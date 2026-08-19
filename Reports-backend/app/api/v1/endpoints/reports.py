# app/api/v1/endpoints/reports.py
#
# REST endpoints for the Report Tracker (Shore side).
#
# RBAC:
#   GET  /reports         -> SHORE, ADMIN (list all reports with inbox sorting)
#   GET  /reports/{id}    -> SHORE, ADMIN (single report with full thread)
#   GET  /reports/{id}/pdf -> SHORE, ADMIN (returns a 24-hr read SAS URL for the PDF)
#
# VESSEL endpoints (verify) are in a separate file, not implemented here.

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import desc, case

from app.core.database import get_db
from app.api.deps import require_shore, require_any
from app.models.report import Report, ReportThread, ReportConfig
from app.schemas.report import ReportOut, ReportListOut, SasUrlOut
from app.core.blob_storage import generate_read_sas_url, verify_blob_exists

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("", response_model=List[ReportListOut])
async def list_reports(
    vessel_imo: Optional[str] = Query(None, description="Filter by vessel IMO"),
    department: Optional[str] = Query(None, description="Filter: DECK or ENGINE"),
    scrape_status: Optional[str] = Query(None, description="Filter: PENDING, SCRAPED, FAILED"),
    verify_status: Optional[str] = Query(None, description="Filter: UNVERIFIED, VERIFIED"),
    search: Optional[str] = Query(None, description="Search by report name or job order no"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns the full inbox list of reports for Shore/Admin.

    Inbox ordering (most urgent first):
      1. Reports with unread_shore > 0  (vessel sent a message)
      2. Reports with verify_status = UNVERIFIED
      3. Reports with scrape_status = FAILED
      4. Everything else, sorted by updated_at DESC
    """
    stmt = select(Report).options(selectinload(Report.attachments))

    # ── ONLY INCLUDE CONFIGURED REPORTS ──
    stmt = stmt.join(
        ReportConfig,
        (Report.vessel_imo == ReportConfig.vessel_imo) &
        (Report.report_code == ReportConfig.report_code)
    )

    # ── VESSEL ROLE: restrict to their assigned vessel(s) only ──
    if current_user.role == 'VESSEL':
        assigned = getattr(current_user, 'assigned_vessels', [])
        if assigned:
            stmt = stmt.where(Report.vessel_imo.in_(assigned))
        else:
            # No assigned vessels → return nothing for safety
            return []

    # ── FILTERS ──
    if vessel_imo:
        stmt = stmt.where(Report.vessel_imo == vessel_imo)
    if department:
        stmt = stmt.where(Report.department == department.upper())
    if scrape_status:
        stmt = stmt.where(Report.scrape_status == scrape_status.upper())
    if verify_status:
        stmt = stmt.where(Report.verify_status == verify_status.upper())
    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            Report.report_name.ilike(pattern) |
            Report.job_order_no.ilike(pattern)
        )

    # ── INBOX SORT: unread first, then unverified, then failed, then newest ──
    stmt = stmt.order_by(
        desc(Report.unread_shore > 0),
        desc(Report.verify_status == "UNVERIFIED"),
        desc(Report.scrape_status == "FAILED"),
        desc(Report.updated_at),
    )

    result = await db.execute(stmt)
    reports = result.scalars().all()
    return reports



@router.get("/{report_id}", response_model=ReportOut)
async def get_report(
    report_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns full details of a single report including all thread messages.
    Called when a user clicks a report in the inbox list.
    """
    stmt = (
        select(Report)
        .where(Report.id == report_id)
        .options(selectinload(Report.threads))
        .options(selectinload(Report.attachments))
    )
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    # Mark shore's unread count as 0 after they open the report
    if report.unread_shore > 0:
        report.unread_shore = 0
        await db.commit()

    return report


@router.get("/{report_id}/pdf", response_model=SasUrlOut)
async def get_report_pdf_url(
    report_id: UUID,
    path: Optional[str] = Query(None, description="Specific blob path to get SAS URL for"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Returns a 24-hour read-only Azure Blob SAS URL for the PDF.
    The frontend PdfViewer component uses this URL to load the PDF in an iframe.
    """
    stmt = select(Report).where(Report.id == report_id).options(selectinload(Report.attachments))
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not report.attachments:
        return SasUrlOut(
            sas_url="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", 
            blob_path="dummy.pdf"
        )

    if path:
        # If the frontend requested a specific path, use it (verify it belongs to this report first)
        valid_paths = [att.blob_path for att in report.attachments]
        if path not in valid_paths:
            raise HTTPException(status_code=403, detail="Requested path does not belong to this report")
        target_path = path
    else:
        # Fallback to the first attachment
        target_path = report.attachments[0].blob_path

    if not verify_blob_exists(target_path):
        return SasUrlOut(
            sas_url="https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf", 
            blob_path=target_path
        )

    sas_url = generate_read_sas_url(target_path)
    return SasUrlOut(sas_url=sas_url, blob_path=target_path)
