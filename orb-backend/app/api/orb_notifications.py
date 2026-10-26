import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import allowed_vessel_ids, get_current_user, is_shore
from app.models.control_user import ControlUser
from app.models.orb_alert import OrbAlert
from app.models.orb_notification import OrbFeedEvent, OrbFeedRead, OrbNotification
from app.models.vessel import Vessel
from app.schemas.common import success
from app.services.clock import utc_now
from app.services.sync_outbox import enqueue

router = APIRouter(tags=["notifications"])

# Not read yet: no row, or a row marked unread. (Unread is a state, not a deleted row, so it can sync.)
_unread = or_(OrbFeedRead.event_id.is_(None), OrbFeedRead.is_read == False)  # noqa: E712


async def _set_feed_read(db: AsyncSession, user_id: uuid.UUID, event_id: uuid.UUID, is_read: bool) -> None:
    """Mark one event read / unread for a user; the caller commits. Queued for the VM when this is a vessel."""
    now = utc_now()
    rec = await db.get(OrbFeedRead, (event_id, user_id))
    if rec is None:
        db.add(OrbFeedRead(event_id=event_id, user_id=user_id, is_read=is_read, read_at=now, updated_at=now))
    elif rec.is_read == is_read:
        return
    else:
        rec.is_read = is_read
        rec.updated_at = now
        if is_read:
            rec.read_at = now
    enqueue(db, "feed_read", event_id, {"event_id": str(event_id), "user_id": str(user_id), "is_read": is_read,
                                        "read_at": now.isoformat(), "updated_at": now.isoformat()})

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
    since = utc_now() - timedelta(days=KEEP_DAYS)
    base = (OrbNotification.user_id == user.id, OrbNotification.created_at >= since)
    items = (await db.execute(select(OrbNotification).where(*base).order_by(OrbNotification.created_at.desc()).limit(limit))).scalars().all()
    unread = (await db.execute(select(func.count(OrbNotification.id)).where(*base, OrbNotification.is_read == False))).scalar() or 0  # noqa: E712
    return success(data={"items": [_notification_dict(n) for n in items], "unread_count": unread})


@router.post("/notifications/read-all")
async def read_all_notifications(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    unread_ids = (await db.execute(select(OrbNotification.id).where(OrbNotification.user_id == user.id, OrbNotification.is_read == False))).scalars().all()  # noqa: E712
    await db.execute(update(OrbNotification).where(OrbNotification.user_id == user.id, OrbNotification.is_read == False).values(is_read=True))  # noqa: E712
    for nid in unread_ids:
        enqueue(db, "notification", nid, {"id": str(nid), "is_read": True})
    await db.commit()
    return success(message="All notifications marked as read")


@router.post("/notifications/{notification_id}/read")
async def read_notification(notification_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    res = await db.execute(update(OrbNotification).where(OrbNotification.id == notification_id, OrbNotification.user_id == user.id).values(is_read=True))
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
    enqueue(db, "notification", notification_id, {"id": str(notification_id), "is_read": True})
    await db.commit()
    return success(message="Marked as read")


async def _visible_events(db: AsyncSession, user: ControlUser):
    """SQL conditions for the feed events this user may see: their vessels, and no shore-only events for vessel users."""
    since = utc_now() - timedelta(days=KEEP_DAYS)
    conds = [OrbFeedEvent.created_at >= since]
    allowed = await allowed_vessel_ids(user, db)
    if allowed is not None:
        conds.append(OrbFeedEvent.vessel_id.in_(allowed))
    if not is_shore(user):
        conds.append(OrbFeedEvent.shore_only == False)  # noqa: E712
    return conds


@router.get("/feed")
async def list_feed(
    limit: int = Query(150, ge=1, le=300),
    vessel_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """Activity on the caller's vessels (messages, mentions, resolution steps, finished uploads, new alerts).

    Each item says whether it was addressed to the caller (`for_me`, My Feed) or mentions them (`mentioned_me`);
    other people's ids never leave the server. Filtering by severity / type / vessel / date is done by the page."""
    conds = await _visible_events(db, user)
    if vessel_id:
        conds.append(OrbFeedEvent.vessel_id == vessel_id)
    # Hide orphaned feed events for alerts that were deleted
    conds.append(or_(OrbFeedEvent.alert_id.is_(None), OrbFeedEvent.alert_id.in_(select(OrbAlert.id))))
    read = (OrbFeedRead.event_id == OrbFeedEvent.id) & (OrbFeedRead.user_id == user.id)
    rows = (await db.execute(
        select(OrbFeedEvent, OrbFeedRead.is_read, Vessel.name, OrbAlert.severity, OrbAlert.alert_type, OrbAlert.status)
        .outerjoin(OrbFeedRead, read)
        .join(Vessel, Vessel.id == OrbFeedEvent.vessel_id)
        .outerjoin(OrbAlert, OrbAlert.id == OrbFeedEvent.alert_id)
        .where(*conds).order_by(OrbFeedEvent.created_at.desc()).limit(limit)
    )).all()
    not_mine = or_(OrbFeedEvent.actor_id.is_(None), OrbFeedEvent.actor_id != user.id)   # your own activity is never "new" to you
    unread = (await db.execute(
        select(func.count(OrbFeedEvent.id)).outerjoin(OrbFeedRead, read).where(*conds, not_mine, _unread)
    )).scalar() or 0
    me = str(user.id)
    items = []
    for e, read_id, vessel_name, severity, alert_type, alert_status in rows:
        meta = dict(e.meta or {})
        recipients = meta.pop("recipient_ids", None) or []
        mentioned = meta.pop("mentioned_user_ids", None) or []
        own = e.actor_id == user.id
        items.append({
            "id": str(e.id), "event_type": e.event_type, "vessel_id": str(e.vessel_id), "vessel_name": vessel_name,
            "alert_id": str(e.alert_id) if e.alert_id else None, "upload_id": str(e.upload_id) if e.upload_id else None,
            "alert_type": alert_type, "severity": severity, "alert_status": alert_status,
            "title": e.title, "message": e.message, "link": e.link, "actor_name": e.actor_name, "own": own,
            "shore_only": e.shore_only, "for_me": (me in recipients) or (not is_shore(user) and not e.shore_only), "mentioned_me": me in mentioned, "meta": meta,
            "is_read": bool(read_id) or own, "created_at": e.created_at.isoformat(),
        })
    return success(data={"items": items, "unread_count": unread})


@router.post("/feed/read-all")
async def read_all_feed(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    conds = await _visible_events(db, user)
    read = (OrbFeedRead.event_id == OrbFeedEvent.id) & (OrbFeedRead.user_id == user.id)
    ids = (await db.execute(select(OrbFeedEvent.id).outerjoin(OrbFeedRead, read).where(*conds, _unread))).scalars().all()
    for eid in ids:
        await _set_feed_read(db, user.id, eid, True)
    await db.commit()
    return success(message=f"{len(ids)} events marked as read")


@router.post("/feed/{event_id}/read")
async def read_feed_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    conds = await _visible_events(db, user)
    visible = (await db.execute(select(OrbFeedEvent.id).where(OrbFeedEvent.id == event_id, *conds))).scalar_one_or_none()
    if visible is None:
        raise HTTPException(status_code=404, detail="Event not found")
    await _set_feed_read(db, user.id, event_id, True)
    await db.commit()
    return success(message="Marked as read")


@router.post("/feed/{event_id}/unread")
async def unread_feed_event(event_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """Mark an event as unread again (not for your own activity, which is always read)."""
    conds = await _visible_events(db, user)
    event = (await db.execute(select(OrbFeedEvent).where(OrbFeedEvent.id == event_id, *conds))).scalar_one_or_none()
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.actor_id == user.id:
        raise HTTPException(status_code=400, detail="Your own activity is always read")
    await _set_feed_read(db, user.id, event_id, False)
    await db.commit()
    return success(message="Marked as unread")
