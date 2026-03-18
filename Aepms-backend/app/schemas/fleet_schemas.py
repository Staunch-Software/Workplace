# app/schemas/fleet_schemas.py
from pydantic import BaseModel
from typing import List, Optional
from datetime import date, datetime

class VesselSummary(BaseModel):
    id: str  # engine_no
    name: str
    imo: Optional[str] = None
    class_: str = "Unknown"  # engine_type mapped to class
    status: str  # Healthy/Watch/Alert
    lastReport: Optional[str] = None  # YYYY-MM-DD format

class FleetResponse(BaseModel):
    fleet: List[VesselSummary]

class VesselDetailResponse(BaseModel):
    vessel_id: str
    vessel_name: str
    imo_number: Optional[str] = None
    engine_type: Optional[str] = None
    engine_model: Optional[str] = None
    engine_maker: Optional[str] = None
    number_of_cylinders: Optional[int] = None
    mcr_power_kw: Optional[float] = None
    mcr_rpm: Optional[float] = None
    last_shop_trial: Optional[date] = None
    last_monthly_report: Optional[date] = None

class VesselStatusResponse(BaseModel):
    vessel_id: str
    status: str
    last_report_date: Optional[date] = None
    engine_hours: Optional[float] = None
    current_load: Optional[float] = None