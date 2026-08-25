from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database_control import get_control_db
from app.models.control.vessel import Vessel
from app.schemas.task_schemas import VesselOut
from app.utils.deps import require_admin

router = APIRouter(prefix="/vessels", tags=["Vessels"])


@router.get("", response_model=list[VesselOut])
async def list_vessels(
    control_db: AsyncSession = Depends(get_control_db),
    _admin: dict = Depends(require_admin),
):
    res = await control_db.execute(select(Vessel).where(Vessel.is_active == True).order_by(Vessel.name))
    return res.scalars().all()
