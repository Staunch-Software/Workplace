import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Incident(Base):
    __tablename__ = "incidents"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_no: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="DRAFT", index=True)  # DRAFT | CLOSED
    vessel_imo: Mapped[str] = mapped_column(String(7), nullable=False, index=True)
    vessel_name: Mapped[str] = mapped_column(String(200), nullable=False)
    incident_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    category: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    offhire: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    offhire_details: Mapped[str] = mapped_column(Text, nullable=False, default="")
    comments: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Text kept next to the file uploads of the left-hand tabs.
    sof_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    log_notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    writeup: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_by_name: Mapped[str] = mapped_column(String(200), nullable=False)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class IncidentFile(Base):
    """kind: REPORT (report attachment) | SOF | LOG (alarm/event log) | PHOTO (PIC column + Photo evidence tab)."""
    __tablename__ = "incident_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    caption: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    uploaded_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class IncidentThread(Base):
    """One internal chat message on an incident. Users are plain UUIDs (they live in the control DB)."""
    __tablename__ = "incident_threads"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    author_name: Mapped[str] = mapped_column(String(200), nullable=False)
    author_role: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    tagged_user_ids: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    client_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class IncidentThreadAttachment(Base):
    __tablename__ = "incident_thread_attachments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incident_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    storage_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class IncidentThreadRead(Base):
    __tablename__ = "incident_thread_reads"

    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    last_read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class IncidentNotification(Base):
    """One item in a user's bell. `user_id` is a workplace user id (plain UUID, no foreign key: users live in the control DB)."""
    __tablename__ = "incident_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)          # MENTION | MESSAGE | CLOSED | REOPENED
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)   # "?open=<incident id>", relative to /incident
    incident_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    sender_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class IncidentFeedEvent(Base):
    """Something that happened on an incident, shown in the activity feed of everyone with access to the module."""
    __tablename__ = "incident_feed_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # INCIDENT_CREATED | MESSAGE | MENTION | CLOSED | REOPENED | FILES_ADDED
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    incident_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    actor_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)   # who caused it; never unread for them
    meta: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)                          # recipient_ids, mentioned_user_ids
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)


class IncidentFeedRead(Base):
    __tablename__ = "incident_feed_reads"

    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("incident_feed_events.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    # "Mark as unread" flips this instead of deleting the row.
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
