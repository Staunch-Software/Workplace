# app/services/live_feed_service.py

from __future__ import annotations
import uuid
from typing import Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.tasks import LiveFeed, FeedEventType
from app.models.vessel import Vessel
from app.models.user import User
from app.models.defect import Defect


async def _get_vessel_name(control_db: AsyncSession, imo: str) -> str:
    result = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    v = result.scalar_one_or_none()
    return v.name if v else imo


async def _get_actor_name(control_db: AsyncSession, user_id: Optional[uuid.UUID]) -> str:
    if not user_id:
        return "System"
    result = await control_db.execute(select(User).where(User.id == user_id))
    u = result.scalar_one_or_none()
    if not u:
        return "Unknown"
    return u.full_name or u.email

# Add this helper below _get_actor_name:
async def _get_actor_role(control_db: AsyncSession, user_id: Optional[uuid.UUID]) -> Optional[str]:
    if not user_id:
        return None
    result = await control_db.execute(select(User).where(User.id == user_id))
    u = result.scalar_one_or_none()
    return u.role if u else None

def _priority_str(defect: Defect) -> str:
    return (
        defect.priority.value
        if hasattr(defect.priority, "value")
        else str(defect.priority)
    )


async def _write(
    db: AsyncSession,
    *,
    defect: Defect,
    event_type: FeedEventType,
    title: str,
    message: str,
    user_id: Optional[uuid.UUID],
    vessel_name: str,
    extra_meta: Optional[dict] = None,
    triggered_by_role: Optional[str] = None,
) -> LiveFeed:
    if triggered_by_role in ("SHORE", "ADMIN"):
        link = f"/drs/shore/dashboard?highlightDefectId={defect.id}"
    else:
        link = f"/drs/vessel/dashboard?highlightDefectId={defect.id}"
    entry = LiveFeed(
        user_id=user_id,
        vessel_imo=defect.vessel_imo,
        vessel_name=vessel_name,
        defect_id=defect.id,
        event_type=event_type,
        title=title,
        message=message,
        link=link,
        is_read=False,
        is_seen=False,
        meta={
            "actor_id": str(user_id) if user_id else None,
            "triggered_by_role": triggered_by_role,
            **(extra_meta or {}),
        },
        updated_at=datetime.utcnow(),
    )
    db.add(entry)
    await db.flush()
    return entry


# ── Public functions ───────────────────────────────────────────────────────────


async def feed_defect_opened(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)
    priority = _priority_str(defect)

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.DEFECT_OPENED,
        title=f"Defect Opened - {defect.title}",
        # Format: Defect was created by User with Priority
        message=f"Defect was created by {actor_name} with {priority} priority for {defect.equipment_name}",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"equipment": defect.equipment_name},
    )


async def feed_defect_closed(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    actor_id: Optional[uuid.UUID] = None,
    remarks: Optional[str] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)

    # Format: Defect was closed by User
    msg = f"Defect was closed by {actor_name}"

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.DEFECT_CLOSED,
        title=f"Defect Closed - {defect.title}",
        message=msg,
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"remarks": remarks},
    )


async def feed_priority_changed(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    old_priority: str,
    new_priority: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.PRIORITY_CHANGED,
        title=f"Priority Changed - {defect.title}",
        # Format: Priority escalated from X to Y by User
        message=f"Priority changed from {old_priority} to {new_priority} by {actor_name}",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"old_priority": old_priority, "new_priority": new_priority},
    )


async def feed_image_uploaded(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    image_type: str,
    file_name: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)
    label = {"before": "Before Image", "after": "After Image"}.get(
        image_type, image_type.title()
    )

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.IMAGE_UPLOADED,
        title=f"{label} Uploaded - {defect.title}",
        # Format: Image file.jpg was uploaded by User
        message=f"{label} {file_name} was uploaded by {actor_name}",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"image_type": image_type, "file_name": file_name},
    )


async def feed_pic_mandatory_changed(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    image_field: str,
    is_now_required: bool,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)
    label = "Before Image" if "before" in image_field else "After Image"
    event_type = (
        FeedEventType.PIC_MADE_MANDATORY
        if is_now_required
        else FeedEventType.PIC_MADE_OPTIONAL
    )

    # Format: Image is MANDATORY to upload before defect closure set by User
    status = "MANDATORY" if is_now_required else "NOT mandatory"
    action = "set by" if is_now_required else "updated by"

    await _write(
        db,
        defect=defect,
        event_type=event_type,
        title=f"{label} Made {status.title()} - {defect.title}",
        message=f"{label} is {status} to upload before defect closure {action} {actor_name}",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"field": image_field, "is_required": is_now_required},
    )


async def feed_pr_added(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    pr_number: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.PR_ADDED,
        title=f"PR Added - {defect.title}",
        # Format: PR Number was added to this defect by User
        message=f"PR {pr_number} was added to this defect by {actor_name}",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"pr_number": pr_number},
    )

async def feed_pr_invalid_format(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    pr_number: str,
    actor_id: Optional[uuid.UUID] = None,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name  = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.PR_INVALID_FORMAT,
        title=f"Invalid PR Format - {defect.title}",
        message=f"PR '{pr_number}' added by {actor_name} has a format mismatch.",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={"pr_number": pr_number, "warning": True},
    )
    
async def feed_mention(
    db: AsyncSession,
    control_db: AsyncSession,
    defect: Defect,
    thread_body: str,
    mentioned_user_ids: list,   # list of UUID — stored in meta
    actor_id: Optional[uuid.UUID] = None,
    is_internal: bool = False,
) -> None:
    vessel_name = await _get_vessel_name(control_db, defect.vessel_imo)
    actor_name = await _get_actor_name(control_db, actor_id)
    actor_role  = await _get_actor_role(control_db, actor_id)

    snippet = (thread_body or "")[:120]
    if len(thread_body or "") > 120:
        snippet += "…"

    await _write(
        db,
        defect=defect,
        event_type=FeedEventType.MENTION,
        title=f"Mention - {defect.title}",
        message=f"{actor_name} mentioned you in a comment",
        user_id=actor_id,
        vessel_name=vessel_name,
        triggered_by_role=actor_role,
        extra_meta={
            "mentioned_user_ids": [str(uid) for uid in mentioned_user_ids],
            "is_internal": is_internal,
            "snippet": snippet,
        },
    )