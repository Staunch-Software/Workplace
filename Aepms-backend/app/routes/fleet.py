# app/api/fleet.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from typing import List, Optional
from datetime import datetime, date
import logging

from app.core.database_control import get_control_db as get_db
from app.models import VesselInfo, ShopTrialSession, ShopTrialPerformanceData, MonthlyReportHeader

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/fleet", tags=["fleet"])

@router.get("/")
async def get_fleet(db: Session = Depends(get_db)):
    """Get all vessels with their current status for the fleet overview."""
    try:
        vessels_query = db.query(VesselInfo).all()
        
        fleet_data = []
        for vessel in vessels_query:
            # Get latest monthly report date using imo_number instead of engine_no
            latest_report = db.query(MonthlyReportHeader)\
                .filter_by(imo_number=vessel.imo_number)\
                .order_by(desc(MonthlyReportHeader.report_date))\
                .first()
            
            # Calculate status based on last report date
            status = calculate_vessel_status(vessel, latest_report)
            
            fleet_data.append({
                "id": str(vessel.imo_number),  # Use imo_number as id
                "name": vessel.vessel_name,
                "imo": str(vessel.imo_number),
                "class": vessel.engine_type or "Unknown",
                "status": status,
                "lastReport": latest_report.report_date.strftime("%Y-%m-%d") if latest_report else None
            })
        
        return {"fleet": fleet_data}
    
    except Exception as e:
        logger.error(f"Error fetching fleet data: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch fleet data")

def calculate_vessel_status(vessel: VesselInfo, latest_report) -> str:
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