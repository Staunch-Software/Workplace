"""Internal chat on an incident: everyone with module access can read and write; nothing is visible outside."""
import json
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.control_database import get_control_db
from app.database import get_db
from app.dependencies import get_current_user
from app.models.control_user import ControlUser
from app.models.incident import Incident, IncidentThread, IncidentThreadAttachment, IncidentThreadRead
from app.schemas.common import success
from app.services import incident_notify, storage

settings = get_settings()
router = APIRouter(prefix="/incidents", tags=["incident-chat"])

MAX_BODY_CHARS = 4000


async def _incident_exists(db: AsyncSession, incident_id: uuid.UUID) -> Incident:
    incident = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one_or_none()
    if incident is None:
        raise HTTPException(status_code=404, detail="Incident not found")
    return incident


def _thread_dict(t: IncidentThread, attachments: list) -> dict:
    return {
        "id": str(t.id), "incident_id": str(t.incident_id), "author_id": str(t.author_id),
        "author_name": t.author_name, "author_role": t.author_role, "body": t.body,
        "tagged_user_ids": t.tagged_user_ids or [], "created_at": t.created_at.isoformat() if t.created_at else None,
        "attachments": [{"id": str(a.id), "file_name": a.file_name, "file_size": a.file_size, "content_type": a.content_type}
                        for a in attachments],
    }


async def _attachments_by_thread(db: AsyncSession, thread_ids: list) -> dict:
    out: dict = {}
    if thread_ids:
        rows = (await db.execute(select(IncidentThreadAttachment).where(IncidentThreadAttachment.thread_id.in_(thread_ids))
                                 .order_by(IncidentThreadAttachment.created_at))).scalars().all()
        for a in rows:
            out.setdefault(a.thread_id, []).append(a)
    return out


async def fetch_mentionable(control_db: AsyncSession, exclude_id: uuid.UUID) -> list[dict]:
    """The people who can be tagged with @: only users assigned to the module (Incident Reports switched on)."""
    out = [{"id": str(u["id"]), "name": u["name"], "role": u["role"]}
           for u in await incident_notify.module_users(control_db) if u["id"] != exclude_id]
    out.sort(key=lambda u: u["name"].lower())
    return out


async def _mark_read(db: AsyncSession, incident_id: uuid.UUID, user_id: uuid.UUID) -> None:
    now = datetime.now(timezone.utc)
    rec = await db.get(IncidentThreadRead, (incident_id, user_id))
    if rec is None:
        db.add(IncidentThreadRead(incident_id=incident_id, user_id=user_id, last_read_at=now))
    else:
        rec.last_read_at = now


@router.get("/{incident_id}/threads")
async def list_threads(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await _incident_exists(db, incident_id)
    threads = (await db.execute(select(IncidentThread).where(IncidentThread.incident_id == incident_id)
                                .order_by(IncidentThread.created_at, IncidentThread.id))).scalars().all()
    atts = await _attachments_by_thread(db, [t.id for t in threads])
    return success(data=[_thread_dict(t, atts.get(t.id, [])) for t in threads])


@router.get("/{incident_id}/mentionable-users")
async def mentionable_users(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                            control_db: AsyncSession = Depends(get_control_db), user: ControlUser = Depends(get_current_user)):
    await _incident_exists(db, incident_id)
    return success(data=await fetch_mentionable(control_db, user.id))


@router.post("/{incident_id}/threads")
async def post_thread(
    incident_id: uuid.UUID,
    body: str = Form(""),
    tagged_user_ids: str = Form(""),
    client_id: Optional[str] = Form(None),
    files: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(get_current_user),
):
    incident = await _incident_exists(db, incident_id)
    body = (body or "").strip()
    if len(body) > MAX_BODY_CHARS:
        raise HTTPException(status_code=400, detail=f"Message is longer than {MAX_BODY_CHARS} characters")
    files = [f for f in files if f and f.filename]
    if not body and not files:
        raise HTTPException(status_code=400, detail="Write a message or attach a file")
    if len(files) > storage.MAX_FILES_PER_MESSAGE:
        raise HTTPException(status_code=400, detail=f"At most {storage.MAX_FILES_PER_MESSAGE} files per message")

    cid = None
    if client_id:
        try:
            cid = uuid.UUID(str(client_id).strip())
        except ValueError:
            cid = uuid.uuid5(uuid.NAMESPACE_OID, str(client_id).strip())
        existing = (await db.execute(select(IncidentThread).where(IncidentThread.client_id == cid))).scalar_one_or_none()
        if existing is not None:
            if existing.incident_id != incident_id or existing.author_id != user.id:
                raise HTTPException(status_code=409, detail="client_id already used")
            atts = await _attachments_by_thread(db, [existing.id])
            return success(data=_thread_dict(existing, atts.get(existing.id, [])), message="Message already sent")

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
        allowed = {u["id"] for u in await fetch_mentionable(control_db, user.id)}
        tagged = [w for w in dict.fromkeys(wanted) if w in allowed]

    contents = []
    for f in files:
        data = await f.read()
        ctype = storage.validate_file(f.filename, len(data), settings.MAX_CHAT_ATTACHMENT_MB)
        contents.append((storage.safe_filename(f.filename), data, ctype))

    thread = IncidentThread(id=uuid.uuid4(), incident_id=incident_id, author_id=user.id, author_name=user.full_name,
                            author_role=user.role, body=body, tagged_user_ids=tagged, client_id=cid)
    db.add(thread)
    await db.flush()
    saved = []
    for name, data, ctype in contents:
        path = await storage.save(data, name, ctype, incident_id, chat=True)
        att = IncidentThreadAttachment(id=uuid.uuid4(), thread_id=thread.id, file_name=name, file_size=len(data),
                                       content_type=ctype, storage_path=path)
        db.add(att)
        saved.append(att)
    await _mark_read(db, incident_id, user.id)
    await db.commit()
    await db.refresh(thread)
    await incident_notify.on_message_posted(db, control_db, incident=incident, thread=thread, author=user,
                                            tagged=tagged, has_files=bool(saved))
    return success(data=_thread_dict(thread, saved), message="Message sent")


@router.get("/{incident_id}/threads/{thread_id}/attachments/{attachment_id}")
async def download_attachment(incident_id: uuid.UUID, thread_id: uuid.UUID, attachment_id: uuid.UUID,
                              db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    thread = (await db.execute(select(IncidentThread).where(IncidentThread.id == thread_id, IncidentThread.incident_id == incident_id))).scalar_one_or_none()
    if thread is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    att = (await db.execute(select(IncidentThreadAttachment).where(
        IncidentThreadAttachment.id == attachment_id, IncidentThreadAttachment.thread_id == thread_id))).scalar_one_or_none()
    if att is None:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        content = await storage.read(att.storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The file is no longer available")
    return Response(content=content, media_type=att.content_type,
                    headers={"Content-Disposition": f'inline; filename="{storage.safe_filename(att.file_name)}"'})


@router.post("/{incident_id}/threads/mark-read")
async def mark_threads_read(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await _incident_exists(db, incident_id)
    await _mark_read(db, incident_id, user.id)
    await db.commit()
    return success(message="Marked as read")
