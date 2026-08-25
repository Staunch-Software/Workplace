# app/api/v1/endpoints/vessels.py
# Vessel sync-status endpoints for the Report Tracker.
# Mirrors DRS app/api/v1/endpoints/vessels.py — provides:
#   GET /vessels/sync-status/all   → summary row per vessel (for Vessel Status table)
#   GET /vessels/{imo}/sync-log    → detailed sync log + active errors (for drawer)
import json
import traceback

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import text

from app.core.database import get_db
from app.core.database_control import get_control_db
from app.models.sync import SyncState

router = APIRouter(prefix="/vessels", tags=["Vessels"])

SYNC_SCOPE = "REPORTS"
MODULE_KEY = "reports"


# ---------------------------------------------------------------------------
# Helper: load a vessel row from the control DB (raw SQL, same as sync.py)
# ---------------------------------------------------------------------------

async def _get_vessel(control_db: AsyncSession, imo: str):
    """Return a mapping of vessel columns from the control DB, or None."""
    res = await control_db.execute(
        text("SELECT imo, name, module_error_counts, last_sync_success, last_sync_error "
             "FROM vessels WHERE imo = :imo"),
        {"imo": imo},
    )
    return res.mappings().fetchone()


# ---------------------------------------------------------------------------
# GET /vessels/sync-status/all
# Returns a dict keyed by IMO with lightweight sync summary for every vessel.
# Consumed by the Vessel Status modal in the Workplace frontend (every 30s).
# ---------------------------------------------------------------------------

@router.get("/sync-status/all")
async def get_all_vessel_sync_status(
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    try:
        # All vessels from the shared control DB
        vessels_res = await control_db.execute(
            text("SELECT imo, name, module_error_counts FROM vessels ORDER BY name")
        )
        vessels = vessels_res.mappings().fetchall()

        # All report-tracker sync states from the module DB
        ss_res = await db.execute(
            select(SyncState).where(SyncState.sync_scope == SYNC_SCOPE)
        )
        sync_states = {s.vessel_imo: s for s in ss_res.scalars().all()}

        result = {}
        for v in vessels:
            imo = v["imo"]
            state = sync_states.get(imo)
            active_errors = (state.active_errors or []) if state else []

            counts_map = v["module_error_counts"] or {}
            report_count = counts_map.get(MODULE_KEY, 0)

            result[imo] = {
                "name": v["name"],
                "last_sync_success": (report_count == 0 and len(active_errors) == 0),
                "failed_items_count": max(report_count, len(active_errors)),
                "latest_error": active_errors[0] if active_errors else None,
                "vessel_reported_push": state.last_push_at if state else None,
                "vessel_reported_pull": state.last_pull_at if state else None,
            }

        return result

    except Exception as e:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# GET /vessels/{imo}/sync-log
# Returns detailed sync stats + active errors for one vessel.
# Consumed by the slide-out drawer in the Vessel Status modal.
# ---------------------------------------------------------------------------

@router.get("/{imo}/sync-log")
async def get_vessel_sync_log(
    imo: str,
    db: AsyncSession = Depends(get_db),
    control_db: AsyncSession = Depends(get_control_db),
):
    # 1. High-level vessel info from control DB
    vessel = await _get_vessel(control_db, imo)
    if not vessel:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} not found")

    # 2. Module-specific sync state from Reports DB
    ss_res = await db.execute(
        select(SyncState).where(
            SyncState.vessel_imo == imo,
            SyncState.sync_scope == SYNC_SCOPE,
        )
    )
    sync_state = ss_res.scalar_one_or_none()

    active_errors = (sync_state.active_errors or []) if sync_state else []

    counts_map = vessel["module_error_counts"] or {}
    report_count = counts_map.get(MODULE_KEY, 0)

    return {
        "imo": imo,
        "name": vessel["name"],
        "last_sync_success": vessel["last_sync_success"],

        # Live timestamps
        "vessel_reported_push": sync_state.last_push_at if sync_state else None,
        "vessel_reported_pull": sync_state.last_pull_at if sync_state else None,

        "active_errors": active_errors,
        "failed_items_count": max(report_count, len(active_errors)),

        "error_history": (
            json.loads(vessel["last_sync_error"])
            if vessel["last_sync_error"]
            else []
        ),
    }
