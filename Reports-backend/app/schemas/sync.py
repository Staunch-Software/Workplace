from datetime import datetime
from pydantic import BaseModel
from typing import Dict, Any, Optional
from uuid import UUID


class SyncPayload(BaseModel):
    """Standard payload for all Report Tracker sync endpoints."""
    entity_id: UUID
    operation: str  # CREATE / UPDATE
    data: Dict[str, Any]  # Full JSON snapshot of the entity
    vessel_imo: str
    vessel_last_sync_at: Optional[datetime] = None
