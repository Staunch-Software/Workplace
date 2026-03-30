from datetime import datetime
from pydantic import BaseModel
from typing import Dict, Any, Optional
from uuid import UUID

class SyncPayload(BaseModel):
    """
    Standard payload for all sync endpoints.
    """
    entity_id: UUID
    version: int
    data: Dict[str, Any]  # The full JSON snapshot of the entity
    vessel_last_sync_at: Optional[datetime] = None
    vessel_imo: str
    vessel_telemetry: Optional[Dict[str, Any]] = None # <--- ADD THIS
