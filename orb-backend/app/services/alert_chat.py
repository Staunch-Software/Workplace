"""Alert chat rules shared by the API: who sees which messages, who can be tagged, unread counts."""
import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import is_shore
from app.models.control_user import ControlUser
from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertThread, OrbAlertThreadRead
from app.models.orb_entry import OrbEntry


def visible_threads_filter(user: ControlUser):
    """SQL condition for the messages this user may see: vessel users never see internal notes."""
    return True if is_shore(user) else (OrbAlertThread.is_internal == False)  # noqa: E712


async def fetch_mentionable(control_db: AsyncSession, vessel_imo: str, internal: bool, exclude_id: uuid.UUID) -> list[dict]:
    """Users who can be tagged on an alert of this vessel.

    External chat: the vessel's own users plus shore users assigned to it, plus admins.
    Internal chat: shore side only (shore users assigned to the vessel and admins).
    Everyone must have the ORB permission, except admins who always have access.
    """
    rows = await control_db.execute(text("""
        SELECT u.id, u.full_name, u.role
        FROM users u
        JOIN user_vessel_link l ON l.user_id = u.id
        WHERE l.vessel_imo = :imo AND u.is_active
          AND u.role IN ('SHORE', 'VESSEL')
          AND COALESCE(u.permissions ->> 'orb', 'false') = 'true'
        UNION
        SELECT u.id, u.full_name, u.role FROM users u WHERE u.role = 'ADMIN' AND u.is_active
    """), {"imo": str(vessel_imo)})
    out = []
    for uid, name, role in rows.fetchall():
        if uid == exclude_id or (internal and role == "VESSEL"):
            continue
        out.append({"id": str(uid), "name": name, "role": role})
    out.sort(key=lambda u: (u["role"] == "VESSEL", u["name"].lower()))
    return out


async def thread_stats(db: AsyncSession, user: ControlUser, alert_ids: Iterable[uuid.UUID]) -> dict:
    """{alert_id: (message_count, unread_count)} for the messages this user can see.

    Unread = messages from other people newer than the user's last read marker of that alert."""
    ids = list(alert_ids)
    if not ids:
        return {}
    cond = visible_threads_filter(user)
    q = (
        select(
            OrbAlertThread.alert_id,
            func.count(OrbAlertThread.id),
            func.count(OrbAlertThread.id).filter(
                OrbAlertThread.author_id != user.id,
                (OrbAlertThreadRead.last_read_at.is_(None)) | (OrbAlertThread.created_at > OrbAlertThreadRead.last_read_at),
            ),
        )
        .outerjoin(OrbAlertThreadRead, (OrbAlertThreadRead.alert_id == OrbAlertThread.alert_id) & (OrbAlertThreadRead.user_id == user.id))
        .where(OrbAlertThread.alert_id.in_(ids))
        .group_by(OrbAlertThread.alert_id)
    )
    if cond is not True:
        q = q.where(cond)
    return {aid: (total, unread) for aid, total, unread in (await db.execute(q)).all()}


async def upload_has_alert_chat(db: AsyncSession, upload_id: uuid.UUID) -> bool:
    """True when any alert raised on this upload's entries already has chat messages."""
    entry_ids = select(OrbEntry.id).where(OrbEntry.upload_id == upload_id)
    n = (await db.execute(
        select(func.count(OrbAlertThread.id)).join(OrbAlert, OrbAlert.id == OrbAlertThread.alert_id).where(OrbAlert.entry_id.in_(entry_ids))
    )).scalar() or 0
    return n > 0


async def mark_read(db: AsyncSession, alert_id: uuid.UUID, user_id: uuid.UUID, when: datetime) -> None:
    rec = await db.get(OrbAlertThreadRead, (alert_id, user_id))
    if rec is None:
        db.add(OrbAlertThreadRead(alert_id=alert_id, user_id=user_id, last_read_at=when))
    else:
        rec.last_read_at = when
