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