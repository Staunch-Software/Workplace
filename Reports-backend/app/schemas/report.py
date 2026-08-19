# app/schemas/report.py
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
from uuid import UUID
from app.models.report import ScrapeStatus, VerifyStatus


class VerifyRequest(BaseModel):
    verified_by: str


# ── Thread Schemas ─────────────────────────────────────────────────────────────

class ThreadAttachmentCreate(BaseModel):
    file_name: str
    file_size: int
    content_type: str
    blob_path: str

class ThreadAttachmentOut(BaseModel):
    id: UUID
    file_name: str
    file_size: int
    content_type: str
    blob_path: str
    created_at: datetime

    class Config:
        from_attributes = True

class ThreadCreate(BaseModel):
    body: str
    tagged_user_ids: Optional[List[str]] = []
    attachments: Optional[List[ThreadAttachmentCreate]] = []


class ThreadOut(BaseModel):
    id: UUID
    report_id: UUID
    author_id: str
    author_name: str
    author_role: str
    body: str
    created_at: datetime
    attachments: List[ThreadAttachmentOut] = []

    class Config:
        from_attributes = True


class ReportAttachmentSchema(BaseModel):
    id: UUID
    file_name: str
    blob_path: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Report Schemas ─────────────────────────────────────────────────────────────

class ReportOut(BaseModel):
    id: UUID
    vessel_imo: str
    vessel_name: str

    # SmartPAL scraped fields
    job_order_no:   str
    report_code:    str
    report_name:    str
    department:     Optional[str]
    frequency:      Optional[str]
    job_status:     Optional[str]
    job_type:       Optional[str]
    job_category:   Optional[str]
    approved_by:    Optional[str]
    due_date:       Optional[datetime]
    next_due_date:  Optional[datetime]
    due_hours:      Optional[float]
    job_start_date: Optional[datetime]
    job_end_date:   Optional[datetime]
    job_date:       Optional[datetime]

    # System fields
    scrape_status:  ScrapeStatus
    verify_status:  VerifyStatus
    verified_by:    Optional[str]
    verified_at:    Optional[datetime]
    unread_shore:   int
    unread_vessel:  int
    created_at:     Optional[datetime]
    updated_at:     Optional[datetime]
    threads:        List[ThreadOut] = []
    attachments:    List[ReportAttachmentSchema] = []

    class Config:
        from_attributes = True


class ReportListOut(BaseModel):
    """Used for the main table view — all SmartPAL fields included."""
    id: UUID
    vessel_imo:     str
    vessel_name:    str
    job_order_no:   str
    report_code:    str
    report_name:    str
    department:     Optional[str]
    frequency:      Optional[str]
    job_status:     Optional[str]
    job_type:       Optional[str]
    job_category:   Optional[str]
    approved_by:    Optional[str]
    due_date:       Optional[datetime]
    next_due_date:  Optional[datetime]
    due_hours:      Optional[float]
    job_start_date: Optional[datetime]
    job_end_date:   Optional[datetime]
    scrape_status:  ScrapeStatus
    verify_status:  VerifyStatus
    unread_shore:   int
    unread_vessel:  int
    updated_at:     Optional[datetime]
    attachments:    List[ReportAttachmentSchema] = []

    class Config:
        from_attributes = True


class SasUrlOut(BaseModel):
    sas_url:   str
    blob_path: str


# ── Config Schemas ─────────────────────────────────────────────────────────────

class BulkAssignRequest(BaseModel):
    vessel_imo: str
    vessel_name: str

class ReportConfigCreate(BaseModel):
    vessel_imo:  str
    vessel_name: str
    report_code: str
    report_name: str
    department:  Optional[str] = None
    frequency:   Optional[str] = None


class ReportConfigOut(BaseModel):
    id:          UUID
    vessel_imo:  str
    vessel_name: str
    report_code: str
    report_name: str
    department:  Optional[str]
    frequency:   Optional[str]
    created_at:  Optional[datetime]

    class Config:
        from_attributes = True
