# app/schemas.py

from pydantic import BaseModel, EmailStr
from typing import List, Dict, Any, Optional
from datetime import date, datetime
import uuid


# ─────────────────────────────────────────────────────────────
# ✅ ORIGINAL SCHEMAS — Preserved exactly, no changes
# Used for Shop Trial / Engine Performance data (vessel_info table)
# ─────────────────────────────────────────────────────────────

class VesselInfo(BaseModel):
    vessel_name: str
    imo_number: int
    engine_no: str

class ReportInfo(BaseModel):
    report_id: int
    report_month: str
    report_date: Optional[str]

class PerformanceDataPoint(BaseModel):
    load_percentage: float
    sfoc_g_kwh: Optional[float]
    engine_speed_rpm: Optional[float]
    max_combustion_pressure_bar: Optional[float]
    compression_pressure_bar: Optional[float]
    scav_air_pressure_kg_cm2: Optional[float]
    turbocharger_speed_x1000_rpm: Optional[float]
    exh_temp_tc_inlet_c: Optional[float]
    exh_temp_tc_outlet_c: Optional[float]
    cyl_exhaust_gas_temp_outlet_c: Optional[float]
    fuel_consumption_total_kg_h: Optional[float]
    fuel_inj_pump_index_mm: Optional[float]

class MonthlyPerformanceData(PerformanceDataPoint):
    report_id: int
    correction_date: Optional[str]

class MetricInfo(BaseModel):
    key: str
    name: str
    unit: str

class ChartConfig(BaseModel):
    x_axis: Dict[str, Any]
    default_metric: str

class GraphData(BaseModel):
    vessel_info: VesselInfo
    report_info: ReportInfo
    shop_trial_baseline: List[PerformanceDataPoint]
    monthly_performance: MonthlyPerformanceData
    available_metrics: List[MetricInfo]
    chart_config: ChartConfig

class UploadWithGraphResponse(BaseModel):
    report_id: int
    message: str
    graph_data: GraphData

# Keep your existing UploadResponse for backward compatibility
class UploadResponse(BaseModel):
    report_id: int
    message: str


# ─────────────────────────────────────────────────────────────
# ✅ NEW SCHEMAS — For new User & Vessel tables (workplace backend)
# ─────────────────────────────────────────────────────────────

# ── Vessel Schemas ──────────────────────────────────────────

class VesselBase(BaseModel):
    """Fields shared across vessel requests and responses."""
    imo: str
    name: str
    vessel_type: Optional[str] = None
    vessel_email: Optional[str] = None
    is_active: Optional[bool] = True


class VesselResponse(VesselBase):
    """Response schema for Vessel — returned from new vessels table."""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── User Schemas ─────────────────────────────────────────────

class UserBase(BaseModel):
    """Fields shared across user requests and responses."""
    email: EmailStr
    full_name: str                                  # ✅ new model uses full_name
    job_title: Optional[str] = None
    role: Optional[str] = "VESSEL"
    is_active: Optional[bool] = True
    can_self_assign_vessels: Optional[bool] = False
    permissions: Optional[Dict[str, Any]] = {
        "drs": False,
        "jira": False,
        "voyage": False,
        "lubeoil": False,
        "engine_performance": False
    }
    preferences: Optional[Dict[str, Any]] = {
        "visible_columns": [],
        "filters": {}
    }


class UserResponse(UserBase):
    """Full user response schema — returned from new users table."""
    id: str
    last_login: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    vessels: Optional[List[VesselResponse]] = []    # ✅ assigned vessels via user_vessel_link

    class Config:
        from_attributes = True


class UserWithVesselsResponse(UserResponse):
    """Extended user response that includes assigned vessel list."""
    vessels: List[VesselResponse] = []

    class Config:
        from_attributes = True