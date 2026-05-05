import json
import traceback
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.database import get_db
from app.core.database_control import get_control_db
from app.models.control.vessel import Vessel
from app.models.sync import SyncState

router = APIRouter()


@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Returns luboil sync health summary for all vessels."""
    try:
        v_res = await control_db.execute(select(Vessel))
        vessels = v_res.scalars().all()

        ss_res = await db.execute(
            select(SyncState).where(SyncState.sync_scope == "LUBOIL")
        )
        sync_states = {s.vessel_imo: s for s in ss_res.scalars().all()}

        result = {}
        for v in vessels:
            state = sync_states.get(v.imo)
            active_errors = state.active_errors if (state and state.active_errors) else []
            result[v.imo] = {
                "name": v.name,
                "last_sync_success": len(active_errors) == 0,
                "failed_items_count": len(active_errors),
                "latest_error": active_errors[0] if active_errors else None,
            }
        return result
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{imo}/sync-log")
async def get_vessel_sync_log(
    imo: str,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Returns luboil sync details for a specific vessel."""
    v_res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = v_res.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    ss_res = await db.execute(
        select(SyncState).where(
            SyncState.vessel_imo == imo,
            SyncState.sync_scope == "LUBOIL"
        )
    )
    sync_state = ss_res.scalar_one_or_none()

    active_errors = sync_state.active_errors if (sync_state and sync_state.active_errors) else []

    return {
        "imo": imo,
        "name": vessel.name,
        "last_sync_success": vessel.last_sync_success,
        "vessel_reported_push": sync_state.last_push_at if sync_state else None,
        "vessel_reported_pull": sync_state.last_pull_at if sync_state else None,
        "active_errors": active_errors,
        "failed_items_count": len(active_errors),
        "error_history": json.loads(vessel.last_sync_error) if vessel.last_sync_error else [],
    }