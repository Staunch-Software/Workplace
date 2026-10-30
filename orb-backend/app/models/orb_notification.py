import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import mapped_column, Mapped
from app.models.base import Base


class OrbNotification(Base):
    """One item in a user's bell. `user_id` is a workplace user id (plain UUID, no foreign key)."""
    __tablename__ = "orb_notifications"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(20), nullable=False)          # MENTION | MESSAGE | RESOLVED | UPLOAD
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Where a click goes, relative to the user's view: "/alerts?alert=<id>" or "/uploads/<id>"
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    vessel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    alert_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    sender_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), onupdate=func.orb_utc_now(), nullable=False)


class OrbFeedEvent(Base):
    """Something that happened on a vessel, shown in the activity feed of everyone who can see that vessel.

    `shore_only` events (internal notes, uploads) are never shown to vessel users."""
    __tablename__ = "orb_feed_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)    # MESSAGE | MENTION | RESOLVED | UPLOAD | ALERTS_RAISED
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=False, index=True)
    alert_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    upload_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    link: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    actor_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    actor_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)   # who caused it; never unread for them
    shore_only: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    meta: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), onupdate=func.orb_utc_now(), nullable=False)


class OrbFeedRead(Base):
    __tablename__ = "orb_feed_reads"

    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orb_feed_events.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False)
    # "Mark as unread" flips this instead of deleting the row, so the choice can sync between vessel and shore.
    is_read: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), onupdate=func.orb_utc_now(), nullable=False)
