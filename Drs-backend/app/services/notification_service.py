# app/services/notification_service.py
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from app.models.tasks import Notification, NotificationType, Task, TaskStatus
from app.models.user import User
from app.models.vessel import Vessel
from app.models.defect import Defect
from app.models.enums import DefectStatus  # <--- Import from enums directly
async def notify_vessel_users(
    db: AsyncSession, 
    control_db: AsyncSession,
    vessel_imo: str, 
    vessel_name: str,
    title: str, 
    message: str, 
    exclude_user_id: str,
    defect_id: str
):
    # Fetch defect to check status (needed for Shore routing only now)
    defect = await db.get(Defect, defect_id)
    
    stmt = select(User).join(User.vessels).where(
        Vessel.imo == vessel_imo,
        User.id != exclude_user_id,
        User.is_active == True
    )
    result = await control_db.execute(stmt)
    recipients = result.scalars().all()

    final_message = f"[{vessel_name}] {message}"

    for recipient in recipients:
        # ✅ UPDATED: Route Vessel users ALWAYS to dashboard
        if recipient.role == "VESSEL":
            # All defects (Open/Closed) are now on the dashboard
            target_link = f"/drs/vessel/dashboard?highlightDefectId={defect_id}"
        else:  
            # SHORE/ADMIN logic remains (split pages usually)
            if defect and defect.status == DefectStatus.CLOSED:
                target_link = f"/drs/shore/dashboard?highlightDefectId={defect_id}"
            else:
                target_link = f"/drs/shore/dashboard?highlightDefectId={defect_id}"

        new_notif = Notification(
            user_id=recipient.id,
            type=NotificationType.ALERT,
            title=title,
            message=final_message,
            link=target_link,
            updated_at=datetime.utcnow(),
        )
        db.add(new_notif)

async def create_task_for_mentions(
    db: AsyncSession,
    control_db: AsyncSession,
    defect_id: str,
    defect_title: str,
    creator_id: str,
    tagged_user_ids: list[str],
    comment_body: str = "" ,
    is_internal: bool = False,   # NEW
    thread_id: str = None        # NEW
):
    # Fetch defect to check status
    defect = await db.get(Defect, defect_id)
    
    defect_description = defect.description if defect else "No description available."
    
    # Fetch creator name for better UI
    creator = await control_db.get(User, creator_id)
    creator_name = creator.full_name if creator else "A user"
    
    stmt = select(User).where(User.id.in_(tagged_user_ids))
    result = await control_db.execute(stmt)
    tagged_users = result.scalars().all()
    
    rich_description = (
        f"{creator_name} tagged you in a comment: {defect_title}\n"
        f"Description: {defect_description}"
    )

    for user in tagged_users:
        # ✅ UPDATED: Route Vessel users ALWAYS to dashboard
        if user.role == "VESSEL":
            # Direct link to the Unified Dashboard with highlight param
            target_link = f"/drs/vessel/dashboard?highlightDefectId={defect_id}"
        else:
            if defect and defect.status == DefectStatus.CLOSED:
                target_link = f"/drs/shore/history?highlightDefectId={defect_id}"
            else:
                target_link = f"/drs/shore/vessels?highlightDefectId={defect_id}"

        task = Task(
            description=rich_description,
            defect_id=defect_id,
            created_by_id=creator_id,
            assigned_to_id=user.id,
            status=TaskStatus.PENDING,
            created_at=datetime.now(timezone.utc)
        )
        db.add(task)

        notif = Notification(
            user_id=user.id,
            type=NotificationType.MENTION,
            title="New Mention",
            message=f"You were tagged in defect: {defect_title}",
            link=target_link,
            meta={
                "defect_id": str(defect_id),
                "thread_id": str(thread_id),
                "is_internal": is_internal
            },
            updated_at=datetime.utcnow(),
        )
        db.add(notif)
