import json
import traceback
from typing import Any, Dict, Optional
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from models.control import Vessel  # adjust import path to your project
from db.database import get_control_db  # adjust to your project
from fastapi import APIRouter, Depends, HTTPException, Query, Security, logger, status
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import datetime, timezone
from models.sync import SyncState
from db.database import get_db
from schemas.sync import SyncPayload
from services.sync_service import SyncService
from models.schema import Ticket, Comment
from core.config import settings

router = APIRouter(prefix="/api/jira/sync", tags=["sync"])

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")

    # --- ADD THESE CONSTANTS AT THE TOP ---
MODULE_KEY = "jira"
SYNC_SCOPE = "TICKET"
# --------------------------------------

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
    
    # --- FIX 1: Extract telemetry safely ---
    # We use None as default for reported_count to detect if telemetry was sent
    reported_count = telemetry.get("failed_items_count") if telemetry else None
    active_errors = telemetry.get("active_errors", []) if telemetry else []
    
    if error_msg:
        active_errors.insert(0, {"entity": "Shore-API", "msg": error_msg, "ts": now.isoformat()})
        # If API error, count is at least the length of errors
        reported_count = max(reported_count or 0, len(active_errors))

    # 1. Update Jira Module DB (SyncState)
    if db:
        update_set = {"updated_at": now}
        
        # --- FIX 2: Only wipe/update errors if fresh telemetry was provided ---
        # This prevents "Pull" requests (where telemetry is None) from clearing the UI
        if telemetry is not None or error_msg:
            update_set["active_errors"] = active_errors
        
        update_set["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

        await db.execute(
            pg_insert(SyncState)
            .values(vessel_imo=imo, sync_scope=SYNC_SCOPE, **update_set)
            .on_conflict_do_update(index_elements=["vessel_imo", "sync_scope"], set_=update_set)
        )
        await db.commit()
    # --- NEW: AUTOMATIC MODULE ACTIVATION ---
    # Get existing module status map
    module_status = dict(vessel.module_status or {})
    
    # If this module isn't marked as True yet, mark it!
    # This "discovers" the module automatically when the ship first syncs.
    if not module_status.get(MODULE_KEY):
        module_status[MODULE_KEY] = True
    # ----------------------------------------

    # 2. Update Central Control DB (Shared Vessel Table)
    # Remove .replace(tzinfo=None) to stay consistent with UTC-aware columns
    vessel_update = {"updated_at": now,"module_status": module_status,}
    vessel_update["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

    # --- FIX 3: Self-Healing Logic (Only if telemetry exists) ---
    if reported_count is not None:
        current_counts = dict(vessel.module_error_counts or {})
        current_counts[MODULE_KEY] = reported_count 
        new_total = sum(current_counts.values())
        
        vessel_update["module_error_counts"] = current_counts
        vessel_update["total_error_count"] = new_total
        vessel_update["last_sync_success"] = (new_total == 0)

    # 3. Tagged History Logging
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
        except Exception: pass

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

# ── PUSH endpoints (vessel → shore) ──────────────────────────────────────

@router.post("/ticket", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_ticket(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, Ticket, payload.entity_id, payload.version, payload.data)
        # Track last_push_at per vessel (vessel pushed a ticket to shore)
        # vessel_imo = payload.vessel_imo or payload.data.get("vessel_imo") or payload.data.get("vesselImo")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        # if vessel_imo:
        #     from models.sync import SyncState
        #     state = (await db.execute(
        #         select(SyncState)
        #         .where(SyncState.vessel_imo == vessel_imo)
        #         .where(SyncState.sync_scope == "TICKET")
        #     )).scalar_one_or_none()
        #     now = datetime.utcnow()
        #     if state:
        #         state.last_push_at = now
        #     else:
        #         db.add(SyncState(vessel_imo=vessel_imo, sync_scope="TICKET", last_push_at=now))
        #     await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        logger.error(f"❌ TICKET SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/comment", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_comment(payload: SyncPayload, db: AsyncSession = Depends(get_db),control_db: AsyncSession = Depends(get_control_db),):
    try:
        await SyncService.apply_snapshot(db, Comment, payload.entity_id, payload.version, payload.data)
        await record_vessel_sync_time(
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, telemetry=payload.vessel_telemetry, db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        logger.error(f"❌ COMMENT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo,
            is_vessel_pushing=True, error_msg=str(e), db=db
        )
        raise HTTPException(status_code=500, detail=str(e))

# ── PULL endpoint (shore → vessel) ───────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: str = Query(None),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    # Normalise to UTC
    
    if since.tzinfo is not None:
        # Convert to UTC then make it naive (match DB)
        since = since.astimezone(timezone.utc).replace(tzinfo=None)
    else:
        # Already naive → keep as is
        pass

    models = {
        "ticket": Ticket,
        "comment": Comment,
    }

    UPDATE_FIELD_MAP = {
        "ticket": "updatedAt",
        "comment": "createdAt",
    }

    results = {}
    for key, model in models.items():
        field_name = UPDATE_FIELD_MAP.get(key, "updated_at")
        update_field = getattr(model, field_name)
        stmt = select(model).where(update_field > since)
        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(i, c.name) for c in i.__table__.columns}
            for i in items
        ]

    # Track last_pull_at per vessel (vessel pulled changes from shore)
    if vessel_imo:
        await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False, db=db)
        # try:
        #     from models.sync import SyncState
        #     state = (await db.execute(
        #         select(SyncState)
        #         .where(SyncState.vessel_imo == vessel_imo)
        #         .where(SyncState.sync_scope == "TICKET")
        #     )).scalar_one_or_none()
        #     now = datetime.utcnow()
        #     if state:
        #         state.last_pull_at = now
        #     else:
        #         db.add(SyncState(vessel_imo=vessel_imo, sync_scope="TICKET", last_pull_at=now))
        #     await db.commit()
        # except Exception:
        #     pass

    return results