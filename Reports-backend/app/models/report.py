# app/models/report.py
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer, Float, ForeignKey, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class ScrapeStatus(str, enum.Enum):
    PENDING = "PENDING"
    SCRAPED = "SCRAPED"
    FAILED  = "FAILED"


class VerifyStatus(str, enum.Enum):
    UNVERIFIED = "UNVERIFIED"
    VERIFIED   = "VERIFIED"


class Report(Base):
    """
    One record per SmartPAL report per vessel per scrape cycle.
    All fields below are captured directly from the SmartPAL Job Order page.
    """
    __tablename__ = "reports"

    id              = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_imo      = Column(String(20), nullable=False, index=True)
    vessel_name     = Column(String(100), nullable=False)

    # ── SmartPAL Job Order fields (scraped from the table view) ──
    job_order_no    = Column(String(100), nullable=False)   # e.g. V-AMKI003164/26
    report_code     = Column(String(100), nullable=False)   # e.g. 200.02.02 WEEKLY-01
    report_name     = Column(String(255), nullable=False)   # e.g. DECK WEEKLY WORKDONE REPORT
    department      = Column(String(50),  nullable=True)    # DECK / ENGINE
    frequency       = Column(String(50),  nullable=True)    # e.g. WEEKLY, MONTHLY
    job_status      = Column(String(50),  nullable=True)    # COMPLETED / PENDING
    job_type        = Column(String(100), nullable=True)    # e.g. Inspection
    job_category    = Column(String(100), nullable=True)    # e.g. PLANNED
    approved_by     = Column(String(150), nullable=True)    # name of approver
    due_date        = Column(DateTime,    nullable=True)    # Due Date column
    next_due_date   = Column(DateTime,    nullable=True)    # Next Due Date (from PLANNED row)
    due_hours       = Column(Float,       nullable=True)    # Due Hrs. column
    job_start_date  = Column(DateTime,    nullable=True)    # Job Start Date
    job_end_date    = Column(DateTime,    nullable=True)    # Job End Date
    job_date        = Column(DateTime,    nullable=True)    # legacy / general date

    # ── System tracking fields ──
    scrape_status   = Column(SAEnum(ScrapeStatus), nullable=False, default=ScrapeStatus.PENDING)
    verify_status   = Column(SAEnum(VerifyStatus), nullable=False, default=VerifyStatus.UNVERIFIED)
    verified_by     = Column(String(150), nullable=True)
    verified_at     = Column(DateTime,    nullable=True)

    unread_shore    = Column(Integer, default=0)
    unread_vessel   = Column(Integer, default=0)

    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    threads = relationship(
        "ReportThread", back_populates="report",
        cascade="all, delete-orphan", order_by="ReportThread.created_at"
    )
    attachments = relationship(
        "ReportAttachment", back_populates="report",
        cascade="all, delete-orphan", order_by="ReportAttachment.created_at"
    )


class ReportThread(Base):
    __tablename__ = "report_threads"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id   = Column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    author_id   = Column(String(100), nullable=False)
    author_name = Column(String(150), nullable=False)
    author_role = Column(String(20),  nullable=False)   # SHORE / VESSEL / ADMIN
    body        = Column(Text, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    report = relationship("Report", back_populates="threads")
    attachments = relationship(
        "ReportThreadAttachment", back_populates="thread",
        cascade="all, delete-orphan", order_by="ReportThreadAttachment.created_at"
    )


class ReportThreadAttachment(Base):
    __tablename__ = "report_thread_attachments"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id    = Column(UUID(as_uuid=True), ForeignKey("report_threads.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name    = Column(String(500), nullable=False)
    file_size    = Column(Integer, nullable=True)
    content_type = Column(String(100), nullable=True)
    blob_path    = Column(String(1000), nullable=False)
    created_at   = Column(DateTime, default=datetime.utcnow)

    thread = relationship("ReportThread", back_populates="attachments")


class ReportConfig(Base):
    __tablename__ = "report_configs"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_imo  = Column(String(20),  nullable=False)
    vessel_name = Column(String(100), nullable=False)
    report_code = Column(String(100), nullable=False)
    report_name = Column(String(255), nullable=False)
    department  = Column(String(50),  nullable=True)
    frequency   = Column(String(50),  nullable=True)

    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ReportAttachment(Base):
    __tablename__ = "report_attachments"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    report_id   = Column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name   = Column(String(500), nullable=False)
    blob_path   = Column(String(1000), nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    report = relationship("Report", back_populates="attachments")

class ReportEvent(Base):
    __tablename__ = "report_events"

    id            = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_imo    = Column(String(20), nullable=False, index=True)
    vessel_name   = Column(String(100), nullable=False)
    report_id     = Column(UUID(as_uuid=True), ForeignKey("reports.id", ondelete="CASCADE"), nullable=True)
    event_type    = Column(String(50), nullable=False)   # NEW_REPORT, MISSING_REPORT, MENTION, VERIFIED, NEW_ATTACHMENT
    description   = Column(Text, nullable=False)
    source        = Column(String(50), nullable=True)    # SYSTEM, VESSEL, SHORE
    author_name   = Column(String(150), nullable=True)   # Name of person or 'System'
    created_at    = Column(DateTime, default=datetime.utcnow)

    report = relationship("Report", backref="events")
