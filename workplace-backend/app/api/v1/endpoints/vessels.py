import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.api.deps import get_control_db, get_current_admin, get_current_user
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.schemas.vessel import VesselCreate, VesselUpdate, VesselOut
import re
from datetime import datetime, timezone, timedelta

router = APIRouter()


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


@router.get("/vessels/status")
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

    # --- UPDATED HELPER FOR JSON HISTORY ---
    def parse_errors(last_sync_error_json: str) -> list:
        if not last_sync_error_json:
            return []
        try:
            # Parse the stored JSON list
            history = json.loads(last_sync_error_json)
            # Map to the format the React UI expects
            return [
                {
                    "id": e["id"],
                    "error_type": e["type"],
                    "error_msg": e["msg"],
                    "created_at": e["ts"],
                }
                for e in history
            ]
        except:
            # Fallback for old string-based data if any remains
            return [
                {
                    "id": 0,
                    "error_type": "vessel_error",
                    "error_msg": last_sync_error_json,
                    "created_at": None,
                }
            ]

    # Change this in your GET /vessel-status


    return [
        {
            "imo": vessel.imo,
            "name": vessel.name,
            "online": (
                (now - vessel.last_pull_at.replace(tzinfo=timezone.utc)) < ONLINE_THRESHOLD
                if vessel.last_pull_at
                else False
            ),
            # SHORE PERSPECTIVE:
            # last_pull_at = When Shore last received data FROM the ship
            "last_pull_at": (
                vessel.last_pull_at.isoformat() if vessel.last_pull_at else None
            ),
            # last_push_at = When Shore last sent data TO the ship
            "last_push_at": (
                vessel.last_push_at.isoformat() if vessel.last_push_at else None
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


@router.patch("/vessels/{imo}/module-status")
async def update_module_status(
    imo: str,
    payload: dict,  # e.g. {"drs": true, "voyage": false}
    db: AsyncSession = Depends(get_control_db),
    admin: User = Depends(get_current_admin),
):
    result = await db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = result.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail="Vessel not found")

    # Merge with existing — don't wipe keys not in payload
    existing = vessel.module_status or {}
    vessel.module_status = {**existing, **payload}
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
