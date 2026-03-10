from uuid import UUID
import datetime
from fastapi import APIRouter, Depends, HTTPException
from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload 

from app.core.database import get_db
from app.models.defect import Defect, Thread, Attachment
from app.models.user import User
from app.models.enums import UserRole, DefectStatus
from app.models.vessel import Vessel
from app.schemas.defect import (
    DefectCreate, 
    DefectUpdate, 
    DefectResponse, 
    ThreadCreate, 
    ThreadResponse, 
    AttachmentResponse,
    AttachmentBase,
    DefectUpdate,
)
from app.core.blob_storage import generate_write_sas_url, generate_read_sas_url
from app.api.deps import get_current_user 
from app.services.email_service import send_defect_email 

router = APIRouter(redirect_slashes=False)

# --- HELPER: Prepare Email Data ---
def prepare_email_data(defect: Defect):
    """Safely converts defect object to dictionary for email template"""
    # Handle Enum .value conversion safely
    priority_str = defect.priority.value if hasattr(defect.priority, "value") else str(defect.priority)
    status_str = defect.status.value if hasattr(defect.status, "value") else str(defect.status)
    
    return {
        "vessel_imo": defect.vessel_imo,
        "title": defect.title,
        "equipment_name": defect.equipment_name,
        "priority": priority_str,
        "status": status_str,
        "description": defect.description
    }

# --- GET ALL DEFECTS ---
@router.get("/", response_model=list[DefectResponse])
async def get_defects(
    vessel_imo: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(Defect).options(selectinload(Defect.vessel))

    # 1. Hide Deleted Items
    query = query.where(Defect.is_deleted == False)

    # 2. Role Based Filtering
    if current_user.role == UserRole.VESSEL:
        user_vessel_imos = [v.imo for v in current_user.vessels]
        if not user_vessel_imos:
            return []
        query = query.where(Defect.vessel_imo.in_(user_vessel_imos))
    elif vessel_imo:
        query = query.where(Defect.vessel_imo == vessel_imo)

    result = await db.execute(query)
    defects = result.scalars().all()
    
    for defect in defects:
        defect.vessel_name = defect.vessel.name if defect.vessel else None
    
    return defects

# --- SAS GENERATION ---
@router.get("/sas")
async def get_upload_sas(blobName: str, current_user: User = Depends(get_current_user)):
    url = generate_write_sas_url(blobName)
    return {"url": url}

# --- CREATE DEFECT ---
@router.post("/", response_model=DefectResponse)
async def create_defect(
    defect_in: DefectCreate,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = await db.get(Defect, defect_in.id)
    if existing: return existing

    if current_user.role == UserRole.VESSEL:
        authorized_imos = [v.imo for v in current_user.vessels]
        if defect_in.vessel_imo not in authorized_imos:
            raise HTTPException(status_code=403, detail="Not authorized for this vessel")

    new_defect = Defect(
        id=defect_in.id,
        vessel_imo=defect_in.vessel_imo,
        reported_by_id=current_user.id,
        title=defect_in.equipment,           
        equipment_name=defect_in.equipment,  
        description=defect_in.description,
        ships_remarks=defect_in.remarks,     
        priority=defect_in.priority.upper(),
        status=defect_in.status.upper(),
        responsibility=defect_in.responsibility,
        office_support_required=True if "Yes" in defect_in.officeSupport else False,
        pr_number=defect_in.prNumber,
        pr_status=defect_in.prStatus,
        json_backup_path=defect_in.json_backup_path,
        date_identified=datetime.datetime.strptime(defect_in.date, '%Y-%m-%d') if defect_in.date else None
    )
    
    db.add(new_defect)
    await db.commit()
    await db.refresh(new_defect)

    # Trigger Email: CREATED
    email_data = prepare_email_data(new_defect)
    background_tasks.add_task(send_defect_email, email_data, "CREATED")
    
    return new_defect

# --- CREATE THREAD ---
@router.post("/threads", response_model=ThreadResponse)
async def create_thread(
    thread_in: ThreadCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = await db.get(Thread, thread_in.id)
    if existing:
        res = await db.execute(select(Thread).where(Thread.id == thread_in.id).options(selectinload(Thread.attachments)))
        return res.scalars().first()

    new_thread = Thread(
        id=thread_in.id,
        defect_id=thread_in.defect_id,
        user_id=current_user.id,
        author_role=thread_in.author, 
        body=thread_in.body,
        tagged_user_ids=thread_in.tagged_user_ids
    )
    
    db.add(new_thread)
    await db.commit()
    await db.refresh(new_thread, attribute_names=["attachments"])
    return new_thread

# --- CREATE ATTACHMENT ---
@router.post("/attachments", response_model=AttachmentResponse)
async def create_attachment(
    attachment_in: AttachmentBase,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    existing = await db.get(Attachment, attachment_in.id)
    if existing: return existing

    new_attachment = Attachment(
        id=attachment_in.id,
        thread_id=attachment_in.thread_id,
        file_name=attachment_in.file_name,
        file_size=attachment_in.file_size,
        content_type=attachment_in.content_type,
        blob_path=attachment_in.blob_path
    )
    
    db.add(new_attachment)
    await db.commit()
    await db.refresh(new_attachment)
    return new_attachment

# --- GET THREADS ---
@router.get("/{defect_id}/threads", response_model=list[ThreadResponse])
async def get_defect_threads(defect_id: UUID, db: AsyncSession = Depends(get_db)):
    query = select(Thread).where(Thread.defect_id == defect_id)\
            .options(selectinload(Thread.attachments), selectinload(Thread.user))\
            .order_by(Thread.created_at.asc())

    result = await db.execute(query)
    threads = result.scalars().all()

    for thread in threads:
        thread.author_role = thread.user.full_name
        for att in thread.attachments:
            att.blob_path = generate_read_sas_url(att.blob_path)
            
    return threads

# --- GET VESSEL USERS ---
@router.get("/{defect_id}/vessel-users", response_model=list[dict])
async def get_vessel_users_for_defect(defect_id: UUID, db: AsyncSession = Depends(get_db)):
    defect = await db.get(Defect, defect_id)
    if not defect: raise HTTPException(status_code=404, detail="Defect not found")
    
    query = select(User).join(User.vessels).where(Vessel.imo == defect.vessel_imo)
    result = await db.execute(query)
    users = result.scalars().all()
    
    return [{"id": str(u.id), "name": u.full_name} for u in users]

# --- UPDATE DEFECT ---
@router.patch("/{defect_id}", response_model=DefectResponse)
async def update_defect(
    defect_id: UUID,
    defect_in: DefectUpdate,
    background_tasks: BackgroundTasks, # <--- Added
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    defect = await db.get(Defect, defect_id)
    if not defect: raise HTTPException(status_code=404, detail="Not found")
    
    update_data = defect_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "officeSupport":
            defect.office_support_required = True if "Yes" in value else False
        elif field == "remarks":
            defect.ships_remarks = value
        elif field == "equipment":
            defect.equipment_name = value
            defect.title = value
        else:
            setattr(defect, field, value)
            
    await db.commit()
    await db.refresh(defect)

    # Trigger Email: UPDATED
    email_data = prepare_email_data(defect)
    background_tasks.add_task(send_defect_email, email_data, "UPDATED")

    return defect

# --- CLOSE DEFECT ---
@router.patch("/{defect_id}/close", response_model=DefectResponse)
async def close_defect(
    defect_id: UUID,
    background_tasks: BackgroundTasks, # <--- Added
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    defect = await db.get(Defect, defect_id)
    if not defect: raise HTTPException(status_code=404, detail="Defect not found")
    
    defect.status = DefectStatus.CLOSED
    defect.closed_at = datetime.datetime.now()
    defect.closed_by_id = current_user.id
    
    await db.commit()
    await db.refresh(defect)

    # Trigger Email: CLOSED
    email_data = prepare_email_data(defect)
    background_tasks.add_task(send_defect_email, email_data, "CLOSED")

    return defect

# --- REMOVE DEFECT ---
@router.delete("/{defect_id}")
async def remove_defect(
    defect_id: UUID,
    background_tasks: BackgroundTasks, # <--- Added
    db: AsyncSession = Depends(get_db)
):
    defect = await db.get(Defect, defect_id)
    if not defect: raise HTTPException(status_code=404, detail="Defect not found")

    # Capture data BEFORE deleting (for the email)
    email_data = prepare_email_data(defect)
    
    defect.is_deleted = True 
    await db.commit()

    # Trigger Email: REMOVED
    background_tasks.add_task(send_defect_email, email_data, "REMOVED")

    return {"message": "Defect removed and archived"}