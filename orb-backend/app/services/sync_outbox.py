"""Vessel outbox: queue a change for the VM in the same transaction as the change itself."""
import uuid
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.sync import SyncQueue
from app.services.sync_registry import row_to_dict

settings = get_settings()


def enqueue(db: AsyncSession, entity_type: str, entity_id: uuid.UUID, payload: dict, operation: str = "UPSERT") -> None:
    """No-op on the VM. On a vessel adds one outbox row; the caller commits."""
    if not settings.is_offline_vessel:
        return
    db.add(SyncQueue(id=uuid.uuid4(), entity_type=entity_type, entity_id=entity_id, operation=operation, payload=payload))


def enqueue_row(db: AsyncSession, entity_type: str, obj, extra: Optional[dict] = None) -> None:
    """Queue a snapshot of `obj` (a mapped row). The row must have its column values loaded (flush first)."""
    if not settings.is_offline_vessel:
        return
    payload = row_to_dict(obj)
    if extra:
        payload.update(extra)
    pk = getattr(obj, "id", None) or getattr(obj, "event_id", None) or getattr(obj, "alert_id", None)
    enqueue(db, entity_type, pk, payload)
