import json
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
import traceback

from app.core.database_control import get_control_db  # ← changed
from app.models.vessel import Vessel
from app.models.user import User
from app.schemas.vessel import VesselCreate, VesselResponse
from app.schemas.defect import VesselUserResponse
from sqlalchemy import func
from app.models.sync import SyncQueue

router = APIRouter()

SYNC_SCOPE = "DEFECT"
# GET ALL VESSELS
@router.get("/", response_model=List[VesselResponse])
async def read_vessels(db: AsyncSession = Depends(get_control_db)):  # ← changed
    try:
        result = await db.execute(select(Vessel).order_by(Vessel.name))
        vessels = result.scalars().all()

        response_data = []
        for v in vessels:
            response_data.append({
                "imo_number": v.imo,
                "name": v.name,
                "vessel_type": v.vessel_type,
                "email": v.vessel_email,  # ← fixed
                "is_active": v.is_active,
                "created_at": v.created_at
            })
        return response_data
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# GET USERS BY VESSEL
@router.get("/{imo_number}/users", response_model=List[VesselUserResponse])
async def get_users_by_vessel(
    imo_number: str,
    db: AsyncSession = Depends(get_control_db)  # ← changed
):
    try:
        stmt = select(User).join(User.vessels).where(Vessel.imo == imo_number)
        result = await db.execute(stmt)
        users = result.scalars().all()
        return users
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# CREATE VESSEL — kept but writes to control DB
@router.post("/", response_model=VesselResponse, status_code=status.HTTP_201_CREATED)
async def create_vessel(
    vessel_in: VesselCreate,
    db: AsyncSession = Depends(get_control_db)  # ← changed
):
    try:
        result = await db.execute(select(Vessel).where(Vessel.imo == vessel_in.imo_number))
        if result.scalars().first():
            raise HTTPException(
                status_code=400,
                detail=f"Vessel with IMO {vessel_in.imo_number} already exists."
            )

        new_vessel = Vessel(
            imo=vessel_in.imo_number,
            name=vessel_in.name,
            vessel_type=vessel_in.vessel_type,
            vessel_email=vessel_in.email,  # ← fixed
        )

        db.add(new_vessel)
        await db.commit()
        await db.refresh(new_vessel)

        return {
            "imo_number": new_vessel.imo,
            "name": new_vessel.name,
            "vessel_type": new_vessel.vessel_type,
            "email": new_vessel.vessel_email,  # ← fixed
            "is_active": new_vessel.is_active,
            "created_at": new_vessel.created_at
        }

    except Exception as e:
        print(f"❌ Error creating vessel: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    
# In your vessels router file (e.g. app/api/v1/vessels.py)

from app.models.sync import SyncState
from app.core.database_control import get_control_db
from app.core.database import get_db

@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    try:
        v_res = await control_db.execute(select(Vessel))
        vessels = v_res.scalars().all()

        ss_res = await db.execute(
            select(SyncState).where(SyncState.sync_scope == SYNC_SCOPE)
        )
        sync_states = {s.vessel_imo: s for s in ss_res.scalars().all()}

        result = {}
        for v in vessels:
            state = sync_states.get(v.imo)
            active_errors = state.active_errors if (state and state.active_errors) else []
            
            # Use the "drs" key specifically
            counts_map = v.module_error_counts or {}
            drs_count = counts_map.get("drs", 0)

            result[v.imo] = {
                "name": v.name,
                "last_sync_success": (drs_count == 0 and len(active_errors) == 0),
                "failed_items_count": drs_count,
                "latest_error": active_errors[0] if active_errors else None,
                "vessel_reported_push": state.last_push_at if state else None,
                "vessel_reported_pull": state.last_pull_at if state else None,
            }
            
        return result # Indented correctly outside the loop
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
            SyncState.sync_scope == SYNC_SCOPE
        )
    )
    sync_state = ss_res.scalar_one_or_none()

    # 3. Handle Active Errors
    active_errors = sync_state.active_errors if sync_state else []
    
    # --- FIX: GET COUNT FROM CENTRAL MAP, NOT SYNC_QUEUE ---
    counts_map = vessel.module_error_counts or {}
    drs_count = counts_map.get("drs", 0)

    return {
        "imo": imo,
        "name": vessel.name,
        "last_sync_success": vessel.last_sync_success,
        
        # Live Timestamps
        "vessel_reported_push": sync_state.last_push_at if sync_state else None, 
        "vessel_reported_pull": sync_state.last_pull_at if sync_state else None,
        
        "active_errors": active_errors, 
        
        # USE THE SHARED COUNT
        "failed_items_count": drs_count, 
        
        "error_history": json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
    }