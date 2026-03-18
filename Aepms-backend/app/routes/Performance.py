# app/routes/Performance.py
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from sqlalchemy import desc, extract
from typing import Dict, Any, Optional
import pandas as pd
import io
import logging
import math
from datetime import datetime, date

from app.database import get_db
from app.models import (
    VesselInfo, 
    ShopTrialSession, 
    ShopTrialPerformanceData, 
    MonthlyReportHeader, 
    MonthlyReportDetailsJsonb,
    MEAlertSummary,
    MECriticalAlert,
    MEWarningAlert,
    MENormalStatus
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/performance", tags=["performance"])

@router.get("/{vessel_id}/baseline")
async def get_baseline_performance(vessel_id: str, db: Session = Depends(get_db)):
    """Get baseline performance data for charts."""
    try:
        # Resolve vessel_id (IMO number) to engine_no, then fetch session and performance rows
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == int(vessel_id)).first()
        if not vessel:
            raise HTTPException(status_code=404, detail=f"Vessel with IMO {vessel_id} not found")

        sessions = db.query(ShopTrialSession) \
            .filter(ShopTrialSession.engine_no == vessel.engine_no) \
            .order_by(desc(ShopTrialSession.trial_date)) \
            .all()
        if not sessions:
            raise HTTPException(status_code=404, detail="No shop trial sessions found")

        session_id = sessions[0].session_id
        shop_data = db.query(ShopTrialPerformanceData) \
            .filter(ShopTrialPerformanceData.session_id == session_id) \
            .order_by(ShopTrialPerformanceData.load_percentage) \
            .all()

        # Map frontend metric names to actual database column names
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

        # Initialize series
        baseline_series = {metric: [] for metric in column_mapping.keys()}

        # Populate with real data
        for data in shop_data:
            if data.load_percentage:
                for metric, metric_col in column_mapping.items():
                    if hasattr(data, metric_col):
                        value = getattr(data, metric_col)
                        if value is not None:
                            baseline_series[metric].append({
                                "load": float(data.load_percentage),
                                "value": float(value)
                            })
        
        return {
            "vessel_id": vessel_id,
            "baseline_date": None,
            "series": baseline_series
        }
    
    except Exception as e:
        logger.error(f"Error fetching baseline for {vessel_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch baseline performance")


@router.get("/me-dashboard-summary")
async def get_me_dashboard_summary(
    year: int,
    month: Optional[int] = None,
    imo_number: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """
    🎯 CRITICAL ENDPOINT: Returns monthly or daily dominant performance status summary.
    Used by VesselMonthlyPerformance.jsx component.
    
    Query Parameters:
    - year (required): Year (e.g., 2024)
    - month (optional): Month number 1-12 (null = all months)
    - imo_number (optional): Filter by specific vessel IMO
    
    Returns:
    {
        "data": [
            {
                "vessel_name": "GCL Ganga",
                "imo_number": 9481697,
                "report_date": "2024-01-05",
                "report_month": "2024-01",
                "status": "Critical",
                "dominant_parameters": [
                    {
                        "parameter": "max_combustion_pressure_bar",
                        "baseline": 130.5,
                        "actual": 145.2,
                        "deviation_pct": 11.3,
                        "status": "Critical"
                    }
                ]
            }
        ],
        "count": 1
    }
    """
    try:
        logger.info(f"📊 ME Dashboard Summary Request: year={year}, month={month}, imo={imo_number}")
        
        # Build base query - join reports with vessel info
        query = db.query(
            MonthlyReportHeader.report_id,
            MonthlyReportHeader.imo_number,
            MonthlyReportHeader.report_date,
            MonthlyReportHeader.report_month,
            VesselInfo.vessel_name
        ).join(
            VesselInfo, 
            MonthlyReportHeader.imo_number == VesselInfo.imo_number
        ).filter(
            extract('year', MonthlyReportHeader.report_date) == year
        )
        
        # Apply optional filters
        if month is not None:
            query = query.filter(extract('month', MonthlyReportHeader.report_date) == month)
        
        if imo_number is not None:
            query = query.filter(MonthlyReportHeader.imo_number == imo_number)
        
        # Execute query
        reports = query.all()
        
        if not reports:
            logger.warning(f"⚠️ No reports found for year={year}, month={month}, imo={imo_number}")
            return {"data": [], "count": 0}
        
        logger.info(f"✅ Found {len(reports)} reports")
        
        # Fetch alert summaries for these reports (efficient batch query)
        report_ids = [r.report_id for r in reports]
        summaries = db.query(MEAlertSummary).filter(
            MEAlertSummary.report_id.in_(report_ids)
        ).all()
        
        # Create lookup dictionary for O(1) access
        summary_dict = {s.report_id: s for s in summaries}
        
        # Build response with dominant parameters
        response = []
        for report in reports:
            summary = summary_dict.get(report.report_id)
            
            if summary:
                dominant_status = summary.dominant_status
                
                # Fetch top 5 dominant parameters based on status
                dom_params = []
                
                if dominant_status == "Critical":
                    params = db.query(MECriticalAlert).filter_by(
                        report_id=report.report_id
                    ).limit(5).all()
                    
                    dom_params = [{
                        "parameter": p.metric_name,
                        "baseline": float(p.baseline_value) if p.baseline_value else None,
                        "actual": float(p.actual_value) if p.actual_value else None,
                        "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                        "status": "Critical"
                    } for p in params]
                    
                elif dominant_status == "Warning":
                    params = db.query(MEWarningAlert).filter_by(
                        report_id=report.report_id
                    ).limit(5).all()
                    
                    dom_params = [{
                        "parameter": p.metric_name,
                        "baseline": float(p.baseline_value) if p.baseline_value else None,
                        "actual": float(p.actual_value) if p.actual_value else None,
                        "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                        "status": "Warning"
                    } for p in params]
                    
                else:  # Normal
                    params = db.query(MENormalStatus).filter_by(
                        report_id=report.report_id
                    ).limit(5).all()
                    
                    dom_params = [{
                        "parameter": p.metric_name,
                        "baseline": float(p.baseline_value) if p.baseline_value else None,
                        "actual": float(p.actual_value) if p.actual_value else None,
                        "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                        "status": "Normal"
                    } for p in params]
            else:
                dominant_status = "No Report"
                dom_params = []
            
            response.append({
                "vessel_name": report.vessel_name,
                "imo_number": report.imo_number,
                "report_date": report.report_date.strftime("%Y-%m-%d"),
                "report_month": report.report_month,
                "status": dominant_status,
                "dominant_parameters": dom_params
            })
        
        logger.info(f"✅ Returning {len(response)} records")
        return {"data": response, "count": len(response)}
        
    except Exception as e:
        logger.error(f"❌ Error fetching ME dashboard summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))