import json
import traceback
from typing import Any, Dict, Optional
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update
from dateutil import parser
from app.core.database_control import get_control_db  # ✅ control DB session
from app.core.database import get_db                  # ✅ vessel/main DB session
from app.core.config import settings
from app.schemas.sync import SyncPayload
from app.services.sync_service import SyncService
from sqlalchemy.dialects.postgresql import insert as pg_insert

# ✅ This Vessel model uses ControlBase → bound to engine_control → correct DB
from app.models.vessel import Vessel

from app.models.user import User
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
from app.models.tasks import Task, Notification, LiveFeed
from app.models.mariapps_pr_cache import MariappsPrCache
from app.models.sync import SyncState
# ---------------------------------------------------------------------------
# Router & API Key Auth
# ---------------------------------------------------------------------------

router = APIRouter()

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)

async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")


# ---------------------------------------------------------------------------
# Helper: record sync timestamp + telemetry on the control Vessel row
# ---------------------------------------------------------------------------


async def record_vessel_sync_time(
    control_db: AsyncSession,
    imo: str,
    is_vessel_pushing: bool,
    error_msg: str = None,
    telemetry: dict = None,
    db: AsyncSession = None,  # main DB — needed for SyncState
):
    if not imo: return

    res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = res.scalar_one_or_none()
    if not vessel: return

    now = datetime.now(timezone.utc)
    update_data = {"updated_at": now}

    if is_vessel_pushing:
        # Use vessel's own reported push timestamp if available
        vessel_time_str = telemetry.get("vessel_reported_push") if telemetry else None
        try:
            push_at = parser.isoparse(vessel_time_str) if vessel_time_str else now
        except:
            push_at = now
        update_data["last_pull_at"] = push_at

        # Write vessel's SyncState timestamps into shore's main DB
        if db:
            try:
                for scope, push_key, pull_key in [
                    ("DEFECT", "vessel_reported_push", "vessel_reported_pull"),
                    ("CONFIG", "vessel_config_push",   "vessel_config_pull"),
                ]:
                    raw_push = telemetry.get(push_key) if telemetry else None
                    raw_pull = telemetry.get(pull_key) if telemetry else None

                    try:
                        scope_push_at = parser.isoparse(raw_push) if raw_push else None
                    except:
                        scope_push_at = None
                    try:
                        scope_pull_at = parser.isoparse(raw_pull) if raw_pull else None
                    except:
                        scope_pull_at = None

                    insert_values = {
                        "vessel_imo": imo,
                        "sync_scope": scope,
                        "last_push_at": scope_push_at,
                        "last_pull_at": scope_pull_at,
                    }

                    update_set = {}
                    if scope_push_at:
                        update_set["last_push_at"] = scope_push_at
                    if scope_pull_at:
                        update_set["last_pull_at"] = scope_pull_at

                    # Always run — creates row even with null timestamps
                    await db.execute(
                        pg_insert(SyncState)
                        .values(**insert_values)
                        .on_conflict_do_update(
                            index_elements=["vessel_imo", "sync_scope"],
                            set_=update_set if update_set else {"vessel_imo": imo}
                        )
                    )
                await db.commit()
            except Exception as e:
                print(f"❌ SyncState upsert failed for imo={imo}: {e}")
                traceback.print_exc()

    else:
        # Vessel pulled from shore — stamp shore's push time in SyncState
        update_data["last_push_at"] = now
        if db:
            await db.execute(
                pg_insert(SyncState)
                .values(vessel_imo=imo, sync_scope="DEFECT", last_push_at=now)
                .on_conflict_do_update(
                    index_elements=["vessel_imo", "sync_scope"],
                    set_={"last_push_at": now}
                )
            )
            await db.commit()

    # --- Error history ---
    try:
        current_errors = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
        if not isinstance(current_errors, list): current_errors = []
    except:
        current_errors = []

    new_err_content = None
    err_type = None

    if error_msg:
        new_err_content = error_msg
        err_type = "shore_error"
    elif telemetry and telemetry.get("failed_items_count", 0) > 0:
        new_err_content = telemetry.get("last_local_error")
        err_type = "vessel_error"

    if new_err_content:
        is_duplicate = len(current_errors) > 0 and current_errors[0]['msg'] == new_err_content
        if not is_duplicate:
            current_errors.insert(0, {
                "id": int(now.timestamp()),
                "type": err_type,
                "msg": new_err_content,
                "ts": now.isoformat()
            })
        update_data["last_sync_success"] = False
    else:
        if telemetry and telemetry.get("failed_items_count") == 0:
            update_data["last_sync_success"] = True

    one_week_ago = now - timedelta(days=7)
    pruned_errors = [
        e for e in current_errors
        if datetime.fromisoformat(e['ts']) > one_week_ago
    ]
    update_data["last_sync_error"] = json.dumps(pruned_errors[:50])

    await control_db.execute(update(Vessel).where(Vessel.imo == imo).values(update_data))
    await control_db.commit()
           
# ---------------------------------------------------------------------------
# Heartbeat
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
    await record_vessel_sync_time(control_db, imo, is_vessel_pushing=True, telemetry=telemetry,db=db )
    return {"status": "heartbeat_received"}


# ---------------------------------------------------------------------------
# POST routes — vessel pushing data to shore
# ---------------------------------------------------------------------------

@router.post("/defect", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Defect snapshot from vessel."""
    try:
        if "vessel_imo" not in payload.data:
            payload.data["vessel_imo"] = payload.vessel_imo
        await SyncService.apply_snapshot(
            db, Defect, payload.entity_id, payload.version, payload.data, control_db=control_db
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ DEFECT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/thread", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_thread(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Thread snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, Thread, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ THREAD SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/attachment", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_attachment(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Attachment snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, Attachment, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ ATTACHMENT SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pr-entry", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_pr_entry(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply PR Entry snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, PrEntry, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ PR-ENTRY SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/defect-image", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect_image(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Defect Image snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, DefectImage, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ DEFECT-IMAGE SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/task", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_task(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Task snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, Task, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ TASK SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notification", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_notification(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Notification snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, Notification, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ NOTIFICATION SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/live_feed", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_live_feed(
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Apply Live Feed snapshot from vessel."""
    try:
        await SyncService.apply_snapshot(
            db, LiveFeed, payload.entity_id, payload.version, payload.data
        )
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry,db=db
        )
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        print(f"❌ LIVE_FEED SYNC ERROR:\n{traceback.format_exc()}")
        await record_vessel_sync_time(
            control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e),db=db
        )
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    """Return all records updated since the given timestamp."""

    # Normalise timezone — treat naive datetimes as UTC
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    else:
        since = since.astimezone(timezone.utc)

    # Record that the vessel pulled from shore — only if IMO provided
    
    if vessel_imo:
        await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False,db=db)

    models = {
        "defects":       Defect,
        "threads":       Thread,
        "attachments":   Attachment,
        "pr_entries":    PrEntry,
        "defect_images": DefectImage,
        "tasks":         Task,
        "notifications": Notification,
        "live_feed":     LiveFeed,
        "pr_cache":      MariappsPrCache,
    }

    results = {}

    for key, model in models.items():
        time_col = model.updated_at if hasattr(model, 'updated_at') else model.last_scraped_at
        stmt = select(model).where(time_col > since)

        if key == "users":
            stmt = stmt.options(selectinload(User.vessels))

        items = (await db.execute(stmt)).scalars().all()

        serialized_items = []
        for item in items:

            item_data = {c.name: getattr(item, c.name) for c in item.__table__.columns}
            
            if key == "users":
                item_data["assigned_vessel_imos"] = [v.imo for v in item.vessels]

            serialized_items.append(item_data)

        results[key] = serialized_items

    return results