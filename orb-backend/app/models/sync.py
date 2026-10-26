"""Tables that only the sync needs: the outbox, the cursors, the conflict log and the delete markers."""
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class SyncQueue(Base):
    """Vessel outbox. A row is written in the same transaction as the change it describes.

    entity_type is one of the PUSH_ENTITIES in app/services/sync_registry.py, or "blob_download" (a file to fetch
    from the VM; handled locally, nothing is posted)."""
    __tablename__ = "sync_queue"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    operation: Mapped[str] = mapped_column(String(20), nullable=False, default="UPSERT")
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="PENDING", index=True)   # PENDING|PROCESSING|FAILED|COMPLETED
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False, index=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class SyncState(Base):
    """One cursor per (vessel, scope). Vessel: scope "pull:<entity>" holds the pull cursor, "push" the last push.
    Shore: scope "push" / "pull" record when each vessel last pushed or pulled (vessel status page)."""
    __tablename__ = "sync_state"

    vessel_imo: Mapped[str] = mapped_column(String(20), primary_key=True)
    sync_scope: Mapped[str] = mapped_column(String(60), primary_key=True)
    last_push_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    last_pull_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    active_errors: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), onupdate=func.orb_utc_now(), nullable=False)


class SyncConflict(Base):
    """Something sync could not apply cleanly (stale resolution request, missing parent, bad row). Never silent."""
    __tablename__ = "orb_sync_conflicts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    vessel_imo: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    incoming: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    existing: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class SyncTombstone(Base):
    """A hard-deleted shore row (reprocess / recalculate). The vessel deletes the same row when it pulls this."""
    __tablename__ = "sync_tombstones"
    __table_args__ = (UniqueConstraint("entity_type", "entity_id", name="uq_sync_tombstone"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type: Mapped[str] = mapped_column(String(40), nullable=False)      # alert | entry | entry_quantity
    entity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False, index=True)
