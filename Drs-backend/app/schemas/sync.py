from pydantic import BaseModel
from typing import Dict, Any
from uuid import UUID

class SyncPayload(BaseModel):
    """
    Standard payload for all sync endpoints.
    """
    entity_id: UUID
    version: int
    data: Dict[str, Any]  # The full JSON snapshot of the entity