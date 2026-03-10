# D:\performance_engine\aepms_project\iso-performance-backend\app\schemas\data_models.py

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import date

# --- Ambient Conditions ---
class AmbientConditions(BaseModel):
    ambient_temperature: float = Field(..., description="Ambient temperature in °C")
    ambient_pressure: float = Field(..., description="Ambient pressure in mbar")
    ambient_humidity: float = Field(..., description="Ambient humidity in %")

# --- Critical Performance Parameters ---
class PerformanceParameters(BaseModel):
    engine_speed: float = Field(..., description="Engine speed in rpm")
    engine_output: float = Field(..., description="Engine output in kW")
    fuel_oil_consumption_raw: float = Field(..., description="Raw fuel oil consumption in g/kW-h")
    exhaust_gas_temp_tc_inlet: float = Field(..., description="Exhaust gas temperature T/C inlet in °C")
    exhaust_gas_temp_tc_outlet: float = Field(..., description="Exhaust gas temperature T/C outlet in °C")
    scavenge_air_pressure: float = Field(..., description="Scavenge air pressure in bar")
    scavenge_air_temperature: float = Field(..., description="Scavenge air temperature in °C")
    max_combustion_pressure: float = Field(..., description="Maximum combustion pressure in bar")
    compression_pressure: float = Field(..., description="Compression pressure in bar")

# --- Shop Trial Data Model (now only ambient and performance) ---
class ShopTrialData(BaseModel):
    ambient_conditions: AmbientConditions
    performance_at_100_load: PerformanceParameters # Assuming 100% load for baseline for now

# --- Monthly Performance Data Model (will be similar, but for a specific month) ---
class MonthlyPerformanceData(BaseModel):
    # For monthly, we might still need a 'report_month' field, but let's keep it simple for now
    # and assume it's passed separately or inferred.
    ambient_conditions: AmbientConditions
    raw_performance: PerformanceParameters
    iso_corrected_performance: Optional[PerformanceParameters] = None # Will be populated after correction