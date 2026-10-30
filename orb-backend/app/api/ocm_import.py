"""Import of 15 ppm bilge alarm / oil content monitor data for a vessel (alert 23).

Shore users and administrators upload the export of the monitor (CSV or xlsx); the records are matched with the
D 15.1 entries of the Oil Record Book the next time the checks run (re-process or recalculate).
"""
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin, require_shore, assert_vessel_access
from app.models.control_user import ControlUser
from app.models.orb_config import OcmImport, OcmRecord
from app.schemas.common import success
from app.services import ocm_data

router = APIRouter(prefix="/vessels", tags=["ocm_import"])

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 300_000


def _name(user: ControlUser) -> str:
    return getattr(user, "full_name", None) or getattr(user, "email", None) or str(user.id)


def _dict(i: OcmImport) -> dict:
    return {
        "id": i.id, "filename": i.filename, "row_count": i.row_count, "period_from": i.period_from, "period_to": i.period_to,
        "imported_by_name": i.imported_by_name, "imported_at": i.imported_at,
    }


@router.get("/{vessel_id}/ocm-imports")
async def list_imports(vessel_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await assert_vessel_access(user, db, vessel_id)
    rows = (await db.execute(select(OcmImport).where(OcmImport.vessel_id == vessel_id).order_by(OcmImport.imported_at.desc()))).scalars().all()
    return success(data=[_dict(r) for r in rows])


@router.post("/{vessel_id}/ocm-imports")
async def import_ocm(
    vessel_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_shore),
):
    await assert_vessel_access(user, db, vessel_id)
    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 10 MB")
    try:
        rows = ocm_data.read_file(file.filename or "", content)
    except Exception:
        raise HTTPException(status_code=422, detail="The file could not be read as CSV or xlsx")
    if len(rows) > MAX_ROWS:
        raise HTTPException(status_code=413, detail=f"More than {MAX_ROWS} rows")
    parsed = ocm_data.parse_rows(rows)
    if not parsed.records:
        raise HTTPException(status_code=422, detail={
            "message": "No usable rows: a date/time column and a status column are needed",
            "headers_found": parsed.headers, "time_column": parsed.time_col, "status_column": parsed.status_col,
            "rows_read": parsed.rows_read, "rows_with_unrecognised_status_or_time": parsed.rows_skipped,
        })

    times = [r[0] for r in parsed.records]
    imp = OcmImport(
        vessel_id=vessel_id, filename=(file.filename or "ocm")[:300], row_count=len(parsed.records),
        period_from=min(times), period_to=max(times), imported_by=user.id, imported_by_name=_name(user),
    )
    db.add(imp)
    await db.flush()
    db.add_all([
        OcmRecord(vessel_id=vessel_id, import_id=imp.id, recorded_at=ts, discharging=on, ppm=ppm, status_text=txt)
        for ts, on, ppm, txt in parsed.records
    ])
    await db.commit()
    await db.refresh(imp)
    ops = ocm_data.operations(parsed.records)
    return success(data={
        **_dict(imp), "rows_read": parsed.rows_read, "rows_skipped": parsed.rows_skipped, "discharge_operations": len(ops),
        "time_column": parsed.time_col, "status_column": parsed.status_col,
    }, message="Monitor data imported; the next re-process or recalculate matches it with the Oil Record Book")


@router.delete("/{vessel_id}/ocm-imports/{import_id}")
async def delete_import(vessel_id: uuid.UUID, import_id: uuid.UUID, db: AsyncSession = Depends(get_db), _: ControlUser = Depends(require_admin)):
    imp = await db.get(OcmImport, import_id)
    if imp is None or imp.vessel_id != vessel_id:
        raise HTTPException(status_code=404, detail="Import not found")
    await db.delete(imp)
    await db.commit()
    return success(message="Import removed")
