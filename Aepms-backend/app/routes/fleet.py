# app/routes/fleet.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Optional
from datetime import datetime, date
import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database_control import get_control_db  # workplace_control DB → vessels table
from app.database import get_db as get_aepms_db       # workplace_engine DB → MonthlyReportHeader
from app.models import VesselInfo, ShopTrialSession, ShopTrialPerformanceData, MonthlyReportHeader
from app.model.control.vessel import Vessel
from app.routes.auth import get_current_user           # ← added: JWT payload
from app.core.permissions import get_allowed_vessel_imos    # ← added: permission helper

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fleet", tags=["fleet"])


@router.get("/")
async def get_fleet(
    current_user: dict = Depends(get_current_user),    # ← added
    control_db: AsyncSession = Depends(get_control_db),
    aepms_db: AsyncSession = Depends(get_aepms_db),
):
    """Get all vessels with their current status for the fleet overview."""
    try:
        # ── permission gate ──────────────────────────────────────────────────
        allowed_imos, role = await get_allowed_vessel_imos(current_user)
        logger.info(
            f"Fleet request — user={current_user.get('id')} "
            f"role={role} allowed_imos={allowed_imos}"
        )

        if allowed_imos is not None and len(allowed_imos) == 0:
            # User is authenticated but has no vessels assigned yet
            return {"fleet": []}
        # ────────────────────────────────────────────────────────────────────

        from sqlalchemy import select
        result = await control_db.execute(select(Vessel))
        vessels_query = result.scalars().all()

        # Filter in Python after fetching — keeps all your existing logic intact.
        # allowed_imos == None would mean "no filter applied" but our helper
        # always returns a list, so the check above already handles the empty case.
        if allowed_imos:
            allowed_set = set(allowed_imos)          # O(1) lookup
            vessels_query = [
                v for v in vessels_query
                if _safe_int(v.imo) in allowed_set
            ]

        fleet_data = []
        for vessel in vessels_query:
            imo_int = _safe_int(vessel.imo)

            latest_report = None
            if imo_int is not None:
                result = await aepms_db.execute(
                    select(MonthlyReportHeader)
                    .where(MonthlyReportHeader.imo_number == imo_int)
                    .order_by(desc(MonthlyReportHeader.report_date))
                )
                latest_report = result.scalars().first()

            status = calculate_vessel_status(vessel, latest_report)

            fleet_data.append({
                "id": str(vessel.imo),
                "name": vessel.name,
                "imo": str(vessel.imo),
                "class": vessel.vessel_type or "Unknown",
                "status": status,
                "lastReport": (
                    latest_report.report_date.strftime("%Y-%m-%d")
                    if latest_report else None
                ),
            })

        return {"fleet": fleet_data}

    except Exception as e:
        logger.error(f"Error fetching fleet data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch fleet data")


# ── helpers ──────────────────────────────────────────────────────────────────

def _safe_int(value) -> Optional[int]:
    """Convert a value to int safely; return None on failure."""
    try:
        return int(value)
    except (ValueError, TypeError):
        return None


def calculate_vessel_status(vessel: Vessel, latest_report) -> str:
    """Calculate vessel status based on latest report data."""
    if not latest_report:
        return "Alert"

    days_since_report = (date.today() - latest_report.report_date).days

    if days_since_report > 60:
        return "Alert"
    elif days_since_report > 30:
        return "Watch"

    if latest_report.load_percent and float(latest_report.load_percent) > 85:
        return "Watch"

    return "Healthy"