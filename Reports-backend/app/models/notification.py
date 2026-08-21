# app/models/notification.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Notification(Base):
    """
    In-app notification record.

    type values:
        "mention"    – someone @mentioned this user in a thread
        "new_report" – scraper found a new completed job cycle for a vessel
                       the user is assigned to
        "new_thread" – a shore/admin user posted a new message to a report
                       thread that was pulled down to the vessel via sync
    """
    __tablename__ = "report_notifications"

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id    = Column(String(100), nullable=False, index=True)   # recipient user id
    type       = Column(String(30),  nullable=False)               # "mention" | "new_report" | "new_thread"
    title      = Column(String(255), nullable=False)
    body       = Column(Text,        nullable=True)
    report_id  = Column(UUID(as_uuid=True), nullable=True)                  # linked report (optional)
    thread_id  = Column(UUID(as_uuid=True), nullable=True, index=True)      # linked thread (optional)
    is_read    = Column(Boolean,     nullable=False, default=False)
    created_at = Column(DateTime,    default=datetime.utcnow)
    updated_at = Column(DateTime,    default=datetime.utcnow, onupdate=datetime.utcnow)
