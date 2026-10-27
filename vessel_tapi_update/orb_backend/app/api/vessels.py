import uuid
from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from app.database import get_db
from app.control_database import get_control_db
from app.models.vessel import Vessel
from app.models.control_user import ControlUser
from app.schemas.vessel import VesselCreate, VesselUpdate, VesselResponse
from app.schemas.common import success
from app.dependencies import get_current_user, require_admin, allowed_vessel_ids, assert_vessel_access, shore_instance_only

router = APIRouter(prefix="/vessels", tags=["vessels"])


@router.get("")
async def list_vessels(
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    q = select(Vessel).where(Vessel.is_active == True).order_by(Vessel.name)
    allowed = await allowed_vessel_ids(user, db)
    if allowed is not None:
        q = q.where(Vessel.id.in_(allowed))
    result = await db.execute(q)
    vessels = result.scalars().all()
    return success(data=[VesselResponse.model_validate(v).model_dump() for v in vessels])


@router.post("", dependencies=[Depends(shore_instance_only)])
async def create_vessel(
    body: VesselCreate,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
    current_user: ControlUser = Depends(require_admin),
):
    # Vessels are managed in the workplace; ORB only adds its own config on top.
    known = await control_db.execute(
        text("SELECT 1 FROM vessels WHERE imo = :imo"), {"imo": body.imo_number}
    )
    if known.first() is None:
        raise HTTPException(status_code=400, detail="This IMO number is not a vessel in the workplace")

    result = await db.execute(select(Vessel).where(Vessel.imo_number == body.imo_number))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="IMO number already exists")

    vessel = Vessel(
        id=uuid.uuid4(),
        name=body.name,
        imo_number=body.imo_number,
        call_sign=body.call_sign,
        created_by=current_user.id,
        is_active=True,
    )
    db.add(vessel)
    await db.commit()
    await db.refresh(vessel)
    return success(data=VesselResponse.model_validate(vessel).model_dump(), message="Vessel created")


@router.get("/{vessel_id}")
async def get_vessel(
    vessel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    await assert_vessel_access(user, db, vessel_id)
    result = await db.execute(select(Vessel).where(Vessel.id == vessel_id))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")
    return success(data=VesselResponse.model_validate(vessel).model_dump())


@router.get("/{vessel_id}/daily-log")
async def get_vessel_daily_log(
    vessel_id: uuid.UUID,
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    await assert_vessel_access(user, db, vessel_id)
    result = await db.execute(select(Vessel).where(Vessel.id == vessel_id))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    from app.services.daily_log import build_daily_log_by_date
    log_data = await build_daily_log_by_date(vessel_id, vessel.name, date_from, date_to, db)
    return success(data=log_data)


@router.put("/{vessel_id}", dependencies=[Depends(shore_instance_only)])
async def update_vessel(
    vessel_id: uuid.UUID,
    body: VesselUpdate,
    db: AsyncSession = Depends(get_db),
    _: ControlUser = Depends(require_admin),
):
    result = await db.execute(select(Vessel).where(Vessel.id == vessel_id))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(vessel, field, val)

    await db.commit()
    await db.refresh(vessel)
    return success(data=VesselResponse.model_validate(vessel).model_dump(), message="Vessel updated")


@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    try:
        from sqlalchemy import table, column, String, JSON
        from app.models.sync import SyncState

        vessels_t = table(
            "vessels",
            column("imo", String),
            column("name", String),
            column("module_error_counts", JSON),
            column("last_sync_error", String),
        )
        v_res = await control_db.execute(select(vessels_t))
        vessels = v_res.mappings().all()

        ss_res = await db.execute(
            select(SyncState).where(SyncState.sync_scope == "vessel")
        )
        sync_states = {s.vessel_imo: s for s in ss_res.scalars().all()}

        result = {}
        for v in vessels:
            imo = v["imo"]
            state = sync_states.get(imo)
            active_errors = state.active_errors if (state and state.active_errors) else []
            counts_map = v["module_error_counts"] or {}
            orb_count = counts_map.get("orb", 0)

            result[imo] = {
                "name": v["name"],
                "last_sync_success": (orb_count == 0 and len(active_errors) == 0),
                "failed_items_count": max(orb_count, len(active_errors)),
                "latest_error": active_errors[0] if active_errors else None,
                "vessel_reported_push": state.last_push_at if state else None,
                "vessel_reported_pull": state.last_pull_at if state else None,
            }
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{imo}/sync-log")
async def get_vessel_sync_log(
    imo: str,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    from sqlalchemy import table, column, String, JSON
    from app.models.sync import SyncState
    import json

    vessels_t = table(
        "vessels",
        column("imo", String),
        column("name", String),
        column("module_error_counts", JSON),
        column("last_sync_error", String),
    )
    v_res = await control_db.execute(select(vessels_t).where(vessels_t.c.imo == imo))
    vessel = v_res.mappings().first()
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    ss_res = await db.execute(
        select(SyncState).where(
            SyncState.vessel_imo == imo,
            SyncState.sync_scope == "vessel",
        )
    )
    sync_state = ss_res.scalar_one_or_none()

    active_errors = sync_state.active_errors if (sync_state and sync_state.active_errors) else []
    counts_map = vessel["module_error_counts"] or {}
    orb_count = counts_map.get("orb", 0)

    error_history = []
    if vessel["last_sync_error"]:
        try:
            error_history = json.loads(vessel["last_sync_error"])
        except Exception:
            pass

    return {
        "imo": imo,
        "name": vessel["name"],
        "last_sync_success": (orb_count == 0 and len(active_errors) == 0),
        "vessel_reported_push": sync_state.last_push_at if sync_state else None,
        "vessel_reported_pull": sync_state.last_pull_at if sync_state else None,
        "active_errors": active_errors,
        "failed_items_count": max(orb_count, len(active_errors)),
        "error_history": error_history,
    }
