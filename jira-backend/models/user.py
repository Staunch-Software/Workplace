from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime

class UserInDB(BaseModel):
    id: Optional[str] = None
    name: str
    email: str
    password: str
    role: Literal["vessel", "shore", "admin"]
    vesselName: Optional[str] = None
    createdAt: datetime = datetime.utcnow()
    updatedAt: datetime = datetime.utcnow()

class UserOut(BaseModel):
    id: Optional[str] = None
    name: str
    email: str
    role: str
    vesselName: Optional[str] = None
