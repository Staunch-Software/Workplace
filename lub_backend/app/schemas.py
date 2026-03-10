# app/schemas.py - Add these new response schemas

from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import date

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