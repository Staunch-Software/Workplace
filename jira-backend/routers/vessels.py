from fastapi import APIRouter, Depends
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