# app/routes/dashboard.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc
from typing import Dict, List, Optional
import logging
import math
from datetime import datetime, date

from app.database import get_db
from app.models import VesselInfo, MonthlyReportHeader, ShopTrialPerformanceData, ShopTrialSession

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

@router.get("/kpis")
async def get_dashboard_kpis(ship_id: Optional[str] = Query(None), db: Session = Depends(get_db)):
    """Get fleet-wide KPIs for dashboard."""
    try:
        logger.info(f"Dashboard KPIs requested for ship_id: {ship_id}")
        all_vessels = db.query(VesselInfo).all()
        
        # Calculate fleet health
        health_counts = {"Healthy": 0, "Watch": 0, "Alert": 0}
        
        for vessel in all_vessels:
            # Use imo_number instead of engine_no
            latest_report = db.query(MonthlyReportHeader)\
                .filter_by(imo_number=vessel.imo_number)\
                .order_by(desc(MonthlyReportHeader.report_date))\
                .first()
            
            status = calculate_vessel_status(vessel, latest_report)
            health_counts[status] += 1
        
        # Generate baseline data
        baseline_data = generate_baseline_series(db, ship_id)
        logger.info(f"Generated baseline data keys: {list(baseline_data.keys())}")
        kpi_load = 75
        kpi_sfoc = interpolate_value(baseline_data.get("SFOC", []), kpi_load)
        kpi_pmax = interpolate_value(baseline_data.get("Pmax", []), kpi_load)
                
        return {
            "fleet_health": {
                "healthy_count": health_counts["Healthy"],
                "watch_count": health_counts["Watch"],
                "alert_count": health_counts["Alert"],
                "total_count": len(all_vessels)
            },
            "kpi_load": kpi_load,
            "kpi_sfoc": kpi_sfoc,
            "kpi_pmax": kpi_pmax,
            "baseline_series": baseline_data,
            "selected_ship_id": ship_id
        }
    
    except Exception as e:
        logger.error(f"Error fetching dashboard KPIs: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch dashboard KPIs")

def calculate_vessel_status(vessel: VesselInfo, latest_report) -> str:
    """Calculate status for a single vessel."""
    if not latest_report:
        return "Alert"
    
    days_since_report = (date.today() - latest_report.report_date).days
    
    if days_since_report > 60:
        return "Alert"
    elif days_since_report > 30:
        return "Watch"
    
    return "Healthy"

def generate_baseline_series(db: Session, vessel_imo:Optional[str] = None) -> Dict:
    """Get real baseline data from shop trial performance data."""
    # Query shop trial data grouped by load
    if vessel_imo:
        try:
            vessel = db.query(VesselInfo).filter_by(imo_number=int(vessel_imo)).first()
            if vessel:
                logger.info(f"Found vessel: {vessel.vessel_name}, engine_no: {vessel.engine_no}")
                sessions = db.query(ShopTrialSession).filter_by(engine_no=vessel.engine_no).all()
                logger.info(f"Found {len(sessions)} sessions for engine_no: {vessel.engine_no}")
                session_ids = [s.session_id for s in sessions]
                shop_data = db.query(ShopTrialPerformanceData).filter(ShopTrialPerformanceData.session_id.in_(session_ids)).all()
                logger.info(f"Found {len(shop_data)} shop trial data points")
            else:
                logger.warning(f"No vessel found for imo_number: {vessel_imo}")
                shop_data = []
        except (ValueError, TypeError) as e:
            logger.error(f"Error processing vessel_imo {vessel_imo}: {e}")
            shop_data = []
    else:
        first_vessel = db.query(VesselInfo).first()
        if first_vessel:
            sessions = db.query(ShopTrialSession).filter_by(engine_no=first_vessel.engine_no).all()
            session_ids = [s.session_id for s in sessions]
            shop_data = db.query(ShopTrialPerformanceData).filter(ShopTrialPerformanceData.session_id.in_(session_ids)).all()
        else:
            shop_data = []
    
    series = {}
    column_mapping = {
        "SFOC": "fuel_oil_consumption_iso_g_kwh",
        "Pmax": "max_combustion_pressure_iso_bar", 
        "Turbospeed": "turbocharger_speed_x1000_iso_rpm",
        "EngSpeed": "engine_speed_rpm",
        "ScavAir": "scav_air_pressure_iso_kg_cm2",
        "Exh_T/C_inlet": "exh_temp_tc_inlet_iso_c",
        "Exh_Cylinder_outlet": "exh_temp_cylinder_outlet_ave_c",
        "Exh_T/C_outlet": "exh_temp_tc_outlet_iso_c", 
        "FIPI": "fuel_injection_pump_index_mm",
        "FOC": "fuel_oil_consumption_kg_h"
    }
    
    for metric, db_column in column_mapping.items():
        load_groups = {}
        for data in shop_data:
            if hasattr(data, 'load_percentage') and hasattr(data, db_column):
                load_val = getattr(data, 'load_percentage')
                metric_val = getattr(data, db_column)
                if load_val is not None and metric_val is not None:
                    load_key = round(float(load_val), 1)
                    if load_key not in load_groups:
                        load_groups[load_key] = []
                    load_groups[load_key].append(float(metric_val))
        
        series[metric] = []
        for load_key, values in sorted(load_groups.items()):
            avg_value = sum(values) / len(values)
            series[metric].append({
                "load": load_key,
                "value": avg_value
            })
    
    return series

def interpolate_value(series_data: List[Dict], target_load: float) -> float:
    """Interpolate baseline value at specific load."""
    if not series_data:
        return 0.0
    
    sorted_data = sorted(series_data, key=lambda x: x["load"])
    
    for i in range(len(sorted_data) - 1):
        current = sorted_data[i]
        next_point = sorted_data[i + 1]
        
        if current["load"] <= target_load <= next_point["load"]:
            t = (target_load - current["load"]) / (next_point["load"] - current["load"])
            return round(current["value"] + t * (next_point["value"] - current["value"]), 1)
    
    return sorted_data[0]["value"] if target_load <= sorted_data[0]["load"] else sorted_data[-1]["value"]