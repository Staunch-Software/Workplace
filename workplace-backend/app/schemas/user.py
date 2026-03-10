from pydantic import BaseModel, EmailStr
from typing import Optional, List
import uuid
from datetime import datetime

class UserCreate(BaseModel):
    full_name: str
    email: EmailStr
    password: str
    job_title: Optional[str] = None
    role: str = "VESSEL"
    can_self_assign_vessels: bool = False
    permissions: dict = {
        "drs": False, "jira": False,
        "voyage": False, "lubeoil": False,
        "engine_performance": False,
    }


class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    job_title: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    can_self_assign_vessels: Optional[bool] = None
    permissions: Optional[dict] = None


class UserOut(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    job_title: Optional[str]
    role: str
    is_active: bool
    can_self_assign_vessels: bool = False
    permissions: dict

    class Config:
        from_attributes = True


class VesselBrief(BaseModel):
    imo: str
    name: str

    class Config:
        from_attributes = True


class UserDetail(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    job_title: Optional[str]
    role: str
    is_active: bool
    can_self_assign_vessels: bool = False
    permissions: dict
    assigned_vessels: List[VesselBrief] = []
    last_login: Optional[datetime] = None
    
    class Config:
        from_attributes = True