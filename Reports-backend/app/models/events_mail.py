# app/models/events_mail.py
# Tables behind the "new logbook report" mail (see app/services/events_mail_service.py).
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class EventsMailRecipient(Base):
    """One email address that receives a vessel's new-report mails (edited on the Report Config > Event mails page)."""
    __tablename__ = "events_mail_recipient"
    __table_args__ = (UniqueConstraint("vessel_imo", "email", name="uq_events_mail_recipient"),)

    id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_imo = Column(String(20),  nullable=False, index=True)
    email      = Column(String(255), nullable=False)   # stored lower-case
    created_at = Column(DateTime,    default=datetime.utcnow)


class EventsMailVessel(Base):
    """Per-vessel on/off switch. No row means enabled."""
    __tablename__ = "events_mail_vessel"

    vessel_imo = Column(String(20), primary_key=True)
    enabled    = Column(Boolean, nullable=False, default=True)


class EventsMailSent(Base):
    """A logbook report that has been mailed (or deliberately skipped as baseline). Claimed before sending."""
    __tablename__ = "events_mail_sent"

    imo      = Column(String, primary_key=True)
    event_id = Column(String, primary_key=True)
    sent_at  = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
