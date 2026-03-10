from pydantic import BaseModel
from typing import Optional, List

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    id: str
    full_name: str
    email: str
    role: str
    job_title: Optional[str] = None
    assigned_vessels: List[str] = []
    permissions: dict = {}
    can_self_assign_vessels: bool = False
    assigned_vessel_names: List[str] = []