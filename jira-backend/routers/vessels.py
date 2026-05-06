import json
import traceback
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from db.database import get_control_db
from models.control import Vessel
from core.deps import get_current_user

router = APIRouter(prefix="/api/vessels", tags=["vessels"])

def fmt(v: Vessel) -> dict:
    return {
        "id": v.imo,
        "name": v.name,
        "imo": v.imo,
        "vessel_type": v.vessel_type,
        "isActive": v.is_active,
    }

@router.get("")
async def get_vessels(
    user=Depends(get_current_user),
    control_db: AsyncSession = Depends(get_control_db),
):
    if user.role in ("SHORE", "ADMIN"):
        result = await control_db.execute(
            select(Vessel).where(Vessel.is_active == True)
        )
        vessels = result.scalars().all()
    else:
        # VESSEL role — only assigned vessels
        vessels = [v for v in user.vessels if v.is_active]

    return [fmt(v) for v in vessels]

from models.sync import SyncState
from db.database import get_control_db
from db.database import get_db

@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    try:
        v_res = await control_db.execute(select(Vessel))
        vessels = v_res.scalars().all()

        # --- FIX: Change "DEFECT" to "TICKET" ---
        ss_res = await db.execute(
            select(SyncState).where(SyncState.sync_scope == "TICKET")
        )
        sync_states = {s.vessel_imo: s for s in ss_res.scalars().all()}

        result = {}
        for v in vessels:
            state = sync_states.get(v.imo)
            active_errors = state.active_errors if state else []
            
            # Use the Jira count from the central map
            counts_map = v.module_error_counts or {}
            jira_count = counts_map.get("jira", 0)

            result[v.imo] = {
                "name": v.name,
                "last_sync_success": (jira_count == 0 and len(active_errors) == 0),
                "failed_items_count": jira_count,
                "latest_error": active_errors[0] if active_errors else None
            }
        return result
    
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))
    
    
@router.get("/{imo}/sync-log")
async def get_vessel_sync_log(
    imo: str,
    db: AsyncSession = Depends(get_db),              # Module DB
    control_db: AsyncSession = Depends(get_control_db), # Control DB
):
    # 1. Fetch High-level info from Control DB
    v_res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = v_res.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    # 2. Fetch Module-Specific Sync State from Module DB (DRS Scope)
    ss_res = await db.execute(
        select(SyncState).where(
            SyncState.vessel_imo == imo, 
            SyncState.sync_scope == "TICKET"
        )
    )
    sync_state = ss_res.scalar_one_or_none()

    # 3. Handle Active Errors (The logic for disappearing errors)
    # If sync_state exists, use its active_errors list. Otherwise, empty list.
    active_errors = sync_state.active_errors if sync_state else []
    counts_map = vessel.module_error_counts or {}
    jira_count = counts_map.get("jira", 0)
    return {
        "imo": imo,
        "name": vessel.name,
        "last_sync_success": vessel.last_sync_success,
        
        # Live Timestamps from the Module Table
        "vessel_reported_push": sync_state.last_push_at if sync_state else None, 
        "vessel_reported_pull": sync_state.last_pull_at if sync_state else None,
        
        # THE LIVE ERROR LIST: Fixed errors won't be in this list
        "active_errors": active_errors,
        "failed_items_count": jira_count, # <--- FIXED
        "error_history": json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
        
    }