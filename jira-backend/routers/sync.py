from fastapi import APIRouter, Depends, HTTPException, Query, Security, status
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from datetime import datetime, timezone

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


# ── PUSH endpoints (vessel → shore) ──────────────────────────────────────

@router.post("/ticket", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_ticket(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, Ticket, payload.entity_id, payload.version, payload.data)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/comment", status_code=status.HTTP_200_OK, dependencies=[Depends(verify_sync_key)])
async def sync_comment(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, Comment, payload.entity_id, payload.version, payload.data)
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── PULL endpoint (shore → vessel) ───────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_changes(
    since: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    # Normalise to UTC
    if since.tzinfo is None:
        since = since.replace(tzinfo=None)
    else:
        since = since.astimezone(timezone.utc)

    models = {
        "ticket": Ticket,
        "comment": Comment,
    }

    UPDATE_FIELD_MAP = {
        "ticket": "updatedAt",
        "comment": "updatedAt",
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

    return results