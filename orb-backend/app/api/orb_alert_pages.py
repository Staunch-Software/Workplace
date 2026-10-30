import uuid

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import assert_vessel_access, get_current_user
from app.models.control_user import ControlUser
from app.models.orb_alert import OrbAlert
from app.models.orb_entry import OrbEntry
from app.models.orb_entry_quantity import OrbEntryQuantity
from app.models.orb_upload import OrbUpload
from app.models.vessel import Vessel
from app.schemas.common import success
from app.services import alert_pages

router = APIRouter(prefix="/alerts", tags=["alert-pages"])


async def _context(db: AsyncSession, user: ControlUser, alert_id: uuid.UUID):
    """(alert, entry, upload, pdf_bytes, source) for an alert tied to a page, else 404."""
    alert = (await db.execute(select(OrbAlert).where(OrbAlert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await assert_vessel_access(user, db, alert.vessel_id)
    if not alert.entry_id:
        raise HTTPException(status_code=404, detail="This alert covers the whole vessel and is not tied to a page")
    entry = (await db.execute(select(OrbEntry).where(OrbEntry.id == alert.entry_id))).scalar_one_or_none()
    if entry is None or not entry.page_number:
        raise HTTPException(status_code=404, detail="The page of this alert is not known")
    upload = (await db.execute(select(OrbUpload).where(OrbUpload.id == entry.upload_id))).scalar_one_or_none()
    if upload is None:
        raise HTTPException(status_code=404, detail="Upload not found")
    try:
        pdf = await alert_pages.load_upload_pdf(upload)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    source = alert_pages.locate_raw_page(upload.page_map, entry.page_number, upload.total_pages, alert_pages.pdf_page_count(pdf))
    return alert, entry, upload, pdf, source


@router.get("/{alert_id}/page-info")
async def page_info(alert_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """Where an alert's page is: lets the popup label its panes and skip them for vessel-level alerts."""
    alert = (await db.execute(select(OrbAlert).where(OrbAlert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await assert_vessel_access(user, db, alert.vessel_id)
    if not alert.entry_id:
        return success(data={"has_page": False, "reason": "This alert covers the whole vessel, not a single page."})
    try:
        _, entry, upload, _pdf, source = await _context(db, user, alert_id)
    except HTTPException as e:
        if e.status_code == 404:
            return success(data={"has_page": False, "reason": e.detail})
        raise
    return success(data={
        "has_page": True, "upload_id": str(upload.id), "filename": upload.original_filename,
        "extracted_page": entry.page_number, "raw_page": source["raw_page"] if source else None,
        "part": source["part"] if source else None, "approximate": source["approximate"] if source else False,
    })


@router.get("/{alert_id}/raw-page")
async def raw_page(alert_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """The alert's page of the uploaded PDF, as a one-page PDF."""
    alert, entry, upload, pdf, source = await _context(db, user, alert_id)
    if source is None:
        raise HTTPException(status_code=404, detail="The page of this alert could not be located in the PDF")
    try:
        content = alert_pages.slice_raw_page(pdf, source["raw_page"])
    except IndexError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="page-{source["raw_page"]}.pdf"'})


@router.get("/{alert_id}/extracted-page")
async def extracted_page(alert_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """What the system extracted from the alert's page, with the alerted entry highlighted."""
    alert, entry, upload, pdf, source = await _context(db, user, alert_id)
    entries = (await db.execute(select(OrbEntry).where(OrbEntry.upload_id == upload.id, OrbEntry.page_number == entry.page_number))).scalars().all()
    quantities: dict = {e.id: [] for e in entries}
    if entries:
        for q in (await db.execute(select(OrbEntryQuantity).where(OrbEntryQuantity.entry_id.in_([e.id for e in entries])))).scalars().all():
            quantities[q.entry_id].append(q)
    vessel = (await db.execute(select(Vessel).where(Vessel.id == upload.vessel_id))).scalar_one_or_none()
    content = alert_pages.render_extracted_page(
        vessel_name=vessel.name if vessel else "", upload=upload, page_number=entry.page_number, source=source,
        entries=entries, quantities=quantities, alert=alert,
    )
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="extracted-page-{entry.page_number}.pdf"'})
