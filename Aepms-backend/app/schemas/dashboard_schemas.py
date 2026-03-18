# app/schemas/dashboard_schemas.py
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import datetime

class FleetHealthStats(BaseModel):
    healthy_count: int
    watch_count: int
    alert_count: int
    total_count: int

class DashboardKPIResponse(BaseModel):
    fleet_health: FleetHealthStats
    kpi_load: float
    kpi_sfoc: float
    kpi_pmax: float
    baseline_series: Dict[str, List[ChartDataPoint]]
    last_updated: datetime

class VesselKPIResponse(BaseModel):
    vessel_id: str
    vessel_name: str
    imo: Optional[str] = None
    class_: str = "Unknown"
    last_report: Optional[str] = None
    status: str
    baseline_series: Dict[str, List[ChartDataPoint]]
    kpi_load: float
    kpi_sfoc: float
    kpi_pmax: float