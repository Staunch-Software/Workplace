import uuid
from sqlalchemy import Column, String, Integer, DateTime, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from db.database import Base


class SyncQueue(Base):
    __tablename__ = "sync_queue"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    entity_type = Column(String(50), nullable=False)
    # ticket, comment, attachment, task, notification

    entity_id = Column(UUID(as_uuid=True), nullable=False)

    operation = Column(String(20), nullable=False)
    # CREATE / UPDATE / DELETE

    payload = Column(JSONB, nullable=False)

    version = Column(Integer, nullable=False)
    origin = Column(String(20), nullable=False)
    sync_scope = Column(String(10), nullable=False, default="TICKET")
    # TICKET / CONFIG

    status = Column(String(20), default="PENDING")
    # PENDING / PROCESSING / FAILED / COMPLETED

    retry_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    processed_at = Column(DateTime(timezone=True), nullable=True)
    next_retry_at = Column(DateTime(timezone=True), nullable=True)


class SyncState(Base):
    __tablename__ = "sync_state"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vessel_imo = Column(String(20), nullable=False, index=True)
    sync_scope = Column(String(10), nullable=False, default="TICKET")

    last_push_at = Column(DateTime(timezone=True), nullable=True)
    last_pull_at = Column(DateTime(timezone=True), nullable=True)

    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class JiraSyncLog(Base):
    __tablename__ = "jira_sync_log"

    id         = Column(Integer, primary_key=True, default=1)  # always 1 row
    mode       = Column(String(20), nullable=True)
    last_sync  = Column(DateTime(timezone=True), nullable=True)
    last_result = Column(JSONB, nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class SyncConflict(Base):
    __tablename__ = "sync_conflicts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    version = Column(Integer, nullable=False)
    incoming_data = Column(JSONB, nullable=False)
    existing_data = Column(JSONB, nullable=False)
    detected_at = Column(DateTime(timezone=True), nullable=False)
    resolved = Column(Boolean, default=False)