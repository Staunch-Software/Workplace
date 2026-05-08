"""
app/routes/engine_sync.py  —  VESSEL-SIDE

Endpoints the vessel exposes so the shore-side can:
  • POST changes to the vessel  (shore → vessel push, if needed)
  • GET  /engine-sync/changes   (vessel pulls this from shore)

This file is the vessel's inbound sync router, mirroring the pattern
of app/routes/sync.py (the luboil vessel-side router).
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime, timezone
from pydantic import BaseModel

from app.database import get_db
from app.config import settings
from app.services.sync_service import SyncService

# Engine Performance models
from app.models import (
    MonthlyReportHeader,
    MonthlyISOPerformanceData,
    MEAlertSummary,
    MECriticalAlert,
    MEWarningAlert,
    MENormalStatus,
    MEDeviationHistory,
    VesselInfo,
    ShopTrialSession,
    ShopTrialPerformanceData,
)
from app.generator_models import (
    GeneratorMonthlyReportHeader,
    GeneratorPerformanceGraphData as GeneratorMonthlyPerformanceData,
    AEAlertSummary,
    AEDeviationHistory,
)

router = APIRouter(prefix="/engine-sync", tags=["Engine Sync"])

sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(sync_api_key_header)):
    if api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")


class SyncPayload(BaseModel):
    entity_id: str
    operation: str
    data: dict
    version: int
    origin: str = "SHORE"
    vessel_imo: str = ""


# ─────────────────────────────────────────────────────────────────────────────
# INBOUND PUSH endpoints  (shore → vessel)
# These allow the shore to push individual record changes down to the vessel.
# ─────────────────────────────────────────────────────────────────────────────

@router.post(
    "/me-monthly-report",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_monthly_report(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MonthlyReportHeader,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-iso-performance",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_iso_performance(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MonthlyISOPerformanceData,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-alert-summary",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_alert_summary(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MEAlertSummary,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-critical-alert",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_critical_alert(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MECriticalAlert,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-warning-alert",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_warning_alert(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MEWarningAlert,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-normal-status",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_normal_status(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MENormalStatus,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/me-deviation-history",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_me_deviation_history(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, MEDeviationHistory,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ae-monthly-report",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_ae_monthly_report(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, GeneratorMonthlyReportHeader,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ae-graph-data",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_ae_graph_data(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, GeneratorMonthlyPerformanceData,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ae-alert-summary",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_ae_alert_summary(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, AEAlertSummary,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post(
    "/ae-deviation-history",
    status_code=200,
    dependencies=[Depends(verify_sync_key)],
)
async def sync_ae_deviation_history(
    payload: SyncPayload, db: AsyncSession = Depends(get_db)
):
    try:
        await SyncService.apply_snapshot(
            db, AEDeviationHistory,
            int(payload.entity_id), payload.version, payload.data
        )
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────────────────────────────────────
# CHANGES FEED  (vessel pulls from shore, or shore pulls from vessel)
# GET /engine-sync/changes?since=<iso-datetime>
# Returns all ENGINE_PERFORMANCE records updated since the given timestamp.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_engine_changes(
    since: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns all Engine Performance records updated after `since`.
    The vessel's EngineSyncProcessor calls this on the shore URL to pull
    down shore-side changes.  The shore's equivalent router calls this
    on the vessel URL to pull up vessel-side changes (if bi-directional
    sync is needed in the future).
    """
    if since.tzinfo is not None:
        since = since.astimezone(timezone.utc).replace(tzinfo=None)

    models = {
        "monthly_report_header": MonthlyReportHeader,
        "monthly_iso_performance_data": MonthlyISOPerformanceData,
        "me_alert_summary": MEAlertSummary,
        "me_critical_alert": MECriticalAlert,
        "me_warning_alert": MEWarningAlert,
        "me_normal_status": MENormalStatus,
        "me_deviation_history": MEDeviationHistory,
        "vessel_info": VesselInfo,
        "shop_trial_session": ShopTrialSession,
        "shop_trial_performance_data": ShopTrialPerformanceData,
        "generator_monthly_report_header": GeneratorMonthlyReportHeader,
        "generator_performance_graph_data": GeneratorMonthlyPerformanceData,
        "ae_alert_summary": AEAlertSummary,
        "ae_deviation_history": AEDeviationHistory,
    }

    results = {}
    for key, model in models.items():
        # Only include models that have an updated_at column
        if not hasattr(model, "updated_at"):
            results[key] = []
            continue
        stmt = select(model).where(model.updated_at > since)
        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(i, c.name) for c in i.__table__.columns}
            for i in items
        ]

    return results