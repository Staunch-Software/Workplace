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

router = APIRouter()


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

# ⚠️ MUST be before /{imo}/sync-log to avoid "all" being caught as {imo}
@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    vessels_res = await control_db.execute(select(Vessel))
    vessels = vessels_res.scalars().all()

    result = {}
    for vessel in vessels:
        try:
            error_history = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
            if not isinstance(error_history, list):
                error_history = []
        except Exception:
            error_history = []

        failed_items_count = sum(
            1 for e in error_history if e.get("type") == "vessel_error"
        )

        result[vessel.imo] = {
            "last_sync_success":  vessel.last_sync_success,
            "failed_items_count": failed_items_count,
            "latest_error": error_history[0] if error_history else None,
        }

    return result

@router.get("/{imo}/sync-log")
async def get_vessel_sync_log(
    imo: str,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = res.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    try:
        error_history = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
        if not isinstance(error_history, list):
            error_history = []
    except Exception:
        error_history = []

    # Fetch SyncState rows
    sync_states_res = await db.execute(
        select(SyncState).where(SyncState.vessel_imo == imo)
    )
    sync_states = {row.sync_scope: row for row in sync_states_res.scalars().all()}

    defect_scope = sync_states.get("DEFECT")

    failed_items_count = sum(
        1 for e in error_history if e.get("type") == "vessel_error"
    )

    return {
        "imo": imo,
        # Flat fields matching VesselSyncDetail exactly
        "vessel_reported_push": defect_scope.last_pull_at if defect_scope else None,  # vessel → shore
        "vessel_reported_pull": defect_scope.last_push_at if defect_scope else None,  # shore → vessel
        # Status fields
        "last_sync_success":  vessel.last_sync_success,
        "failed_items_count": failed_items_count,
        "last_sync_error":    vessel.last_sync_error,  # raw JSON string — frontend parses it
        # Vessel-level timestamps (for reference)
        "last_pull_at": vessel.last_pull_at,
        "last_push_at": vessel.last_push_at,
    }