# app/api/v1/endpoints/sync.py
# Shore-side receiver for vessel Report Tracker sync: accepts pushed changes
# and serves incremental pulls. Same shape as Drs-backend's sync.py endpoint.
import traceback
from typing import Any, Dict, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.core.database import get_db
from app.core.config import settings
from app.schemas.sync import SyncPayload
from app.services.sync_service import SyncService
from app.models.report import (
    Report, ReportThread, ReportThreadAttachment, ReportAttachment,
    ReportConfig, ReportEvent,
)

router = APIRouter(prefix="/sync", tags=["Sync"])

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")


ENTITY_MODEL_MAP = {
    "report": Report,
    "report_thread": ReportThread,
    "report_thread_attachment": ReportThreadAttachment,
    "report_attachment": ReportAttachment,
    "report_config": ReportConfig,
    "report_event": ReportEvent,
}


async def _apply(entity_type: str, payload: SyncPayload, db: AsyncSession):
    model_class = ENTITY_MODEL_MAP.get(entity_type)
    if not model_class:
        raise HTTPException(status_code=400, detail=f"Unknown entity_type '{entity_type}'")
    try:
        if "vessel_imo" not in payload.data and hasattr(model_class, "vessel_imo"):
            payload.data["vessel_imo"] = payload.vessel_imo
        await SyncService.apply_snapshot(db, model_class, payload.entity_id, payload.data)
        return {"status": "processed", "id": str(payload.entity_id)}
    except Exception as e:
        print(f"SYNC ERROR ({entity_type}):\n{traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{entity_type}", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_push(
    entity_type: str,
    payload: SyncPayload,
    db: AsyncSession = Depends(get_db),
):
    """Apply a vessel-pushed snapshot for one of the report tracker entities."""
    return await _apply(entity_type, payload, db)


@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    vessel_imo: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Return all report tracker records changed since the given timestamp."""
    if since.tzinfo is None:
        since = since.replace(tzinfo=timezone.utc)
    else:
        since = since.astimezone(timezone.utc)

    models = {
        "reports": Report,
        "report_threads": ReportThread,
        "report_thread_attachments": ReportThreadAttachment,
        "report_attachments": ReportAttachment,
        "report_configs": ReportConfig,
        "report_events": ReportEvent,
    }

    results = {}
    for key, model in models.items():
        time_col = model.updated_at if hasattr(model, "updated_at") else model.created_at
        stmt = select(model).where(time_col > since)

        # Scope reports/events to the requesting vessel when known, so a
        # vessel instance doesn't pull every other vessel's data.
        if vessel_imo and hasattr(model, "vessel_imo"):
            stmt = stmt.where(model.vessel_imo == vessel_imo)

        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(item, c.name) for c in item.__table__.columns}
            for item in items
        ]

    return results
