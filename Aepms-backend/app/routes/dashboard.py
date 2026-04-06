# app/routes/dashboard.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, distinct, func, select
from typing import Dict, List, Optional
import logging
import math
from datetime import datetime, date

# ── Dual DB sessions ──────────────────────────────────────────────────────────
# control_db  → workplace_backend  (Vessel master list)
# aepms_db    → workplace_engine   (VesselInfo, shop trial, reports …)
from app.core.database_control import get_control_db
from app.database import get_db as get_aepms_db

# ── Models ────────────────────────────────────────────────────────────────────
from app.model.control.vessel import Vessel                        # workplace vessels table
from app.models import (
    VesselInfo,
    MonthlyReportHeader,
    ShopTrialPerformanceData,
    ShopTrialSession,
)
from app.generator_models import GeneratorBaselineData             # AE baseline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


# ─────────────────────────────────────────────────────────────────────────────
# PRIVATE HELPER — safe IMO string → int
# vessels.imo  is VARCHAR(7)
# vessel_info.imo_number is INTEGER
# They are in different databases so we convert in Python, not SQL
# ─────────────────────────────────────────────────────────────────────────────
def _imo_to_int(imo_str: str) -> Optional[int]:
    try:
        return int(imo_str)
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# GET /api/dashboard/kpis
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/kpis")
async def get_dashboard_kpis(
    ship_id: Optional[str] = Query(None),
    control_db: AsyncSession = Depends(get_control_db),      # workplace vessels
    aepms_db: AsyncSession = Depends(get_aepms_db),          # vessel_info / reports
):
    """
    Get fleet-wide KPIs for dashboard.

    Total Fleet Ships  → workplace  'vessels'  table  (master list)
    ME Configured      → vessel_info  ⋈  shop_trial_session
    AE Configured      → vessel_info  ⋈  generator_baseline_data
    Config Gaps        → fleet vessels not yet configured
    Fleet Health       → based on latest monthly report dates
    Baseline Series    → shop trial performance data for charts
    """
    try:
        logger.info(f"Dashboard KPIs requested for ship_id: {ship_id}")

        # ── 1. TOTAL FLEET from workplace vessels ─────────────────────────────
        result = await control_db.execute(select(Vessel).where(Vessel.is_active == True))
        all_vessels = result.scalars().all()
        total_fleet = len(all_vessels)

        # Integer IMO set for cross-DB comparisons
        fleet_imo_set = {
            imo_int
            for v in all_vessels
            for imo_int in [_imo_to_int(v.imo)]
            if imo_int is not None
        }

        # ── 2. ME CONFIGURED ─────────────────────────────────────────────────
        result = await aepms_db.execute(
            select(distinct(VesselInfo.imo_number)).join(
                ShopTrialSession,
                VesselInfo.engine_no == ShopTrialSession.engine_no
            )
        )
        me_configured_rows = result.all()
        me_configured_set = {row[0] for row in me_configured_rows}
        me_configured_count = len(me_configured_set & fleet_imo_set)

        # ── 3. AE CONFIGURED ─────────────────────────────────────────────────
        result = await aepms_db.execute(
            select(distinct(VesselInfo.imo_number)).join(
                GeneratorBaselineData,
                VesselInfo.imo_number == GeneratorBaselineData.imo_number
            )
        )
        ae_configured_rows = result.all()
        ae_configured_set = {row[0] for row in ae_configured_rows}
        ae_configured_count = len(ae_configured_set & fleet_imo_set)

        # ── 4. CONFIG GAPS ────────────────────────────────────────────────────
        result = await aepms_db.execute(select(VesselInfo.imo_number))
        all_vessel_info_imos = {row[0] for row in result.all()}
        unregistered      = fleet_imo_set - all_vessel_info_imos
        me_not_configured = (fleet_imo_set & all_vessel_info_imos) - me_configured_set
        ae_not_configured = (fleet_imo_set & all_vessel_info_imos) - ae_configured_set
        total_config_gaps = len(unregistered) + len(me_not_configured) + len(ae_not_configured)

        # ── 5. UNCONFIGURED LISTS (for dashboard tables) ──────────────────────
        result = await aepms_db.execute(
            select(VesselInfo).where(
                VesselInfo.imo_number.notin_(me_configured_set),
                VesselInfo.imo_number.in_(fleet_imo_set),
            )
        )
        me_unconfigured_vessels = result.scalars().all()

        result = await aepms_db.execute(
            select(VesselInfo).where(
                VesselInfo.imo_number.notin_(ae_configured_set),
                VesselInfo.imo_number.in_(fleet_imo_set),
            )
        )
        ae_unconfigured_vessels = result.scalars().all()

        # ── 6. FLEET HEALTH ───────────────────────────────────────────────────
        health_counts = {"Healthy": 0, "Watch": 0, "Alert": 0}
        for vessel in all_vessels:
            imo_int = _imo_to_int(vessel.imo)
            if not imo_int:
                continue
            result = await aepms_db.execute(
                select(MonthlyReportHeader)
                .where(MonthlyReportHeader.imo_number == imo_int)
                .order_by(desc(MonthlyReportHeader.report_date))
            )
            latest_report = result.scalars().first()
            status = calculate_vessel_status(None, latest_report)   # vessel arg unused
            health_counts[status] += 1

        # ── 7. BASELINE SERIES for charts (unchanged logic) ───────────────────
        baseline_data = await generate_baseline_series(aepms_db, ship_id)
        logger.info(f"Generated baseline data keys: {list(baseline_data.keys())}")
        kpi_load = 75
        kpi_sfoc = interpolate_value(baseline_data.get("SFOC", []), kpi_load)
        kpi_pmax = interpolate_value(baseline_data.get("Pmax", []), kpi_load)

        return {
            # ── NEW fleet-level counts ────────────────────────────────────────
            "total_fleet_ships":   total_fleet,
            "me_configured_ships": me_configured_count,
            "ae_configured_ships": ae_configured_count,
            "config_gaps":         total_config_gaps,
            "me_unconfigured_list": [
                {
                    "id":     str(v.imo_number),
                    "imo":    str(v.imo_number),
                    "name":   v.vessel_name,
                    "status": "ME Not Configured",
                }
                for v in me_unconfigured_vessels
            ],
            "ae_unconfigured_list": [
                {
                    "id":     str(v.imo_number),
                    "imo":    str(v.imo_number),
                    "name":   v.vessel_name,
                    "status": "AE Not Configured",
                }
                for v in ae_unconfigured_vessels
            ],
            # ── ORIGINAL fleet_health block (preserved) ───────────────────────
            "fleet_health": {
                "healthy_count": health_counts["Healthy"],
                "watch_count":   health_counts["Watch"],
                "alert_count":   health_counts["Alert"],
                "total_count":   total_fleet,
            },
            # ── ORIGINAL KPI / chart fields (preserved) ───────────────────────
            "kpi_load":       kpi_load,
            "kpi_sfoc":       kpi_sfoc,
            "kpi_pmax":       kpi_pmax,
            "baseline_series": baseline_data,
            "selected_ship_id": ship_id,
        }

    except Exception as e:
        logger.error(f"Error fetching dashboard KPIs: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch dashboard KPIs")


# ─────────────────────────────────────────────────────────────────────────────
# HELPER — vessel status  (signature preserved, vessel arg kept for compat)
# ─────────────────────────────────────────────────────────────────────────────
def calculate_vessel_status(vessel: Optional[VesselInfo], latest_report) -> str:
    """Calculate status for a single vessel."""
    if not latest_report:
        return "Alert"

    days_since_report = (date.today() - latest_report.report_date).days

    if days_since_report > 60:
        return "Alert"
    elif days_since_report > 30:
        return "Watch"

    return "Healthy"


# ─────────────────────────────────────────────────────────────────────────────
# HELPER — baseline series  (logic 100 % preserved, only db arg renamed)
# ─────────────────────────────────────────────────────────────────────────────
async def generate_baseline_series(db: AsyncSession, vessel_imo: Optional[str] = None) -> Dict:
    """Get real baseline data from shop trial performance data."""
    if vessel_imo:
        try:
            result = await db.execute(select(VesselInfo).where(VesselInfo.imo_number == int(vessel_imo)))
            vessel = result.scalar_one_or_none()
            if vessel:
                logger.info(f"Found vessel: {vessel.vessel_name}, engine_no: {vessel.engine_no}")
                result = await db.execute(select(ShopTrialSession).where(ShopTrialSession.engine_no == vessel.engine_no))
                sessions = result.scalars().all()
                logger.info(f"Found {len(sessions)} sessions for engine_no: {vessel.engine_no}")
                session_ids = [s.session_id for s in sessions]
                result = await db.execute(
                    select(ShopTrialPerformanceData).where(
                        ShopTrialPerformanceData.session_id.in_(session_ids)
                    )
                )
                shop_data = result.scalars().all()
                logger.info(f"Found {len(shop_data)} shop trial data points")
            else:
                logger.warning(f"No vessel found for imo_number: {vessel_imo}")
                shop_data = []
        except (ValueError, TypeError) as e:
            logger.error(f"Error processing vessel_imo {vessel_imo}: {e}")
            shop_data = []
    else:
        result = await db.execute(select(VesselInfo))
        first_vessel = result.scalars().first()
        if first_vessel:
            sessions = db.query(ShopTrialSession).filter_by(engine_no=first_vessel.engine_no).all()
            session_ids = [s.session_id for s in sessions]
            shop_data = db.query(ShopTrialPerformanceData).filter(
                ShopTrialPerformanceData.session_id.in_(session_ids)
            ).all()
        else:
            shop_data = []

    column_mapping = {
        "SFOC":              "fuel_oil_consumption_iso_g_kwh",
        "Pmax":              "max_combustion_pressure_iso_bar",
        "Turbospeed":        "turbocharger_speed_x1000_iso_rpm",
        "EngSpeed":          "engine_speed_rpm",
        "ScavAir":           "scav_air_pressure_iso_kg_cm2",
        "Exh_T/C_inlet":     "exh_temp_tc_inlet_iso_c",
        "Exh_Cylinder_outlet": "exh_temp_cylinder_outlet_ave_c",
        "Exh_T/C_outlet":    "exh_temp_tc_outlet_iso_c",
        "FIPI":              "fuel_injection_pump_index_mm",
        "FOC":               "fuel_oil_consumption_kg_h",
    }

    series = {}
    for metric, db_column in column_mapping.items():
        load_groups = {}
        for data in shop_data:
            if hasattr(data, "load_percentage") and hasattr(data, db_column):
                load_val   = getattr(data, "load_percentage")
                metric_val = getattr(data, db_column)
                if load_val is not None and metric_val is not None:
                    load_key = round(float(load_val), 1)
                    if load_key not in load_groups:
                        load_groups[load_key] = []
                    load_groups[load_key].append(float(metric_val))

        series[metric] = []
        for load_key, values in sorted(load_groups.items()):
            avg_value = sum(values) / len(values)
            series[metric].append({"load": load_key, "value": avg_value})

    return series


# ─────────────────────────────────────────────────────────────────────────────
# HELPER — interpolation  (100 % preserved)
# ─────────────────────────────────────────────────────────────────────────────
def interpolate_value(series_data: List[Dict], target_load: float) -> float:
    """Interpolate baseline value at specific load."""
    if not series_data:
        return 0.0

    sorted_data = sorted(series_data, key=lambda x: x["load"])

    for i in range(len(sorted_data) - 1):
        current    = sorted_data[i]
        next_point = sorted_data[i + 1]

        if current["load"] <= target_load <= next_point["load"]:
            t = (target_load - current["load"]) / (next_point["load"] - current["load"])
            return round(current["value"] + t * (next_point["value"] - current["value"]), 1)

    return (
        sorted_data[0]["value"]
        if target_load <= sorted_data[0]["load"]
        else sorted_data[-1]["value"]
    )