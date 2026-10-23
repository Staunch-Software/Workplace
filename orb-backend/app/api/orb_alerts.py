import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.database import get_db
from app.models.orb_alert import OrbAlert
from app.models.orb_entry import OrbEntry
from app.models.orb_upload import OrbUpload
from app.models.control_user import ControlUser
from app.schemas.orb_alert import AlertResponse
from app.schemas.common import success
from app.dependencies import get_current_user, require_shore, allowed_vessel_ids, scope_vessel_ids, assert_vessel_access, shore_instance_only
from app.models.orb_alert_thread import OrbAlertThread
from app.services.alert_chat import thread_stats
from app.services.calculations import run_all_checks

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/summary")
async def alert_summary(
    vessel_id: Optional[List[uuid.UUID]] = Query(None),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    q = select(OrbAlert).where(OrbAlert.is_resolved == False)
    scoped = scope_vessel_ids(vessel_id, await allowed_vessel_ids(user, db))
    if scoped is not None:
        q = q.where(OrbAlert.vessel_id.in_(scoped))
    result = await db.execute(q)
    alerts = result.scalars().all()

    by_type = {}
    counts = {"critical": 0, "major": 0, "minor": 0, "observation": 0}
    pending = 0
    for a in alerts:
        pending += a.status == "PENDING_APPROVAL"
        counts[a.severity] = counts.get(a.severity, 0) + 1
        by_type[a.alert_type] = by_type.get(a.alert_type, 0) + 1

    return success(data={
        "total": len(alerts),
        **counts,
        "pending_approval": pending,        # open alerts a vessel has asked shore to resolve
        "by_type": by_type,
    })


@router.get("")
async def list_alerts(
    vessel_id: Optional[List[uuid.UUID]] = Query(None),
    severity: Optional[str] = None,
    is_resolved: Optional[bool] = None,
    alert_type: Optional[str] = None,
    status: Optional[str] = Query(None, pattern="^(OPEN|PENDING_APPROVAL|RESOLVED)$"),
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    q = (
        select(OrbAlert, OrbEntry.page_number, OrbEntry.upload_id)
        .outerjoin(OrbEntry, OrbAlert.entry_id == OrbEntry.id)
        .order_by(OrbAlert.created_at.desc())
    )
    scoped = scope_vessel_ids(vessel_id, await allowed_vessel_ids(user, db))
    if scoped is not None:
        q = q.where(OrbAlert.vessel_id.in_(scoped))
    if severity:
        q = q.where(OrbAlert.severity == severity)
    if is_resolved is not None:
        q = q.where(OrbAlert.is_resolved == is_resolved)
    if alert_type:
        q = q.where(OrbAlert.alert_type == alert_type)
    if status:
        q = q.where(OrbAlert.status == status)

    result = await db.execute(q)
    rows = result.all()
    stats = await thread_stats(db, user, [a.id for a, _, _ in rows])
    data = []
    for alert, page_number, upload_id in rows:
        d = AlertResponse.model_validate(alert).model_dump()
        d["page_number"] = page_number
        d["upload_id"] = upload_id
        d["thread_count"], d["unread_count"] = stats.get(alert.id, (0, 0))
        data.append(d)
    return success(data=data)


@router.get("/{alert_id}")
async def get_alert(
    alert_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: ControlUser = Depends(get_current_user),
):
    result = await db.execute(
        select(OrbAlert, OrbEntry.page_number, OrbEntry.upload_id)
        .outerjoin(OrbEntry, OrbAlert.entry_id == OrbEntry.id)
        .where(OrbAlert.id == alert_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert, page_number, upload_id = row
    await assert_vessel_access(user, db, alert.vessel_id)
    stats = await thread_stats(db, user, [alert.id])
    d = AlertResponse.model_validate(alert).model_dump()
    d["page_number"] = page_number
    d["upload_id"] = upload_id
    d["thread_count"], d["unread_count"] = stats.get(alert.id, (0, 0))
    return success(data=d)


@router.post("/recalculate", dependencies=[Depends(shore_instance_only)])
async def recalculate_alerts(
    vessel_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: ControlUser = Depends(require_shore),
):
    """Delete the unresolved alerts of a vessel that have no chat and rerun all compliance checks.

    An alert with messages is kept (the checks do not create a second copy of it), so a recalculation
    never throws away a conversation."""
    await assert_vessel_access(current_user, db, vessel_id)
    # 1. Delete all unresolved alerts for the vessel (a database trigger leaves a delete marker for each, so vessels drop them too)
    deleted = await db.execute(
        delete(OrbAlert).where(
            OrbAlert.vessel_id == vessel_id,
            OrbAlert.is_resolved == False,
            OrbAlert.id.not_in(select(OrbAlertThread.alert_id)),
        )
    )
    await db.flush()

    # 2. Re-run checks for every completed upload belonging to this vessel
    uploads_result = await db.execute(
        select(OrbUpload).where(
            OrbUpload.vessel_id == vessel_id,
            OrbUpload.status == "completed",
        )
    )
    uploads = uploads_result.scalars().all()

    for upload in uploads:
        await run_all_checks(vessel_id, upload.id, db)

    return success(message=f"Recalculated alerts for vessel. Cleared {deleted.rowcount} stale alerts, processed {len(uploads)} upload(s).")
