# models/schema.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Integer, Text, ForeignKey, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from db.database import Base


def _uuid():
    return str(uuid.uuid4())


class Ticket(Base):
    __tablename__ = "tickets"
    id                   = Column(String, primary_key=True, default=_uuid)
    reference            = Column(String, nullable=True, unique=True, index=True)
    referenceNum         = Column(Integer, nullable=True)
    summary              = Column(String, nullable=False)
    description          = Column(Text, default="")
    module               = Column(String, nullable=True)
    environment          = Column(String, nullable=True)
    priority             = Column(String, nullable=True)
    requestType          = Column(String, nullable=True)
    status               = Column(String, default="SUP IN PROGRESS")
    jiraStatus           = Column(String, nullable=True, index=True)
    jiraSubmissionStatus = Column(String, default="PENDING")
    jiraUrl              = Column(String, nullable=True)
    jiraSortOrder        = Column(Integer, nullable=True)
    vesselName           = Column(String, nullable=True, index=True)
    requester            = Column(String, nullable=True)
    createdAt            = Column(DateTime, default=datetime.utcnow)
    updatedAt            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    jiraCreatedAt        = Column(DateTime, nullable=True)
    jiraUpdatedAt        = Column(DateTime, nullable=True)
    lastSyncedAt         = Column(DateTime, nullable=True)
    detailFetchedAt      = Column(DateTime, nullable=True)
    attachments          = Column(JSONB, default=list)
    sharedWith           = Column(JSONB, default=list)

    # ── NEW: Sync columns ─────────────────────────────────────────────
    version              = Column(Integer, nullable=False, default=1)
    origin               = Column(String(20), nullable=False, default="SHORE")
    is_deleted           = Column(Boolean, default=False)
    # ──────────────────────────────────────────────────────────────────

    comments             = relationship(
        "Comment",
        back_populates="ticket",
        cascade="all, delete-orphan",
        order_by="Comment.createdAt",
    )
    __table_args__ = (
        Index("ix_tickets_updated", "updatedAt"),
        Index("ix_tickets_vessel_status", "vesselName", "jiraStatus"),
    )


class Comment(Base):
    __tablename__ = "comments"
    id        = Column(String, primary_key=True, default=_uuid)
    ticket_id = Column(String, ForeignKey("tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author    = Column(String, nullable=True)
    message   = Column(Text, nullable=False)
    source    = Column(String, default="jira")
    createdAt = Column(DateTime, default=datetime.utcnow)
    images    = Column(JSONB, default=list)

    # ── NEW: Sync columns ─────────────────────────────────────────────
    version   = Column(Integer, nullable=False, default=1)
    origin    = Column(String(20), nullable=False, default="SHORE")
    is_deleted = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # ──────────────────────────────────────────────────────────────────

    ticket    = relationship("Ticket", back_populates="comments")