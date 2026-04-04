from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.core.database import get_db
from app.models.user import User
from app.models.vessel import Vessel
from app.schemas.user import UserCreate, UserResponse, UserPreferencesUpdate
from app.core.security import get_password_hash
from app.models.tasks import LiveFeedRead, Task, Notification,LiveFeed  
from sqlalchemy import update, desc
from app.api.deps import get_current_user # <--- ADDED THIS IMPORT
from uuid import UUID
from sqlalchemy.orm import selectinload
from datetime import datetime
from app.core.database_control import get_control_db

router = APIRouter()

@router.post("/", response_model=UserResponse)
async def create_user(user_in: UserCreate, db: AsyncSession = Depends(get_db)):
    # 1. Check if Email already exists
    result = await db.execute(select(User).where(User.email == user_in.email))
    if result.scalars().first():
        raise HTTPException(
            status_code=400, 
            detail="The user with this email already exists."
        )

    # 2. Fetch the Vessel objects
    vessels_to_assign = []
    if user_in.assigned_vessel_imos:
        # FIX: Use Vessel.imo, not Vessel.imo_number
        stmt = select(Vessel).where(Vessel.imo.in_(user_in.assigned_vessel_imos))
        result = await db.execute(stmt)
        vessels_to_assign = result.scalars().all()

        # Validation: Did we find all ships?
        if len(vessels_to_assign) != len(user_in.assigned_vessel_imos):
            print("⚠️ Warning: Some IMO numbers provided do not exist in DB.")

    # 3. Create User with updated default column preferences
    new_user = User(
        email=user_in.email,
        password_hash=get_password_hash(user_in.password), # <--- CRITICAL FIX: 'password_hash'
        full_name=user_in.full_name,
        job_title=user_in.job_title,
        role=user_in.role,
        vessels=vessels_to_assign,
        preferences={
            "vessel_columns": [
                "date",
                "deadline",
                "source",
                "equipment",
                "description",
                "priority",
                "status",
                "deadline_icon",
                "chat",
                "pr_details",
            ]
        }
    )
    

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Manually map response to avoid Pydantic validation errors on relationships
    return {
        "id": new_user.id,
        "email": new_user.email,
        "full_name": new_user.full_name,
        "role": new_user.role,
        "is_active": new_user.is_active,
        # Helper to return list of IMOs
        "assigned_vessel_imos": [v.imo for v in new_user.vessels]
    }

@router.patch("/me/preferences", response_model=UserResponse)
async def update_user_preferences(
    preferences_update: UserPreferencesUpdate,
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user)
):
    """
    Update the current user's preferences (e.g., visible columns for vessel dashboard).
    
    Example request body:
    {
        "preferences": {
            "vessel_columns": ["date", "deadline", "equipment", "description"]
        }
    }
    """
    try:
        # Update the user's preferences
        current_user.preferences = preferences_update.preferences
        
        await db.commit()
        await db.refresh(current_user)
        
        # Return updated user info
        return {
            "id": current_user.id,
            "email": current_user.email,
            "full_name": current_user.full_name,
            "job_title": current_user.job_title,
            "role": current_user.role,
            "is_active": current_user.is_active,
            "assigned_vessel_imos": [],
            "preferences": current_user.preferences
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to update preferences: {str(e)}"
        )

# ✅ NEW ENDPOINT: Get current user preferences
@router.get("/me/preferences")
async def get_user_preferences(
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user)
):
    """Get the current user's preferences"""
    return {
        "user_id": str(current_user.id),
        "preferences": current_user.preferences or {}
    }

# --- TASKS ENDPOINTS ---

@router.get("/me/tasks")
async def get_my_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetch tasks assigned specifically to the logged-in user"""
    stmt = select(Task).where(
        Task.assigned_to_id == current_user.id,
        Task.status == "PENDING"
    ).order_by(desc(Task.created_at))
    
    result = await db.execute(stmt)
    return result.scalars().all()

@router.patch("/tasks/{task_id}/complete")
async def complete_task(
    task_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Mark a task as done"""
    stmt = update(Task).where(
        Task.id == task_id,
        Task.assigned_to_id == current_user.id
    ).values(status="COMPLETED")
    
    await db.execute(stmt)
    await db.commit()
    return {"status": "success"}

# --- NOTIFICATIONS ENDPOINTS ---

@router.get("/me/notifications")
async def get_my_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetch recent notifications for the user"""
    # Fetch unread first, then new ones
    stmt = select(Notification).where(
        Notification.user_id == current_user.id
    ).order_by(Notification.is_read.asc(), desc(Notification.created_at)).limit(50)
    
    result = await db.execute(stmt)
    return result.scalars().all()

@router.patch("/notifications/read-all")
async def read_all_notifications(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Clear the red badge"""
    stmt = update(Notification).where(
        Notification.user_id == current_user.id,
        Notification.is_read == False
    ).values(is_read=True)
    
    await db.execute(stmt)
    await db.commit()
    return {"status": "success"}

@router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stmt = update(Notification).where(
        Notification.id == notification_id,
        Notification.user_id == current_user.id
    ).values(is_read=True)
    
    await db.execute(stmt)
    await db.commit()
    return {"status": "success"}

# 2. UPDATED: Mark all as SEEN (Opened Bell) - Was previously 'read-all'
@router.patch("/notifications/mark-seen")
async def mark_notifications_seen(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    stmt = update(Notification).where(
        Notification.user_id == current_user.id,
        Notification.is_seen == False
    ).values(is_seen=True)
    
    await db.execute(stmt)
    await db.commit()
    return {"status": "success"}

@router.get("/live-feed")
async def get_live_feed(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # 1. Base query
    query = (
        select(LiveFeed)
        .options(selectinload(LiveFeed.defect))
        .order_by(desc(LiveFeed.created_at))
    )

    # 2. Filtering Logic
    vessel_imos = [v.imo for v in current_user.vessels]
    
    # Condition: Always show if the user is mentioned
    mention_filter = (LiveFeed.event_type == "MENTION") & (
        LiveFeed.meta["mentioned_user_ids"].contains([str(current_user.id)])
    )

    if current_user.role in ("VESSEL", "SHORE"):
        # Users see EVERYTHING related to their assigned vessels 
        # (Actions by others AND actions by themselves)
        query = query.where(
            mention_filter | (LiveFeed.vessel_imo.in_(vessel_imos))
        )
        
    elif current_user.role == "ADMIN":
        # ADMINs typically see everything across the entire fleet.
        # If you want to restrict ADMINs to only their vessels, 
        # move 'ADMIN' into the block above.
        pass 

    # 3. Execute Query
    result = await db.execute(query)
    feeds = result.scalars().all()

    # 4. Fetch per-user read state (so users can clear their own notifications)
    read_result = await db.execute(
        select(LiveFeedRead.feed_id).where(
            LiveFeedRead.user_id == current_user.id,
            LiveFeedRead.is_read == True
        )
    )
    read_feed_ids = {str(row[0]) for row in read_result.all()}

    # 5. Build Response
    return [
        {
            "id": str(feed.id),
            "event_type": feed.event_type,
            "message": feed.message,
            "created_at": feed.created_at,
            "vessel_name": feed.vessel_name,
            "vessel_imo": feed.vessel_imo,
            "defect_id": str(feed.defect_id) if feed.defect_id else None,
            "is_read": str(feed.id) in read_feed_ids,
            "is_seen": str(feed.id) in read_feed_ids,
            "meta": feed.meta or {},
            "triggered_by_role": (feed.meta or {}).get("triggered_by_role"),
            "is_own_action": str(feed.user_id) == str(current_user.id), # Useful for UI styling
            "defect": {
                "priority": feed.defect.priority.value if feed.defect and hasattr(feed.defect.priority, "value") else (feed.defect.priority if feed.defect else None),
                "description": feed.defect.description if feed.defect else None,
                "equipment_name": feed.defect.equipment_name if feed.defect else None,
                "closure_remark": feed.defect.closure_remarks if feed.defect else None,
                "defect_source": feed.defect.defect_source.value if feed.defect and hasattr(feed.defect.defect_source, "value") else (feed.defect.defect_source if feed.defect else None),
            } if feed.defect else None,
        }
        for feed in feeds
    ]

    
@router.patch("/live-feed/{feed_id}/read")
async def mark_feed_read(
    feed_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Check feed exists
    entry = await db.get(LiveFeed, feed_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Not found")

    # Upsert per-user read state
    existing = await db.execute(
        select(LiveFeedRead).where(
            LiveFeedRead.feed_id == feed_id,
            LiveFeedRead.user_id == current_user.id,
        )
    )
    record = existing.scalar_one_or_none()

    if record:
        record.is_read = True
        record.read_at = datetime.now()
    else:
        db.add(LiveFeedRead(
            feed_id=feed_id,
            user_id=current_user.id,
            is_read=True,
            read_at=datetime.now(),
        ))

    await db.commit()
    return {"success": True, "id": str(feed_id), "is_read": True, "is_seen": True}
