# ============================================================
# VESSEL SYNC ROUTES — VP shore-side pull & vessel status endpoint
# ============================================================
# Vessels pull VP data from the shore server using this endpoint,
# and send heartbeats / telemetry to report vessel sync status.
# Auth: X-Sync-API-Key header (vessels authenticate with API key).
# ============================================================

import os
import json
import logging
from datetime import datetime, date
from typing import Optional, Any, Dict, List
from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect, text

from backend.database import SessionLocal
from backend.auth import _get_control_engine
from backend.models import (
    Vessel,
    VesselParticulars,
    AnalysisData,
    FleetStatusData,
    VesselDesignData,
    ISO19030Result,
    VesselCPConfig,
    CPVesselDescription,
    CPSeaWarranty,
    CPPortWarranty,
    MariAppsBunkerReport,
    BiofuelPoS,
    BiofuelBunkerStem,
    ExpandedColumnMetadata,
    UserColumnPreference,
    VesselColumnDefault,
)

log = logging.getLogger("uvicorn")

MODULE_KEY = "vessel_performance"

# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/vessel-sync", tags=["vessel-sync"])

# ── API-Key auth ─────────────────────────────────────────────────────────────
sync_api_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(sync_api_key_header)) -> str:
    """Validate the X-Sync-API-Key header against SYNC_API_KEY env var."""
    expected = os.environ.get("SYNC_API_KEY", "change-me-in-production")
    if api_key != expected:
        raise HTTPException(status_code=401, detail="Invalid Sync API Key")
    return api_key


# ── Helpers ───────────────────────────────────────────────────────────────────

def get_db():
    """Yield a synchronous SQLAlchemy session on vessel_perf DB."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _row_to_dict(row) -> dict:
    """Convert a SQLAlchemy ORM row to a plain Python dict."""
    mapper = sa_inspect(type(row))
    result = {}
    for col in mapper.columns:
        val = getattr(row, col.key)
        if isinstance(val, (datetime, date)):
            val = val.isoformat()
        result[col.key] = val
    return result


def _parse_since(since: Optional[str]) -> Optional[datetime]:
    if not since:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d"):
        try:
            return datetime.strptime(since, fmt)
        except ValueError:
            continue
    raise HTTPException(
        status_code=422,
        detail=f"Cannot parse 'since' value {since!r}. Use ISO-8601 format: YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS",
    )


# ── Vessel Status & Telemetry Tracker ────────────────────────────────────────

def record_vessel_sync_time(
    imo: str,
    is_vessel_pushing: bool,
    error_msg: Optional[str] = None,
    telemetry: Optional[dict] = None,
) -> None:
    """
    Updates the vessel's row in the control database (`vessels` table),
    recording sync timestamps, module_status['vessel_performance'] = True,
    and error counts so the Shore Admin / Navbar Vessel Status reflects VP sync.
    Never raises — failures are logged.
    """
    if not imo:
        return
    now = datetime.utcnow()
    now_iso = now.isoformat()

    try:
        engine = _get_control_engine()
        with engine.begin() as conn:
            row = conn.execute(
                text("SELECT id, imo, module_status, module_error_counts, total_error_count, last_sync_error FROM vessels WHERE imo = :imo"),
                {"imo": imo},
            ).first()
            if not row:
                return

            module_status = dict(row.module_status or {})
            module_status[MODULE_KEY] = True

            reported_count = telemetry.get("failed_items_count", 0) if telemetry else None
            active_errors = telemetry.get("active_errors", []) if telemetry else []
            if error_msg:
                active_errors.insert(0, {"entity": "VP-Sync", "msg": error_msg, "ts": now_iso})
                reported_count = max(reported_count or 0, len(active_errors))

            counts = dict(row.module_error_counts or {})
            if reported_count is not None:
                counts[MODULE_KEY] = reported_count
            total_errors = sum(counts.values()) if counts else 0
            last_sync_success = (total_errors == 0)

            # Tagged error history
            history_json = row.last_sync_error
            if active_errors:
                try:
                    history = json.loads(row.last_sync_error) if row.last_sync_error else []
                    msg = active_errors[0].get("msg", "")
                    if not history or history[0].get("msg") != msg:
                        history.insert(0, {
                            "module": MODULE_KEY.upper(),
                            "type": "vessel_error",
                            "msg": msg,
                            "ts": now_iso,
                        })
                        history_json = json.dumps(history[:50])
                except Exception:
                    pass

            time_col = "last_push_at" if is_vessel_pushing else "last_pull_at"
            conn.execute(
                text(f"""
                    UPDATE vessels
                    SET updated_at = :now,
                        {time_col} = :now,
                        module_status = :module_status,
                        module_error_counts = :counts,
                        total_error_count = :total_errors,
                        last_sync_success = :last_sync_success,
                        last_sync_error = :history_json
                    WHERE imo = :imo
                """),
                {
                    "now": now,
                    "module_status": json.dumps(module_status),
                    "counts": json.dumps(counts),
                    "total_errors": total_errors,
                    "last_sync_success": last_sync_success,
                    "history_json": history_json,
                    "imo": imo,
                },
            )
            log.info("[VP SYNC] Updated vessel status for IMO %s (push=%s)", imo, is_vessel_pushing)
    except Exception as exc:
        log.warning("[VP SYNC] Failed to update control DB vessel row for IMO %s: %s", imo, exc)


# ── Heartbeat endpoint ────────────────────────────────────────────────────────

class HeartbeatPayload(BaseModel):
    vessel_imo: str
    vessel_telemetry: Optional[Dict[str, Any]] = None


@router.post("/heartbeat")
def receive_heartbeat(
    payload: HeartbeatPayload,
    _key: str = Security(verify_sync_key),
):
    """Vessels send heartbeats and telemetry to report their VP sync state."""
    record_vessel_sync_time(
        payload.vessel_imo,
        is_vessel_pushing=True,
        telemetry=payload.vessel_telemetry,
    )
    return {
        "status": "ok",
        "server_time": datetime.utcnow().isoformat() + "Z",
    }


# ── Snapshot endpoint ─────────────────────────────────────────────────────────

@router.get("/vp/snapshot")
def get_vp_snapshot(
    vessel_imo: str = Query(..., description="Vessel IMO number"),
    since: Optional[str] = Query(
        None,
        description="Only return rows updated after this ISO-8601 datetime. Omit to fetch all rows.",
    ),
    _key: str = Security(verify_sync_key),
    db: Session = Depends(get_db),
):
    """Return a full VP data snapshot for a single vessel and records sync telemetry."""
    since_dt = _parse_since(since)

    # Record that the vessel just pulled data
    record_vessel_sync_time(vessel_imo, is_vessel_pushing=False)

    try:
        # Helper to query safely
        def safe_query(model, *filters):
            try:
                q = db.query(model)
                for f in filters:
                    q = q.filter(f)
                return [_row_to_dict(r) for r in q.all()]
            except Exception as e:
                log.warning("[VP SYNC] Table query failed for %s: %s", model.__name__, e)
                return []

        # 1. Vessel Master & Particulars
        vessel_rows = safe_query(Vessel, Vessel.imo_number == vessel_imo)
        particulars_rows = safe_query(VesselParticulars, VesselParticulars.vessel_imo == vessel_imo)

        # 2. AnalysisData
        an_filters = [AnalysisData.vessel_imo == vessel_imo]
        if since_dt:
            an_filters.append(AnalysisData.Date >= since_dt.date())
        analysis_rows = safe_query(AnalysisData, *an_filters)

        # 3. FleetStatusData
        fleet_filters = [FleetStatusData.imo == vessel_imo]
        if since_dt:
            fleet_filters.append(FleetStatusData.scraped_at >= since_dt)
        fleet_rows = safe_query(FleetStatusData, *fleet_filters)

        # 4. VesselDesignData
        design_filters = [VesselDesignData.vessel_imo == vessel_imo]
        if since_dt:
            design_filters.append(VesselDesignData.updated_at >= since_dt)
        design_rows = safe_query(VesselDesignData, *design_filters)

        # 5. ISO19030Result
        iso_filters = [ISO19030Result.vessel_imo == vessel_imo]
        if since_dt:
            iso_filters.append(ISO19030Result.record_date >= since_dt.date())
        iso_rows = safe_query(ISO19030Result, *iso_filters)

        # 6. VesselCPConfig & Warranties
        cp_filters = [VesselCPConfig.vessel_imo == vessel_imo]
        if since_dt:
            cp_filters.append(VesselCPConfig.updated_at >= since_dt)
        cp_rows = safe_query(VesselCPConfig, *cp_filters)

        cp_desc_rows = safe_query(CPVesselDescription, CPVesselDescription.vessel_imo == vessel_imo)
        cp_sea_rows = safe_query(CPSeaWarranty, CPSeaWarranty.vessel_imo == vessel_imo)
        cp_port_rows = safe_query(CPPortWarranty, CPPortWarranty.vessel_imo == vessel_imo)

        # 7. Bunker reports
        bunker_filters = [MariAppsBunkerReport.vessel_imo == vessel_imo]
        if since_dt:
            bunker_filters.append(MariAppsBunkerReport.scraped_at >= since_dt)
        bunker_rows = safe_query(MariAppsBunkerReport, *bunker_filters)

        # 8. Biofuel
        biofuel_stems = safe_query(BiofuelBunkerStem, BiofuelBunkerStem.vessel_imo == vessel_imo)
        biofuel_pos = safe_query(BiofuelPoS, BiofuelPoS.vessel_imo == vessel_imo)

        # 9. Column configs & preferences
        col_metadata = safe_query(ExpandedColumnMetadata)
        col_prefs = safe_query(UserColumnPreference)
        col_defaults = safe_query(VesselColumnDefault, VesselColumnDefault.vessel_imo == vessel_imo)

    except Exception as exc:
        log.error("vessel-sync snapshot DB error for IMO %s: %s", vessel_imo, exc, exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="Database error while building VP snapshot.",
        )

    return {
        "vessel_imo": vessel_imo,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "since_filter": since,
        "snapshot": {
            "vessels": vessel_rows,
            "vessel_particulars": particulars_rows,
            "analysis_data": analysis_rows,
            "fleet_status": fleet_rows,
            "vessel_design": design_rows,
            "iso19030_results": iso_rows,
            "cp_config": cp_rows,
            "cp_vessel_description": cp_desc_rows,
            "cp_sea_warranties": cp_sea_rows,
            "cp_port_warranties": cp_port_rows,
            "bunker_reports": bunker_rows,
            "biofuel_bunker_stems": biofuel_stems,
            "biofuel_pos": biofuel_pos,
            "expanded_columns": col_metadata,
            "column_preferences": col_prefs,
            "column_defaults": col_defaults,
        },
    }
