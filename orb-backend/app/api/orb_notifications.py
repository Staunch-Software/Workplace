import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import allowed_vessel_ids, get_current_user, is_shore
from app.models.control_user import ControlUser
from app.models.orb_notification import OrbFeedEvent, OrbFeedRead, OrbNotification
from app.schemas.common import success

router = APIRouter(tags=["notifications"])

KEEP_DAYS = 60   # older items are not listed


def _notification_dict(n: OrbNotification) -> dict:
    return {"id": str(n.id), "type": n.type, "title": n.title, "message": n.message, "link": n.link,
            "vessel_id": str(n.vessel_id) if n.vessel_id else None, "alert_id": str(n.alert_id) if n.alert_id else None,
            "sender_name": n.sender_name, "is_read": n.is_read, "created_at": n.created_at.isoformat()}


@router.get("/notifications")
async def list_notifications(
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """The caller's own notifications, newest first, with the unread count for the bell badge."""
    since = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    base = (OrbNotification.user_id == user.id, OrbNotification.created_at >= since)
    items = (await db.execute(select(OrbNotification).where(*base).order_by(OrbNotification.created_at.desc()).limit(limit))).scalars().all()
    unread = (await db.execute(select(func.count(OrbNotification.id)).where(*base, OrbNotification.is_read == False))).scalar() or 0  # noqa: E712
    return success(data={"items": [_notification_dict(n) for n in items], "unread_count": unread})


@router.post("/notifications/read-all")
async def read_all_notifications(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await db.execute(update(OrbNotification).where(OrbNotification.user_id == user.id, OrbNotification.is_read == False).values(is_read=True))  # noqa: E712
    await db.commit()
    return success(message="All notifications marked as read")


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    res = await db.execute(update(OrbNotification).where(OrbNotification.id == notification_id, OrbNotification.user_id == user.id).values(is_read=True))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    await db.commit()
    return success(message="Marked as read")


async def _visible_events(db: AsyncSession, user: ControlUser):
    """SQL conditions for the feed events this user may see: their vessels, and no shore-only events for vessel users."""
    since = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    conds = [OrbFeedEvent.created_at >= since]
    allowed = await allowed_vessel_ids(user, db)
    if allowed is not None:
        conds.append(OrbFeedEvent.vessel_id.in_(allowed))
    if not is_shore(user):
        conds.append(OrbFeedEvent.shore_only == False)  # noqa: E712
    return conds


@router.get("/feed")
async def list_feed(
    limit: int = Query(40, ge=1, le=100),
    vessel_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """Activity on the caller's vessels (messages, mentions, resolved alerts, finished uploads, new alerts)."""
    conds = await _visible_events(db, user)
    if vessel_id:
        conds.append(OrbFeedEvent.vessel_id == vessel_id)
    read = (OrbFeedRead.event_id == OrbFeedEvent.id) & (OrbFeedRead.user_id == user.id)
    rows = (await db.execute(
        select(OrbFeedEvent, OrbFeedRead.event_id).outerjoin(OrbFeedRead, read).where(*conds)
        .order_by(OrbFeedEvent.created_at.desc()).limit(limit)
    )).all()
    not_mine = or_(OrbFeedEvent.actor_id.is_(None), OrbFeedEvent.actor_id != user.id)   # your own activity is never "new" to you
    unread = (await db.execute(
        select(func.count(OrbFeedEvent.id)).outerjoin(OrbFeedRead, read).where(*conds, not_mine, OrbFeedRead.event_id.is_(None))
    )).scalar() or 0
    return success(data={
        "items": [{"id": str(e.id), "event_type": e.event_type, "vessel_id": str(e.vessel_id), "title": e.title, "message": e.message,
                   "link": e.link, "actor_name": e.actor_name, "shore_only": e.shore_only,
                   "is_read": read_id is not None or e.actor_id == user.id, "created_at": e.created_at.isoformat()} for e, read_id in rows],
        "unread_count": unread,
    })


@router.post("/feed/read-all")
async def read_all_feed(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    conds = await _visible_events(db, user)
    read = (OrbFeedRead.event_id == OrbFeedEvent.id) & (OrbFeedRead.user_id == user.id)
    ids = (await db.execute(select(OrbFeedEvent.id).outerjoin(OrbFeedRead, read).where(*conds, OrbFeedRead.event_id.is_(None)))).scalars().all()
    for eid in ids:
        db.add(OrbFeedRead(event_id=eid, user_id=user.id))
    await db.commit()
    return success(message=f"{len(ids)} events marked as read")


@router.post("/feed/{event_id}/read")
async def read_feed_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    conds = await _visible_events(db, user)
    visible = (await db.execute(select(OrbFeedEvent.id).where(OrbFeedEvent.id == event_id, *conds))).scalar_one_or_none()
    if visible is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if await db.get(OrbFeedRead, (event_id, user.id)) is None:
        db.add(OrbFeedRead(event_id=event_id, user_id=user.id))
        await db.commit()
    return success(message="Marked as read")
