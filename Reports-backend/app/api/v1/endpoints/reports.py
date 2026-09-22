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
import os
import re
from fastapi import APIRouter, Depends, HTTPException, Query, Form, File, UploadFile
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import desc, case

from app.core.database import get_db
from app.core.config import settings
from app.models.sync import SyncQueue
from app.api.deps import require_shore, require_any
from app.models.report import Report, ReportThread, ReportConfig, ReportEvent, ReportAttachment, ScrapeStatus, VerifyStatus
from app.schemas.report import ReportOut, ReportListOut, SasUrlOut, VerifyRequest
from app.core.blob_storage import generate_read_sas_url, verify_blob_exists, download_blob_bytes, upload_pdf_to_blob
from app.utils.report_date import extract_report_period
import mimetypes
import io
from fastapi.responses import StreamingResponse
import logging

router = APIRouter(prefix="/reports", tags=["Reports"])
logger = logging.getLogger("reports.endpoints")


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
    # Always hide the SmartPAL "failed" placeholders from the UI
    stmt = stmt.where(Report.job_order_no != "N/A")

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



MANUAL_UPLOAD_EXTS = {".pdf", ".xls", ".xlsx", ".xlsm", ".csv", ".doc", ".docx"}
MANUAL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024


@router.post("/manual-upload", response_model=ReportListOut)
async def manual_upload_report(
    vessel_imo: str = Form(...),
    report_code: str = Form(...),
    report_date: Optional[date] = Form(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_shore),
):
    """
    Shore/Admin uploads a report file directly (e.g. one not obtainable from
    SmartPAL). Creates a normal SCRAPED Report + attachment for the chosen
    vessel/report type, so it shows up on the Dashboard and Overview exactly
    like a scraped one. report_date drives which period Overview files it under.
    If report_date is omitted, it is read out of the file with the same logic
    the scraper uses (extract_report_period); 422 if the file has no readable date.
    """
    cfg = (await db.execute(
        select(ReportConfig).where(
            ReportConfig.vessel_imo == vessel_imo,
            ReportConfig.report_code == report_code,
        )
    )).scalars().first()
    if not cfg:
        raise HTTPException(status_code=404, detail="This report type is not configured for the selected vessel")

    file_name = (file.filename or "").strip()
    ext = os.path.splitext(file_name)[1].lower()
    if ext not in MANUAL_UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="File is empty")
    if len(data) > MANUAL_UPLOAD_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 50 MB")

    uploader = getattr(current_user, "full_name", None) or getattr(current_user, "email", None) or "Shore"
    if report_date is not None:
        dated = datetime.combine(report_date, datetime.min.time())
        date_source = f"manual upload by {uploader}"
    else:
        try:
            found = await run_in_threadpool(extract_report_period, data, file_name)
        except Exception as e:
            logger.warning(f"Report-date extraction failed for '{file_name}': {e}")
            found = None
        if not found:
            raise HTTPException(
                status_code=422,
                detail="Could not read a report date from this file. Please select the report date.",
            )
        dated, found_src = found
        date_source = f"{found_src} (manual upload by {uploader})"

    safe_fname = re.sub(r'[^a-zA-Z0-9_\-\. ]', '', file_name).strip() or f"report{ext}"
    stamp = datetime.utcnow().strftime("%Y-%m-%d")
    blob_name = f"reports/{vessel_imo}/{report_code}/{stamp}_manual_{uuid4().hex[:8]}_{safe_fname}"
    try:
        await run_in_threadpool(upload_pdf_to_blob, data, blob_name)
    except Exception as e:
        logger.error(f"Manual upload to blob failed for '{blob_name}': {e}")
        raise HTTPException(status_code=502, detail="Could not store the file, please retry")

    now = datetime.utcnow()
    report = Report(
        id=uuid4(),
        vessel_imo=cfg.vessel_imo,
        vessel_name=cfg.vessel_name,
        job_order_no=f"MANUAL-{uuid4().hex[:8].upper()}",
        report_code=cfg.report_code,
        report_name=cfg.report_name,
        department=cfg.department,
        frequency=cfg.frequency,
        job_status="COMPLETED",
        job_type="Manual Upload",
        approved_by=uploader,
        job_end_date=dated,
        job_date=dated,
        report_date=dated,
        report_date_source=date_source,
        scrape_status=ScrapeStatus.SCRAPED,
        verify_status=VerifyStatus.UNVERIFIED,
        created_at=now,
        updated_at=now,
    )
    report.attachments.append(ReportAttachment(id=uuid4(), file_name=file_name, blob_path=blob_name))
    db.add(report)
    db.add(ReportEvent(
        id=uuid4(),
        vessel_imo=cfg.vessel_imo,
        vessel_name=cfg.vessel_name,
        report_id=report.id,
        event_type="NEW_REPORT",
        description=f"{cfg.report_name} was uploaded manually by {uploader}",
        source="SHORE",
        author_name=uploader,
        created_at=now,
    ))
    await db.commit()

    result = await db.execute(
        select(Report).where(Report.id == report.id).options(selectinload(Report.attachments))
    )
    return result.scalars().first()


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

    if not await run_in_threadpool(verify_blob_exists, target_path):
        # Don't fall back to an external placeholder URL -- if it ever fails
        # to load (network policy, the third-party host being unreachable,
        # etc.) the iframe shows a confusing native "Failed to load PDF
        # document" error. Tell the frontend outright so AttachmentsPanel can
        # show its own "attachment not available" state instead.
        raise HTTPException(status_code=404, detail="Attachment not available")

    sas_url = generate_read_sas_url(target_path)
    return SasUrlOut(sas_url=sas_url, blob_path=target_path)


@router.get("/{report_id}/pdf/stream")
async def stream_report_pdf(
    report_id: UUID,
    path: Optional[str] = Query(None, description="Specific blob path to stream"),
    db: AsyncSession = Depends(get_db),
):
    """
    Streams the attachment bytes through this API instead of handing the
    browser a direct blob-storage URL. On the vessel, a raw SAS URL always
    points at 127.0.0.1 (local Azurite) -- that only resolves correctly for
    a browser running on the server machine itself, not for other crew PCs
    on the vessel's LAN. Routing the bytes through this endpoint (reachable
    via the same nginx proxy as everything else) fixes that regardless of
    which machine the request comes from.

    download_blob_bytes is a synchronous (blocking) Azure SDK call. This app
    runs a single uvicorn worker with one event loop, so calling it directly
    here would freeze the ENTIRE server -- every other request, from any
    user -- for as long as this one download takes. Measured at ~2.3s for a
    2.7MB file; several attachment previews loading around the same time
    (e.g. an Overview page opening more than one report) queue up strictly
    one after another behind that block, which is what actually produced
    the 30+ second waits reported in the UI, not slow network/Azure access.
    run_in_threadpool moves the download off the event loop so it no longer
    blocks other requests while it runs.
    """
    stmt = select(Report).where(Report.id == report_id).options(selectinload(Report.attachments))
    result = await db.execute(stmt)
    report = result.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    if not report.attachments:
        raise HTTPException(status_code=404, detail="Attachment not available")

    if path:
        valid_paths = [att.blob_path for att in report.attachments]
        if path not in valid_paths:
            raise HTTPException(status_code=403, detail="Requested path does not belong to this report")
        target_path = path
    else:
        target_path = report.attachments[0].blob_path

    try:
        data = await run_in_threadpool(download_blob_bytes, target_path)
    except Exception as e:
        logger.warning(f"Could not stream '{target_path}': {e}")
        raise HTTPException(status_code=404, detail="Attachment not available")

    content_type, _ = mimetypes.guess_type(target_path)
    return StreamingResponse(io.BytesIO(data), media_type=content_type or "application/octet-stream")
