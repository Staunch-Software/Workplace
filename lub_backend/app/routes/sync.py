from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from typing import Any
from pydantic import BaseModel

from app.database import get_db
from app.config import settings
from app.luboil_model import (
    LuboilReport, LuboilSample, Notification,
    LuboilEvent, LuboilEventReadState, LuboilVesselConfig
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


class SyncPayload(BaseModel):
    entity_id: str
    operation: str
    data: dict
    version: int
    origin: str = "VESSEL"
    vessel_imo: str = ""


# ── Luboil entity endpoints ──────────────────────────────────────────────────

@router.post("/luboil-report", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_report(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, LuboilReport, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-sample", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_sample(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, LuboilSample, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/notification", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_notification(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, Notification, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-event", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_event(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, LuboilEvent, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-event-read-state", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_event_read_state(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, LuboilEventReadState, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/luboil-vessel-config", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_luboil_vessel_config(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, LuboilVesselConfig, payload.entity_id, payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Changes feed (cloud → vessel pull) ───────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    db: AsyncSession = Depends(get_db)
):
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    else:
        since = since.astimezone(timezone.utc)

    models = {
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