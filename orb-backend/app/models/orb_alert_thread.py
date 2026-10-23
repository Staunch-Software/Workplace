import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Integer, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import mapped_column, Mapped
from app.models.base import Base


class OrbAlertThread(Base):
    """One chat message on an alert.

    Visibility is decided on the server: `is_internal` messages are shore-only. Authors and tagged
    users are workplace user ids kept as plain UUIDs (no foreign key: users live in the control DB,
    see migration 010).
    """
    __tablename__ = "orb_alert_threads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orb_alerts.id", ondelete="CASCADE"), nullable=False, index=True)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=False, index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    author_name: Mapped[str] = mapped_column(String(200), nullable=False)
    author_role: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, index=True)
    # A line written by the system for a resolution step (requested / accepted / rejected / resolved).
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    tagged_user_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    # Client-generated id so a retried send never posts the same message twice.
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OrbAlertAttachment(Base):
    __tablename__ = "orb_alert_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orb_alert_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    # Blob URL (Azure) or a path under UPLOAD_DIR/chat -- see services/alert_chat_storage.py
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OrbAlertThreadRead(Base):
    """When each user last opened an alert's chat, for unread counts."""
    __tablename__ = "orb_alert_thread_reads"

    alert_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orb_alerts.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
