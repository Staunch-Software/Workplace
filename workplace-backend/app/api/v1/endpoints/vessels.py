import json
from typing import Dict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.api.deps import get_control_db, get_current_admin, get_current_user
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.schemas.vessel import ModuleStatusUpdate, VesselCreate, VesselStatusOut, VesselUpdate, VesselOut
import re
from datetime import datetime, timezone, timedelta

router = APIRouter()


@router.get("/vessels/status",response_model=list[VesselStatusOut])
async def get_vessel_status(
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    # 1. Fetch user with assigned vessels
    result = await db.execute(
        select(User)
        .where(User.id == current_user.id)
        .options(selectinload(User.vessels))
    )
    user = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)

    ONLINE_THRESHOLD = timedelta(minutes=10)
    allowed_keys = [k for k, v in (current_user.permissions or {}).items() if v]

    def to_utc(dt):
        """Safely make any datetime UTC-aware."""
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)  # naive → assume UTC
        return dt.astimezone(timezone.utc)  # aware → convert to UTC

    # --- UPDATED HELPER FOR JSON HISTORY ---
    def parse_errors(last_sync_error_json: str) -> list:
        if not last_sync_error_json:
            return []
        
        try:
            history = json.loads(last_sync_error_json)
        except (json.JSONDecodeError, TypeError):
            # Not valid JSON at all — treat as no errors, not as an error
            return []

        # Must be a non-empty list to count as errors
        if not isinstance(history, list) or len(history) == 0:
            return []

        result = []
        for e in history:
            # Each item must be a dict with expected keys — skip malformed entries
            if not isinstance(e, dict):
                continue
            result.append({
                "id":         e.get("id", 0),
                "error_type": e.get("type", "vessel_error"),
                "error_msg":  e.get("msg", "Unknown error"),
                "created_at": e.get("ts"),
            })
        
        return result
    # Change this in your GET /vessel-status

    return [
        {
            "imo": vessel.imo,
            "name": vessel.name,
            "online": (
                (now - to_utc(vessel.last_push_at)) < ONLINE_THRESHOLD
                if vessel.last_push_at
                else False
            ),
            "last_pull_at": (
                to_utc(vessel.last_pull_at).isoformat() if vessel.last_pull_at else None
            ),
            "last_push_at": (
                to_utc(vessel.last_push_at).isoformat() if vessel.last_push_at else None
            ),
            "last_sync_success": vessel.last_sync_success,
            "failed_items_count": (vessel.vessel_telemetry or {}).get(
                "failed_items_count", 0
            ),
            "sync_errors": parse_errors(vessel.last_sync_error),
            "modules": [
                {"key": k, "available": (vessel.module_status or {}).get(k, False)}
                for k in allowed_keys
            ],
        }
        for vessel in user.vessels
    ]


@router.get("/vessels", response_model=list[VesselOut])
async def list_vessels(
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Vessel).options(selectinload(Vessel.users)))
    vessels = result.scalars().all()
    return [
        VesselOut(
            imo=v.imo,
            name=v.name,
            vessel_type=v.vessel_type,
            vessel_email=v.vessel_email,
            is_active=v.is_active,
            module_status=v.module_status,
            last_push_at=v.last_push_at,  # ← add
            last_pull_at=v.last_pull_at,
            assigned_users=[
                {"id": u.id, "full_name": u.full_name, "email": u.email, "role": u.role}
                for u in v.users
            ],
        )
        for v in vessels
    ]


@router.post("/vessels", response_model=VesselOut)
async def create_vessel(
    payload: VesselCreate,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Vessel).where(Vessel.imo == payload.imo))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=400, detail="Vessel with this IMO already exists"
        )

    vessel = Vessel(
        imo=payload.imo,
        name=payload.name,
        vessel_type=payload.vessel_type,
        vessel_email=payload.vessel_email,
        created_by=admin.id,
        updated_at=datetime.utcnow(),
    )
    db.add(vessel)
    await db.commit()
    await db.refresh(vessel)
    return VesselOut(
        imo=vessel.imo,
        name=vessel.name,
        vessel_type=vessel.vessel_type,
        vessel_email=vessel.vessel_email,
        is_active=vessel.is_active,
        module_status=vessel.module_status,
        last_push_at=None,  # ← add (new vessel, always None)
        last_pull_at=None,  # ← add
        assigned_users=[],
    )


@router.patch("/vessels/{imo}/module-status",response_model=Dict[str, bool])
async def update_module_status(
    imo: str,
    payload: ModuleStatusUpdate,  # e.g. {"drs": true, "voyage": false}
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    # Merge with existing — don't wipe keys not in payload
    existing = vessel.module_status or {}
    vessel.module_status = {**existing, **payload.model_dump(exclude_none=True)}
    vessel.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(vessel)
    return vessel.module_status


@router.patch("/vessels/{imo}", response_model=VesselOut)
async def update_vessel(
    imo: str,
    payload: VesselUpdate,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(
        select(Vessel).where(Vessel.imo == imo).options(selectinload(Vessel.users))
    )
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(vessel, field, value)

    vessel.updated_at = datetime.utcnow()
    # ✅ What it needs to be
    await db.commit()

    # Re-query with users eagerly loaded
    result = await db.execute(
        select(Vessel).where(Vessel.imo == imo).options(selectinload(Vessel.users))
    )
    vessel = result.scalar_one()

    return VesselOut(
        imo=vessel.imo,
        name=vessel.name,
        vessel_type=vessel.vessel_type,
        vessel_email=vessel.vessel_email,
        is_active=vessel.is_active,
        module_status=vessel.module_status,
        last_push_at=vessel.last_push_at,  # ← add
        last_pull_at=vessel.last_pull_at,
        assigned_users=[
            {"id": u.id, "full_name": u.full_name, "role": u.role, "email": u.email}
            for u in vessel.users
        ],
    )


@router.delete("/vessels/{imo}")
async def delete_vessel(
    imo: str,
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")
    await db.delete(vessel)
    await db.commit()
    return {"message": "Vessel deleted successfully"}
