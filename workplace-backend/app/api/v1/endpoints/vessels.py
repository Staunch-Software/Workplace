from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.api.deps import get_control_db, get_current_admin, get_current_user
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.schemas.vessel import VesselCreate, VesselUpdate, VesselOut
from datetime import datetime

router = APIRouter()


@router.get("/vessels", response_model=list[VesselOut])
async def list_vessels(
    db: AsyncSession = Depends(get_control_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Vessel).options(selectinload(Vessel.users))
    )
    vessels = result.scalars().all()
    return [
        VesselOut(
            imo=v.imo,
            name=v.name,
            vessel_type=v.vessel_type,
            vessel_email=v.vessel_email,
            is_active=v.is_active,
            assigned_users=[{"id": u.id, "full_name": u.full_name, "email": u.email} for u in v.users],
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
        raise HTTPException(status_code=400, detail="Vessel with this IMO already exists")

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
        assigned_users=[],
    )


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
    await db.commit()
    await db.refresh(vessel)
    return VesselOut(
        imo=vessel.imo,
        name=vessel.name,
        vessel_type=vessel.vessel_type,
        vessel_email=vessel.vessel_email,
        is_active=vessel.is_active,
        assigned_users=[{"id": u.id, "full_name": u.full_name, "email": u.email} for u in vessel.users],
    )