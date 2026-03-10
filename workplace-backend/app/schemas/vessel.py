from pydantic import BaseModel, EmailStr
from typing import Optional, List
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


class UserBrief(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str

    class Config:
        from_attributes = True


class VesselOut(BaseModel):
    imo: str
    name: str
    vessel_type: Optional[str]
    vessel_email: Optional[str]
    is_active: bool
    assigned_users: List[UserBrief] = []

    class Config:
        from_attributes = True