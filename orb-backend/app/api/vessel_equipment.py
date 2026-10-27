"""Equipment register of a vessel: bilge pumps, OWS and the 15 ppm monitor.

The rated capacity of a pump is what alert 7 (pump capacity exceeded) compares against. There is no
default rate: a pump tank without a rate is simply not checked, and the response lists those tanks.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin, assert_vessel_access
from app.models.control_user import ControlUser
from app.models.orb_config import Equipment
from app.models.sync import SyncTombstone
from datetime import datetime, timezone
from app.models.vessel_tank import VesselTank
from app.schemas.common import success
from app.services.calculations import _get_effective_group

router = APIRouter(prefix="/vessels", tags=["vessel_equipment"])

TYPES = ("BILGE_PUMP", "OWS", "OCM")


class EquipmentIn(BaseModel):
    equipment_type: str
    name: str = Field(min_length=1, max_length=200)
    make_model: Optional[str] = Field(None, max_length=200)
    serial_no: Optional[str] = Field(None, max_length=100)
    rated_capacity_m3_hr: Optional[float] = Field(None, gt=0)
    linked_tank_id: Optional[uuid.UUID] = None
    is_active: bool = True


class EquipmentPatch(BaseModel):
    equipment_type: Optional[str] = None
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    make_model: Optional[str] = Field(None, max_length=200)
    serial_no: Optional[str] = Field(None, max_length=100)
    rated_capacity_m3_hr: Optional[float] = Field(None, gt=0)
    linked_tank_id: Optional[uuid.UUID] = None
    is_active: Optional[bool] = None


def _dict(e: Equipment) -> dict:
    return {
        "id": e.id, "vessel_id": e.vessel_id, "equipment_type": e.equipment_type, "name": e.name,
        "make_model": e.make_model, "serial_no": e.serial_no, "rated_capacity_m3_hr": e.rated_capacity_m3_hr,
        "linked_tank_id": e.linked_tank_id, "is_active": e.is_active,
    }


def _check_type(value: str) -> None:
    if value not in TYPES:
        raise HTTPException(status_code=422, detail=f"equipment_type must be one of {', '.join(TYPES)}")


async def _check_rules(db: AsyncSession, vessel_id: uuid.UUID, etype: str, rated, tank_id) -> None:
    if etype in ("BILGE_PUMP", "OWS") and rated is None:
        raise HTTPException(status_code=422, detail="A pump or OWS needs its rated capacity (m3/hr); there is no default")
    if tank_id is not None:
        tank = await db.get(VesselTank, tank_id)
        if tank is None or tank.vessel_id != vessel_id:
            raise HTTPException(status_code=422, detail="The linked tank does not belong to this vessel")


@router.get("/{vessel_id}/equipment")
async def list_equipment(
    vessel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    await assert_vessel_access(user, db, vessel_id)
    items = (await db.execute(
        select(Equipment).where(Equipment.vessel_id == vessel_id).order_by(Equipment.equipment_type, Equipment.name)
    )).scalars().all()
    tanks = (await db.execute(
        select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active.is_(True))
    )).scalars().all()
    rated = {e.linked_tank_id for e in items if e.is_active and e.rated_capacity_m3_hr and e.linked_tank_id}
    return success(data={
        "items": [_dict(e) for e in items],
        # bilge tanks that no pump with a rated capacity is linked to: alert 7 cannot check them yet
        "tanks_missing_pump_rate": [
            {"id": t.id, "tank_name": t.tank_name} for t in tanks if _get_effective_group(t) == "BILGE" and t.id not in rated
        ],
    })


@router.post("/{vessel_id}/equipment")
async def add_equipment(
    vessel_id: uuid.UUID,
    body: EquipmentIn,
    db: AsyncSession = Depends(get_db),
    _: ControlUser = Depends(require_admin),
):
    _check_type(body.equipment_type)
    await _check_rules(db, vessel_id, body.equipment_type, body.rated_capacity_m3_hr, body.linked_tank_id)
    item = Equipment(vessel_id=vessel_id, **body.model_dump())
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return success(data=_dict(item), message="Equipment added")


@router.patch("/{vessel_id}/equipment/{equipment_id}")
async def update_equipment(
    vessel_id: uuid.UUID,
    equipment_id: uuid.UUID,
    body: EquipmentPatch,
    db: AsyncSession = Depends(get_db),
    _: ControlUser = Depends(require_admin),
):
    item = await db.get(Equipment, equipment_id)
    if item is None or item.vessel_id != vessel_id:
        raise HTTPException(status_code=404, detail="Equipment not found")
    changes = body.model_dump(exclude_unset=True)
    if "equipment_type" in changes:
        _check_type(changes["equipment_type"])
    etype = changes.get("equipment_type", item.equipment_type)
    await _check_rules(db, vessel_id, etype, changes.get("rated_capacity_m3_hr", item.rated_capacity_m3_hr),
                       changes.get("linked_tank_id", item.linked_tank_id))
    for field, val in changes.items():
        setattr(item, field, val)
    await db.commit()
    await db.refresh(item)
    return success(data=_dict(item), message="Equipment updated")


@router.delete("/{vessel_id}/equipment/{equipment_id}")
async def delete_equipment(
    vessel_id: uuid.UUID,
    equipment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: ControlUser = Depends(require_admin),
):
    item = await db.get(Equipment, equipment_id)
    if item is None or item.vessel_id != vessel_id:
        raise HTTPException(status_code=404, detail="Equipment not found")
    await db.delete(item)
    db.add(SyncTombstone(vessel_id=vessel_id, entity_type="equipment", entity_id=equipment_id, deleted_at=datetime.now(timezone.utc)))
    await db.commit()
    return success(message="Equipment removed")
