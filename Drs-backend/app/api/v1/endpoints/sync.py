import traceback
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from sqlalchemy import update

from app.core.database import get_db
from app.schemas.sync import SyncPayload
from app.services.sync_service import SyncService
from app.core.config import settings

# ✅ CRITICAL: Import the correct Vessel model and alias it
# This prevents conflicts with local database relationship stubs
from app.models.vessel import Vessel as ControlVessel 
from app.models.user import User
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
from app.models.tasks import Task, Notification, LiveFeed
from app.core.database_control import get_control_db

router = APIRouter()

from fastapi.security import APIKeyHeader
from fastapi import Security

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)

async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")

# ✅ THE CORE HELPER: Maps Vessel timestamps to Shore columns
async def record_vessel_sync_time(
    control_db: AsyncSession, 
    imo: str, 
    is_vessel_pushing: bool, 
    error_msg: str = None, 
    telemetry: dict = None
):
    """
    Logic Mapping:
    - Vessel PUSH (sending data) -> Shore records as PULL (received data)
    - Vessel PULL (asking data) -> Shore records as PUSH (sent data)
    """
    imo_clean = imo.strip()
    now = datetime.now(timezone.utc)
    
    # We use explicit class attributes (ControlVessel.column) as keys 
    # to bypass SQLAlchemy mapping issues.
    update_data = {}

    # 1. Default Logic (Used if telemetry is missing)
    if is_vessel_pushing:
        update_data[ControlVessel.last_pull_at] = now
    else:
        update_data[ControlVessel.last_push_at] = now

    # 2. Telemetry Mapping (The Vessel's reported Truth)
    if telemetry:
        # 🔄 Vessel reports its internal PUSH time -> Shore records it as PULL (received)
        if telemetry.get("vessel_reported_push"):
            update_data[ControlVessel.last_pull_at] = telemetry["vessel_reported_push"]
        
        # 🔄 Vessel reports its internal PULL time -> Shore records it as PUSH (sent)
        if telemetry.get("vessel_reported_pull"):
            update_data[ControlVessel.last_push_at] = telemetry["vessel_reported_pull"]

        # Save Health Meta
        update_data[ControlVessel.vessel_telemetry] = telemetry
        failed_count = telemetry.get("failed_items_count", 0)
        
        if failed_count > 0:
            update_data[ControlVessel.last_sync_success] = False
            update_data[ControlVessel.last_sync_error] = f"Vessel Error: {telemetry.get('last_local_error')}"
        else:
            update_data[ControlVessel.last_sync_success] = True
            update_data[ControlVessel.last_sync_error] = None

    # 3. Handle Shore-side logic errors (If Shore rejected the sync)
    if error_msg:
        update_data[ControlVessel.last_sync_success] = False
        update_data[ControlVessel.last_sync_error] = f"Shore Error: {error_msg}"

    # Execute the SQL Update
    try:
        stmt = (
            update(ControlVessel)
            .where(ControlVessel.imo == imo_clean)
            .values(update_data)
        )
        await control_db.execute(stmt)
        await control_db.commit()
    except Exception as e:
        await control_db.rollback()
        print(f"❌ Failed to record sync time: {e}")

# --- 1. HEARTBEAT (Vessel Pushing Health Only) ---

@router.post("/heartbeat", dependencies=[Depends(verify_sync_key)])
async def receive_heartbeat(payload: Dict[str, Any], control_db: AsyncSession = Depends(get_control_db)):
    imo = payload.get("vessel_imo")
    telemetry = payload.get("vessel_telemetry") or payload
    if not imo:
        raise HTTPException(status_code=400, detail="Vessel IMO missing")
    # Heartbeat = Vessel Pushing health -> Shore records as Pulling
    await record_vessel_sync_time(control_db, imo, is_vessel_pushing=True, telemetry=telemetry)
    return {"status": "heartbeat_received"}

# --- 2. DATA SYNC (POST = Vessel Pushing data -> Shore Pulling) ---

@router.post("/defect", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect(payload: SyncPayload, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    try:
        if "vessel_imo" not in payload.data:
            payload.data["vessel_imo"] = payload.vessel_imo
        await SyncService.apply_snapshot(db, Defect, payload.entity_id, payload.version, payload.data, control_db=control_db)
        # Vessel Push -> Shore Pull
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/thread", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_thread(payload: SyncPayload, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    try:
        await SyncService.apply_snapshot(db, Thread, payload.entity_id, payload.version, payload.data)
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/attachment", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_attachment(payload: SyncPayload, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    try:
        await SyncService.apply_snapshot(db, Attachment, payload.entity_id, payload.version, payload.data)
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pr-entry", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_pr_entry(payload: SyncPayload, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    try:
        await SyncService.apply_snapshot(db, PrEntry, payload.entity_id, payload.version, payload.data)
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e))
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/defect-image", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect_image(payload: SyncPayload, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    try:
        await SyncService.apply_snapshot(db, DefectImage, payload.entity_id, payload.version, payload.data)
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, telemetry=payload.vessel_telemetry)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        await record_vessel_sync_time(control_db, payload.vessel_imo, is_vessel_pushing=True, error_msg=str(e))
        raise HTTPException(status_code=500, detail=str(e))

# --- 3. GET CHANGES (Vessel PULLING Updates -> Shore records PUSHING data) ---

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: str = Query(...),
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db)
):
    # 🔄 Vessel is PULLING -> Shore records it as a PUSH out to the ship
    await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False)
    
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    else:
        since = since.astimezone(timezone.utc)

    # 1. Define tables to check
    models = {
        "defects": Defect,
        "threads": Thread,
        "attachments": Attachment,
        "pr_entries": PrEntry,
        "defect_images": DefectImage,
        "tasks": Task,
        "notifications": Notification,
        "live_feed": LiveFeed,
    }

    results = {}
    for key, model in models.items():
        stmt = select(model).where(model.updated_at > since)
        if key == "users":
            stmt = stmt.options(selectinload(User.vessels))

        items = (await db.execute(stmt)).scalars().all()

        serialized_items = []
        for i in items:
            item_data = {c.name: getattr(i, c.name) for c in i.__table__.columns}
            if key == "users":
                item_data["assigned_vessel_imos"] = [v.imo for v in i.vessels]
            serialized_items.append(item_data)

        results[key] = serialized_items

    return results