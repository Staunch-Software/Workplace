from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from app.models.enums import DefectPriority, DefectStatus

class VesselUserResponse(BaseModel):
    id: UUID
    full_name: str
    role: Optional[str] = None 
    job_title: Optional[str] = None
    
    class Config:
        from_attributes = True

# ✅ PR Entry Schemas
class PrEntryCreate(BaseModel):
    defect_id: UUID
    pr_number: str
    pr_description: Optional[str] = None
## For PR UPdate ##
class PrEntryUpdate(BaseModel):
    pr_number: Optional[str] = None
    pr_description: Optional[str] = None

class PrEntryResponse(BaseModel):
    id: UUID
    defect_id: UUID
    pr_number: str
    pr_description: Optional[str]
    mariapps_pr_status: Optional[str] = None
    created_at: datetime
    created_by_id: Optional[UUID]
    
    class Config:
        from_attributes = True

# ✅ NEW: Defect Image Schemas
class DefectImageCreate(BaseModel):
    id: UUID
    defect_id: UUID
    image_type: str  # 'before' or 'after'
    file_name: str
    file_size: Optional[int] = None
    blob_path: str

class DefectImageResponse(BaseModel):
    id: UUID
    defect_id: UUID
    image_type: str
    file_name: str
    file_size: Optional[int]
    blob_path: str
    image_url: str 
    created_at: datetime
    
    class Config:
        from_attributes = True

# ✅ Defect Create Schema
class DefectCreate(BaseModel):
    id: UUID
    vessel_imo: str
    date: Optional[str] = None
    equipment: str
    description: str
    priority: str
    status: str
    responsibility: str
    json_backup_path: Optional[str] = None
    target_close_date: Optional[str] = None
    is_owner: bool = False 
    is_flagged: bool = False  # ✅ Added
    is_dd: bool = False       # ✅ Added
    defect_number: Optional[str] = None
    # ✅ Defect Source
    defect_source: str
    pr_status: Optional[str] = 'Not Set' 
    before_image_required: Optional[bool] = False
    after_image_required: Optional[bool] = False
    before_image_path: Optional[str] = None
    after_image_path: Optional[str] = None

class DefectCloseRequest(BaseModel):
    closure_remarks: str
    closure_image_before: str
    closure_image_after: str
    
class ShoreCloseRequest(BaseModel):
    closure_remarks: str

# ✅ Defect Response Schema
class DefectResponse(BaseModel):
    id: UUID
    vessel_imo: str
    vessel_name: Optional[str] = None
    reported_by_id: UUID
    
    # Core fields
    title: str
    equipment_name: str
    description: str
    priority: DefectPriority
    status: DefectStatus
    
    # ✅ Defect Source
    defect_source: str
    
    # ✅ PR Entries relationship
    pr_entries: List[PrEntryResponse] = []
    
     # ✅ OWNER FLAG
    is_owner: bool = False
    is_flagged: bool = False
    is_dd: bool = False
    defect_number: Optional[str] = None
    # Other fields
    responsibility: Optional[str] = None
    pr_status: Optional[str] = 'Not Set'
    json_backup_path: Optional[str] = None
    date_identified: Optional[datetime] = None
    target_close_date: Optional[datetime] = None
    before_image_required: bool = False
    after_image_required: bool = False
    before_image_path: Optional[str] = None
    after_image_path: Optional[str] = None
    
    created_at: datetime
    updated_at: Optional[datetime] = None
    closure_remarks: Optional[str] = None
    closure_image_before: Optional[str] = None
    closure_image_after: Optional[str] = None
    
    class Config:
        from_attributes = True

# ✅ Defect Update Schema
class DefectUpdate(BaseModel):
    equipment_name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    responsibility: Optional[str] = None
    defect_source: Optional[str] = None
    pr_status: Optional[str] = None
    target_close_date: Optional[str] = None
    date_identified: Optional[str] = None
    
    # ✅ Image requirement flags and paths
    before_image_required: Optional[bool] = None
    after_image_required: Optional[bool] = None
    before_image_path: Optional[str] = None
    after_image_path: Optional[str] = None
    is_owner: Optional[bool] = None 
    is_flagged: Optional[bool] = None  # ✅ Added
    is_dd: Optional[bool] = None    
    # ✅ Closure remarks (minimum 50 characters required when closing)
    closure_remarks: Optional[str] = None

class AttachmentBase(BaseModel):
    id: UUID
    thread_id: UUID
    file_name: str
    blob_path: str
    file_size: Optional[int] = None
    content_type: Optional[str] = None

class AttachmentResponse(AttachmentBase):
    created_at: datetime
    
    class Config:
        from_attributes = True

class ThreadCreate(BaseModel):
    id: UUID
    defect_id: UUID
    author: str 
    body: str
    tagged_user_ids: List[str] = []
    is_internal: bool = False

class ThreadResponse(BaseModel):
    id: UUID
    defect_id: UUID
    author: str = Field(alias="author_role") 
    body: str
    created_at: datetime
    user_id: UUID
    is_system_message: bool = False
    tagged_user_ids: List[str] = []
    attachments: List['AttachmentResponse'] = [] 
    is_internal: bool = False

    class Config:
        from_attributes = True
        populate_by_name = True