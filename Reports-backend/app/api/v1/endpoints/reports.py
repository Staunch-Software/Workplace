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
from uuid import UUID, uuid4
from datetime import datetime, date
import enum
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import desc, case

from app.core.database import get_db
from app.core.config import settings
from app.models.sync import SyncQueue
from app.api.deps import require_shore, require_any
from app.models.report import Report, ReportThread, ReportConfig, ReportEvent, VerifyStatus
from app.schemas.report import ReportOut, ReportListOut, SasUrlOut, VerifyRequest
from app.core.blob_storage import generate_read_sas_url, verify_blob_exists

router = APIRouter(prefix="/reports", tags=["Reports"])


def _should_sync() -> bool:
    """True only on a vessel instance (STORAGE_MODE=offline). No-op on shore."""
    return settings.is_offline_vessel


def _json_safe(value):
    """Coerces ORM column values (datetime, UUID, Enum) into JSONB-storable types."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, enum.Enum):
        return value.value
    return value


def _enqueue_sync(db: AsyncSession, entity_type: str, entity_id, operation: str, payload: dict):
    db.add(SyncQueue(
        entity_type=entity_type,
        entity_id=entity_id,
        operation=operation,
        payload={k: _json_safe(v) for k, v in payload.items()},
        origin="VESSEL",
        status="PENDING",
    ))


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
        assigned = getattr(current_user, 'assigned_vessels', None)
        if assigned is None:
            # assigned_vessels lookup failed (see deps.get_current_user) --
            # do NOT silently return [], that's indistinguishable from a
            # vessel user who genuinely has 0 vessels and would show an
            # empty inbox with no indication anything went wrong.
            raise HTTPException(
                status_code=503,
                detail="Could not verify vessel assignment. Please retry.",
            )
        if assigned:
            stmt = stmt.where(Report.vessel_imo.in_(assigned))
        else:
            # Genuinely no vessels assigned → return nothing for safety
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

    # Clear whichever side's unread badge belongs to the viewer's own role.
    # Shore/Admin opening it clears unread_shore; a vessel user opening their
    # own report clears unread_vessel. Never clear the other side's count.
    if current_user.role in ("SHORE", "ADMIN") and report.unread_shore > 0:
        report.unread_shore = 0
        await db.commit()
    elif current_user.role == "VESSEL" and report.unread_vessel > 0:
        report.unread_vessel = 0
        await db.commit()

    return report


@router.post("/{report_id}/verify", response_model=ReportOut)
async def verify_report(
    report_id: UUID,
    payload: VerifyRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_any),
):
    """
    Marks a report as verified. Called by vessel crew after reviewing a report.
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

    report.verify_status = VerifyStatus.VERIFIED
    report.verified_by = payload.verified_by
    report.verified_at = datetime.utcnow()
    report.updated_at = datetime.utcnow()

    event = ReportEvent(
        id=uuid4(),
        vessel_imo=report.vessel_imo,
        vessel_name=report.vessel_name,
        report_id=report.id,
        event_type="VERIFIED",
        description=f"{report.report_name} was verified by {payload.verified_by}",
        source="VESSEL",
        author_name=payload.verified_by,
        created_at=datetime.utcnow(),
    )
    db.add(event)

    if _should_sync():
        _enqueue_sync(db, "report", report.id, "UPDATE", {
            c.name: getattr(report, c.name) for c in report.__table__.columns
        })
        _enqueue_sync(db, "report_event", event.id, "CREATE", {
            c.name: getattr(event, c.name) for c in event.__table__.columns
        })

    await db.commit()

    # Re-query with the same eager-loading as the initial fetch — db.refresh()
    # would expire the already-loaded threads/attachments relationships and
    # risk a lazy-load (MissingGreenlet) when the response model serializes them.
    stmt_reload = (
        select(Report)
        .where(Report.id == report_id)
        .options(selectinload(Report.threads))
        .options(selectinload(Report.attachments))
    )
    result_reload = await db.execute(stmt_reload)
    return result_reload.scalars().first()


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
        raise HTTPException(status_code=404, detail="Attachment not available")

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
        # Don't fall back to an external placeholder URL -- if it ever fails
        # to load (network policy, the third-party host being unreachable,
        # etc.) the iframe shows a confusing native "Failed to load PDF
        # document" error. Tell the frontend outright so AttachmentsPanel can
        # show its own "attachment not available" state instead.
        raise HTTPException(status_code=404, detail="Attachment not available")

    sas_url = generate_read_sas_url(target_path)
    return SasUrlOut(sas_url=sas_url, blob_path=target_path)
