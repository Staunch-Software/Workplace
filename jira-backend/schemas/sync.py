from pydantic import BaseModel
from typing import Any, Dict, Optional


class SyncPayload(BaseModel):
    entity_id: str
    operation: str          # CREATE / UPDATE / DELETE
    data: Dict[str, Any]
    version: int
    origin: str             # VESSEL / SHORE
    vessel_imo: Optional[str] = None