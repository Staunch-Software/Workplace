"""The notification bell (a user's own items) and the activity feed (everything happening on incidents)."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user
from app.models.control_user import ControlUser
from app.models.incident import Incident, IncidentFeedEvent, IncidentFeedRead, IncidentNotification
from app.schemas.common import success

router = APIRouter(tags=["notifications"])

KEEP_DAYS = 60   # older items are not listed

# Not read yet: no row, or a row marked unread. (Unread is a state, not a deleted row.)
_unread = or_(IncidentFeedRead.event_id.is_(None), IncidentFeedRead.is_read == False)  # noqa: E712


def _since() -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)


def _iso(d) -> str:
    return d.isoformat() if d else None


def _notification_dict(n: IncidentNotification) -> dict:
    return {"id": str(n.id), "type": n.type, "title": n.title, "message": n.message, "link": n.link,
            "incident_id": str(n.incident_id) if n.incident_id else None, "sender_name": n.sender_name,
            "is_read": n.is_read, "created_at": _iso(n.created_at)}


async def _set_feed_read(db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID, is_read: bool) -> None:
    """Mark one event read / unread for a user; the caller commits."""
    now = datetime.now(timezone.utc)
    rec = await db.get(IncidentFeedRead, (event_id, user_id))
    if rec is None:
        db.add(IncidentFeedRead(event_id=event_id, user_id=user_id, is_read=is_read, read_at=now))
    elif rec.is_read != is_read:
        rec.is_read = is_read
        if is_read:
            rec.read_at = now


def _read_join(user: ControlUser):
    return (IncidentFeedRead.event_id == IncidentFeedEvent.id) & (IncidentFeedRead.user_id == user.id)


def _not_mine(user: ControlUser):
    return or_(IncidentFeedEvent.actor_id.is_(None), IncidentFeedEvent.actor_id != user.id)   # your own activity is never "new" to you


# ── Bell ─────────────────────────────────────────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(limit: int = Query(30, ge=1, le=100), db: AsyncSession = Depends(get_db),
                             user: ControlUser = Depends(get_current_user)):
    """The caller's own notifications, newest first, with the unread count for the bell badge."""
    base = (IncidentNotification.user_id == user.id, IncidentNotification.created_at >= _since())
    items = (await db.execute(select(IncidentNotification).where(*base)
                              .order_by(IncidentNotification.created_at.desc()).limit(limit))).scalars().all()
    unread = (await db.execute(select(func.count(IncidentNotification.id))
                               .where(*base, IncidentNotification.is_read == False))).scalar() or 0  # noqa: E712
    return success(data={"items": [_notification_dict(n) for n in items], "unread_count": unread})


@router.post("/notifications/read-all")
async def read_all_notifications(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await db.execute(update(IncidentNotification)
                     .where(IncidentNotification.user_id == user.id, IncidentNotification.is_read == False)  # noqa: E712
                     .values(is_read=True))
    await db.commit()
    return success(message="All notifications marked as read")


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: uuid.UUID, db: AsyncSession = Depends(get_db),
                            user: ControlUser = Depends(get_current_user)):
    res = await db.execute(update(IncidentNotification)
                           .where(IncidentNotification.id == notification_id, IncidentNotification.user_id == user.id)
                           .values(is_read=True))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.commit()
    return success(message="Marked as read")


# ── Feed ─────────────────────────────────────────────────────────────────────────────────────

@router.get("/feed")
async def list_feed(
    limit: int = Query(150, ge=1, le=300),
    vessel_imo: Optional[str] = Query(None),
    incident_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """Activity on incidents (created, messages, mentions, closed/reopened, evidence added).

    Each item says whether it was addressed to the caller (`for_me`, My Feed) or mentions them (`mentioned_me`);
    other people's ids never leave the server. Filtering by type / date is done by the page."""
    conds = [IncidentFeedEvent.created_at >= _since()]
    if vessel_imo:
        conds.append(Incident.vessel_imo == vessel_imo)
    if incident_id:
        conds.append(IncidentFeedEvent.incident_id == incident_id)
    rows = (await db.execute(
        select(IncidentFeedEvent, IncidentFeedRead.is_read, Incident.incident_no, Incident.vessel_name,
               Incident.vessel_imo, Incident.status, Incident.category)
        .outerjoin(IncidentFeedRead, _read_join(user))
        .join(Incident, Incident.id == IncidentFeedEvent.incident_id)
        .where(*conds).order_by(IncidentFeedEvent.created_at.desc()).limit(limit)
    )).all()
    unread = (await db.execute(
        select(func.count(IncidentFeedEvent.id)).outerjoin(IncidentFeedRead, _read_join(user))
        .where(IncidentFeedEvent.created_at >= _since(), _not_mine(user), _unread)
    )).scalar() or 0
    me = str(user.id)
    items = []
    for e, read_flag, incident_no, vessel_name, vessel_imo, status, category in rows:
        meta = dict(e.meta or {})
        recipients = meta.pop("recipient_ids", None) or []
        mentioned = meta.pop("mentioned_user_ids", None) or []
        own = e.actor_id == user.id
        items.append({
            "id": str(e.id), "event_type": e.event_type, "incident_id": str(e.incident_id),
            "incident_no": incident_no, "vessel_name": vessel_name, "vessel_imo": vessel_imo,
            "incident_status": status, "category": category,
            "title": e.title, "message": e.message, "link": e.link, "actor_name": e.actor_name, "own": own,
            "for_me": me in recipients, "mentioned_me": me in mentioned, "meta": meta,
            # No row at all = never opened; a row is read unless it was flipped back to unread.
            "is_read": own or (read_flag is not None and bool(read_flag)),
            "created_at": _iso(e.created_at),
        })
    return success(data={"items": items, "unread_count": unread})


@router.get("/feed/unread-count")
async def feed_unread_count(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """Just the number, for the badge on the Feed tab (cheap to poll)."""
    unread = (await db.execute(
        select(func.count(IncidentFeedEvent.id)).outerjoin(IncidentFeedRead, _read_join(user))
        .where(IncidentFeedEvent.created_at >= _since(), _not_mine(user), _unread)
    )).scalar() or 0
    return success(data={"unread_count": unread})


@router.post("/feed/read-all")
async def read_all_feed(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    ids = (await db.execute(
        select(IncidentFeedEvent.id).outerjoin(IncidentFeedRead, _read_join(user))
        .where(IncidentFeedEvent.created_at >= _since(), _unread)
    )).scalars().all()
    for eid in ids:
        await _set_feed_read(db, user.id, eid, True)
    await db.commit()
    return success(message=f"{len(ids)} events marked as read")


async def _visible_event(db: AsyncSession, event_id: uuid.UUID) -> IncidentFeedEvent:
    event = (await db.execute(select(IncidentFeedEvent).where(IncidentFeedEvent.id == event_id))).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/feed/{event_id}/read")
async def read_feed_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await _visible_event(db, event_id)
    await _set_feed_read(db, user.id, event_id, True)
    await db.commit()
    return success(message="Marked as read")


@router.post("/feed/{event_id}/unread")
async def unread_feed_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """Mark an event as unread again (not for your own activity, which is always read)."""
    event = await _visible_event(db, event_id)
    if event.actor_id == user.id:
        raise HTTPException(status_code=400, detail="Your own activity is always read")
    await _set_feed_read(db, user.id, event_id, False)
    await db.commit()
    return success(message="Marked as unread")
