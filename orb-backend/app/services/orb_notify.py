"""Who gets told what: the notification bell and the activity feed of ORB.

Called after the action that caused it has been committed. Telling people must never undo or fail
the action, so every public function here swallows and logs its own errors.
"""
import logging
import uuid
from typing import Iterable, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertThread
from app.models.orb_notification import OrbFeedEvent, OrbNotification

logger = logging.getLogger(__name__)

SNIPPET = 140


def _snippet(body: str, has_files: bool) -> str:
    body = " ".join((body or "").split())
    if not body:
        return "sent an attachment" if has_files else ""
    return body if len(body) <= SNIPPET else body[:SNIPPET - 1] + "…"


def _alert_title(alert: OrbAlert) -> str:
    return alert.alert_type.replace("_", " ").title()


def alert_link(alert_id) -> str:
    return f"/alerts?alert={alert_id}"


async def fetch_assigned_shore(control_db: AsyncSession, vessel_imo: str) -> list[uuid.UUID]:
    """Shore users assigned to the vessel who have ORB access."""
    rows = await control_db.execute(text("""
        SELECT u.id FROM users u JOIN user_vessel_link l ON l.user_id = u.id
        WHERE l.vessel_imo = :imo AND u.is_active AND u.role = 'SHORE'
          AND COALESCE(u.permissions ->> 'orb', 'false') = 'true'
    """), {"imo": str(vessel_imo)})
    return [r[0] for r in rows.fetchall()]


def _add_notifications(db: AsyncSession, user_ids: Iterable[uuid.UUID], **fields) -> int:
    n = 0
    for uid in dict.fromkeys(user_ids):
        db.add(OrbNotification(id=uuid.uuid4(), user_id=uid, **fields))
        n += 1
    return n


def _add_feed(db: AsyncSession, **fields) -> None:
    db.add(OrbFeedEvent(id=uuid.uuid4(), **fields))


async def _participants(db: AsyncSession, alert_id: uuid.UUID, shore_side_only: bool) -> set[uuid.UUID]:
    rows = (await db.execute(
        select(OrbAlertThread.author_id, OrbAlertThread.author_role).where(OrbAlertThread.alert_id == alert_id).distinct()
    )).all()
    return {uid for uid, role in rows if not (shore_side_only and role == "VESSEL")}


async def on_message_posted(db: AsyncSession, control_db: AsyncSession, *, alert: OrbAlert, vessel, thread: OrbAlertThread,
                            author, tagged: list[str], has_files: bool) -> None:
    """A chat message was posted: tell the people tagged and the people already in the conversation."""
    try:
        snippet = _snippet(thread.body, has_files)
        where = f"{_alert_title(alert)} · {vessel.name}"
        tagged_ids = {uuid.UUID(t) for t in tagged}

        audience = await _participants(db, alert.id, shore_side_only=thread.is_internal)
        if author.role == "VESSEL" and not thread.is_internal:
            audience |= set(await fetch_assigned_shore(control_db, vessel.imo_number))   # shore must learn of vessel replies
        audience.discard(author.id)

        common = dict(vessel_id=vessel.id, alert_id=alert.id, sender_name=author.full_name, link=alert_link(alert.id))
        mention_ids = tagged_ids - {author.id}
        _add_notifications(db, mention_ids, type="MENTION", title=f"{author.full_name} mentioned you on {where}",
                           message=snippet, **common)
        _add_notifications(db, audience - mention_ids, type="MESSAGE",
                           title=f"{'Internal note' if thread.is_internal else 'New message'} on {where}",
                           message=f"{author.full_name}: {snippet}", **common)

        _add_feed(db, event_type="MENTION" if mention_ids else "MESSAGE", vessel_id=vessel.id, alert_id=alert.id,
                  title=f"{author.full_name} {'wrote an internal note' if thread.is_internal else 'wrote'} on {where}",
                  message=snippet, link=alert_link(alert.id), actor_name=author.full_name, actor_id=author.id, shore_only=thread.is_internal)
        await db.commit()
    except Exception:
        logger.exception("Could not create notifications for a message on alert %s", alert.id)
        await db.rollback()


async def on_alert_resolved(db: AsyncSession, *, alert: OrbAlert, vessel, actor) -> None:
    try:
        where = f"{_alert_title(alert)} · {vessel.name}"
        audience = await _participants(db, alert.id, shore_side_only=False)
        audience.discard(actor.id)
        _add_notifications(db, audience, type="RESOLVED", title=f"Alert resolved: {where}", message=f"Resolved by {actor.full_name}",
                           vessel_id=vessel.id, alert_id=alert.id, sender_name=actor.full_name, link=alert_link(alert.id))
        _add_feed(db, event_type="RESOLVED", vessel_id=vessel.id, alert_id=alert.id, title=f"{actor.full_name} resolved {where}",
                  message=alert.message, link=alert_link(alert.id), actor_name=actor.full_name, actor_id=actor.id, shore_only=False)
        await db.commit()
    except Exception:
        logger.exception("Could not create notifications for resolved alert %s", alert.id)
        await db.rollback()


async def on_upload_finished(db: AsyncSession, *, upload, vessel_name: str, entries: int, alert_counts: dict,
                             failed: bool = False, error: str = "") -> None:
    """Extraction finished (or failed): tell the uploader, and put the upload and its alerts in the feed."""
    try:
        link = f"/uploads/{upload.id}"
        if failed:
            _add_notifications(db, [upload.uploaded_by], type="UPLOAD", title=f"Upload failed: {upload.original_filename}",
                               message=f"{vessel_name} \u00b7 {(error or 'No entries could be extracted')[:200]}",
                               vessel_id=upload.vessel_id, link=link)
            _add_feed(db, event_type="UPLOAD", vessel_id=upload.vessel_id, upload_id=upload.id,
                      title=f"ORB upload failed for {vessel_name}", message=upload.original_filename, link=link, shore_only=True)
            await db.commit()
            return
        total_alerts = sum(alert_counts.values())
        summary = f"{entries} entries extracted" + (f", {total_alerts} alert{'s' if total_alerts != 1 else ''} raised" if total_alerts else "")
        _add_notifications(db, [upload.uploaded_by], type="UPLOAD", title=f"Upload finished: {upload.original_filename}",
                           message=f"{vessel_name} · {summary}", vessel_id=upload.vessel_id, link=link)
        _add_feed(db, event_type="UPLOAD", vessel_id=upload.vessel_id, upload_id=upload.id,
                  title=f"ORB upload finished for {vessel_name}", message=f"{upload.original_filename} · {summary}",
                  link=link, shore_only=True)
        if total_alerts:
            parts = ", ".join(f"{alert_counts[s]} {s}" for s in ("critical", "major", "minor", "observation") if alert_counts.get(s))
            _add_feed(db, event_type="ALERTS_RAISED", vessel_id=upload.vessel_id, upload_id=upload.id,
                      title=f"{total_alerts} new alert{'s' if total_alerts != 1 else ''} on {vessel_name}", message=parts,
                      link="/alerts", shore_only=False, meta=alert_counts)
        await db.commit()
    except Exception:
        logger.exception("Could not create notifications for upload %s", getattr(upload, "id", None))
        await db.rollback()
