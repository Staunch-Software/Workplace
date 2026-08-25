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
from sqlalchemy import select, func, cast
from sqlalchemy.dialects.postgresql import JSONB
from datetime import datetime, timezone
from pydantic import BaseModel

from app.database import get_db
from app.config import settings
from app.services.sync_service import SyncService
from typing import Dict, Any, Optional
import json
from sqlalchemy import update
from app.core.database_control import get_control_db
from app.model.control.vessel import Vessel

# Engine Performance models
from app.models import (
    MonthlyReportHeader,
    MonthlyReportDetailsJsonb,
    MonthlyISOPerformanceData,
    MEAlertSummary,
    MECriticalAlert,
    MEWarningAlert,
    MENormalStatus,
    MEDeviationHistory,
    VesselInfo,
    ShopTrialSession,
    ShopTrialPerformanceData,
    BaselinePerformanceData,
    Organization,
    RolePermission,
)
from app.generator_models import (
    GeneratorMonthlyReportHeader,
    GeneratorMonthlyReportDetailsJsonb,
    GeneratorPerformanceGraphData as GeneratorMonthlyPerformanceData,
    GeneratorBaselineData,
    GeneratorReferenceCurve,
    VesselGenerator,
    AEAlertSummary,
    AEDeviationHistory,
    AECriticalAlert,
    AENormalStatus,
    AEWarningAlert,
)

router = APIRouter(prefix="/engine-sync", tags=["Engine Sync"])
vessels_status_router = APIRouter(prefix="/vessels", tags=["Vessel Status"])

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

@router.post("/monthly-report-details", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_monthly_report_details(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, MonthlyReportDetailsJsonb, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ae-critical-alert", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_ae_critical_alert(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, AECriticalAlert, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ae-normal-status", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_ae_normal_status(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, AENormalStatus, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ae-warning-alert", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_ae_warning_alert(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, AEWarningAlert, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/baseline-performance", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_baseline_performance(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, BaselinePerformanceData, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generator-baseline", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_generator_baseline(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, GeneratorBaselineData, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generator-report-details", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_generator_report_details(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, GeneratorMonthlyReportDetailsJsonb, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generator-reference-curves", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_generator_reference_curves(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, GeneratorReferenceCurve, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/organizations", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_organizations(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, Organization, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/role-permissions", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_role_permissions(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, RolePermission, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/vessel-generator", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_vessel_generator(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, VesselGenerator, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/vessel-info", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_vessel_info(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, VesselInfo, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/shop-trial-session", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_shop_trial_session(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, ShopTrialSession, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/shop-trial-performance", status_code=200, dependencies=[Depends(verify_sync_key)])
async def sync_shop_trial_performance(payload: SyncPayload, db: AsyncSession = Depends(get_db)):
    try:
        await SyncService.apply_snapshot(db, ShopTrialPerformanceData, int(payload.entity_id), payload.version, payload.data)
        await db.commit()
        return {"status": "processed", "id": payload.entity_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# ---------------------------------------------------------------------------
# Helper: record sync timestamp in Vessel row
# ---------------------------------------------------------------------------

SYNC_SCOPE = "AEPMS"
MODULE_KEY = "engine_performance"

async def record_vessel_sync_time(
    control_db: AsyncSession,
    imo: str,
    is_vessel_pushing: bool,
    error_msg: str = None,
    telemetry: dict = None,
):
    if not imo:
        return
    now = datetime.now(timezone.utc)

    # Update Vessel row in control DB
    try:
        res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
        vessel = res.scalar_one_or_none()
        if not vessel:
            return

        vessel_update = {"updated_at": now}
        vessel_update["last_push_at" if is_vessel_pushing else "last_pull_at"] = now

        if telemetry is not None or error_msg:
            reported_count = telemetry.get("failed_items_count", 0) if telemetry else 0
            active_errors = telemetry.get("active_errors", []) if telemetry else []
            if error_msg:
                active_errors.insert(0, {"entity": "Shore-API", "msg": error_msg, "ts": now.isoformat()})

            # Atomic JSONB merge — avoids the lost-update race where another
            # module's heartbeat (e.g. DRS, firing every few seconds) reads a
            # stale module_status snapshot and overwrites this key on commit.
            vessel_update["module_status"] = func.coalesce(
                Vessel.module_status, cast({}, JSONB)
            ).op("||")(cast({MODULE_KEY: True}, JSONB))

            vessel_update["module_error_counts"] = func.coalesce(
                Vessel.module_error_counts, cast({}, JSONB)
            ).op("||")(cast({MODULE_KEY: reported_count}, JSONB))

            current_counts = dict(vessel.module_error_counts or {})
            current_counts[MODULE_KEY] = reported_count
            vessel_update["total_error_count"] = sum(current_counts.values())
            vessel_update["last_sync_success"] = (sum(current_counts.values()) == 0)

            if active_errors:
                try:
                    history = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
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

        await control_db.execute(update(Vessel).where(Vessel.imo == imo).values(vessel_update))
        await control_db.commit()
    except Exception as e:
        print(f"record_vessel_sync_time: Vessel update failed: {e}")

@router.post("/heartbeat", dependencies=[Depends(verify_sync_key)])
async def receive_heartbeat(
    payload: Dict[str, Any],
    control_db: AsyncSession = Depends(get_control_db),
):
    imo = payload.get("vessel_imo")
    if not imo:
        raise HTTPException(status_code=400, detail="vessel_imo missing from payload")
    telemetry = payload.get("vessel_telemetry") or payload
    await record_vessel_sync_time(control_db, imo, is_vessel_pushing=False, error_msg=None, telemetry=telemetry)
    return {"status": "ok"}


# ─────────────────────────────────────────────────────────────────────────────
# VESSEL STATUS  (dashboard reads these — built entirely from the Vessel
# control-table row, since AEPMS has no shared multi-vessel module DB the
# shore server can query directly; the heartbeat above is the only channel
# that populates last_pull_at / last_push_at / module_error_counts / errors.)
# ─────────────────────────────────────────────────────────────────────────────

@vessels_status_router.get("/sync-status/all")
async def get_all_vessel_sync_status(control_db: AsyncSession = Depends(get_control_db)):
    try:
        v_res = await control_db.execute(select(Vessel))
        vessels = v_res.scalars().all()

        result = {}
        for v in vessels:
            counts_map = v.module_error_counts or {}
            engine_count = counts_map.get(MODULE_KEY, 0)
            try:
                history = json.loads(v.last_sync_error) if v.last_sync_error else []
            except Exception:
                history = []
            latest_error = next(
                (e for e in history if e.get("module") == MODULE_KEY.upper()), None
            )

            result[v.imo] = {
                "name": v.name,
                "last_sync_success": (engine_count == 0),
                "failed_items_count": engine_count,
                "latest_error": latest_error,
                "vessel_reported_push": v.last_push_at,
                "vessel_reported_pull": v.last_pull_at,
            }
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@vessels_status_router.get("/{imo}/sync-log")
async def get_vessel_sync_log(imo: str, control_db: AsyncSession = Depends(get_control_db)):
    v_res = await control_db.execute(select(Vessel).where(Vessel.imo == imo))
    vessel = v_res.scalar_one_or_none()
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    counts_map = vessel.module_error_counts or {}
    engine_count = counts_map.get(MODULE_KEY, 0)
    try:
        history = json.loads(vessel.last_sync_error) if vessel.last_sync_error else []
    except Exception:
        history = []
    active_errors = [e for e in history if e.get("module") == MODULE_KEY.upper()]

    return {
        "imo": imo,
        "name": vessel.name,
        "last_sync_success": (engine_count == 0),
        "vessel_reported_push": vessel.last_push_at,
        "vessel_reported_pull": vessel.last_pull_at,
        "active_errors": active_errors,
        "failed_items_count": engine_count,
        "error_history": history,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CHANGES FEED  (vessel pulls from shore, or shore pulls from vessel)
# GET /engine-sync/changes?since=<iso-datetime>
# Returns all ENGINE_PERFORMANCE records updated since the given timestamp.
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/changes", dependencies=[Depends(verify_sync_key)])
async def get_engine_changes(
    since: datetime = Query(...),
    vessel_imo: str = Query(None),
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
        "monthly_report_header":                  MonthlyReportHeader,
        "monthly_report_details_jsonb":           MonthlyReportDetailsJsonb,
        "monthly_iso_performance_data":           MonthlyISOPerformanceData,
        "me_alert_summary":                       MEAlertSummary,
        "me_critical_alert":                      MECriticalAlert,
        "me_warning_alert":                       MEWarningAlert,
        "me_normal_status":                       MENormalStatus,
        "me_deviation_history":                   MEDeviationHistory,
        "vessel_info":                            VesselInfo,
        "shop_trial_session":                     ShopTrialSession,
        "shop_trial_performance_data":            ShopTrialPerformanceData,
        "baseline_performance_data":              BaselinePerformanceData,
        "organizations":                          Organization,
        "role_permissions":                       RolePermission,
        "vessel_generator":                       VesselGenerator,
        "generator_monthly_report_header":        GeneratorMonthlyReportHeader,
        "generator_monthly_report_details_jsonb": GeneratorMonthlyReportDetailsJsonb,
        "generator_performance_graph_data":       GeneratorMonthlyPerformanceData,
        "generator_baseline_data":               GeneratorBaselineData,
        "generator_reference_curves":            GeneratorReferenceCurve,
        "ae_alert_summary":                       AEAlertSummary,
        "ae_deviation_history":                   AEDeviationHistory,
        "ae_critical_alert":                      AECriticalAlert,
        "ae_normal_status":                       AENormalStatus,
        "ae_warning_alert":                       AEWarningAlert,
    }

    results = {}
    for key, model in models.items():
        # Only include models that have an updated_at column
        if not hasattr(model, "updated_at"):
            results[key] = []
            continue
        stmt = select(model).where(model.updated_at > since)

        if vessel_imo:
            imo_int = int(vessel_imo)
            if hasattr(model, "imo_number"):
                stmt = stmt.where(model.imo_number == imo_int)
            elif hasattr(model, "generator_id"):
                # GeneratorMonthlyReportHeader has no imo_number column of its own —
                # route through VesselGenerator instead (also covers ae_* alert tables).
                stmt = stmt.join(VesselGenerator, model.generator_id == VesselGenerator.generator_id).where(VesselGenerator.imo_number == imo_int)
            elif hasattr(model, "report_id"):
                if key.startswith("ae_") or key.startswith("generator_"):
                    stmt = (
                        stmt.join(GeneratorMonthlyReportHeader, model.report_id == GeneratorMonthlyReportHeader.report_id)
                        .join(VesselGenerator, GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id)
                        .where(VesselGenerator.imo_number == imo_int)
                    )
                else:
                    stmt = stmt.join(MonthlyReportHeader, model.report_id == MonthlyReportHeader.report_id).where(MonthlyReportHeader.imo_number == imo_int)
            elif hasattr(model, "engine_no"):
                stmt = stmt.join(VesselInfo, model.engine_no == VesselInfo.engine_no).where(VesselInfo.imo_number == imo_int)
            elif hasattr(model, "generator_no"):
                stmt = stmt.join(VesselGenerator, model.generator_no == VesselGenerator.generator_no).where(VesselGenerator.imo_number == imo_int)
            elif hasattr(model, "session_id"):
                # ShopTrialPerformanceData has no imo_number/engine_no of its own —
                # route through ShopTrialSession.engine_no -> VesselInfo.
                stmt = (
                    stmt.join(ShopTrialSession, model.session_id == ShopTrialSession.session_id)
                    .join(VesselInfo, ShopTrialSession.engine_no == VesselInfo.engine_no)
                    .where(VesselInfo.imo_number == imo_int)
                )

        items = (await db.execute(stmt)).scalars().all()
        results[key] = [
            {c.name: getattr(i, c.name) for c in i.__table__.columns}
            for i in items
        ]

    return results