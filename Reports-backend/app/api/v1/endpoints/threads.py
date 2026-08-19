# app/api/v1/endpoints/threads.py
#
# Thread (chat) endpoints for a specific report.
# Each report has its own isolated thread.
# Messages sent here are ONLY visible for the selected report_id.
#
# RBAC:
#   GET  /reports/{id}/threads        -> SHORE, ADMIN (read thread)
#   POST /reports/{id}/threads        -> SHORE, ADMIN (post a message)

from uuid import UUID, uuid4
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.database_control import ControlSession
from app.api.deps import require_shore, require_any
from app.models.report import Report, ReportThread, ReportThreadAttachment, ReportEvent
from app.models.notification import Notification
from app.schemas.report import ThreadCreate, ThreadOut, SasUrlOut
from app.core.blob_storage import generate_read_sas_url, generate_write_sas_url


router = APIRouter(prefix="/reports", tags=["Threads"])


@router.get("/{report_id}/threads", response_model=list[ThreadOut])
async def get_threads(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns all chat messages for a specific report.
    Ordered by created_at ASC (oldest first, like a chat window).
    This is ISOLATED: only threads for this report_id are returned.
    """
    stmt = (
        select(ReportThread)
        .where(ReportThread.report_id == report_id)
        .options(selectinload(ReportThread.attachments))
        .order_by(ReportThread.created_at.asc())
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/{report_id}/threads", response_model=ThreadOut)
async def post_thread(
    report_id: UUID,
    payload: ThreadCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Posts a new message to the thread of a specific report.
    Shore/Admin users send messages here.
    Also increments unread_vessel count so the vessel crew sees the notification.
    """
    # Verify report exists
    stmt = select(Report).where(Report.id == report_id)
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Create the thread message
    thread = ReportThread(
        id=uuid4(),
        report_id=report_id,
        author_id=str(current_user.id),
        author_name=current_user.full_name or current_user.email,
        author_role=current_user.role,
        body=payload.body,
        created_at=datetime.utcnow(),
    )
    db.add(thread)
    
    # Process attachments
    if hasattr(payload, 'attachments') and payload.attachments:
        for att in payload.attachments:
            db_att = ReportThreadAttachment(
                id=uuid4(),
                thread_id=thread.id,
                file_name=att.file_name,
                file_size=att.file_size,
                content_type=att.content_type,
                blob_path=att.blob_path,
                created_at=datetime.utcnow()
            )
            db.add(db_att)

    # Bump the OTHER side's unread count: shore replies notify the vessel,
    # vessel replies notify shore. This endpoint is shared by both clients.
    if current_user.role == "VESSEL":
        report.unread_shore += 1
    else:
        report.unread_vessel += 1
    report.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(thread)

    # ── Mention Activity Events ──────────────────────────────────────────────────
    # The frontend's @mention picker already resolves real user ids into
    # payload.tagged_user_ids (see ThreadPanel.jsx selectMention()), so we use
    # those directly instead of re-parsing the free-text body: a body-regex
    # can't reliably tell where a "@Full Name" mention ends and the rest of
    # the sentence begins (e.g. "@Super Admin can you check this" has no
    # delimiter after the name), so it silently failed to match real users.
    if payload.tagged_user_ids:
        try:
            from app.core.database_control import ControlSession
            from sqlalchemy import text as sql_text

            async with ControlSession() as ctrl_db:
                users_res = await ctrl_db.execute(sql_text("SELECT id, full_name FROM users WHERE is_active = true"))
                users_list = users_res.fetchall()

            # Build id→name map for quick lookup
            id_to_name = {str(row[0]): row[1] for row in users_list}

            seen_uids = set()
            for tagged_id in payload.tagged_user_ids:
                uid = str(tagged_id)
                if uid == str(current_user.id) or uid in seen_uids:
                    continue
                full_name = id_to_name.get(uid)
                if not full_name:
                    continue
                seen_uids.add(uid)
                event = ReportEvent(
                    id=uuid4(),
                    vessel_imo=report.vessel_imo,
                    vessel_name=report.vessel_name,
                    report_id=report.id,
                    event_type="MENTION",
                    description=f"{current_user.full_name} mentioned @{full_name} in {report.report_name}",
                    source="SYSTEM",
                    author_name=current_user.full_name,
                    created_at=datetime.utcnow()
                )
                db.add(event)

                # Per-recipient notification for the bell/Notifications Feed
                # (Notification is a separate table from ReportEvent -- the
                # feed above shows this to everyone watching the vessel, this
                # is what actually pings the specific mentioned user).
                notification = Notification(
                    id=uuid4(),
                    user_id=uid,
                    type="mention",
                    title=f"{current_user.full_name} mentioned you — {report.vessel_name}",
                    body=payload.body[:300],
                    report_id=report.id,
                    thread_id=thread.id,
                    is_read=False,
                    created_at=datetime.utcnow(),
                )
                db.add(notification)
            if seen_uids:
                await db.commit()
        except Exception as e:
            import logging
            logging.getLogger("threads").warning(f"Failed to create mention events: {e}")

    # Reload thread to fetch attachments relationship properly for the response
    stmt_reload = select(ReportThread).where(ReportThread.id == thread.id).options(selectinload(ReportThread.attachments))
    res_reload = await db.execute(stmt_reload)
    thread_reloaded = res_reload.scalars().first()

    return thread_reloaded


@router.get("/{report_id}/upload-sas")
async def get_upload_sas(
    report_id: UUID,
    path: str,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns a 24-hour write SAS URL for uploading an attachment directly to blob.
    """
    sas_url = generate_write_sas_url(path)
    return {"url": sas_url}


@router.get("/{report_id}/threads/{thread_id}/attachments/{attachment_id}/url")
async def get_thread_attachment_url(
    report_id: UUID,
    thread_id: UUID,
    attachment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns a 24-hour read SAS URL for downloading a thread attachment.
    """
    stmt = select(ReportThreadAttachment).where(ReportThreadAttachment.id == attachment_id, ReportThreadAttachment.thread_id == thread_id)
    result = await db.execute(stmt)
    attachment = result.scalars().first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
        
    sas_url = generate_read_sas_url(
        attachment.blob_path,
        force_download=True,
        download_filename=attachment.file_name
    )
    return {"url": sas_url}
