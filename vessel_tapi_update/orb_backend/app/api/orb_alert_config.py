"""Alert and threshold configuration. Everyone with ORB access can read it; only an administrator changes it.

Changing a threshold needs no code release: the next run of the checks (extraction, re-process,
recalculate) reads the new value. Every change is written to the history with who made it.
"""
import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_current_user, require_admin, assert_vessel_access
from app.models.control_user import ControlUser
from app.models.orb_config import AlertConfig, ThresholdParam, ThresholdHistory
from app.models.vessel import Vessel
from app.schemas.common import success

router = APIRouter(prefix="/alert-config", tags=["alert-config"])

SEVERITIES = ("critical", "major", "minor", "observation")
COMPARATORS = (">", ">=", "<", "<=", "=", "+/-")


def _name(user: ControlUser) -> str:
    return getattr(user, "full_name", None) or getattr(user, "email", None) or str(user.id)


def _alert_dict(a: AlertConfig) -> dict:
    return {
        "alert_code": a.alert_code, "alert_no": a.alert_no, "name": a.name, "category": a.category,
        "severity": a.severity, "scope": a.scope, "enabled": a.enabled, "in_alerts_filter": a.in_alerts_filter,
        "built": a.built, "updated_by_name": a.updated_by_name, "updated_at": a.updated_at,
    }


def _param_dict(p: ThresholdParam) -> dict:
    return {
        "param_code": p.param_code, "alert_code": p.alert_code, "label": p.label, "comparator": p.comparator,
        "value": p.value, "unit": p.unit, "vessel_id": p.vessel_id, "effective_from": p.effective_from,
        "approved_by_name": p.approved_by_name, "note": p.note, "updated_at": p.updated_at,
    }


@router.get("/types")
async def alert_types(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    """The alert types offered in the Alerts filter: enabled and marked for the filter."""
    rows = (await db.execute(
        select(AlertConfig).where(AlertConfig.enabled.is_(True), AlertConfig.in_alerts_filter.is_(True)).order_by(AlertConfig.alert_no)
    )).scalars().all()
    return success(data=[{"alert_code": a.alert_code, "alert_no": a.alert_no, "name": a.name} for a in rows])


@router.get("")
async def list_config(db: AsyncSession = Depends(get_db), user: ControlUser = Depends(get_current_user)):
    rows = (await db.execute(select(AlertConfig).order_by(AlertConfig.alert_no))).scalars().all()
    return success(data=[_alert_dict(a) for a in rows])


class AlertConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    in_alerts_filter: Optional[bool] = None
    severity: Optional[str] = None


@router.patch("/{alert_code}")
async def update_alert(
    alert_code: str,
    body: AlertConfigPatch,
    db: AsyncSession = Depends(get_db),
    admin: ControlUser = Depends(require_admin),
):
    row = await db.get(AlertConfig, alert_code)
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown alert")
    if body.severity is not None:
        if body.severity not in SEVERITIES:
            raise HTTPException(status_code=422, detail=f"severity must be one of {', '.join(SEVERITIES)}")
        row.severity = body.severity
    if body.enabled is not None:
        row.enabled = body.enabled
    if body.in_alerts_filter is not None:
        row.in_alerts_filter = body.in_alerts_filter
    row.updated_by, row.updated_by_name = admin.id, _name(admin)
    await db.commit()
    await db.refresh(row)          # updated_at is set by the database
    return success(data=_alert_dict(row))


@router.get("/params")
async def list_params(
    vessel_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    """Default thresholds, each with the vessel's override and the value that applies to it."""
    if vessel_id:
        await assert_vessel_access(user, db, vessel_id)
    rows = (await db.execute(
        select(ThresholdParam).where((ThresholdParam.vessel_id.is_(None)) | (ThresholdParam.vessel_id == vessel_id))
        .order_by(ThresholdParam.alert_code, ThresholdParam.param_code)
    )).scalars().all()
    defaults = {r.param_code: r for r in rows if r.vessel_id is None}
    overrides = {r.param_code: r for r in rows if r.vessel_id is not None}
    data = []
    for code, d in defaults.items():
        o = overrides.get(code)
        item = _param_dict(d)
        item["override"] = _param_dict(o) if o else None
        item["effective_value"] = o.value if o else d.value
        data.append(item)
    return success(data=data)


class ParamUpdate(BaseModel):
    value: float
    comparator: Optional[str] = None
    vessel_id: Optional[uuid.UUID] = None         # set: the value is that vessel's override
    note: Optional[str] = Field(None, max_length=1000)


@router.put("/params/{param_code}")
async def set_param(
    param_code: str,
    body: ParamUpdate,
    db: AsyncSession = Depends(get_db),
    admin: ControlUser = Depends(require_admin),
):
    if body.comparator is not None and body.comparator not in COMPARATORS:
        raise HTTPException(status_code=422, detail=f"comparator must be one of {', '.join(COMPARATORS)}")
    default = (await db.execute(
        select(ThresholdParam).where(ThresholdParam.param_code == param_code, ThresholdParam.vessel_id.is_(None))
    )).scalar_one_or_none()
    if default is None:
        raise HTTPException(status_code=404, detail="Unknown threshold")

    if body.vessel_id:
        if await db.get(Vessel, body.vessel_id) is None:
            raise HTTPException(status_code=404, detail="Vessel not found")
        row = (await db.execute(
            select(ThresholdParam).where(ThresholdParam.param_code == param_code, ThresholdParam.vessel_id == body.vessel_id)
        )).scalar_one_or_none()
        if row is None:
            row = ThresholdParam(
                param_code=param_code, alert_code=default.alert_code, label=default.label,
                comparator=default.comparator, value=body.value, unit=default.unit, vessel_id=body.vessel_id,
            )
            db.add(row)
            old = None
        else:
            old = row.value
    else:
        row, old = default, default.value

    db.add(ThresholdHistory(
        param_code=param_code, vessel_id=body.vessel_id, old_value=old, new_value=body.value,
        changed_by=admin.id, changed_by_name=_name(admin), note=body.note,
    ))
    row.value = body.value
    if body.comparator is not None:
        row.comparator = body.comparator
    row.effective_from = date.today()
    row.approved_by, row.approved_by_name, row.note = admin.id, _name(admin), body.note
    await db.commit()
    await db.refresh(row)
    return success(data=_param_dict(row))


@router.delete("/params/{param_code}")
async def remove_override(
    param_code: str,
    vessel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: ControlUser = Depends(require_admin),
):
    """Drop a vessel's override: the vessel follows the default value again."""
    row = (await db.execute(
        select(ThresholdParam).where(ThresholdParam.param_code == param_code, ThresholdParam.vessel_id == vessel_id)
    )).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="No override for this vessel")
    db.add(ThresholdHistory(
        param_code=param_code, vessel_id=vessel_id, old_value=row.value, new_value=None,
        changed_by=admin.id, changed_by_name=_name(admin), note="override removed",
    ))
    await db.delete(row)
    await db.commit()
    return success(message="Override removed")


@router.get("/params/{param_code}/history")
async def param_history(
    param_code: str,
    vessel_id: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    if vessel_id:
        await assert_vessel_access(user, db, vessel_id)
    q = select(ThresholdHistory).where(ThresholdHistory.param_code == param_code)
    q = q.where(ThresholdHistory.vessel_id == vessel_id) if vessel_id else q.where(ThresholdHistory.vessel_id.is_(None))
    rows = (await db.execute(q.order_by(ThresholdHistory.changed_at.desc()).limit(100))).scalars().all()
    return success(data=[{
        "old_value": h.old_value, "new_value": h.new_value, "changed_by_name": h.changed_by_name,
        "note": h.note, "changed_at": h.changed_at,
    } for h in rows])
