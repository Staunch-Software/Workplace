# app/routes/fleet.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Optional
from datetime import datetime, date
import logging

from app.core.database_control import get_control_db  # workplace_control DB → vessels table
from app.database import get_db as get_aepms_db       # workplace_engine DB → MonthlyReportHeader
from app.models import VesselInfo, ShopTrialSession, ShopTrialPerformanceData, MonthlyReportHeader
from app.model.control.vessel import Vessel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fleet", tags=["fleet"])


@router.get("/")
async def get_fleet(
    control_db: Session = Depends(get_control_db),  # vessels table lives here
    aepms_db: Session = Depends(get_aepms_db),      # MonthlyReportHeader lives here
):
    """Get all vessels with their current status for the fleet overview."""
    try:
        vessels_query = control_db.query(Vessel).all()  # query vessels from control DB

        fleet_data = []
        for vessel in vessels_query:
            # Get latest monthly report date — must use aepms_db, not control_db
            # Also cast vessel.imo (String) to int to match imo_number (Integer) column
            try:
                imo_int = int(vessel.imo)
            except (ValueError, TypeError):
                imo_int = None

            latest_report = None
            if imo_int is not None:
                latest_report = aepms_db.query(MonthlyReportHeader)\
                    .filter(MonthlyReportHeader.imo_number == imo_int)\
                    .order_by(desc(MonthlyReportHeader.report_date))\
                    .first()

            # Calculate status based on last report date
            status = calculate_vessel_status(vessel, latest_report)

            fleet_data.append({
                "id": str(vessel.imo),
                "name": vessel.name,
                "imo": str(vessel.imo),
                "class": vessel.vessel_type or "Unknown",
                "status": status,
                "lastReport": latest_report.report_date.strftime("%Y-%m-%d") if latest_report else None
            })

        return {"fleet": fleet_data}

    except Exception as e:
        logger.error(f"Error fetching fleet data: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to fetch fleet data")


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