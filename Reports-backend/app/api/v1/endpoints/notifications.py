# app/api/v1/endpoints/notifications.py
#
# Notification endpoints for in-app alerts.
# Supports:
#   GET  /notifications           – list unread (and recent read) for current user
#   POST /notifications/{id}/read – mark one notification as read
#   POST /notifications/read-all  – mark all notifications as read

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

from app.core.database import get_db
from app.api.deps import require_any
from app.models.notification import Notification

router = APIRouter(prefix="/notifications", tags=["Notifications"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: UUID
    type: str
    title: str
    body: Optional[str]
    report_id: Optional[UUID]
    thread_id: Optional[UUID]
    is_read: bool
    created_at: datetime

    class Config:
        from_attributes = True



# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=List[NotificationOut])
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns the 50 most recent notifications for the current user,
    newest first regardless of read/unread status.
    """
    stmt = (
        select(Notification)
        .where(Notification.user_id == str(current_user.id))
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    result = await db.execute(stmt)
    return result.scalars().all()


@router.post("/read-all", status_code=204)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """Mark all of the current user's notifications as read."""
    stmt = (
        select(Notification)
        .where(Notification.user_id == str(current_user.id), Notification.is_read == False)
    )
    result = await db.execute(stmt)
    notifications = result.scalars().all()
    for n in notifications:
        n.is_read = True
    await db.commit()


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_one_read(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """Mark a single notification as read."""
    stmt = select(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == str(current_user.id),
    )
    result = await db.execute(stmt)
    notif = result.scalars().first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    await db.commit()
    await db.refresh(notif)
    return notif
