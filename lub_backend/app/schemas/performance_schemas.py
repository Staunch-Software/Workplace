# app/schemas/performance_schemas.py
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from datetime import date, datetime

class ChartDataPoint(BaseModel):
    load: float
    value: float

class BaselineResponse(BaseModel):
    vessel_id: str
    baseline_date: Optional[date] = None
    series: Dict[str, List[ChartDataPoint]]

class MonthlyDataPoint(BaseModel):
    month: str
    date: date
    load: float
    SFOC: Optional[float] = None
    Pmax: Optional[float] = None
    EngSpeed: Optional[float] = None
    ScavAir: Optional[float] = None
    Exh_T_C_inlet: Optional[float] = None
    FOC: Optional[float] = None

class MonthlyPerformanceResponse(BaseModel):
    vessel_id: str
    monthly_data: List[MonthlyDataPoint]

class PerformanceComparisonResponse(BaseModel):
    vessel_id: str
    baseline_data: Dict[str, List[ChartDataPoint]]
    monthly_data: List[MonthlyDataPoint]
    deviation_analysis: Dict[str, Any]