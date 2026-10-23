import uuid
import os
import hashlib
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, BackgroundTasks, Query
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
import io

from app.config import get_settings
from app.database import get_db, AsyncSessionLocal
from app.models.orb_upload import OrbUpload
from app.models.orb_entry import OrbEntry
from app.models.orb_entry_quantity import OrbEntryQuantity
from app.models.orb_alert import OrbAlert
from app.models.orb_upload_raw import OrbUploadRaw
from app.models.vessel import Vessel
from app.models.user import User as OrbHistoryUser
from app.models.control_user import ControlUser
from app.control_database import get_control_db
from app.schemas.orb_upload import UploadResponse, UploadDetail
from app.schemas.orb_entry import EntryResponse
from app.schemas.common import success
from app.dependencies import get_current_user, require_shore, require_admin, allowed_vessel_ids, scope_vessel_ids, assert_vessel_access

router = APIRouter(prefix="/uploads", tags=["uploads"])
settings = get_settings()
logger = logging.getLogger(__name__)


@router.get("")
async def list_uploads(
    vessel_id: Optional[List[uuid.UUID]] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    q = select(OrbUpload).order_by(OrbUpload.created_at.desc()).limit(50)
    scoped = scope_vessel_ids(vessel_id, await allowed_vessel_ids(user, db))
    if scoped is not None:
        q = q.where(OrbUpload.vessel_id.in_(scoped))
    result = await db.execute(q)
    uploads = result.scalars().all()
    return success(data=[UploadResponse.model_validate(u).model_dump() for u in uploads])


@router.post("")
async def create_upload(
    background_tasks: BackgroundTasks,
    vessel_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: ControlUser = Depends(require_shore),
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    content = await file.read()
    max_bytes = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB} MB limit")

    await assert_vessel_access(current_user, db, vessel_id)
    result = await db.execute(select(Vessel).where(Vessel.id == vessel_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Vessel not found")

    # ── Layer 1: file-hash duplicate check ───────────────────────────────────
    file_hash = hashlib.sha256(content).hexdigest()
    existing = await db.execute(
        select(OrbUpload).where(
            OrbUpload.vessel_id == vessel_id,
            OrbUpload.file_hash == file_hash,
            OrbUpload.status == "completed",
        )
    )
    duplicate_upload = existing.scalar_one_or_none()
    if duplicate_upload:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This exact file has already been uploaded and processed for this vessel "
                f"(upload id: {duplicate_upload.id}, file: {duplicate_upload.original_filename}). "
                f"Uploading the same file twice would create duplicate ORB entries."
            ),
        )

    upload_id = uuid.uuid4()
    vessel_dir = os.path.join(settings.UPLOAD_DIR, str(vessel_id))
    os.makedirs(vessel_dir, exist_ok=True)
    storage_path = os.path.join(vessel_dir, f"{upload_id}_{file.filename}")

    with open(storage_path, "wb") as f:
        f.write(content)

    # Best-effort: also persist the original PDF to Azure Blob Storage so it can
    # be previewed later. If blob storage is unavailable, the upload still
    # proceeds — the preview endpoint falls back to the local storage_path.
    pdf_blob_url = None
    if settings.AZURE_STORAGE_CONNECTION_STRING:
        try:
            from app.services.azure_storage import upload_orb_pdf
            pdf_blob_url = await upload_orb_pdf(content, file.filename)
        except Exception:
            logger.exception("Failed to upload ORB PDF %s to blob storage", file.filename)

    upload = OrbUpload(
        id=upload_id,
        vessel_id=vessel_id,
        uploaded_by=current_user.id,
        original_filename=file.filename,
        storage_path=storage_path,
        pdf_blob_url=pdf_blob_url,
        status="pending",
        extracted_entries_count=0,
        file_hash=file_hash,
        duplicate_entries_skipped=0,
    )
    db.add(upload)
    await db.commit()
    await db.refresh(upload)

    from app.services.extraction import run_extraction
    background_tasks.add_task(run_extraction, upload_id, storage_path, vessel_id, AsyncSessionLocal)

    return success(data=UploadResponse.model_validate(upload).model_dump(), message="Upload queued for processing")


@router.get("/{upload_id}")
async def get_upload(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_shore),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    vessel_result = await db.execute(select(Vessel).where(Vessel.id == upload.vessel_id))
    vessel = vessel_result.scalar_one_or_none()

    # Old uploads point at ORB's own (now historical) users table; new ones at
    # workplace users in the control database.
    uploader_name = None
    old_result = await db.execute(select(OrbHistoryUser).where(OrbHistoryUser.id == upload.uploaded_by))
    old_uploader = old_result.scalar_one_or_none()
    if old_uploader:
        uploader_name = old_uploader.name
    else:
        new_result = await control_db.execute(select(ControlUser).where(ControlUser.id == upload.uploaded_by))
        new_uploader = new_result.scalar_one_or_none()
        uploader_name = new_uploader.full_name if new_uploader else None

    data = UploadDetail.model_validate(upload).model_dump()
    data["vessel_name"] = vessel.name if vessel else None
    data["uploader_name"] = uploader_name
    return success(data=data)


# ── TEMPORARY (testing only) ─────────────────────────────────────────────────
# Re-run extraction on an existing upload so older uploads pick up newer
# extraction rules (e.g. item_lines / item-number alerts). Remove once testing
# is done: it deletes the upload's entries and the alerts attached to them.
@router.post("/{upload_id}/reprocess")
async def reprocess_upload(
    upload_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_admin),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    if upload.status in ("pending", "processing"):
        # A run that has shown no activity for a long time is dead (worker restarted, connection
        # dropped...) and would otherwise stay "processing" forever with no way to retry it.
        from datetime import datetime, timezone, timedelta
        last = upload.updated_at or upload.created_at
        if last is not None and (datetime.now(timezone.utc) - last) < timedelta(minutes=30):
            raise HTTPException(status_code=409, detail="This upload is still being processed (activity within the last 30 minutes)")

    # The extractor reads the PDF from disk; restore it from blob storage if the
    # local copy is gone.
    if not (upload.storage_path and os.path.exists(upload.storage_path)):
        if not upload.pdf_blob_url:
            raise HTTPException(status_code=404, detail="Original PDF is no longer available")
        from app.services.azure_storage import download_iopp_document
        content, _ = await download_iopp_document(upload.pdf_blob_url)
        os.makedirs(os.path.dirname(upload.storage_path) or ".", exist_ok=True)
        with open(upload.storage_path, "wb") as f:
            f.write(content)

    from app.services.alert_chat import upload_has_alert_chat
    if await upload_has_alert_chat(db, upload_id):
        raise HTTPException(status_code=409, detail="Alerts of this upload already have chat messages; re-processing would delete them")

    # Entries first: extraction de-duplicates against every existing entry of the
    # vessel, so leaving the old ones would turn the whole re-run into duplicates.
    entry_ids = select(OrbEntry.id).where(OrbEntry.upload_id == upload_id)
    await db.execute(delete(OrbAlert).where(OrbAlert.entry_id.in_(entry_ids)))
    await db.execute(delete(OrbEntryQuantity).where(OrbEntryQuantity.entry_id.in_(entry_ids)))
    await db.execute(delete(OrbEntry).where(OrbEntry.upload_id == upload_id))
    upload.status = "pending"
    upload.error_message = None
    upload.pages_processed = 0
    upload.extracted_entries_count = 0
    upload.duplicate_entries_skipped = 0
    await db.commit()

    from app.services.extraction import run_extraction
    background_tasks.add_task(run_extraction, upload_id, upload.storage_path, upload.vessel_id, AsyncSessionLocal)
    logger.warning("Upload %s re-queued for extraction by %s (temporary reprocess endpoint)", upload_id, user.id)
    return success(message="Re-extraction queued")


# ── TEMPORARY (testing only) ─────────────────────────────────────────────────
# Re-apply post-processing (repairs, de-duplication, checks) to the extraction saved for this
# upload, WITHOUT calling Gemini. Remove together with /reprocess once testing is done.
@router.post("/{upload_id}/reprocess-saved")
async def reprocess_saved(
    upload_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_admin),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    if upload.status in ("pending", "processing"):
        from datetime import datetime, timezone, timedelta
        last = upload.updated_at or upload.created_at
        if last is not None and (datetime.now(timezone.utc) - last) < timedelta(minutes=30):
            raise HTTPException(status_code=409, detail="This upload is still being processed (activity within the last 30 minutes)")
    if await db.get(OrbUploadRaw, upload_id) is None:
        raise HTTPException(status_code=404, detail="No saved extraction for this upload. Run a full re-extraction once; later fixes can then be re-applied for free.")

    from app.services.alert_chat import upload_has_alert_chat
    if await upload_has_alert_chat(db, upload_id):
        raise HTTPException(status_code=409, detail="Alerts of this upload already have chat messages; re-processing would delete them")

    entry_ids = select(OrbEntry.id).where(OrbEntry.upload_id == upload_id)
    await db.execute(delete(OrbAlert).where(OrbAlert.entry_id.in_(entry_ids)))
    await db.execute(delete(OrbEntryQuantity).where(OrbEntryQuantity.entry_id.in_(entry_ids)))
    await db.execute(delete(OrbEntry).where(OrbEntry.upload_id == upload_id))
    upload.status = "pending"
    upload.error_message = None
    upload.pages_processed = 0
    upload.extracted_entries_count = 0
    upload.duplicate_entries_skipped = 0
    await db.commit()

    from app.services.extraction import run_extraction
    background_tasks.add_task(run_extraction, upload_id, upload.storage_path, upload.vessel_id, AsyncSessionLocal, True)
    logger.warning("Upload %s re-processed from saved extraction by %s (temporary endpoint)", upload_id, user.id)
    return success(message="Re-processing from the saved extraction queued")


@router.get("/{upload_id}/alerts")
async def get_upload_alerts(
    upload_id: uuid.UUID,
    is_resolved: Optional[bool] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    """Alerts that belong to THIS upload (its own entries, plus batch-level alerts raised while it
    was processed). The vessel-wide list is /api/alerts; the upload page used to show that one, so
    a brand-new upload with no entries displayed every open alert the vessel ever had."""
    from app.models.orb_alert import OrbAlert  # noqa: F401  (typing aid)
    from app.schemas.orb_alert import AlertResponse
    from app.services.report_alerts import alerts_for_upload

    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    entries = (await db.execute(select(OrbEntry).where(OrbEntry.upload_id == upload_id))).scalars().all()
    pages = {e.id: e.page_number for e in entries}
    alerts = await alerts_for_upload(db, upload, list(entries))
    from app.services.alert_chat import thread_stats
    stats = await thread_stats(db, user, [a.id for a in alerts])
    data = []
    for a in alerts:
        if is_resolved is not None and a.is_resolved != is_resolved:
            continue
        d = AlertResponse.model_validate(a).model_dump()
        d["page_number"] = pages.get(a.entry_id)
        d["upload_id"] = upload_id if a.entry_id in pages else None
        d["thread_count"], d["unread_count"] = stats.get(a.id, (0, 0))
        data.append(d)
    return success(data=data)


@router.get("/{upload_id}/pdf")
async def get_upload_pdf(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    """Stream the original uploaded PDF back for in-app preview.

    Prefers the local storage_path (fast, and always written on upload) and
    only falls back to Azure Blob Storage (a network round-trip, several
    seconds slower) if the local copy is missing -- e.g. a different server
    instance than the one that handled the original upload.
    """
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    if upload.storage_path and os.path.exists(upload.storage_path):
        with open(upload.storage_path, "rb") as f:
            content = f.read()
        content_type = "application/pdf"
    elif upload.pdf_blob_url:
        from app.services.azure_storage import download_iopp_document
        content, content_type = await download_iopp_document(upload.pdf_blob_url)
    else:
        raise HTTPException(status_code=404, detail="Original PDF is no longer available")

    # Plain Response, not StreamingResponse: the content is already fully in
    # memory, and StreamingResponse iterates a raw BytesIO line-by-line
    # (splitting on \n bytes) rather than in fixed chunks -- binary PDFs are
    # full of 0x0A bytes, so that turns a few-MB file into tens of thousands
    # of tiny awaited chunks and inflates response time by orders of magnitude.
    return Response(
        content=content,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{upload.original_filename}"'},
    )


@router.get("/{upload_id}/entries")
async def get_upload_entries(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    from app.models.orb_entry_quantity import OrbEntryQuantity
    owner = (await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, owner.vessel_id)
    result = await db.execute(
        select(OrbEntry).where(OrbEntry.upload_id == upload_id).order_by(OrbEntry.entry_date)
    )
    entries = result.scalars().all()

    data = []
    for entry in entries:
        qty_result = await db.execute(
            select(OrbEntryQuantity).where(OrbEntryQuantity.entry_id == entry.id)
        )
        quantities = qty_result.scalars().all()
        entry_data = EntryResponse.model_validate(entry).model_dump()
        from app.schemas.orb_entry import QuantityResponse
        entry_data["quantities"] = [QuantityResponse.model_validate(q).model_dump() for q in quantities]
        data.append(entry_data)

    return success(data=data)

@router.get("/{upload_id}/daily-log")
async def get_daily_log(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    from app.services.daily_log import build_daily_log
    log_data = await build_daily_log(upload.vessel_id, upload_id, db)
    return success(data=log_data)

@router.get("/{upload_id}/export/excel")
async def export_excel(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    from app.services.excel_report import generate_excel
    xlsx_bytes = await generate_excel(upload_id, db)
    filename = f"ORB_Report_{upload.original_filename.replace('.pdf', '')}.xlsx"

    return StreamingResponse(
        io.BytesIO(xlsx_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{upload_id}/export/pdf")
async def export_pdf(
    upload_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    result = await db.execute(select(OrbUpload).where(OrbUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await assert_vessel_access(user, db, upload.vessel_id)

    from app.services.pdf_report import generate_pdf
    pdf_bytes = await generate_pdf(upload_id, db)
    filename = f"ORB_Report_{upload.original_filename.replace('.pdf', '')}.pdf"

    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
