from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from app.core.database import get_db
from app.schemas.sync import SyncPayload
from app.services.sync_service import SyncService
from app.core.config import settings
from app.models.vessel import Vessel
from app.models.user import User
from app.models.tasks import Task, Notification
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
# Import all syncable models
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
from app.models.tasks import Task, Notification, LiveFeed

router = APIRouter()

from fastapi.security import APIKeyHeader
from fastapi import Security

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)

async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")

#@router.post("/defect", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
#async def sync_defect(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
  # await SyncService.apply_snapshot(db, Defect, payload.entity_id, payload.version, payload.data)
 #   return {"status": "processed", "id": payload.entity_id}
@router.post("/defect", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Defect Snapshot"""
    try:
        await SyncService.apply_snapshot(db, Defect, payload.entity_id, payload.version, payload.data)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        # THIS LINE IS CRITICAL: It forces the error into the logs
        print(f"CRITICAL SYNC FAILURE: {str(e)}") 
        raise HTTPException(status_code=500, detail=str(e))

#@router.post("/thread", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
#async def sync_thread(payload: SyncPayload, db: AsyncSession = Depends(get_db)):

    #await SyncService.apply_snapshot(db, Thread, payload.entity_id, payload.version, payload.data)
    #return {"status": "processed", "id": payload.entity_id}
@router.post("/thread", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_thread(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, Thread, payload.entity_id, payload.version, payload.data)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"❌ THREAD SYNC ERROR: {error_detail}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/attachment", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_attachment(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Attachment Snapshot"""
    await SyncService.apply_snapshot(db, Attachment, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.post("/pr-entry", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_pr_entry(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply PR Entry Snapshot"""
    await SyncService.apply_snapshot(db, PrEntry, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.post("/defect-image", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_defect_image(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Defect Image Snapshot"""
    await SyncService.apply_snapshot(db, DefectImage, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.post("/task", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_task(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Task Snapshot"""
    await SyncService.apply_snapshot(db, Task, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.post("/notification", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_notification(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Notification Snapshot"""
    await SyncService.apply_snapshot(db, Notification, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.post("/live_feed", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_live_feed(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    """Apply Live Feed Snapshot"""
    await SyncService.apply_snapshot(db, LiveFeed, payload.entity_id, payload.version, payload.data)
    return {"status": "processed", "id": payload.entity_id}

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    db: AsyncSession = Depends(get_db)
):
    # --- FIX: Guarantee the incoming 'since' query is evaluated as UTC ---
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    else:
        since = since.astimezone(timezone.utc)

    # 1. Define tables to check
    models = {
        # "vessels": Vessel,
        # "users": User,
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
        # 2. Fetch records updated after the 'since' timestamp
        stmt = select(model).where(model.updated_at > since)

        if key == "users":
            stmt = stmt.options(selectinload(User.vessels))

        items = (await db.execute(stmt)).scalars().all()

        # 3. Serialize
        serialized_items = []
        for i in items:
            item_data = {c.name: getattr(i, c.name) for c in i.__table__.columns}

            # Inject Vessel Links for Users
            if key == "users":
                item_data["assigned_vessel_imos"] = [v.imo for v in i.vessels]

            serialized_items.append(item_data)

        results[key] = serialized_items

    return results
