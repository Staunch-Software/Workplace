import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control_database import get_control_db
from app.database import get_db
from app.dependencies import assert_vessel_access, get_current_user, is_shore
from app.models.control_user import ControlUser
from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertAttachment, OrbAlertThread
from app.models.vessel import Vessel
from app.schemas.common import success
from app.services import alert_chat, alert_chat_storage, orb_notify

router = APIRouter(prefix="/alerts", tags=["alert-chat"])

MAX_BODY_CHARS = 4000


async def _alert_for(db: AsyncSession, user: ControlUser, alert_id: uuid.UUID) -> OrbAlert:
    alert = (await db.execute(select(OrbAlert).where(OrbAlert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await assert_vessel_access(user, db, alert.vessel_id)
    return alert


def _thread_dict(t: OrbAlertThread, attachments: list) -> dict:
    return {
        "id": str(t.id), "alert_id": str(t.alert_id), "author_id": str(t.author_id), "author_name": t.author_name,
        "author_role": t.author_role, "body": t.body, "is_internal": t.is_internal,
        "tagged_user_ids": t.tagged_user_ids or [], "created_at": t.created_at.isoformat() if t.created_at else None,
        "attachments": [{"id": str(a.id), "file_name": a.file_name, "file_size": a.file_size, "content_type": a.content_type}
                        for a in attachments],
    }


async def _attachments_by_thread(db: AsyncSession, thread_ids: list) -> dict:
    out: dict = {}
    if thread_ids:
        rows = (await db.execute(select(OrbAlertAttachment).where(OrbAlertAttachment.thread_id.in_(thread_ids))
                                 .order_by(OrbAlertAttachment.created_at))).scalars().all()
        for a in rows:
            out.setdefault(a.thread_id, []).append(a)
    return out


@router.get("/{alert_id}/threads")
async def list_threads(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """The chat of an alert. Vessel users only ever receive the external messages (decided here,
    not in the browser)."""
    await _alert_for(db, user, alert_id)
    q = select(OrbAlertThread).where(OrbAlertThread.alert_id == alert_id).order_by(OrbAlertThread.created_at, OrbAlertThread.id)
    if not is_shore(user):
        q = q.where(OrbAlertThread.is_internal == False)  # noqa: E712
    threads = (await db.execute(q)).scalars().all()
    atts = await _attachments_by_thread(db, [t.id for t in threads])
    return success(data=[_thread_dict(t, atts.get(t.id, [])) for t in threads])


@router.get("/{alert_id}/mentionable-users")
async def mentionable_users(
    alert_id: uuid.UUID,
    internal: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(get_current_user),
):
    alert = await _alert_for(db, user, alert_id)
    if internal and not is_shore(user):
        raise HTTPException(status_code=403, detail="Internal notes are for shore users only")
    vessel = (await db.execute(select(Vessel).where(Vessel.id == alert.vessel_id))).scalar_one()
    users = await alert_chat.fetch_mentionable(control_db, vessel.imo_number, internal, user.id)
    return success(data=users)


@router.post("/{alert_id}/threads")
async def post_thread(
    alert_id: uuid.UUID,
    body: str = Form(""),
    is_internal: bool = Form(False),
    tagged_user_ids: str = Form(""),
    client_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(get_current_user),
):
    alert = await _alert_for(db, user, alert_id)

    if is_internal and not is_shore(user):
        raise HTTPException(status_code=403, detail="Only shore users can write internal notes")
    body = (body or "").strip()
    if len(body) > MAX_BODY_CHARS:
        raise HTTPException(status_code=400, detail=f"Message is longer than {MAX_BODY_CHARS} characters")
    files = [f for f in files if f and f.filename]
    if not body and not files:
        raise HTTPException(status_code=400, detail="Write a message or attach a file")
    if len(files) > alert_chat_storage.MAX_FILES_PER_MESSAGE:
        raise HTTPException(status_code=400, detail=f"At most {alert_chat_storage.MAX_FILES_PER_MESSAGE} files per message")

    cid = None
    if client_id:
        try:
            cid = uuid.UUID(client_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid client_id")
        existing = (await db.execute(select(OrbAlertThread).where(OrbAlertThread.client_id == cid))).scalar_one_or_none()
        if existing is not None:
            if existing.alert_id != alert_id or existing.author_id != user.id:
                raise HTTPException(status_code=409, detail="client_id already used")
            atts = await _attachments_by_thread(db, [existing.id])
            return success(data=_thread_dict(existing, atts.get(existing.id, [])), message="Message already sent")

    # Tagged users: only people who can actually see this message are kept.
    wanted: list[str] = []
    raw = (tagged_user_ids or "").strip()
    if raw:
        try:
            parsed = json.loads(raw) if raw.startswith("[") else [p for p in raw.split(",") if p.strip()]
            wanted = [str(uuid.UUID(str(p).strip())) for p in parsed]
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="tagged_user_ids must be a list of user ids")
    tagged: list[str] = []
    if wanted:
        vessel = (await db.execute(select(Vessel).where(Vessel.id == alert.vessel_id))).scalar_one()
        allowed = {u["id"] for u in await alert_chat.fetch_mentionable(control_db, vessel.imo_number, is_internal, user.id)}
        tagged = [w for w in dict.fromkeys(wanted) if w in allowed]

    # Validate every file before anything is stored.
    contents = []
    for f in files:
        data = await f.read()
        ctype = alert_chat_storage.validate_attachment(f.filename, len(data))
        contents.append((alert_chat_storage.safe_filename(f.filename), data, ctype))

    thread = OrbAlertThread(
        id=uuid.uuid4(), alert_id=alert_id, vessel_id=alert.vessel_id, author_id=user.id,
        author_name=user.full_name, author_role=user.role, body=body, is_internal=bool(is_internal),
        tagged_user_ids=tagged, client_id=cid,
    )
    db.add(thread)
    await db.flush()
    saved = []
    for name, data, ctype in contents:
        path = await alert_chat_storage.save_attachment(data, name, ctype, alert_id)
        att = OrbAlertAttachment(id=uuid.uuid4(), thread_id=thread.id, file_name=name, file_size=len(data),
                                 content_type=ctype, storage_path=path)
        db.add(att)
        saved.append(att)
    await alert_chat.mark_read(db, alert_id, user.id, datetime.now(timezone.utc))
    await db.commit()
    await db.refresh(thread)
    vessel = (await db.execute(select(Vessel).where(Vessel.id == alert.vessel_id))).scalar_one()
    await orb_notify.on_message_posted(db, control_db, alert=alert, vessel=vessel, thread=thread, author=user,
                                       tagged=tagged, has_files=bool(saved))
    return success(data=_thread_dict(thread, saved), message="Message sent")


@router.get("/{alert_id}/threads/{thread_id}/attachments/{attachment_id}")
async def download_attachment(
    alert_id: uuid.UUID,
    thread_id: uuid.UUID,
    attachment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    await _alert_for(db, user, alert_id)
    thread = (await db.execute(select(OrbAlertThread).where(OrbAlertThread.id == thread_id, OrbAlertThread.alert_id == alert_id))).scalar_one_or_none()
    # An internal note's files are as hidden as the note itself.
    if thread is None or (thread.is_internal and not is_shore(user)):
        raise HTTPException(status_code=404, detail="Attachment not found")
    att = (await db.execute(select(OrbAlertAttachment).where(OrbAlertAttachment.id == attachment_id, OrbAlertAttachment.thread_id == thread_id))).scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        content = await alert_chat_storage.read_attachment(att.storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The file is no longer available")
    return Response(content=content, media_type=att.content_type,
                    headers={"Content-Disposition": f'inline; filename="{alert_chat_storage.safe_filename(att.file_name)}"'})


@router.post("/{alert_id}/threads/mark-read")
async def mark_threads_read(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    await _alert_for(db, user, alert_id)
    await alert_chat.mark_read(db, alert_id, user.id, datetime.now(timezone.utc))
    await db.commit()
    return success(message="Marked as read")
