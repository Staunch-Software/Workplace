# app/models/sync.py
# Vessel <-> shore offline sync outbox, mirroring Drs-backend's app/models/sync.py.
import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.core.database import Base


class SyncQueue(Base):
    __tablename__ = "sync_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    entity_type = Column(String(50), nullable=False)
    # report, report_thread, report_thread_attachment, report_attachment, report_event

    entity_id = Column(UUID(as_uuid=True), nullable=False)

    operation = Column(String(20), nullable=False)
    # CREATE / UPDATE

    payload = Column(JSONB, nullable=False)
    # Full JSON snapshot of entity

    origin = Column(String(20), nullable=False, default="VESSEL")
    status = Column(String(20), default="PENDING")
    # PENDING / PROCESSING / FAILED / COMPLETED

    retry_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)


class SyncState(Base):
    __tablename__ = "reports_sync_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vessel_imo = Column(String(20), nullable=False, index=True)
    sync_scope = Column(String(20), nullable=False, default="REPORTS")

    last_push_at = Column(DateTime(timezone=True), nullable=True)
    last_pull_at = Column(DateTime(timezone=True), nullable=True)

    active_errors = Column(JSONB, nullable=False, server_default='[]')
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("vessel_imo", "sync_scope", name="uq_reports_vessel_sync_scope"),
    )


class SyncConflict(Base):
    __tablename__ = "reports_sync_conflicts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    incoming_data = Column(JSONB, nullable=False)
    existing_data = Column(JSONB, nullable=False)
    detected_at = Column(DateTime(timezone=True), nullable=False)
    resolved = Column(Boolean, default=False)
