import uuid
from datetime import date, datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.control_database import get_control_db
from app.database import get_db
from app.dependencies import can_create, get_current_user, require_creator
from app.models.control_user import ControlUser
from app.models.incident import Incident, IncidentFile
from app.schemas.common import success
from app.services import storage

settings = get_settings()
router = APIRouter(tags=["incidents"])

STATUSES = ("DRAFT", "CLOSED")
FILE_KINDS = ("REPORT", "SOF", "LOG", "PHOTO")
# Starting list; the category is stored as plain text so the list can change without a migration.
CATEGORIES = [
    "Collision", "Grounding / Stranding", "Fire / Explosion", "Pollution", "Personal Injury", "Fatality",
    "Machinery Damage", "Hull / Structural Damage", "Cargo Damage", "Near Miss", "Security", "Port State / Detention", "Other",
]


class IncidentIn(BaseModel):
    vessel_imo: str = Field(min_length=1, max_length=7)
    incident_date: date
    description: str = ""
    category: str = ""
    offhire: bool = False
    offhire_details: str = ""
    comments: str = ""


class IncidentPatch(BaseModel):
    vessel_imo: Optional[str] = Field(default=None, min_length=1, max_length=7)
    incident_date: Optional[date] = None
    description: Optional[str] = None
    category: Optional[str] = None
    offhire: Optional[bool] = None
    offhire_details: Optional[str] = None
    comments: Optional[str] = None
    sof_notes: Optional[str] = None
    log_notes: Optional[str] = None
    writeup: Optional[str] = None


def _iso(d) -> Optional[str]:
    return d.isoformat() if d else None


def _file_dict(f: IncidentFile) -> dict:
    return {"id": str(f.id), "kind": f.kind, "file_name": f.file_name, "file_size": f.file_size,
            "content_type": f.content_type, "caption": f.caption, "created_at": _iso(f.created_at)}


def _incident_dict(i: Incident, extra: Optional[dict] = None) -> dict:
    d = {
        "id": str(i.id), "incident_no": i.incident_no, "status": i.status, "vessel_imo": i.vessel_imo,
        "vessel_name": i.vessel_name, "incident_date": _iso(i.incident_date), "description": i.description,
        "category": i.category, "offhire": i.offhire, "offhire_details": i.offhire_details, "comments": i.comments,
        "sof_notes": i.sof_notes, "log_notes": i.log_notes, "writeup": i.writeup,
        "created_by": str(i.created_by), "created_by_name": i.created_by_name,
        "closed_at": _iso(i.closed_at), "created_at": _iso(i.created_at), "updated_at": _iso(i.updated_at),
    }
    if extra:
        d.update(extra)
    return d


async def _get_incident(db: AsyncSession, incident_id: uuid.UUID) -> Incident:
    inc = (await db.execute(select(Incident).where(Incident.id == incident_id))).scalar_one_or_none()
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    return inc


def _assert_open(inc: Incident) -> None:
    if inc.status == "CLOSED":
        raise HTTPException(status_code=409, detail="This incident is closed; reopen it to make changes")


async def _vessel_name(control_db: AsyncSession, imo: str) -> str:
    row = (await control_db.execute(text("SELECT name FROM vessels WHERE imo = :imo"), {"imo": imo})).first()
    if not row:
        raise HTTPException(status_code=400, detail=f"Unknown vessel IMO {imo}")
    return row[0]


@router.get("/me")
async def me(user: ControlUser = Depends(get_current_user)):
    return success(data={"id": str(user.id), "name": user.full_name, "role": user.role, "can_create": can_create(user)})


@router.get("/categories")
async def categories(user: ControlUser = Depends(get_current_user)):
    return success(data=CATEGORIES)


@router.get("/vessels")
async def vessels(control_db: AsyncSession = Depends(get_control_db), user: ControlUser = Depends(get_current_user)):
    """Every active vessel: shore sees all incidents, so the vessel pick is not limited to assignments."""
    rows = (await control_db.execute(text("SELECT imo, name FROM vessels WHERE is_active ORDER BY name"))).all()
    return success(data=[{"imo": str(r[0]), "name": r[1]} for r in rows])


@router.get("/incidents")
async def list_incidents(
    status: Optional[str] = Query(None),
    vessel_imo: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    stmt = select(Incident).order_by(Incident.incident_date.desc(), Incident.created_at.desc())
    if status:
        if status.upper() not in STATUSES:
            raise HTTPException(status_code=400, detail="status must be DRAFT or CLOSED")
        stmt = stmt.where(Incident.status == status.upper())
    if vessel_imo:
        stmt = stmt.where(Incident.vessel_imo.in_([v for v in vessel_imo.split(",") if v]))
    if category:
        stmt = stmt.where(Incident.category == category)
    if date_from:
        stmt = stmt.where(Incident.incident_date >= date_from)
    if date_to:
        stmt = stmt.where(Incident.incident_date <= date_to)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Incident.incident_no.ilike(like), Incident.description.ilike(like),
                              Incident.vessel_name.ilike(like), Incident.comments.ilike(like)))
    incidents = (await db.execute(stmt)).scalars().all()

    ids = [i.id for i in incidents]
    photos: dict = {}
    reports: dict = {}
    if ids:
        rows = (await db.execute(
            select(IncidentFile).where(IncidentFile.incident_id.in_(ids), IncidentFile.kind.in_(("PHOTO", "REPORT")))
            .order_by(IncidentFile.created_at))).scalars().all()
        for f in rows:
            (photos if f.kind == "PHOTO" else reports).setdefault(f.incident_id, []).append(f)
    out = []
    for i in incidents:
        p = photos.get(i.id, [])
        r = reports.get(i.id, [])
        out.append(_incident_dict(i, {
            "photo_count": len(p), "first_photo_id": str(p[0].id) if p else None,
            "report_count": len(r), "first_report": {"id": str(r[0].id), "file_name": r[0].file_name} if r else None,
        }))
    return success(data=out)


@router.post("/incidents")
async def create_incident(
    body: IncidentIn,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_creator),
):
    name = await _vessel_name(control_db, body.vessel_imo)
    seq = (await db.execute(text("SELECT nextval('incident_no_seq')"))).scalar_one()
    inc = Incident(
        id=uuid.uuid4(), incident_no=f"INC-{body.incident_date.year}-{seq:04d}", status="DRAFT",
        vessel_imo=body.vessel_imo, vessel_name=name, incident_date=body.incident_date,
        description=body.description.strip(), category=body.category.strip(), offhire=body.offhire,
        offhire_details=body.offhire_details.strip(), comments=body.comments.strip(),
        created_by=user.id, created_by_name=user.full_name,
    )
    db.add(inc)
    await db.commit()
    await db.refresh(inc)
    return success(data=_incident_dict(inc), message="Incident created")


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    inc = await _get_incident(db, incident_id)
    files = (await db.execute(select(IncidentFile).where(IncidentFile.incident_id == incident_id)
                              .order_by(IncidentFile.created_at))).scalars().all()
    return success(data=_incident_dict(inc, {"files": [_file_dict(f) for f in files]}))


@router.patch("/incidents/{incident_id}")
async def update_incident(
    incident_id: uuid.UUID,
    body: IncidentPatch,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_creator),
):
    inc = await _get_incident(db, incident_id)
    _assert_open(inc)
    data = body.model_dump(exclude_unset=True)
    if "vessel_imo" in data and data["vessel_imo"] != inc.vessel_imo:
        inc.vessel_name = await _vessel_name(control_db, data["vessel_imo"])
    keep_as_typed = ("writeup", "sof_notes", "log_notes")
    for key, value in data.items():
        if value is None:
            continue  # a column that cannot be null: ignore an explicit null
        setattr(inc, key, value.strip() if isinstance(value, str) and key not in keep_as_typed else value)
    await db.commit()
    await db.refresh(inc)
    return success(data=_incident_dict(inc), message="Saved")


@router.post("/incidents/{incident_id}/close")
async def close_incident(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(require_creator)):
    inc = await _get_incident(db, incident_id)
    inc.status = "CLOSED"
    inc.closed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(inc)
    return success(data=_incident_dict(inc), message="Incident closed")


@router.post("/incidents/{incident_id}/reopen")
async def reopen_incident(incident_id: uuid.UUID, db: AsyncSession = Depends(get_db), user: ControlUser = Depends(require_creator)):
    inc = await _get_incident(db, incident_id)
    inc.status = "DRAFT"
    inc.closed_at = None
    await db.commit()
    await db.refresh(inc)
    return success(data=_incident_dict(inc), message="Incident reopened")


# ── Files: report attachment, SOF, alarm/event log, photos ───────────────────

@router.get("/incidents/{incident_id}/files")
async def list_files(incident_id: uuid.UUID, kind: Optional[str] = Query(None),
                     db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    await _get_incident(db, incident_id)
    stmt = select(IncidentFile).where(IncidentFile.incident_id == incident_id).order_by(IncidentFile.created_at)
    if kind:
        stmt = stmt.where(IncidentFile.kind == kind.upper())
    return success(data=[_file_dict(f) for f in (await db.execute(stmt)).scalars().all()])


@router.post("/incidents/{incident_id}/files")
async def upload_files(
    incident_id: uuid.UUID,
    kind: str = Form(...),
    caption: str = Form(""),
    files: List[UploadFile] = File(default=[]),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(require_creator),
):
    kind = kind.upper()
    if kind not in FILE_KINDS:
        raise HTTPException(status_code=400, detail=f"kind must be one of {', '.join(FILE_KINDS)}")
    inc = await _get_incident(db, incident_id)
    _assert_open(inc)
    files = [f for f in files if f and f.filename]
    if not files:
        raise HTTPException(status_code=400, detail="Choose at least one file")

    # Validate every file before anything is stored.
    prepared = []
    for f in files:
        data = await f.read()
        ctype = storage.validate_file(f.filename, len(data), settings.MAX_FILE_MB, images_only=(kind == "PHOTO"))
        prepared.append((storage.safe_filename(f.filename), data, ctype))

    saved = []
    for name, data, ctype in prepared:
        path = await storage.save(data, name, ctype, incident_id)
        rec = IncidentFile(id=uuid.uuid4(), incident_id=incident_id, kind=kind, file_name=name, file_size=len(data),
                           content_type=ctype, storage_path=path, caption=caption.strip()[:500], uploaded_by=user.id)
        db.add(rec)
        saved.append(rec)
    await db.commit()
    for rec in saved:
        await db.refresh(rec)
    return success(data=[_file_dict(r) for r in saved], message="Uploaded")


@router.get("/incidents/{incident_id}/files/{file_id}")
async def download_file(incident_id: uuid.UUID, file_id: uuid.UUID,
                        db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    f = (await db.execute(select(IncidentFile).where(IncidentFile.id == file_id, IncidentFile.incident_id == incident_id))).scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        content = await storage.read(f.storage_path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="The file is no longer available")
    return Response(content=content, media_type=f.content_type,
                    headers={"Content-Disposition": f'inline; filename="{storage.safe_filename(f.file_name)}"'})


@router.delete("/incidents/{incident_id}/files/{file_id}")
async def delete_file(incident_id: uuid.UUID, file_id: uuid.UUID,
                      db: AsyncSession = Depends(get_db), user: ControlUser = Depends(require_creator)):
    inc = await _get_incident(db, incident_id)
    _assert_open(inc)
    f = (await db.execute(select(IncidentFile).where(IncidentFile.id == file_id, IncidentFile.incident_id == incident_id))).scalar_one_or_none()
    if f is None:
        raise HTTPException(status_code=404, detail="File not found")
    await db.delete(f)
    await db.commit()
    return success(message="Deleted")
