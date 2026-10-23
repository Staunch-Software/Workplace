"""Resolving an alert, the way DRS closes a defect.

Vessel user  -> request resolution (notes required)        OPEN -> PENDING_APPROVAL
Shore user   -> accept the request                         PENDING_APPROVAL -> RESOLVED
Shore user   -> reject the request (reason optional)       PENDING_APPROVAL -> OPEN
Shore user   -> resolve directly (notes required)          OPEN / PENDING_APPROVAL -> RESOLVED

Every step is written into the alert's conversation as a system line and tells the other side.
"""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.control_database import get_control_db
from app.database import get_db
from app.dependencies import assert_vessel_access, get_current_user, is_shore, require_shore
from app.models.control_user import ControlUser
from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertThread
from app.models.vessel import Vessel
from app.schemas.common import success
from app.schemas.orb_alert import AlertResponse, ResolveRequest
from app.services import orb_notify

router = APIRouter(prefix="/alerts", tags=["alert-resolution"])

MIN_NOTES = 20          # characters, for a request and for a direct resolve
MAX_NOTES = 2000
OPEN, PENDING, RESOLVED = "OPEN", "PENDING_APPROVAL", "RESOLVED"


class RequestResolution(BaseModel):
    notes: str = ""


class AcceptResolution(BaseModel):
    notes: Optional[str] = ""


class RejectResolution(BaseModel):
    reason: Optional[str] = ""


def _notes(value: Optional[str], required: bool, what: str) -> str:
    text = (value or "").strip()
    if required and len(text) < MIN_NOTES:
        raise HTTPException(status_code=400, detail=f"{what} must be at least {MIN_NOTES} characters")
    if len(text) > MAX_NOTES:
        raise HTTPException(status_code=400, detail=f"{what} is longer than {MAX_NOTES} characters")
    return text


async def _load(db: AsyncSession, user: ControlUser, alert_id: uuid.UUID) -> tuple[OrbAlert, Vessel]:
    alert = (await db.execute(select(OrbAlert).where(OrbAlert.id == alert_id))).scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    await assert_vessel_access(user, db, alert.vessel_id)
    vessel = (await db.execute(select(Vessel).where(Vessel.id == alert.vessel_id))).scalar_one()
    return alert, vessel


def _system_line(alert: OrbAlert, actor: ControlUser, body: str) -> OrbAlertThread:
    return OrbAlertThread(
        id=uuid.uuid4(), alert_id=alert.id, vessel_id=alert.vessel_id, author_id=actor.id, author_name=actor.full_name,
        author_role=actor.role, body=body, is_internal=False, is_system=True, tagged_user_ids=[],
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _resolve(alert: OrbAlert, actor: ControlUser, notes: str) -> None:
    alert.status = RESOLVED
    alert.is_resolved = True
    alert.resolved_by = actor.id
    alert.resolved_by_name = actor.full_name
    alert.resolved_at = _now()
    alert.resolution_notes = notes or alert.resolution_notes


@router.post("/{alert_id}/request-resolution")
async def request_resolution(
    alert_id: uuid.UUID, body: RequestResolution,
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(get_current_user),
):
    """Vessel: ask shore to resolve this alert, explaining what was done."""
    alert, vessel = await _load(db, user, alert_id)
    if is_shore(user):
        raise HTTPException(status_code=403, detail="Shore users resolve alerts directly")
    if alert.status == RESOLVED:
        raise HTTPException(status_code=400, detail="This alert is already resolved")
    if alert.status == PENDING:
        raise HTTPException(status_code=409, detail="A resolution request is already waiting for shore approval")
    notes = _notes(body.notes, True, "Resolution notes")

    alert.status = PENDING
    alert.resolution_notes = notes
    alert.resolution_requested_by = user.id
    alert.resolution_requested_by_name = user.full_name
    alert.resolution_requested_at = _now()
    alert.rejection_reason = alert.rejected_by_name = alert.rejected_at = None
    db.add(_system_line(alert, user, f"Resolution requested by {user.full_name}: {notes}"))
    await db.commit()
    await db.refresh(alert)
    await orb_notify.on_resolution_event(db, control_db, kind="REQUESTED", alert=alert, vessel=vessel, actor=user, notes=notes)
    return success(data=AlertResponse.model_validate(alert).model_dump(), message="Resolution requested")


@router.post("/{alert_id}/accept-resolution")
async def accept_resolution(
    alert_id: uuid.UUID, body: AcceptResolution,
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_shore),
):
    """Shore: accept the vessel's request; the alert is resolved."""
    alert, vessel = await _load(db, user, alert_id)
    if alert.status != PENDING:
        raise HTTPException(status_code=409, detail="There is no resolution request waiting for approval")
    note = _notes(body.notes, False, "Note")
    requester = alert.resolution_requested_by
    _resolve(alert, user, "")
    db.add(_system_line(alert, user, f"Resolution accepted by {user.full_name}" + (f": {note}" if note else "")))
    await db.commit()
    await db.refresh(alert)
    await orb_notify.on_resolution_event(db, control_db, kind="ACCEPTED", alert=alert, vessel=vessel, actor=user, notes=note, requester_id=requester)
    return success(data=AlertResponse.model_validate(alert).model_dump(), message="Resolution accepted")


@router.post("/{alert_id}/reject-resolution")
async def reject_resolution(
    alert_id: uuid.UUID, body: RejectResolution,
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_shore),
):
    """Shore: send the alert back to open (a reason is optional but shown to the vessel)."""
    alert, vessel = await _load(db, user, alert_id)
    if alert.status != PENDING:
        raise HTTPException(status_code=409, detail="There is no resolution request waiting for approval")
    reason = _notes(body.reason, False, "Reason")
    requester = alert.resolution_requested_by
    alert.status = OPEN
    alert.rejection_reason = reason or None
    alert.rejected_by_name = user.full_name
    alert.rejected_at = _now()
    alert.resolution_notes = None
    alert.resolution_requested_by = alert.resolution_requested_by_name = alert.resolution_requested_at = None
    db.add(_system_line(alert, user, f"Resolution rejected by {user.full_name}" + (f": {reason}" if reason else "")))
    await db.commit()
    await db.refresh(alert)
    await orb_notify.on_resolution_event(db, control_db, kind="REJECTED", alert=alert, vessel=vessel, actor=user, notes=reason, requester_id=requester)
    return success(data=AlertResponse.model_validate(alert).model_dump(), message="Resolution rejected")


@router.patch("/{alert_id}/resolve")
async def resolve_alert(
    alert_id: uuid.UUID, body: ResolveRequest,
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
    user: ControlUser = Depends(require_shore),
):
    """Shore: resolve directly, with notes, without waiting for a vessel request."""
    alert, vessel = await _load(db, user, alert_id)
    if alert.status == RESOLVED or alert.is_resolved:
        raise HTTPException(status_code=400, detail="Alert already resolved")
    notes = _notes(body.notes, True, "Resolution notes")
    requester = alert.resolution_requested_by      # set when a request was waiting; None otherwise
    _resolve(alert, user, notes)
    db.add(_system_line(alert, user, f"Resolved by {user.full_name}: {notes}"))
    await db.commit()
    await db.refresh(alert)
    await orb_notify.on_resolution_event(db, control_db, kind="RESOLVED", alert=alert, vessel=vessel, actor=user, notes=notes, requester_id=requester)
    return success(data=AlertResponse.model_validate(alert).model_dump(), message="Alert resolved")
