from datetime import datetime

from pydantic import BaseModel, EmailStr
from typing import Any, Dict, Optional, List
import uuid


class VesselCreate(BaseModel):
    imo: str
    name: str
    vessel_type: Optional[str] = None
    vessel_email: Optional[str] = None


class VesselUpdate(BaseModel):
    name: Optional[str] = None
    vessel_type: Optional[str] = None
    vessel_email: Optional[str] = None
    is_active: Optional[bool] = None
    module_status: Optional[Dict[str, bool]] = None

class UserBrief(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    role: str
    last_login: Optional[datetime] = None          # ← added
    permissions: Dict[str, Any] = {                # ← added
        "drs": False,
        "jira": False,
        "voyage": False,
        "lubeoil": False,
        "engine_performance": False,
    }
    class Config:
        from_attributes = True


class VesselOut(BaseModel):
    imo: str
    name: str
    vessel_type: Optional[str]
    vessel_email: Optional[str]
    is_active: bool
    assigned_users: List[UserBrief] = []
    module_status: Dict[str, bool] = {}
    last_push_at: Optional[datetime] = None   # ← add
    last_pull_at: Optional[datetime] = None   # ← add
    class Config:
        from_attributes = True
        
class ModuleStatus(BaseModel):
    key: str
    available: bool

class SyncError(BaseModel):
    id: int = 0
    error_type: str = "" 
    error_msg: Optional[str] = None
    created_at: Optional[str] = None

class VesselStatusOut(BaseModel):
    imo: str
    name: str
    online: bool
    last_pull_at: Optional[str] = None
    last_push_at: Optional[str] = None
    last_sync_success: Optional[bool] = None
    failed_items_count: int = 0
    sync_errors: List[SyncError] = []
    modules: List[ModuleStatus] = []

    class Config:
        from_attributes = True
        
class ModuleStatusUpdate(BaseModel):
    drs: Optional[bool] = None
    jira: Optional[bool] = None
    voyage: Optional[bool] = None
    lubeoil: Optional[bool] = None
    engine_performance: Optional[bool] = None

    class Config:
        extra = "allow"  