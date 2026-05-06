from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel
import json
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.models.sync import SyncState
from app.database import get_db
from app.config import settings
from app.luboil_model import (
    LuboilReport, LuboilSample, Notification,
    LuboilEvent, LuboilEventReadState, LuboilVesselConfig, LuboilEquipmentType, LuboilNameMapping
)
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.core.database_control import get_control_db
from app.services.sync_service import SyncService

router = APIRouter()

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)

async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")
    
MODULE_KEY = "luboil" # Ensure this is at the top of shore sync.py
SYNC_SCOPE = "LUBOIL"

async def record_vessel_sync_time(
    control_db: AsyncSession,
    imo: str,
    is_vessel_pushing: bool,
    error_msg: str = None,
    telemetry: dict = None,
    db: AsyncSession = None,
):
    if not imo: return
    res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = res.scalar_one_or_none()
    if not vessel: return

    now = datetime.now(timezone.utc)
    # Extract reported values from vessel
    reported_count = telemetry.get("failed_items_count", 0) if telemetry else None
    active_errors = telemetry.get("active_errors", []) if telemetry else []
    
    if error_msg:
        active_errors.insert(0, {"entity": "Shore-API", "msg": error_msg, "ts": now.isoformat()})
        if reported_count is not None:
            reported_count = max(reported_count, len(active_errors))

    # Update Module-Specific DB (sync_state table)
    if db:
        update_set = {"updated_at": now}
        if telemetry is not None or error_msg:
            update_set["active_errors"] = active_errors
        
        update_set["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

        await db.execute(
            pg_insert(SyncState)
            .values(vessel_imo=imo, sync_scope=SYNC_SCOPE, **update_set)
            .on_conflict_do_update(index_elements=["vessel_imo", "sync_scope"], set_=update_set)
        )
        await db.commit()

    # --- SELF-HEALING & MULTI-MODULE LOGIC (Control DB) ---
    vessel_update = {"updated_at": now}
    vessel_update["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

    # Only update counts if telemetry was actually provided (prevents Pull wiping counts)
    if reported_count is not None:
        current_counts = dict(vessel.module_error_counts or {})
        current_counts[MODULE_KEY] = reported_count
        new_total = sum(current_counts.values())
        
        vessel_update["module_error_counts"] = current_counts
        vessel_update["total_error_count"] = new_total
        vessel_update["last_sync_success"] = (new_total == 0)

    # --- HISTORY LOGGING ---
    if len(active_errors) > 0:
        try:
            history = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
            latest_msg = active_errors[0]["msg"]
            if not history or history[0].get("msg") != latest_msg:
                history.insert(0, {
                    "module": MODULE_KEY.upper(), 
                    "msg": latest_msg, 
                    "ts": now.isoformat()
                })
                vessel_update["last_sync_error"] = json.dumps(history[:50])
        except: pass

    await control_db.execute(update(Vessel).where(Vessel.imo == imo).values(vessel_update))
    await control_db.commit()

@router.post("/heartbeat", dependencies=[Depends(verify_sync_key)])
async def receive_heartbeat(
    payload: Dict[str, Any],
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    imo = payload.get("vessel_imo")
    if not imo:
        raise HTTPException(status_code=400, detail="vessel_imo missing")
    telemetry = payload.get("vessel_telemetry") or payload
    await record_vessel_sync_time(control_db, imo, is_vessel_pushing=True, telemetry=telemetry, db=db)
    return {"status": "heartbeat_received"}


class SyncPayload(BaseModel):
    entity_id: str
    operation: str
    data: dict
    version: int
    origin: str = "VESSEL"
    vessel_imo: str = ""
    vessel_telemetry: dict = {}   # ← add this line only


# ── Luboil entity endpoints ──────────────────────────────────────────────────

@router.post("/luboil-report", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_report(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, LuboilReport, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-sample", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_sample(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, LuboilSample, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notification", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_notification(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, Notification, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-event", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_event(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, LuboilEvent, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-event-read-state", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_event_read_state(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, LuboilEventReadState, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-vessel-config", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_vessel_config(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, LuboilVesselConfig, payload.entity_id, payload.version, payload.data)
        await db.commit()
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LUBOIL-REPORT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(                     # ← add
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


# ── Changes feed (cloud → vessel pull) ───────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: Optional[str] = Query(None), 
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    if since.tzinfo is not None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)
    if vessel_imo:                                         # ← add block
        await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False, db=db)

    models = {
        "luboil_equipment_types": LuboilEquipmentType,
        "luboil_name_mappings": LuboilNameMapping,
        "luboil_reports": LuboilReport,
        "luboil_samples": LuboilSample,
        "notifications": Notification,
        "luboil_events": LuboilEvent,
        "luboil_event_read_states": LuboilEventReadState,
        "luboil_vessel_configs": LuboilVesselConfig,
    }

    results = {}
    for key, model in models.items():
        stmt = select(model).where(model.updated_at > since)
        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(i, c.name) for c in i.__table__.columns}
            for i in items
        ]

    return results