from typing import Dict, Any, Optional, List
from pydantic import BaseModel, EmailStr
from uuid import UUID
from uuid import UUID


# Shared properties
class UserBase(BaseModel):
    email: EmailStr
    full_name: str
    job_title: Optional[str] = None
    role: str = "VESSEL"
    is_active: Optional[bool] = True

# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str
    assigned_vessel_imos: List[str] = [] # List of strings (IMOs)

class UserPreferencesUpdate(BaseModel):
    """Schema for updating user preferences"""
    preferences: Dict[str, Any]
    
    class Config:
        json_schema_extra = {
            "example": {
                "preferences": {
                    "vessel_columns": [
                        "date",
                        "deadline", 
                        "source",
                        "equipment",
                        "description",
                        "priority_status",
                        "pr_details"
                    ]
                }
            }
        }

# Properties to return to the UI
class UserResponse(UserBase):
    id: UUID
    assigned_vessel_imos: List[str] = [] # The API returns this list now
    preferences: Dict[str, Any] = {}

    class Config:
        from_attributes = True # updated from 'orm_mode' in Pydantic v2