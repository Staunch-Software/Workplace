# app/api/v1/endpoints/sync.py
# Shore-side receiver for vessel Report Tracker sync.
# Mirrors DRS sync.py: heartbeat, push endpoints, get_changes with notifications.
import json
import traceback
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.database import get_db
from app.core.database_control import get_control_db
from app.core.config import settings
from app.schemas.sync import SyncPayload
from app.services.sync_service import SyncService
from app.models.report import (
    Report, ReportThread, ReportThreadAttachment, ReportAttachment,
    ReportConfig, ReportEvent,
)
from app.models.notification import Notification
from app.models.sync import SyncState

router = APIRouter(prefix="/sync", tags=["Sync"])

SYNC_SCOPE = "REPORTS"
MODULE_KEY = "reports"
sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")


# ---------------------------------------------------------------------------
# Helper: record sync timestamp in SyncState and optionally on Vessel row
# ---------------------------------------------------------------------------

async def record_vessel_sync_time(
    control_db: AsyncSession,
    imo: str,
    is_vessel_pushing: bool,
    db: AsyncSession = None,
    error_msg: str = None,
    telemetry: dict = None,
):
    """Update SyncState and Vessel row with latest push/pull timestamps and telemetry."""
    if not imo:
        return
    now = datetime.now(timezone.utc)

    # Update SyncState in main DB
    if db:
        update_set = {"updated_at": now}
        if telemetry is not None or error_msg:
            active_errors = telemetry.get("active_errors", []) if telemetry else []
            if error_msg:
                active_errors.insert(0, {"entity": "Shore-API", "msg": error_msg, "ts": now.isoformat()})
            update_set["active_errors"] = active_errors
        update_set["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

        await db.execute(
            pg_insert(SyncState)
            .values(vessel_imo=imo, sync_scope=SYNC_SCOPE, **update_set)
            .on_conflict_do_update(index_elements=["vessel_imo", "sync_scope"], set_=update_set)
        )
        await db.commit()

    # Update Vessel row in control DB
    try:
        from sqlalchemy import table, column, JSON, Integer, String, Boolean, DateTime
        from sqlalchemy import select, update
        
        vessels_t = table('vessels', 
            column('imo', String),
            column('updated_at', DateTime),
            column('last_push_at', DateTime),
            column('last_pull_at', DateTime),
            column('module_status', JSON),
            column('module_error_counts', JSON),
            column('total_error_count', Integer),
            column('last_sync_success', Boolean),
            column('last_sync_error', String)
        )
        
        res = await control_db.execute(select(vessels_t).where(vessels_t.c.imo == imo))
        vessel_row = res.mappings().fetchone()
        if not vessel_row:
            return

        module_status = dict(vessel_row["module_status"] or {})
        if not module_status.get(MODULE_KEY):
            module_status[MODULE_KEY] = True

        vessel_update = {
            "updated_at": now,
            "module_status": module_status,
        }
        vessel_update["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

        if telemetry is not None:
            reported_count = telemetry.get("failed_items_count", 0)
            active_errors = telemetry.get("active_errors", [])

            current_counts = dict(vessel_row["module_error_counts"] or {})
            current_counts[MODULE_KEY] = reported_count
            vessel_update["module_error_counts"] = current_counts
            vessel_update["total_error_count"] = sum(current_counts.values())
            vessel_update["last_sync_success"] = (sum(current_counts.values()) == 0)

            if active_errors:
                try:
                    history = json.loads(vessel_row["last_sync_error"]) if vessel_row["last_sync_error"] else []
                    latest_msg = active_errors[0].get("msg", "")
                    if not history or history[0].get("msg") != latest_msg:
                        history.insert(0, {
                            "module": MODULE_KEY.upper(),
                            "type": "vessel_error",
                            "msg": latest_msg,
                            "ts": now.isoformat()
                        })
                        vessel_update["last_sync_error"] = json.dumps(history[:50])
                except Exception:
                    pass

        await control_db.execute(update(vessels_t).where(vessels_t.c.imo == imo).values(vessel_update))
        await control_db.commit()
    except Exception as e:
        print(f"record_vessel_sync_time: Vessel update failed: {e}")


# ---------------------------------------------------------------------------
# Heartbeat — vessel reports its health without pushing data
# ---------------------------------------------------------------------------

@router.post("/heartbeat", dependencies=[Depends(verify_sync_key)])
async def receive_heartbeat(
    payload: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    imo = payload.get("vessel_imo")
    if not imo:
        raise HTTPException(status_code=400, detail="vessel_imo missing from payload")
    telemetry = payload.get("vessel_telemetry") or payload
    await record_vessel_sync_time(control_db, imo, is_vessel_pushing=True, db=db, telemetry=telemetry)
    return {"status": "heartbeat_received"}


# ---------------------------------------------------------------------------
# ENTITY MODEL MAP for push route
# ---------------------------------------------------------------------------

ENTITY_MODEL_MAP = {
    "report": Report,
    "report_thread": ReportThread,
    "report_thread_attachment": ReportThreadAttachment,
    "report_attachment": ReportAttachment,
    "report_config": ReportConfig,
    "report_event": ReportEvent,
    "notification": Notification,
}


async def _apply(entity_type: str, payload: SyncPayload, db: AsyncSession, control_db: AsyncSession):
    model_class = ENTITY_MODEL_MAP.get(entity_type)
    if not model_class:
        raise HTTPException(status_code=400, detail=f"Unknown entity_type '{entity_type}'")
    try:
        if "vessel_imo" not in payload.data and hasattr(model_class, "vessel_imo"):
            payload.data["vessel_imo"] = payload.vessel_imo
        await SyncService.apply_snapshot(db, model_class, payload.entity_id, payload.data)
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True,
            db=db, telemetry=getattr(payload, "vessel_telemetry", None)
        )
        return {"status": "processed", "id": str(payload.entity_id)}
    except Exception as e:
        print(f"SYNC ERROR ({entity_type}):\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True,
            db=db, error_msg=str(e)
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{entity_type}", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_push(
    entity_type: str,
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply a vessel-pushed snapshot for one of the report tracker entities."""
    return await _apply(entity_type, payload, db, control_db)


# ---------------------------------------------------------------------------
# GET /changes — vessel pulls shore data
# ---------------------------------------------------------------------------

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Return all report tracker records changed since the given timestamp."""
    # Normalise to naive UTC (Report Tracker DateTime columns are naive)
    if since.tzinfo is not None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)

    # Record that the vessel pulled
    if vessel_imo:
        await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False, db=db)

    models = {
        "reports": Report,
        "report_threads": ReportThread,
        "report_thread_attachments": ReportThreadAttachment,
        "report_attachments": ReportAttachment,
        "report_configs": ReportConfig,
        "report_events": ReportEvent,
        "notifications": Notification,
    }

    results = {}
    for key, model in models.items():
        time_col = model.updated_at if hasattr(model, "updated_at") else model.created_at
        stmt = select(model).where(time_col > since)

        # Scope to requesting vessel
        if vessel_imo:
            if hasattr(model, "vessel_imo"):
                stmt = stmt.where(model.vessel_imo == vessel_imo)
            elif model == ReportThread:
                stmt = stmt.join(Report, model.report_id == Report.id).where(Report.vessel_imo == vessel_imo)
            elif model == ReportAttachment:
                stmt = stmt.join(Report, model.report_id == Report.id).where(Report.vessel_imo == vessel_imo)
            elif model == ReportThreadAttachment:
                stmt = stmt.join(ReportThread, model.thread_id == ReportThread.id)\
                           .join(Report, ReportThread.report_id == Report.id)\
                           .where(Report.vessel_imo == vessel_imo)
            elif model == Notification:
                # Scope notifications via report_id join; rows with no report_id are skipped
                stmt = stmt.join(Report, model.report_id == Report.id).where(Report.vessel_imo == vessel_imo)

        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(item, c.name) for c in item.__table__.columns}
            for item in items
        ]

    return results
