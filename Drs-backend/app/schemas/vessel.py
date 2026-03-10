from pydantic import BaseModel, constr
from typing import Optional
from datetime import datetime

class VesselBase(BaseModel):
    name: str
    vessel_type: str
 
    email: Optional[str] = None
    flag: Optional[str] = None

class VesselCreate(VesselBase):
    imo_number: constr(min_length=7, max_length=7, pattern=r'^\d{7}$')

class VesselResponse(VesselBase):
    imo_number: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True