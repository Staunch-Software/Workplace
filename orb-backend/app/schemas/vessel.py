import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class VesselCreate(BaseModel):
    name: str
    imo_number: str
    call_sign: Optional[str] = None


class VesselUpdate(BaseModel):
    name: Optional[str] = None
    imo_number: Optional[str] = None
    call_sign: Optional[str] = None
    is_active: Optional[bool] = None
    flag_state: Optional[str] = None
    flag_official_language: Optional[str] = None     # alert 36; send "" to clear
    fuel_grades: Optional[list[str]] = None


class VesselResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    imo_number: str
    call_sign: Optional[str] = None
    is_active: bool
    flag_state: Optional[str] = None
    flag_official_language: Optional[str] = None
    fuel_grades: Optional[list[str]] = None
    created_by: Optional[uuid.UUID] = None
    created_at: datetime
    updated_at: datetime
