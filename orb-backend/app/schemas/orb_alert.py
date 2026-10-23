import uuid
from datetime import datetime, date
from typing import Optional
from pydantic import BaseModel, ConfigDict


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    vessel_id: uuid.UUID
    entry_id: Optional[uuid.UUID] = None
    page_number: Optional[int] = None
    upload_id: Optional[uuid.UUID] = None
    thread_count: int = 0
    unread_count: int = 0
    alert_type: str
    severity: str
    message: str
    is_resolved: bool
    status: str = "OPEN"                       # OPEN | PENDING_APPROVAL | RESOLVED
    resolved_by: Optional[uuid.UUID] = None
    resolved_by_name: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolution_notes: Optional[str] = None
    resolution_requested_by_name: Optional[str] = None
    resolution_requested_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    rejected_by_name: Optional[str] = None
    rejected_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


class ResolveRequest(BaseModel):
    notes: Optional[str] = ""


class AlertSummary(BaseModel):
    total: int
    critical: int
    major: int
    minor: int
    observation: int
    by_type: dict
