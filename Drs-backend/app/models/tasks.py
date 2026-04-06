import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Enum, Integer,UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID,JSONB
from app.core.database import Base
import enum
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship


class TaskStatus(str, enum.Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"

class NotificationType(str, enum.Enum):
    MENTION = "MENTION"        # Tagged in chat
    ALERT = "ALERT"           # Status Change (Open/Close)
    SYSTEM = "SYSTEM"

class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    description = Column(String, nullable=False) # e.g. "Review Defect #123"
    status = Column(Enum(TaskStatus), default=TaskStatus.PENDING)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    # Context
    defect_id = Column(UUID(as_uuid=True), ForeignKey("defects.id"))
    
    # Who assigned it? (The person who tagged)
    created_by_id = Column(UUID(as_uuid=True))
    
    # Who is it for? (The person tagged)
    assigned_to_id = Column(UUID(as_uuid=True), index=True)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )

class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    
    # Who gets this alert?
    user_id = Column(UUID(as_uuid=True), index=True)
    
    type = Column(Enum(NotificationType), default=NotificationType.SYSTEM)
    title = Column(String, nullable=False)
    message = Column(String, nullable=False)
    link = Column(String) # e.g. "/vessel/dashboard?defectId=..."

    is_read = Column(Boolean, default=False)
    is_seen = Column(Boolean, default=False) # Removes from badge (NEW)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    meta = Column(JSONB, default=dict)
    
class FeedEventType(str, enum.Enum):
    DEFECT_OPENED      = "DEFECT_OPENED"
    DEFECT_CLOSED      = "DEFECT_CLOSED"
    PRIORITY_CHANGED   = "PRIORITY_CHANGED"
    IMAGE_UPLOADED     = "IMAGE_UPLOADED"
    PIC_MADE_MANDATORY = "PIC_MADE_MANDATORY"
    PIC_MADE_OPTIONAL  = "PIC_MADE_OPTIONAL"
    PR_ADDED           = "PR_ADDED" 
    PR_INVALID_FORMAT  = "PR_INVALID_FORMAT" 
    MENTION            = "MENTION"


class LiveFeed(Base):
    __tablename__ = "live_feed"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    vessel_imo = Column(String, nullable=False)
    vessel_name = Column(String, nullable=True)          # denormalized for fast filter
    defect_id   = Column(UUID(as_uuid=True), ForeignKey("defects.id", ondelete="SET NULL"), nullable=True, index=True)
    event_type  = Column(Enum(FeedEventType), nullable=False, index=True)
    title       = Column(String, nullable=False)
    message     = Column(String, nullable=False)
    link        = Column(String, nullable=True)
    is_read     = Column(Boolean, default=False, index=True)
    is_seen     = Column(Boolean, default=False)
    created_at  = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    meta        = Column(JSONB, default=dict)
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    
    # user   = relationship("User",   foreign_keys=[user_id],  lazy="select")
    defect = relationship("Defect", foreign_keys=[defect_id], lazy="select")
    
class LiveFeedRead(Base):
    __tablename__ = "live_feed_read"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    feed_id = Column(UUID(as_uuid=True), ForeignKey("live_feed.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("feed_id", "user_id"),)
