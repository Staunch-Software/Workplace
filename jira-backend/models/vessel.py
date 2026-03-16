from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class Vessel(BaseModel):
    id: Optional[str] = None
    name: str
    code: str
    isActive: bool = True
    createdAt: datetime = datetime.utcnow()
    updatedAt: datetime = datetime.utcnow()

class VesselCreate(BaseModel):
    name: str
    code: str
