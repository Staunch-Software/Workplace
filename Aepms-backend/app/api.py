import sys  
from pydantic import BaseModel
import asyncio
import multiprocessing 
import shutil
import tempfile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from fastapi.responses import JSONResponse
from pypdf import PdfReader, PdfWriter
import os
import zipfile
from fastapi.responses import StreamingResponse
import io
from dateutil.relativedelta import relativedelta 
from sqlalchemy import desc
from sqlalchemy.orm import aliased
from fastapi import Query 
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status, Form
from app.services.ae_pdf_extractor import extract_and_save_ae_pdf
from fastapi.middleware.cors import CORSMiddleware
if sys.platform == 'win32':
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except AttributeError:
        pass
   
    try:
        if multiprocessing.get_start_method(allow_none=True) is None:
            multiprocessing.set_start_method('spawn', force=True)
    except Exception as e:
        print(f"Warning: Could not set multiprocessing start method: {e}")
from sqlalchemy.orm import Session
import io
import logging
from typing import BinaryIO, Dict, Any, List, Optional
import re
from datetime import datetime, timedelta, date, timezone
from dateutil.relativedelta import relativedelta
from sqlalchemy import func, distinct, text, desc, and_
# add this at the top of api.py (or replace the existing definition)
from app.core.permissions import get_allowed_vessel_imos
import numpy as np
from decimal import Decimal

# Local imports
from app.database import get_db, create_all_tables, run_startup_migrations
from app.report_processor import save_monthly_report
from app.ae_report_processor import save_ae_monthly_report_from_pdf  # ðŸ”¥ FIX: Import AE Processor
from app.field_metadata import FIELD_METADATA_MAPPING
from app.models import (
    MonthlyISOPerformanceData,
    MonthlyReportHeader,
    VesselInfo,
    ShopTrialSession,
    ShopTrialPerformanceData
)

from app.model.control.user import User
from app.core.database_control import get_control_db
from app.model.control.vessel import Vessel 
from app.generator_models import (
    VesselGenerator,
    GeneratorBaselineData,
    GeneratorMonthlyReportHeader,
    AEAlertSummary,
    AEDeviationHistory,
    GeneratorReferenceCurve,  # <--- ADD THIS NEW LINE
    GeneratorPerformanceGraphData as GeneratorMonthlyPerformanceData
)
from app.routes.fleet import router as fleet_router
from app.routes.Performance import router as performance_router
from app.routes.dashboard import router as dashboard_router
from app.routes import auth
from app.routes import admin  
from app.routes.aux_engine_routes import router as aux_router
from app.me_iso_corrector import MEISOCorrector
from app.middleware.permission_check import check_endpoint_permission
from app.models import MENormalStatus, MEWarningAlert, MECriticalAlert, MEAlertSummary
from app.models import MEDeviationHistory
from app.blob_storage import upload_file_to_azure, generate_sas_url
from app.blob_storage import generate_sas_url
from sqlalchemy import case, literal
from app.load_excel_data import load_excel_to_database
VESSEL_ORDER_CONFIG = {
    9832925: 1,  # AM KIRTI
    9792058: 2,  # MV AM UMANG
    9832913: 3,  # AM TARANG
    9481659: 4,  # M.V.GCL TAPI
    9481697: 5,  # GCL GANGA
    9481685: 6,  # GCL NARMADA
    9481661: 7,  # GCL SABARMATI
    9481219: 8,  # GCL YAMUNA
}
import logging
logger = logging.getLogger(__name__)
from app.core.permissions import get_allowed_vessel_imos
def format_vessel_name(name: str) -> str:
    """
    Removes prefixes like 'MV', 'M.V.', 'M.V' from vessel names.
    Example: 'MV AM UMANG' -> 'AM UMANG', 'M.V.GCL TAPI' -> 'GCL TAPI'
    """
    if not name:
        return None
    # Regex explains:
    # ^Start of string
    # (?:...) Non-capturing group for variants: MV, M.V., M.V, M/V
    # \s* Optional whitespace after the prefix
    return re.sub(r'^(?:MV|M\.V\.|M\.V|M/V)\s*', '', name, flags=re.IGNORECASE).strip()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(
    title="Ship Performance Data API",
    description="API for uploading and processing ship engine performance reports (PDFs)."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Include routers
app.include_router(fleet_router)
app.include_router(performance_router)
app.include_router(dashboard_router)
app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
app.include_router(admin.router, tags=["Admin"])  
app.include_router(aux_router)

# Database Initialization
@app.on_event("startup")
async def startup_event():
    """Event handler that runs when the FastAPI application starts up."""
    logger.info("Application startup: Initializing database...")
    try:
        create_all_tables()
        logger.info("Database tables checked/created successfully.")
        run_startup_migrations()
        from app.database import SessionLocal
        db = SessionLocal()
        try:
            sync_vessel_display_order(db)
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Failed to initialize database on startup: {e}", exc_info=True)

# ============================================
# MAIN ENGINE PERFORMANCE GRAPH GENERATOR
# ============================================
class PerformanceGraphGenerator:
    """Generate performance graph data from database using shop trial data,
    including Engine Load Diagram calculation."""
   
    def __init__(self, db_session: Session):
        self.db = db_session

    def _calculate_propeller_curves(self, P_MCR: Decimal, N_MCR: Decimal) -> List[Dict[str, float]]:
        """Calculates the Design (P âˆ N^3) and Service (10% Margin) Propeller Curves."""
        if P_MCR is None or N_MCR is None or N_MCR == Decimal('0'):
            return []

        P_MCR = Decimal(str(P_MCR))
        N_MCR = Decimal(str(N_MCR))

        curve_points = []
        N_min = max(float(N_MCR) * 0.40, 30.0)
        N_max = float(N_MCR) * 1.05
       
        for n_rpm_float in np.linspace(N_min, N_max, 50):
            n = Decimal(str(n_rpm_float))
            power_design = P_MCR * (n / N_MCR)**3
            power_service = power_design * Decimal('1.10')
           
            curve_points.append({
                "rpm": round(float(n), 2),
                "power_design_kw": round(float(power_design), 2),
                "power_service_kw": round(float(power_service), 2)
            })

        return curve_points

    def generate_graph_data(self, report_id: int) -> Dict[str, Any]:
        """Generate complete graph data for the uploaded ME report."""
        try:
            report = self.db.query(MonthlyReportHeader).filter(
                MonthlyReportHeader.report_id == report_id
            ).first()
            if not report:
                raise ValueError(f"Report {report_id} not found")
           
            vessel = self.db.query(VesselInfo).filter(
                VesselInfo.imo_number == report.imo_number
            ).first()
            if not vessel:
                raise ValueError(f"Vessel with IMO {report.imo_number} not found")
           
            actual_shaft_power = self.db.query(MonthlyReportHeader.shaft_power_kw).filter(
                MonthlyReportHeader.report_id == report_id
            ).scalar()
            actual_effective_power = report.effective_power_kw

            session_records = self.db.query(ShopTrialSession).filter(
                ShopTrialSession.engine_no == vessel.engine_no
            ).all()
            if not session_records:
                raise ValueError(f"No shop trial sessions found for engine {vessel.engine_no}")
           
            baseline_records = self.db.query(ShopTrialPerformanceData).filter(
                ShopTrialPerformanceData.session_id == session_records[0].session_id
            ).order_by(ShopTrialPerformanceData.load_percentage).all()
            if not baseline_records:
                raise ValueError(f"No shop trial performance data found")
           
            baseline_data = []
            for record in baseline_records:
                baseline_data.append({
                    "load_percentage": float(record.load_percentage),
                    "engine_output_kw": float(record.engine_output_kw) if record.engine_output_kw else None,
                    "engine_speed_rpm": float(record.engine_speed_rpm) if record.engine_speed_rpm else None,
                    "max_combustion_pressure_bar": (
                        float(record.max_combustion_pressure_iso_bar) if record.max_combustion_pressure_iso_bar
                        else (float(record.max_combustion_pressure_bar) if record.max_combustion_pressure_bar else None)
                    ),
                    "compression_pressure_bar": (
                        float(record.compression_pressure_iso_bar) if record.compression_pressure_iso_bar
                        else (float(record.compression_pressure_bar) if record.compression_pressure_bar else None)
                    ),
                    "scav_air_pressure_kg_cm2": (
                        float(record.scav_air_pressure_iso_kg_cm2) if record.scav_air_pressure_iso_kg_cm2
                        else (
                            float(record.turbocharger_gas_inlet_press_kg_cm2) if record.turbocharger_gas_inlet_press_kg_cm2
                            else (float(record.scav_air_pressure_bar) * 1.01972 if record.scav_air_pressure_bar else None)
                        )
                    ),
                    "turbocharger_speed_x1000_rpm": (
                        float(record.turbocharger_speed_x1000_iso_rpm) * 1000 if record.turbocharger_speed_x1000_iso_rpm is not None
                        else (float(record.turbocharger_speed_x1000_rpm) * 1000 if record.turbocharger_speed_x1000_rpm is not None else None)
                    ),
                    "exh_temp_tc_inlet_c": (
                        float(record.exh_temp_tc_inlet_iso_c) if record.exh_temp_tc_inlet_iso_c
                        else (float(record.exh_temp_tc_inlet_c) if record.exh_temp_tc_inlet_c else None)
                    ),
                    "exh_temp_tc_outlet_c": (
                        float(record.exh_temp_tc_outlet_iso_c) if record.exh_temp_tc_outlet_iso_c
                        else (float(record.exh_temp_tc_outlet_c) if record.exh_temp_tc_outlet_c else None)
                    ),
                    "cyl_exhaust_gas_temp_outlet_c": float(record.exh_temp_cylinder_outlet_ave_c) if record.exh_temp_cylinder_outlet_ave_c else None,
                    "fuel_consumption_total_kg_h": float(record.fuel_oil_consumption_kg_h) if record.fuel_oil_consumption_kg_h else None,
                    "sfoc_g_kwh": (
                        float(record.fuel_oil_consumption_iso_g_kwh) if record.fuel_oil_consumption_iso_g_kwh
                        else (float(record.fuel_oil_consumption_g_kwh) if record.fuel_oil_consumption_g_kwh else None)
                    ),
                    "fuel_inj_pump_index_mm": float(record.fuel_injection_pump_index_mm) if record.fuel_injection_pump_index_mm else None
                })
           
            iso_data = self.db.query(MonthlyISOPerformanceData).filter(
                MonthlyISOPerformanceData.report_id == report_id
            ).first()
           
            if not iso_data:
                raise ValueError(f"No monthly performance data found for report {report_id}")
           
            monthly_data = {
                "report_id": report_id,
                "load_percentage": float(iso_data.load_percentage),
                "effective_power_kw": float(actual_effective_power) if actual_effective_power else None, # <--- ADD THIS
                "shaft_power_kw": float(actual_shaft_power) if actual_shaft_power else None, # <--- ADD THIS
                "cylinder_readings": report.cylinder_readings,
                "engine_speed_rpm": float(iso_data.engine_speed_graph_rpm) if iso_data.engine_speed_graph_rpm else None,
                "max_combustion_pressure_bar": float(iso_data.max_combustion_pressure_iso_bar) if iso_data.max_combustion_pressure_iso_bar else None,
                "compression_pressure_bar": float(iso_data.compression_pressure_iso_bar) if iso_data.compression_pressure_iso_bar else None,
                "scav_air_pressure_kg_cm2": float(iso_data.scav_air_pressure_graph_kg_cm2) if iso_data.scav_air_pressure_graph_kg_cm2 else None,
                # "turbocharger_speed_x1000_rpm": float(iso_data.turbocharger_speed_graph_x1000_rpm_scaled) if iso_data.turbocharger_speed_graph_x1000_rpm_scaled else None,
                "turbocharger_speed_x1000_rpm": float(report.turbocharger_rpm_avg) if report.turbocharger_rpm_avg else None,
                "exh_temp_tc_inlet_c": float(iso_data.exh_temp_tc_inlet_iso_c) if iso_data.exh_temp_tc_inlet_iso_c else None,
                "exh_temp_tc_outlet_c": float(iso_data.exh_temp_tc_outlet_iso_c) if iso_data.exh_temp_tc_outlet_iso_c else None,
                "cyl_exhaust_gas_temp_outlet_c": float(iso_data.cyl_exhaust_gas_temp_outlet_graph_c) if iso_data.cyl_exhaust_gas_temp_outlet_graph_c else None,
                "fuel_consumption_total_kg_h": float(iso_data.fuel_consumption_total_graph_kg_h) if iso_data.fuel_consumption_total_graph_kg_h else None,
                "sfoc_g_kwh": float(iso_data.sfoc_graph_g_kwh) if iso_data.sfoc_graph_g_kwh else None,
                "fuel_inj_pump_index_mm": float(iso_data.fuel_inj_pump_index_graph_mm) if iso_data.fuel_inj_pump_index_graph_mm else None,
                "correction_date": iso_data.correction_date.isoformat() if iso_data.correction_date else None,
                "propeller_margin_percent": float(iso_data.propeller_margin_percent) if iso_data.propeller_margin_percent is not None else None
            }

            def safe_float(v): 
                try:
                    return float(v) if v is not None else None
                except:
                    return None

            # 1. Unit Conversions for Raw Data
            raw_scav_bar = safe_float(report.scavenge_pr_bar)
            scav_raw_kgcm2 = raw_scav_bar * 1.01972 if raw_scav_bar is not None else None # Convert Bar -> kg/cm2

            raw_turbo_rpm = safe_float(report.turbocharger_rpm_avg)
            turbo_raw_x1000 = raw_turbo_rpm / 1000.0 if raw_turbo_rpm is not None else None # RPM -> x1000 RPM

            raw_foc_mt = safe_float(report.fo_consumption_mt_hr)
            foc_raw_kg = raw_foc_mt * 1000.0 if raw_foc_mt is not None else None # MT/h -> kg/h

            monthly_raw = {
                "max_combustion_pressure_bar": safe_float(report.max_comb_pr_avg_bar),
                "compression_pressure_bar": safe_float(report.comp_pr_avg_bar),
                "scav_air_pressure_kg_cm2": scav_raw_kgcm2,
                "exh_temp_tc_inlet_c": safe_float(report.tc_exhaust_gas_temp_in_c),
                "exh_temp_tc_outlet_c": safe_float(report.tc_exhaust_gas_temp_out_c),
                "turbocharger_speed_x1000_rpm": turbo_raw_x1000,
                "sfoc_g_kwh": safe_float(report.sfoc_calculated_g_kwh),
                "engine_speed_rpm": safe_float(report.rpm),
                "cyl_exhaust_gas_temp_outlet_c": safe_float(report.exh_temp_cylinder_outlet_ave_c),
                "fuel_consumption_total_kg_h": foc_raw_kg,
                "fuel_inj_pump_index_mm": safe_float(report.fuel_injection_pump_index_mm)
            }

            propeller_curves_data = self._calculate_propeller_curves(vessel.mcr_power_kw, vessel.mcr_rpm)

            engine_load_diagram_data = {
                "propeller_curves": propeller_curves_data,
                "actual_operating_point": {
                    "rpm": monthly_data["engine_speed_rpm"],
                    "power_kw": float(actual_shaft_power) if actual_shaft_power else None
                },
                "fixed_limits": {
                    "mcr_power_kw": float(vessel.mcr_power_kw) if vessel.mcr_power_kw else None,
                    "mcr_speed_rpm": float(vessel.mcr_rpm) if vessel.mcr_rpm else None,
                    "csr_power_kw": float(vessel.csr_power_kw) if vessel.csr_power_kw else None,
                    "barred_speed_rpm_start": float(vessel.barred_speed_rpm_start) if vessel.barred_speed_rpm_start else None,
                    "barred_speed_rpm_end": float(vessel.barred_speed_rpm_end) if vessel.barred_speed_rpm_end else None
                }
            }

            metrics = [
                {"key": "sfoc_g_kwh", "name": "SFOC", "unit": "g/kWh", "description": "Specific Fuel Oil Consumption"},
                {"key": "engine_speed_rpm", "name": "Engine Speed", "unit": "RPM", "description": "Engine Revolution Per Minute"},
                {"key": "max_combustion_pressure_bar", "name": "Max Combustion Pressure", "unit": "Bar", "description": "Maximum Combustion Pressure"},
                {"key": "compression_pressure_bar", "name": "Compression Pressure", "unit": "Bar", "description": "Compression Pressure"},
                {"key": "scav_air_pressure_kg_cm2", "name": "Scavenge Air Pressure", "unit": "kg/cmÂ²", "description": "Scavenge Air Pressure"},
                {"key": "turbocharger_speed_x1000_rpm", "name": "Turbocharger Speed", "unit": "Ã—1000 RPM", "description": "Turbocharger Speed"},
                {"key": "exh_temp_tc_inlet_c", "name": "T/C Inlet Exhaust Temp", "unit": "Â°C", "description": "Turbocharger Inlet Exhaust Temperature"},
                {"key": "exh_temp_tc_outlet_c", "name": "T/C Outlet Exhaust Temp", "unit": "Â°C", "description": "Turbocharger Outlet Exhaust Temperature"},
                {"key": "cyl_exhaust_gas_temp_outlet_c", "name": "Cylinder Outlet Exhaust Temp", "unit": "Â°C", "description": "Cylinder Outlet Exhaust Temperature"},
                {"key": "fuel_consumption_total_kg_h", "name": "Total Fuel Consumption", "unit": "kg/h", "description": "Total Fuel Consumption"},
                {"key": "fuel_inj_pump_index_mm", "name": "Fuel Injection Pump Index", "unit": "mm", "description": "Fuel Injection Pump Index"},
                {"key": "engine_output_kw", "name": "Engine Output", "unit": "kW", "description": "Engine Output Power"}
            ]
           
            graph_data = {
                "vessel_info": {
                    "vessel_name": format_vessel_name(vessel.vessel_name),
                    "imo_number": vessel.imo_number,
                    "engine_no": vessel.engine_no,
                    "engine_maker": vessel.engine_maker,
                    "engine_model": vessel.engine_model,
                    "mcr_power_kw": float(vessel.mcr_power_kw) if vessel.mcr_power_kw else None
                },
                "report_info": {
                    "report_id": report_id,
                    "report_month": report.report_month,
                    "report_date": report.report_date.isoformat() if report.report_date else None
                },
                "shop_trial_baseline": baseline_data,
                "monthly_performance": monthly_data,
                "monthly_performance_raw": monthly_raw,
                "available_metrics": metrics,
                "chart_config": {
                    "x_axis": {"key": "load_percentage", "label": "Load Percentage (%)", "min": 20, "max": 115},
                    "default_metric": "sfoc_g_kwh"
                },
                "engine_load_diagram_data": engine_load_diagram_data
            }
           
            return graph_data
           
        except Exception as e:
            logger.error(f"Error generating ME graph data: {e}")
            raise
#display order of vessels in fleet list
def sync_vessel_display_order(db_session: Session):
    """
    Automatically updates the display_order column in the database
    on server startup based on the configuration above.
    """
    logger.info("🔄 Syncing vessel display orders based on configuration...")
    try:
        updated_count = 0
        
        # Loop through the config and update the database
        for imo, order in VESSEL_ORDER_CONFIG.items():
            vessel = db_session.query(VesselInfo).filter(VesselInfo.imo_number == imo).first()
            
            if vessel:
                # Only update if the order is actually different (saves DB writes)
                if vessel.display_order != order:
                    logger.info(f"Updating {vessel.vessel_name} ({imo}) order from {vessel.display_order} to {order}")
                    vessel.display_order = order
                    updated_count += 1
            else:
                logger.warning(f"⚠️ Configuration contains IMO {imo}, but vessel not found in DB.")

        # Set any vessels NOT in the list to a high number (e.g., 1000) to push them to the bottom
        configured_imos = list(VESSEL_ORDER_CONFIG.keys())
        others = db_session.query(VesselInfo).filter(VesselInfo.imo_number.notin_(configured_imos)).all()
        for v in others:
            if v.display_order != 1000:
                v.display_order = 1000
                updated_count += 1

        if updated_count > 0:
            db_session.commit()
            logger.info(f"✅ Successfully updated display order for {updated_count} vessels.")
        else:
            logger.info("✅ Vessel orders are already up to date.")
            
    except Exception as e:
        logger.error(f"❌ Failed to sync vessel orders: {e}")
        db_session.rollback()
#finish
# ============================================
# ðŸ”¥ NEW: AUX ENGINE PERFORMANCE GRAPH GENERATOR (FIXED)
# ============================================
# app/api.py - AuxPerformanceGraphGenerator class
# âœ… CORRECT VERSION - Uses actual database column names

# ============================================
# 🔥 NEW: AUX ENGINE PERFORMANCE GRAPH GENERATOR (FIXED)
# ============================================
# app/api.py - AuxPerformanceGraphGenerator class
# ✅ ALIGNED WITH get_ae_report_details logic (No Averaging, per-row fallback)

class AuxPerformanceGraphGenerator:
    """
    Generate AE performance graph data with STRICT generator_id filtering.
    """
   
    def __init__(self, db_session: Session):
        self.db = db_session
    def _extract_ae_cylinder_readings_from_report(report) -> dict:
    
        try:
            raw = report.raw_json_data
            if not raw:
                return {}

            # raw_json_data may be stored as a JSON string or already a dict
            if isinstance(raw, str):
                import json
                raw = json.loads(raw)

            readings = {}
            for i in range(1, 7):
                pmax = raw.get(f"pmaxunit#{i}") or raw.get(f"pmax#{i}")
                exhaust_temp = raw.get(f"exhausttempunit#{i}") or raw.get(f"exhausttemp#{i}")
                fuel_rack = raw.get(f"fuelrackunit#{i}") or raw.get(f"fuelrack#{i}")
                jcw_temp_out = raw.get(f"jcwtempoutunit#{i}") or raw.get(f"jcwtempout#{i}")

                # Convert Decimal to float safely
                def to_float(v):
                    try:
                        return float(v) if v is not None else None
                    except (TypeError, ValueError):
                        return None

                pmax = to_float(pmax)
                exhaust_temp = to_float(exhaust_temp)
                fuel_rack = to_float(fuel_rack)
                jcw_temp_out = to_float(jcw_temp_out)

                if any(v is not None for v in [pmax, exhaust_temp, fuel_rack, jcw_temp_out]):
                    readings[str(i)] = {
                        "pmax": pmax,
                        "exhaust_temp": exhaust_temp,
                        "fuel_rack": fuel_rack,
                        "jcw_temp_out": jcw_temp_out,
                    }

            return readings

        except Exception as e:
            logger.warning(f"[AE_GRAPH] Could not extract cylinder readings: {e}")
            return {}

    def generate_graph_data(self, report_id: int) -> Dict[str, Any]:
        """Generate complete AE graph data for a specific report."""
        try:
            # 1. Get report header
            # report = self.db.query(GeneratorMonthlyReportHeader).filter(
            #     GeneratorMonthlyReportHeader.report_id == report_id
            # ).first()
            report = self.db.query(GeneratorMonthlyReportHeader).filter_by(report_id=report_id).first()
            target_gen_id = int(report.generator_id) 
           
            if not report:
                raise ValueError(f"AE Report {report_id} not found")
           
            # 2. Get generator info
            generator = self.db.query(VesselGenerator).filter(
                VesselGenerator.generator_id == report.generator_id
            ).first()
           
            if not generator:
                raise ValueError(f"Generator {report.generator_id} not found")
           
            logger.info(f"[AE_GRAPH] Processing report {report_id} for generator {generator.generator_id} ({generator.designation})")
           
            # 3. Get vessel info
            vessel = self.db.query(VesselInfo).filter(
                VesselInfo.imo_number == generator.imo_number
            ).first()
           
            # 4. CRITICAL FIX: Query baseline ONLY for THIS specific generator_id
            baseline_records = (
                self.db.query(GeneratorBaselineData)
                .filter(GeneratorBaselineData.generator_id == target_gen_id) # Use the casted ID
                .order_by(GeneratorBaselineData.load_percentage)
                .all()
            )

           
            if not baseline_records:
                logger.warning(f"No baseline data found for generator {generator.designation}")
                # We return an empty list instead of crashing, allowing the frontend to load
                baseline_data = []
            else:
                # 5. Format baseline data - EXACT MATCH to get_ae_report_details logic
                # We do NOT average. We return raw points. 
                # This ensures fallback logic (A or B) happens per row, not on the average.
                baseline_data = []
                for r in baseline_records:
                    # Skip invalid loads
                    if r.load_percentage is None:
                        continue

                    baseline_data.append({
                        "load_percentage": float(r.load_percentage),
                        "load_kw": float(r.load_kw) if r.load_kw is not None else (float(r.engine_output_kw) if r.engine_output_kw else None),
                        "engine_speed_rpm": float(r.engine_speed_rpm) if r.engine_speed_rpm else None,
                        
                        # --- MAPPINGS (Matches get_ae_report_details) ---
                        
                        # SFOC
                        "sfoc_graph_g_kwh": float(r.sfoc_graph_g_kwh) if r.sfoc_graph_g_kwh is not None else (float(r.sfoc_g_kwh) if r.sfoc_g_kwh is not None else None),
                        
                        # Fuel Index
                        "fuel_pump_index_graph": float(r.fuel_pump_index_graph) if r.fuel_pump_index_graph is not None else (float(r.fuel_rack_position_mm) if r.fuel_rack_position_mm is not None else None),
                        
                        # TC Inlet Temp
                        "exh_temp_tc_inlet_graph_c": float(r.exh_temp_tc_inlet_graph_c) if r.exh_temp_tc_inlet_graph_c is not None else (float(r.exhaust_gas_temp_before_tc_c) if r.exhaust_gas_temp_before_tc_c is not None else None),
                        
                        # TC Outlet Temp
                        "exh_temp_tc_outlet_graph_c": float(r.exh_temp_tc_outlet_graph_c) if r.exh_temp_tc_outlet_graph_c is not None else (float(r.exhaust_gas_temp_after_tc_c) if r.exhaust_gas_temp_after_tc_c is not None else None),
                        
                        # Cyl Outlet Temp
                        "exh_temp_cyl_outlet_avg_graph_c": float(r.exh_temp_cyl_outlet_avg_graph_c) if r.exh_temp_cyl_outlet_avg_graph_c is not None else None,
                        
                        # Scav Air Pressure
                        "scav_air_pressure_bar": float(r.scav_air_pressure_bar) if r.scav_air_pressure_bar is not None else (float(r.boost_air_pressure_graph_bar) if r.boost_air_pressure_graph_bar is not None else None),
                        
                        # Pmax
                        "pmax_graph_bar": float(r.pmax_graph_bar) if r.pmax_graph_bar is not None else (float(r.max_combustion_pressure_bar) if r.max_combustion_pressure_bar is not None else None),
                        
                        # Pcomp
                        "compression_pressure_bar": float(r.compression_pressure_bar) if r.compression_pressure_bar is not None else None,
                        
                        # Turbo Speed
                        "turbocharger_speed_rpm": float(r.turbocharger_speed_rpm) if r.turbocharger_speed_rpm is not None else None
                    })
           
            # 6. Get monthly performance data
            monthly_perf = self.db.query(GeneratorMonthlyPerformanceData).filter(
                GeneratorMonthlyPerformanceData.report_id == report_id
            ).first()
           
            if not monthly_perf:
                raise ValueError(f"No monthly performance data found for report {report_id}")
           
            monthly_data = {
                "report_id": report_id,
                "load_percentage": float(monthly_perf.load_percentage) if monthly_perf.load_percentage else None,
                "load_kw": float(monthly_perf.load_kw) if monthly_perf.load_kw else None,
                "engine_speed_rpm": float(monthly_perf.engine_speed_rpm) if monthly_perf.engine_speed_rpm else None,
                "sfoc_graph_g_kwh": float(monthly_perf.sfoc_g_kwh) if monthly_perf.sfoc_g_kwh else None,
                "fuel_pump_index_graph": float(monthly_perf.fuel_rack_position_mm or monthly_perf.fuel_pump_index_graph) if (monthly_perf.fuel_rack_position_mm or monthly_perf.fuel_pump_index_graph) else None,
                "exh_temp_tc_inlet_graph_c": float(monthly_perf.exhaust_gas_temp_before_tc_c or monthly_perf.exh_temp_tc_inlet_graph_c) if (monthly_perf.exhaust_gas_temp_before_tc_c or monthly_perf.exh_temp_tc_inlet_graph_c) else None,
                "exh_temp_tc_outlet_graph_c": float(monthly_perf.exhaust_gas_temp_after_tc_c or monthly_perf.exh_temp_tc_outlet_graph_c) if (monthly_perf.exhaust_gas_temp_after_tc_c or monthly_perf.exh_temp_tc_outlet_graph_c) else None,
                "exh_temp_cyl_outlet_avg_graph_c": float(monthly_perf.exh_temp_cyl_outlet_avg_graph_c) if monthly_perf.exh_temp_cyl_outlet_avg_graph_c else None,
                "scav_air_pressure_bar": float(monthly_perf.scav_air_pressure_bar or monthly_perf.boost_air_pressure_graph_bar) if (monthly_perf.scav_air_pressure_bar or monthly_perf.boost_air_pressure_graph_bar) else None,
                "pmax_graph_bar": float(monthly_perf.max_combustion_pressure_bar or monthly_perf.pmax_graph_bar) if (monthly_perf.max_combustion_pressure_bar or monthly_perf.pmax_graph_bar) else None,
                "compression_pressure_bar": float(monthly_perf.compression_pressure_bar) if monthly_perf.compression_pressure_bar else None,
                "turbocharger_speed_rpm": float(monthly_perf.turbocharger_speed_rpm) if monthly_perf.turbocharger_speed_rpm else None,
                "cylinder_readings": report.cylinder_readings
            }
           
            # 7. Define available metrics
            metrics = [
                {"key": "sfoc_graph_g_kwh", "name": "SFOC", "unit": "g/kWh"},
                {"key": "engine_speed_rpm", "name": "Engine Speed", "unit": "RPM"},
                {"key": "fuel_pump_index_graph", "name": "Fuel Pump Index", "unit": "mm"},
                {"key": "exh_temp_tc_inlet_graph_c", "name": "Exhaust Temp Before T/C", "unit": "Â°C"},
                {"key": "exh_temp_tc_outlet_graph_c", "name": "Exhaust Temp After T/C", "unit": "Â°C"},
                {"key": "exh_temp_cyl_outlet_avg_graph_c", "name": "Cylinder Outlet Exhaust Temp", "unit": "Â°C"},
                {"key": "scav_air_pressure_bar", "name": "Scavenge Air Pressure", "unit": "Bar"},
                {"key": "pmax_graph_bar", "name": "Max Combustion Pressure", "unit": "Bar"},
                {"key": "compression_pressure_bar", "name": "Compression Pressure", "unit": "Bar"},
                {"key": "turbocharger_speed_rpm", "name": "Turbocharger Speed", "unit": "RPM"},
                {"key": "load_kw", "name": "Engine Output", "unit": "kW"}
            ]
           
            graph_data = {
                "vessel_info": {
                    "vessel_name": format_vessel_name(vessel.vessel_name),
                    "imo_number": vessel.imo_number,
                    "generator_designation": generator.designation,
                    "generator_id": generator.generator_id,
                    "engine_maker": generator.engine_maker,
                    "engine_model": generator.engine_model,
                    "mcr_power_kw": float(generator.mcr_power_kw) if generator.mcr_power_kw else None
                },
                "report_info": {
                    "report_id": report_id,
                    "report_month": report.report_month,
                    "report_date": report.report_date.isoformat() if report.report_date else None
                },
                "shop_trial_baseline": baseline_data,
                "monthly_performance": monthly_data,
                "available_metrics": metrics,
                "chart_config": {
                    "x_axis": {"key": "load_percentage", "label": "Load Percentage (%)", "min": 20, "max": 115},
                    "default_metric": "sfoc_graph_g_kwh"
                }
            }
           
            logger.info(f"[AE_GRAPH] Successfully generated graph data: {len(baseline_data)} baseline points")
           
            return graph_data
           
        except Exception as e:
            logger.error(f"Error generating AE graph data: {e}", exc_info=True)
            raise

# ============================================
# ME UPLOAD ENDPOINT
# ============================================
@app.post("/upload-monthly-report/", summary="Upload a monthly performance report PDF")
async def upload_monthly_report(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Upload monthly performance PDF, extract data, store in DB, CALC ISO, and return graph data."""
    logger.info(f"Received file upload: {file.filename}")

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        contents = await file.read()
        pdf_stream = io.BytesIO(contents)

        # To capture the missing parameters list even if the process continues
        missing_params_list = []

        try:
            # 1. EXTRACT & SAVE (Now returning missing_parameters in the result)
            result = save_monthly_report(
                pdf_file_stream=pdf_stream,
                filename=file.filename,
                session=db,
                mapping=FIELD_METADATA_MAPPING
            )
           
            if result and isinstance(result, dict) and result.get("report_id"):
                report_id = result["report_id"]
                is_new_report = not result.get("is_duplicate", False)
                
                # --- NEW: Capture the missing parameters from the processor ---
                missing_params_list = result.get("missing_parameters", [])
                
                # 2. UPLOAD RAW PDF TO AZURE
                try:
                    report = db.query(MonthlyReportHeader).filter(MonthlyReportHeader.report_id == report_id).first()
                    if report:
                        folder_path = f"main_engine/raw/{report.imo_number}/{report.report_month}"
                        
                        blob_url = upload_file_to_azure(
                            file_data=contents, 
                            filename=file.filename, 
                            folder_path=folder_path
                        )
                        
                        if blob_url:
                            report.raw_report_url = blob_url
                            db.commit()
                            logger.info(f"☁️ Uploaded Raw ME Report to Azure: {blob_url}")
                except Exception as blob_err:
                    logger.error(f"❌ Failed to upload ME report to Blob: {blob_err}")

                # =========================================================
                # 🔥 3. TRIGGER ISO CORRECTION (Logic Maintained)
                # =========================================================
                try:
                    logger.info(f"⚙️ Starting ISO Calculation for Report {report_id}...")
                    iso_corrector = MEISOCorrector(db)
                    iso_record = iso_corrector.process_and_save_iso_correction(report_id)
                    if iso_record:
                        logger.info(f"✅ ISO Correction successful for Report {report_id}")
                    else:
                        logger.warning(f"⚠️ ISO Correction returned None for Report {report_id}")
                except Exception as iso_e:
                    logger.error(f"❌ ISO Correction Failed: {iso_e}", exc_info=True)
                # =========================================================

                logger.info(f"Successfully processed {'new' if is_new_report else 'existing'} report, ID: {report_id}")
            else:
                raise Exception("Failed to process report - no report ID returned")
       
        except ValueError as ve:
            error_message = str(ve)
            logger.error(f"Validation error during ME upload: {error_message}")
            raise HTTPException(status_code=400, detail=error_message)
               
        except Exception as processing_error:
            # Handle Duplicates (Logic Maintained)
            error_str = str(processing_error).lower()
            if "duplicate key" in error_str and "uq_vessel_report_date" in error_str:
                logger.info(f"Duplicate report detected, finding existing...")
               
                imo_match = re.search(r'imo_number.*?(\d+)', error_str)
                date_match = re.search(r'report_date.*?([\d-]+)', error_str)
               
                if imo_match and date_match:
                    imo_number = int(imo_match.group(1))
                    report_date = date_match.group(1)
                   
                    existing_report = db.query(MonthlyReportHeader).filter(
                        MonthlyReportHeader.imo_number == imo_number,
                        MonthlyReportHeader.report_date == report_date
                    ).first()
                   
                    if existing_report:
                        report_id = existing_report.report_id
                        is_new_report = False
                        logger.info(f"Found existing report ID: {report_id}")
                    else:
                        raise Exception(f"Could not find existing report")
                else:
                    raise Exception("Could not parse duplicate key error")
            else:
                raise processing_error

        # 4. GENERATE GRAPH DATA (Logic Maintained)
        try:
            graph_generator = PerformanceGraphGenerator(db)
            graph_data = graph_generator.generate_graph_data(report_id)
        except Exception as graph_error:
            logger.warning(f"Could not generate graph data: {graph_error}")
            graph_data = None
       
        # 5. FETCH ISO ID FOR RESPONSE
        iso_data_record = db.query(MonthlyISOPerformanceData).filter_by(report_id=report_id).first()
        iso_data_id = iso_data_record.iso_data_id if iso_data_record else None

        # Build appropriate message
        base_message = "Main Engine report uploaded successfully!" if is_new_report else "Report already exists - using existing data"
        if missing_params_list:
            message = f"{base_message} (Warning: {len(missing_params_list)} parameters missing in PDF)"
        else:
            message = base_message
           
        # Prepare the response data with the missing_parameters key
        response_data = {
            "message": message,
            "report_id": report_id,
            "missing_parameters": missing_params_list,
            "iso_data_id": iso_data_id,
            "is_duplicate": not is_new_report,
            "iso_cylinder_data": result.get("iso_cylinder_data"),
            "enriched_json_path": result.get("enriched_json_path") if is_new_report else None,
            "header_json_path": result.get("header_json_path") if is_new_report else None,
            "missing_parameters": missing_params_list  # 🔥 THIS IS SENT TO UI
        }
       
        if graph_data:
            response_data["graph_data"] = graph_data
       
        return response_data

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Validation error: {e}")
    except Exception as e:
        logger.exception(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}")


@app.post("/aux/upload-auxiliary-report/",
          summary="Upload a monthly AE performance report PDF")
async def upload_auxiliary_report(
    file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """
    Handles the upload of the AE PDF, extracts data, and saves it.
    """
    logger.info(f"Received AE file upload: {file.filename}")

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        contents = await file.read()
        pdf_stream = io.BytesIO(contents)

        # 1. Process the report using the fixed processor logic
        result = save_ae_monthly_report_from_pdf(
            pdf_file_stream=pdf_stream,
            filename=file.filename,
            session=db
        )

        missing_params_list = result.get("missing_parameters", [])
       
        if not result:
            raise HTTPException(status_code=500, detail="Failed to process the PDF report.")
       
        report_id = result.get("report_id")
        generator_id = result.get("generator_id")
        is_duplicate = result.get("is_duplicate", False)
        report_month = result.get("report_month")
       
        # Validation Block
        if not report_id or not generator_id:
            raise HTTPException(status_code=400, detail="Report processing succeeded but could not identify Generator or IMO from PDF.")

        # 🔥 NEW: Upload RAW PDF to Azure Blob (CORRECTLY PLACED & INDENTED)
        try:
            # Fetch report to get details
            report = db.query(GeneratorMonthlyReportHeader).filter(GeneratorMonthlyReportHeader.report_id == report_id).first()
            if report:
                # We need IMO number for the folder path.
                # Access via relationship safely
                imo_num = report.generator.imo_number if report.generator else "unknown"
                
                folder_path = f"aux_engine/raw/{imo_num}/{report_month}"
                
                blob_url = upload_file_to_azure(
                    file_data=contents,
                    filename=file.filename,
                    folder_path=folder_path
                )
                
                if blob_url:
                    report.raw_report_url = blob_url
                    db.commit()
                    logger.info(f"☁️ Uploaded Raw AE Report to Azure: {blob_url}")
        except Exception as blob_err:
            logger.error(f"❌ Failed to upload AE report to Blob: {blob_err}")

        # 2. ✅ ALWAYS fetch graph data from database
        graph_data = None
        try:
            graph_generator = AuxPerformanceGraphGenerator(db)
            graph_data = graph_generator.generate_graph_data(report_id)
            logger.info(f"✅ Graph data generated successfully for report_id={report_id}")
        except Exception as graph_error:
            logger.error(f"❌ Failed to generate graph data: {graph_error}", exc_info=True)
            graph_data = None
       
        # 3. Build appropriate response message
        if is_duplicate:
            message = f"Report is a duplicate, returning existing data."
            logger.info(f"📋 Duplicate report detected for {report_month}, returning existing data")
        else:
            message = f"Auxiliary Engine report uploaded successfully!"
            logger.info(f"✅ New report created for generator_id={generator_id}, month={report_month}")
       
        # 4. Return response with graph data
        response_data = {
            "message": message,
            "report_id": report_id,
            "generator_id": generator_id,
            "is_duplicate": is_duplicate,
            "missing_parameters": missing_params_list,
            "graph_data": graph_data
        }
       
        return response_data

    except HTTPException:
        raise
    except ValueError as e:
        logger.error(f"Validation error during AE upload: {e}")
        raise HTTPException(status_code=400, detail=f"Validation error: {e}")
    except Exception as e:
        logger.exception(f"Unexpected error during AE upload: {e}")
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")
# ============================================
# 🔥 NEW: UPLOAD GENERATED ANALYSIS PDF
# ============================================
@app.post("/api/reports/upload-generated", summary="Upload frontend-generated PDF to Azure")
async def upload_generated_report(
    file: UploadFile = File(...),
    report_type: str = Form(...), 
    report_id: Optional[int] = Form(None), # Made Optional for Luboil if ID isn't passed
    db: Session = Depends(get_db)
):
    try:
        file_content = await file.read()
        
        # 1. Determine Logic based on Report Type
        model = None
        pk_field = None
        folder_base = ""
        imo_number = "unknown"
        report_month = "unknown"

        if report_type == 'mainEngine':
            model = MonthlyReportHeader
            pk_field = MonthlyReportHeader.report_id
            folder_base = "main_engine/analytical"
        elif report_type == 'auxiliaryEngine':
            model = GeneratorMonthlyReportHeader
            pk_field = GeneratorMonthlyReportHeader.report_id
            folder_base = "aux_engine/analytical"
        else:
            raise HTTPException(status_code=400, detail="Invalid report_type")

        # 2. Fetch Report Details (If report_id is provided)
        if report_id and model:
            report = db.query(model).filter(pk_field == report_id).first()
            if report:
                if report_type == 'mainEngine':
                    imo_number = report.imo_number
                    report_month = report.report_month
                elif report_type == 'auxiliaryEngine':
                    imo_number = report.generator.imo_number
                    report_month = report.report_month

        # 3. Construct Path
        folder_path = f"{folder_base}/{imo_number}/{report_month}"
        
        # 4. Upload to Azure
        blob_url = upload_file_to_azure(
            file_data=file_content,
            filename=file.filename,
            folder_path=folder_path
        )

        if blob_url:
            # Update DB URL if linked to a specific report
            if report_id and model and report:
                report.generated_report_url = blob_url
                db.commit()
            
            # For Lube Oil, we might just log it or save to a History Log table if you have one
            logger.info(f"✅ Uploaded {report_type} to {blob_url}")
            return {"status": "success", "url": blob_url}
        else:
            raise HTTPException(status_code=500, detail="Azure upload returned no URL")

    except Exception as e:
        logger.error(f"Error saving generated report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
# ============================================
# ðŸ”¥ NEW: AUXILIARY GENERATOR LIST ENDPOINT (Fixes 404 error)
# ============================================
@app.get("/aux/generators/{imo_number}", tags=["Auxiliary Engine"])
async def get_generators_list(
    imo_number: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Retrieves the list of Auxiliary Engines (VesselGenerator) for a given IMO number.
    ðŸ”¥ FIXED: Returns engine_maker and engine_model (actual database column names)
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)# ADD
    if str(imo_number) not in [str(x) for x in allowed_imos]:  # ADD
        raise HTTPException(status_code=403, detail="Access Denied")  # ADD
    try:
        generators = db.query(VesselGenerator).filter(
            VesselGenerator.imo_number == imo_number
        ).all()
       
        # ðŸ”¥ CRITICAL FIX: Use actual column names from database
        return [
            {
                "generator_id": gen.generator_id,
                "designation": gen.designation,
                "engine_no": gen.engine_no,
                "engine_maker": gen.engine_maker,  # âœ… CORRECT: Use actual DB column name
                "engine_model": gen.engine_model,  # âœ… CORRECT: Use actual DB column name
                "mcr_power_kw": float(gen.mcr_power_kw) if gen.mcr_power_kw else None,
            } for gen in generators
        ]
    except Exception as e:
        logger.error(f"Error fetching generator list for IMO {imo_number}: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

# ============================================
# ðŸ”¥ NEW: AE GRAPH DATA ENDPOINT (CRITICAL FIX)
# ============================================
@app.get("/api/aux-engine/{report_id}/graph-data")
async def get_ae_graph_data(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Get AE performance graph data for a specific report ID.
    """
    report = db.query(GeneratorMonthlyReportHeader).filter_by(report_id=report_id).first()
    if report:
        generator = db.query(VesselGenerator).filter(
            VesselGenerator.generator_id == report.generator_id
        ).first()
        if generator:
            allowed_imos, _ = await get_allowed_vessel_imos(current_user)
            if str(generator.imo_number) not in [str(x) for x in allowed_imos]:
                raise HTTPException(status_code=403, detail="Access Denied")

    try:
        graph_generator = AuxPerformanceGraphGenerator(db)
        graph_data = graph_generator.generate_graph_data(report_id)
       
        return {
            "message": "AE graph data retrieved successfully",
            "report_id": report_id,
            "graph_data": graph_data
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=f"Data not found: {e}")
    except Exception as e:
        logger.exception(f"Error retrieving AE graph data: {e}")
        raise HTTPException(status_code=500, detail=f"Error: {e}")


# ============================================
# ME GRAPH DATA ENDPOINT
# ============================================
@app.get("/reports/{report_id}/graph-data")
async def get_graph_data(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """Get ME performance graph data for a specific report ID."""
    report = db.query(MonthlyReportHeader).filter_by(report_id=report_id).first()
    if report:
        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(report.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
    try:
        graph_generator = PerformanceGraphGenerator(db)
        graph_data = graph_generator.generate_graph_data(report_id)
       
        return {
            "message": "Graph data retrieved successfully",
            "report_id": report_id,
            "graph_data": graph_data
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=f"Data not found: {e}")
    except Exception as e:
        logger.exception(f"Error retrieving graph data: {e}")
        raise HTTPException(status_code=500, detail=f"Error: {e}")


# ============================================
# ME PERFORMANCE HISTORY ENDPOINT
# ============================================
@app.get("/performance/history")
async def get_performance_history(
    imo_number: int,
    limit: Optional[int] = 6,
    ref_month: str = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) 
):
    """Get historical monthly performance data for the specified vessel."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied: Not assigned to this vessel.")
    
    try:
        logger.info(f"Historical data request: IMO={imo_number}, limit={limit}, ref_month={ref_month}")
       
        if limit is None or limit <= 0:
            limit = 6
           
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail=f"Vessel with IMO {imo_number} not found")
       
        historical_reports_query = db.query(MonthlyReportHeader).filter(
            MonthlyReportHeader.imo_number == imo_number
        )
       
        # --- FIXED LOGIC: Strict Date Filtering ---
        if ref_month:
            try:
                # 1. Start of selected month (e.g., 2024-06-01)
                ref_dt_start = datetime.strptime(ref_month + "-01", "%Y-%m-%d").date()
                
                # 2. Start of NEXT month (e.g., 2024-07-01)
                ref_dt_cutoff = ref_dt_start + relativedelta(months=1)
                
                # 3. Filter reports strictly BEFORE next month (includes all of June)
                historical_reports_query = historical_reports_query.filter(
                    MonthlyReportHeader.report_date < ref_dt_cutoff
                )
            except ValueError:
                raise HTTPException(status_code=400, detail="ref_month must be in YYYY-MM format")
        # ------------------------------------------
       
        historical_reports = historical_reports_query.order_by(
            desc(MonthlyReportHeader.report_date)
        ).limit(limit).all()
       
        logger.info(f"Found {len(historical_reports)} reports")
       
        if not historical_reports:
            return {
                "message": f"No historical data found for vessel {vessel.vessel_name}",
                "vessel_name": format_vessel_name(vessel.vessel_name),
                "imo_number": imo_number,
                "limit": limit,
                "reference_month": ref_month,
                "total_records": 0,
                "monthly_performance_list": []
            }
       
        monthly_performance_list = []
       
        for report in historical_reports:
            iso_data = db.query(MonthlyISOPerformanceData).filter(
                MonthlyISOPerformanceData.report_id == report.report_id
            ).first()
           
            if iso_data:
                def get_raw(val):
                    try:
                        return float(val) if val is not None else None
                    except:
                        return None

                raw_scav = get_raw(report.scavenge_pr_bar)
                scav_raw_kgcm2 = raw_scav * 1.01972 if raw_scav is not None else None

                raw_turbo = get_raw(report.turbocharger_rpm_avg)
                turbo_raw_x1000 = raw_turbo / 1000.0 if raw_turbo is not None else None

                raw_foc = get_raw(report.fo_consumption_mt_hr)
                foc_raw_kg = raw_foc * 1000.0 if raw_foc is not None else None
                performance_data = {
                    "report_id": report.report_id,
                    "report_month": report.report_month,
                    "report_date": report.report_date.isoformat() if report.report_date else None,
                    "cylinder_readings": report.cylinder_readings, 
                    "shaft_power_kw": float(report.shaft_power_kw) if report.shaft_power_kw is not None else None,
                    "effective_power_kw": float(report.effective_power_kw) if report.effective_power_kw is not None else None,
                    "tc_air_inlet_temp_c": float(report.tc_air_inlet_temp_c) if report.tc_air_inlet_temp_c else None,
                    # "scav_air_cooler_cw_in_temp_c": get_cw_temp(json_data), 
                    # "mcr_limit_kw": float(vessel.mcr_limit_kw) if vessel.mcr_limit_kw is not None else None,
                    # "mcr_limit_percentage": float(vessel.mcr_limit_percentage) if vessel.mcr_limit_percentage is not None else None,
                    "finish_time": report.time_finish.strftime("%H:%M") if report.time_finish else None,
                    "rpm": float(report.rpm) if report.rpm is not None else None,
                    "load_percentage": float(iso_data.load_percentage) if iso_data.load_percentage else None,
                    "engine_speed_rpm": float(iso_data.engine_speed_graph_rpm) if iso_data.engine_speed_graph_rpm else None,
                    "sfoc_g_kwh": float(iso_data.sfoc_graph_g_kwh) if iso_data.sfoc_graph_g_kwh else None,
                    "max_combustion_pressure_bar": float(iso_data.max_combustion_pressure_iso_bar) if iso_data.max_combustion_pressure_iso_bar else None,
                    "compression_pressure_bar": float(iso_data.compression_pressure_iso_bar) if iso_data.compression_pressure_iso_bar else None,
                    "scav_air_pressure_kg_cm2": float(iso_data.scav_air_pressure_graph_kg_cm2) if iso_data.scav_air_pressure_graph_kg_cm2 else None,
                    # "turbocharger_speed_x1000_rpm": float(iso_data.turbocharger_speed_graph_x1000_rpm_scaled) if iso_data.turbocharger_speed_graph_x1000_rpm_scaled else None,
                    "turbocharger_speed_x1000_rpm": float(report.turbocharger_rpm_avg) if report.turbocharger_rpm_avg else None,
                    "exh_temp_tc_inlet_c": float(iso_data.exh_temp_tc_inlet_iso_c) if iso_data.exh_temp_tc_inlet_iso_c else None,
                    "exh_temp_tc_outlet_c": float(iso_data.exh_temp_tc_outlet_iso_c) if iso_data.exh_temp_tc_outlet_iso_c else None,
                    "cyl_exhaust_gas_temp_outlet_c": float(iso_data.cyl_exhaust_gas_temp_outlet_graph_c) if iso_data.cyl_exhaust_gas_temp_outlet_graph_c else None,
                    "fuel_consumption_total_kg_h": float(iso_data.fuel_consumption_total_graph_kg_h) if iso_data.fuel_consumption_total_graph_kg_h else None,
                    "fuel_inj_pump_index_mm": float(iso_data.fuel_inj_pump_index_graph_mm) if iso_data.fuel_inj_pump_index_graph_mm else None,
                    "correction_date": iso_data.correction_date.isoformat() if iso_data.correction_date else None,
                    "propeller_margin_percent": float(iso_data.propeller_margin_percent) if iso_data.propeller_margin_percent is not None else None,

                    "sfoc_g_kwh_raw": get_raw(report.sfoc_calculated_g_kwh),
                    "max_combustion_pressure_bar_raw": get_raw(report.max_comb_pr_avg_bar),
                    "compression_pressure_bar_raw": get_raw(report.comp_pr_avg_bar),
                    "scav_air_pressure_kg_cm2_raw": scav_raw_kgcm2,
                    "turbocharger_speed_x1000_rpm_raw": turbo_raw_x1000,
                    "engine_speed_rpm_raw": get_raw(report.rpm),
                    "exh_temp_tc_inlet_c_raw": get_raw(report.tc_exhaust_gas_temp_in_c),
                    "exh_temp_tc_outlet_c_raw": get_raw(report.tc_exhaust_gas_temp_out_c),
                    "cyl_exhaust_gas_temp_outlet_c_raw": get_raw(report.exh_temp_cylinder_outlet_ave_c),
                    "fuel_inj_pump_index_mm_raw": get_raw(report.fuel_injection_pump_index_mm),
                    "fuel_consumption_total_kg_h_raw": foc_raw_kg
                }
               
                monthly_performance_list.append(performance_data)
       
        return {
            "message": f"Retrieved {len(monthly_performance_list)} historical records (last {limit} reports)",
            "vessel_name": format_vessel_name(vessel.vessel_name),
            "imo_number": imo_number,
            "limit": limit,
            "reference_month": ref_month,
            "total_records": len(monthly_performance_list),
            "monthly_performance_list": monthly_performance_list
        }
       
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error retrieving performance history: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ============================================
# ðŸ”¥ NEW: AE HISTORICAL PERFORMANCE ENDPOINT
# ============================================
# In app/api.py

# 🔥 CHANGE 1: Route updated to match Frontend (/aux/history)
@app.get("/aux/history")
async def get_ae_performance_history(
    generator_id: int,
    limit: Optional[int] = 6,
    ref_month: str = None,
    imo_number: Optional[int] = None, # 🔥 CHANGE 2: Added to handle frontend query param
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Get historical AE performance data for a specific generator.
    
    ðŸ”¥ FILTERS BY generator_id (not just imo_number)
    """
    try:
        logger.info(f"AE Historical data request: generator_id={generator_id}, limit={limit}")
       
        if limit is None or limit <= 0:
            limit = 6
       
        # Get generator info
        generator = db.query(VesselGenerator).filter(
            VesselGenerator.generator_id == generator_id
        ).first()

        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(generator.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
       
        if not generator:
            raise HTTPException(status_code=404, detail=f"Generator {generator_id} not found")
       
        # Query reports for THIS specific generator only
        historical_reports_query = db.query(GeneratorMonthlyReportHeader).filter(
            GeneratorMonthlyReportHeader.generator_id == generator_id
        )
       
        # Logic to handle ref_month selection
        if ref_month:
            try:
                # 1. Parse selected month (e.g., "2024-02" -> 2024-02-01)
                ref_dt_start = datetime.strptime(ref_month + "-01", "%Y-%m-%d").date()
                
                # 2. Calculate start of NEXT month (e.g., 2024-03-01)
                ref_dt_cutoff = ref_dt_start + relativedelta(months=1)
                
                # 3. Filter STRICTLY BEFORE the next month (captures any date within the month)
                historical_reports_query = historical_reports_query.filter(
                    GeneratorMonthlyReportHeader.report_date < ref_dt_cutoff
                )
            except ValueError:
                raise HTTPException(status_code=400, detail="ref_month must be in YYYY-MM format")
                
        historical_reports = historical_reports_query.order_by(
            desc(GeneratorMonthlyReportHeader.report_date)
        ).limit(limit).all()
       
        logger.info(f"Found {len(historical_reports)} AE reports for generator {generator.designation}")
       
        if not historical_reports:
            return {
                "message": f"No historical data found for generator {generator.designation}",
                "generator_designation": generator.designation,
                "generator_id": generator_id,
                "limit": limit,
                "reference_month": ref_month,
                "total_records": 0,
                "monthly_performance_list": []
            }
       
        monthly_performance_list = []
       
        for report in historical_reports:
            perf_data = db.query(GeneratorMonthlyPerformanceData).filter(
                GeneratorMonthlyPerformanceData.report_id == report.report_id
            ).first()
           
            if perf_data:
                performance_data = {
                    "report_id": report.report_id,
                    "generator_id": generator_id,
                    "report_month": report.report_month,
                    "report_date": report.report_date.isoformat() if report.report_date else None,
                    "load_percentage": float(perf_data.load_percentage) if perf_data.load_percentage else None,
                    "cylinder_readings": report.cylinder_readings,
                    "load_kw": float(perf_data.load_kw) if perf_data.load_kw else None,
                    "engine_speed_rpm": float(perf_data.engine_speed_rpm) if perf_data.engine_speed_rpm else None,
                    "sfoc_g_kwh": float(perf_data.sfoc_g_kwh) if perf_data.sfoc_g_kwh else None,
                    "fuel_rack_position_mm": float(perf_data.fuel_rack_position_mm) if perf_data.fuel_rack_position_mm else None,
                    "exhaust_gas_temp_before_tc_c": float(perf_data.exhaust_gas_temp_before_tc_c) if perf_data.exhaust_gas_temp_before_tc_c else None,
                    "exhaust_gas_temp_after_tc_c": float(perf_data.exhaust_gas_temp_after_tc_c) if perf_data.exhaust_gas_temp_after_tc_c else None,
                    
                    # --- Exh Cyl Outlet ---
                    "exh_temp_cyl_outlet_avg_graph_c": float(perf_data.exh_temp_cyl_outlet_avg_graph_c) if perf_data.exh_temp_cyl_outlet_avg_graph_c else None,

                    "scav_air_pressure_bar": float(perf_data.scav_air_pressure_bar) if perf_data.scav_air_pressure_bar else None,
                    "max_combustion_pressure_bar": float(perf_data.max_combustion_pressure_bar) if perf_data.max_combustion_pressure_bar else None,
                    "compression_pressure_bar": float(perf_data.compression_pressure_bar) if perf_data.compression_pressure_bar else None,
                    "turbocharger_speed_rpm": float(perf_data.turbocharger_speed_rpm) if perf_data.turbocharger_speed_rpm else None
                }
                monthly_performance_list.append(performance_data)
       
        return {
            "message": f"Retrieved {len(monthly_performance_list)} historical records (last {limit} reports)",
            "generator_designation": generator.designation,
            "generator_id": generator_id,
            "limit": limit,
            "reference_month": ref_month,
            "total_records": len(monthly_performance_list),
            "monthly_performance_list": monthly_performance_list
        }
       
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error retrieving AE performance history: {e}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")


# ============================================
# ME BASELINE PERFORMANCE ENDPOINT
# ============================================
@app.get("/api/performance/{imo_number}/baseline")
async def get_baseline_performance(
    imo_number: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """Get baseline (shop trial) performance data for a vessel."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        logger.info(f"Fetching baseline data for IMO: {imo_number}")
       
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail=f"Vessel with IMO {imo_number} not found")
       
        sessions = db.query(ShopTrialSession).filter(
            ShopTrialSession.engine_no == vessel.engine_no
        ).all()
       
        if not sessions:
            raise HTTPException(status_code=404, detail=f"No shop trial sessions found")
       
        session_id = sessions[0].session_id
        baseline_records = db.query(ShopTrialPerformanceData).filter(
            ShopTrialPerformanceData.session_id == session_id
        ).order_by(ShopTrialPerformanceData.load_percentage).all()
       
        if not baseline_records:
            raise HTTPException(status_code=404, detail=f"No shop trial performance data found")
       
        baseline_data = []
        for record in baseline_records:
            baseline_data.append({
                "load_percentage": float(record.load_percentage) if record.load_percentage is not None else None,
                "engine_output_kw": float(record.engine_output_kw) if record.engine_output_kw is not None else None,
                "engine_speed_rpm": float(record.engine_speed_rpm) if record.engine_speed_rpm is not None else None,
                "max_combustion_pressure_bar": (
                    float(record.max_combustion_pressure_iso_bar) if record.max_combustion_pressure_iso_bar is not None
                    else (float(record.max_combustion_pressure_bar) if record.max_combustion_pressure_bar is not None else None)
                ),
                "scav_air_pressure_kg_cm2": (
                    float(record.scav_air_pressure_iso_kg_cm2) if record.scav_air_pressure_iso_kg_cm2 is not None
                    else (
                        float(record.turbocharger_gas_inlet_press_kg_cm2) if record.turbocharger_gas_inlet_press_kg_cm2 is not None
                        else (float(record.scav_air_pressure_bar) * 1.01972 if record.scav_air_pressure_bar is not None else None)
                    )
                ),
                "turbocharger_speed_x1000_rpm": (
                    float(record.turbocharger_speed_x1000_iso_rpm) if record.turbocharger_speed_x1000_iso_rpm is not None
                    else (float(record.turbocharger_speed_x1000_rpm) if record.turbocharger_speed_x1000_rpm is not None else None)
                ),
                "exh_temp_tc_inlet_c": (
                    float(record.exh_temp_tc_inlet_iso_c) if record.exh_temp_tc_inlet_iso_c is not None
                    else (float(record.exh_temp_tc_inlet_c) if record.exh_temp_tc_inlet_c is not None else None)
                ),
                "exh_temp_tc_outlet_c": (
                    float(record.exh_temp_tc_outlet_iso_c) if record.exh_temp_tc_outlet_iso_c is not None
                    else (float(record.exh_temp_tc_outlet_c) if record.exh_temp_tc_outlet_c is not None else None)
                ),
                "cyl_exhaust_gas_temp_outlet_c": float(record.exh_temp_cylinder_outlet_ave_c) if record.exh_temp_cylinder_outlet_ave_c is not None else None,
                "fuel_consumption_total_kg_h": float(record.fuel_oil_consumption_kg_h) if record.fuel_oil_consumption_kg_h is not None else None,
                "sfoc_g_kwh": (
                    float(record.fuel_oil_consumption_iso_g_kwh) if record.fuel_oil_consumption_iso_g_kwh is not None
                    else (float(record.fuel_oil_consumption_g_kwh) if record.fuel_oil_consumption_g_kwh is not None else None)
                ),
                "fuel_inj_pump_index_mm": float(record.fuel_injection_pump_index_mm) if record.fuel_injection_pump_index_mm is not None else None
            })
       
        if not baseline_data:
            raise HTTPException(status_code=500, detail=f"Could not process baseline data")
       
        return {
            "message": f"Baseline data retrieved for vessel {vessel.vessel_name}",
            "vessel_info": {
                "vessel_name": format_vessel_name(vessel.vessel_name),
                "imo_number": vessel.imo_number,
                "engine_no": vessel.engine_no,
                "engine_maker": vessel.engine_maker,
                "engine_model": vessel.engine_model
            },
            "baseline_data": baseline_data,
            "total_points": len(baseline_data)
        }
       
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching baseline: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving baseline data: {str(e)}")


# ============================================
# REMAINING ENDPOINTS (Fleet, Alerts, Dashboard, etc.)
# ============================================
@app.get("/api/fleet/config-summary-live")
async def get_fleet_configuration_summary_live(db: Session = Depends(get_db), control_db: AsyncSession = Depends(get_control_db), current_user: Any = Depends(auth.get_current_user)):
    """Executes live SQL queries to get configuration counts and unconfigured lists."""
    logger.info("Executing live fleet configuration summary queries.")
    allowed_imos, role = await get_allowed_vessel_imos(current_user)
    allowed_imos_str =[str(x) for x in allowed_imos]
    # Total ships from WORKPLACE vessel table (control DB)
    total_ships_result = await control_db.execute(
        select(func.count(Vessel.imo)).where(Vessel.imo.in_(allowed_imos_str))
    )
    total_ships = total_ships_result.scalar() or 0

    # ME configured count (from vessel_info joined with shop_trial_session)
    me_configured_imo_count = db.query(func.count(distinct(VesselInfo.imo_number))).join(
        ShopTrialSession, VesselInfo.engine_no == ShopTrialSession.engine_no
    ).filter(VesselInfo.imo_number.in_(allowed_imos)).scalar()
    me_configured_ships = me_configured_imo_count if me_configured_imo_count is not None else 0

    # AE configured count
    ae_configured_imo_count = db.query(func.count(distinct(VesselInfo.imo_number))).join(
        GeneratorBaselineData, VesselInfo.imo_number == GeneratorBaselineData.imo_number
    ).filter(VesselInfo.imo_number.in_(allowed_imos)).scalar()
    ae_configured_ships = ae_configured_imo_count if ae_configured_imo_count is not None else 0

    # Get all vessels from control DB
    all_control_vessels_result = await control_db.execute(
        select(Vessel).where(Vessel.imo.in_(allowed_imos_str))
    )
    all_control_vessels = all_control_vessels_result.scalars().all()

    # Get ME configured IMOs as strings for comparison
    me_configured_imos = set(
        str(r[0]) for r in db.query(distinct(VesselInfo.imo_number)).join(
            ShopTrialSession, VesselInfo.engine_no == ShopTrialSession.engine_no
        ).all()
    )

    # Get AE configured IMOs as strings for comparison
    ae_configured_imos = set(
        str(r[0]) for r in db.query(distinct(GeneratorBaselineData.imo_number)).all()
    )

    # Full fleet from control DB (for the configured table in frontend)
    full_fleet = [
        {"imo": str(v.imo), "name": v.name}
        for v in all_control_vessels
    ]

    # ME unconfigured = vessels in control DB but NOT in me_configured_imos
    me_unconfigured_list = [
        {"imo": str(v.imo), "name": v.name}
        for v in all_control_vessels
        if str(v.imo) not in me_configured_imos
    ]

    # AE unconfigured = vessels in control DB but NOT in ae_configured_imos
    ae_unconfigured_list = [
        {"imo": str(v.imo), "name": v.name}
        for v in all_control_vessels
        if str(v.imo) not in ae_configured_imos
    ]

    return {
        "total_ships": total_ships,
        "me_configured_ships": me_configured_ships,
        "ae_configured_ships": ae_configured_ships,
        "me_unconfigured_list": me_unconfigured_list,
        "ae_unconfigured_list": ae_unconfigured_list,
        "fleet": full_fleet
    }


@app.get("/performance/alerts/{report_id}")
async def get_me_alerts(report_id: int, db: Session = Depends(get_db),current_user: Any = Depends(auth.get_current_user)):
    """Get categorized ME performance alerts for a specific report."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    report = db.query(MEAlertSummary).filter_by(report_id=report_id).first()
    if report and str(report.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        normal_alerts = db.query(MENormalStatus).filter_by(report_id=report_id).all()
        warning_alerts = db.query(MEWarningAlert).filter_by(report_id=report_id).all()
        critical_alerts = db.query(MECriticalAlert).filter_by(report_id=report_id).all()
       
        def alert_to_dict(alert):
            return {
                "id": alert.id,
                "metric_name": alert.metric_name,
                "baseline_value": alert.baseline_value,
                "actual_value": alert.actual_value,
                "deviation": alert.deviation,
                "deviation_pct": alert.deviation_pct,
                "created_at": alert.created_at.isoformat() if alert.created_at else None
            }
       
        return {
            "report_id": report_id,
            "total_alerts": len(normal_alerts) + len(warning_alerts) + len(critical_alerts),
            "normal": [alert_to_dict(a) for a in normal_alerts],
            "warning": [alert_to_dict(a) for a in warning_alerts],
            "critical": [alert_to_dict(a) for a in critical_alerts]
        }
       
    except Exception as e:
        logger.error(f"Error fetching ME alerts for report {report_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Error retrieving alerts: {str(e)}")


@app.get("/performance/alerts/summary/{report_id}")
async def get_me_alert_summary(report_id: int, db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)):
    """Get precomputed ME alert summary for a specific report."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    report = db.query(MEAlertSummary).filter_by(report_id=report_id).first()
    if report and str(report.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        summary = db.query(MEAlertSummary).filter(
            MEAlertSummary.report_id == report_id
        ).first()
       
        if not summary:
            raise HTTPException(
                status_code=404,
                detail=f"No alert summary found for report {report_id}"
            )
       
        return {
            "report_id": summary.report_id,
            "vessel_name": summary.vessel_name,
            "imo_number": summary.imo_number,
            "report_date": summary.report_date.isoformat(),
            "report_month": summary.report_month,
            "alert_counts": {
                "normal": summary.normal_count,
                "warning": summary.warning_count,
                "critical": summary.critical_count,
                "total": summary.normal_count + summary.warning_count + summary.critical_count
            },
            "dominant_status": summary.dominant_status,
            "created_at": summary.created_at.isoformat(),
            "updated_at": summary.updated_at.isoformat()
        }
       
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching alert summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/performance/alerts/fleet-summary")
async def get_fleet_alert_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """Get ME alert summaries for entire fleet with optional filters."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    query = db.query(MEAlertSummary).filter(
        MEAlertSummary.imo_number.in_(allowed_imos)
    )
    from sqlalchemy import extract, and_
   
    try:
        query = db.query(MEAlertSummary)
       
        filters = []
       
        if year:
            filters.append(extract('year', MEAlertSummary.report_date) == year)
       
        if month:
            filters.append(extract('month', MEAlertSummary.report_date) == month)
       
        if status_filter and status_filter in ['Normal', 'Warning', 'Critical']:
            filters.append(MEAlertSummary.dominant_status == status_filter)
       
        if filters:
            query = query.filter(and_(*filters))
       
        summaries = query.order_by(desc(MEAlertSummary.report_date)).all()
       
        result = []
        for summary in summaries:
            result.append({
                "report_id": summary.report_id,
                "vessel_name": summary.vessel_name,
                "imo_number": summary.imo_number,
                "report_date": summary.report_date.isoformat(),
                "report_month": summary.report_month,
                "dominant_status": summary.dominant_status,
                "alert_counts": {
                    "normal": summary.normal_count,
                    "warning": summary.warning_count,
                    "critical": summary.critical_count,
                    "total": summary.normal_count + summary.warning_count + summary.critical_count
                }
            })
       
        total_reports = len(result)
        status_breakdown = {
            "normal": sum(1 for r in result if r["dominant_status"] == "Normal"),
            "warning": sum(1 for r in result if r["dominant_status"] == "Warning"),
            "critical": sum(1 for r in result if r["dominant_status"] == "Critical")
        }
       
        return {
            "total_reports": total_reports,
            "fleet_status_breakdown": status_breakdown,
            "filters_applied": {
                "year": year,
                "month": month,
                "status": status_filter
            },
            "reports": result
        }
       
    except Exception as e:
        logger.error(f"Error fetching fleet alert summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/performance/me-dashboard-summary")
async def get_me_dashboard_summary(
    year: int,
    month: Optional[int] = None,
    imo_number: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """Returns ME performance status summaries for vessels."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)  # ADD
    # ADD at top of try block - filter by allowed IMOs:
    # if imo_number passed, verify it's allowed:
    if imo_number and str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    from sqlalchemy import extract, and_, func, desc
   
    try:
        base_query = db.query(
            MonthlyReportHeader.report_id,
            MonthlyReportHeader.imo_number,
            MonthlyReportHeader.report_date,
            MonthlyReportHeader.report_month,
            VesselInfo.vessel_name
        ).join(
            VesselInfo, MonthlyReportHeader.imo_number == VesselInfo.imo_number
        ).filter(
            extract('year', MonthlyReportHeader.report_date) == year
        )

        base_query = base_query.filter(MonthlyReportHeader.imo_number.in_(allowed_imos))
       
        if imo_number:
            base_query = base_query.filter(MonthlyReportHeader.imo_number.in_(allowed_imos))

        if month is None:
            latest_dates_subquery = db.query(
                MonthlyReportHeader.imo_number.label('imo'),
                extract('month', MonthlyReportHeader.report_date).label('report_month_num'),
                func.max(MonthlyReportHeader.report_date).label('latest_date')
            ).filter(
                extract('year', MonthlyReportHeader.report_date) == year
            )
            # ALWAYS filter the subquery by allowed IMOs first
            latest_dates_subquery = latest_dates_subquery.filter(MonthlyReportHeader.imo_number.in_(allowed_imos))
            
            # If a specific vessel is clicked, filter down further
            if imo_number:
                latest_dates_subquery = latest_dates_subquery.filter(MonthlyReportHeader.imo_number == imo_number)

            latest_dates_subquery = latest_dates_subquery.group_by(
                MonthlyReportHeader.imo_number,
                extract('month', MonthlyReportHeader.report_date)
            ).subquery()

            reports_query = db.query(
                MonthlyReportHeader,
                VesselInfo.vessel_name
            ).join(
                VesselInfo, MonthlyReportHeader.imo_number == VesselInfo.imo_number
            ).join(
                latest_dates_subquery,
                and_(
                    MonthlyReportHeader.imo_number == latest_dates_subquery.c.imo,
                    MonthlyReportHeader.report_date == latest_dates_subquery.c.latest_date
                )
            ).order_by(VesselInfo.vessel_name, latest_dates_subquery.c.report_month_num)

        else:
            reports_query = base_query.filter(extract('month', MonthlyReportHeader.report_date) == month)
            reports_query = reports_query.order_by(VesselInfo.vessel_name, MonthlyReportHeader.report_date)

        reports = reports_query.all()
       
        if not reports:
            return {"data": [], "count": 0}
       
        is_monthly_summary = isinstance(reports[0], tuple)

        report_ids = [r[0].report_id if is_monthly_summary else r.report_id for r in reports]
        summaries = db.query(MEAlertSummary).filter(MEAlertSummary.report_id.in_(report_ids)).all()
        summary_dict = {s.report_id: s for s in summaries}
       
        response = []
        for item in reports:
            report = item[0] if is_monthly_summary else item
            raw_name = item[1] if is_monthly_summary else item.vessel_name
            vessel_name = item[1] if is_monthly_summary else item.vessel_name

            summary = summary_dict.get(report.report_id)
            dominant_status = summary.dominant_status if summary else "No Report"
           
            from app.models import MECriticalAlert, MEWarningAlert, MENormalStatus
           
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
               
            else:
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
           
            response.append({
                "report_id": report.report_id,
                "vessel_name": vessel_name,
                "imo_number": report.imo_number,
                "report_date": report.report_date.strftime("%Y-%m-%d"),
                "report_month": report.report_month,
                "status": dominant_status,
                "dominant_parameters": dom_params
            })
       
        return {"data": response, "count": len(response)}
       
    except Exception as e:
        logger.error(f"Error fetching ME dashboard summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/fleet/propeller-margin-overview", tags=["Fleet Overview"])
async def get_propeller_margin_overview(db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)) -> Dict[str, Any]:
    """Retrieves the latest propeller margin percentage for every vessel."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    from sqlalchemy import func, desc
   
    logger.info("Executing fleet propeller margin overview query.")
    try:
        latest_report_rank_subquery = db.query(
            MonthlyISOPerformanceData.imo_number.label('imo'),
            MonthlyISOPerformanceData.propeller_margin_percent,
            MonthlyReportHeader.report_date,
            MonthlyReportHeader.report_month,
            func.row_number().over(
                partition_by=MonthlyISOPerformanceData.imo_number,
                order_by=desc(MonthlyReportHeader.report_date)
            ).label('rn')
        ).join(
            MonthlyReportHeader,
            MonthlyISOPerformanceData.report_id == MonthlyReportHeader.report_id
        ).filter(
            MonthlyISOPerformanceData.propeller_margin_percent.isnot(None)
        ).subquery()

        results = db.query(
            VesselInfo.vessel_name,
            VesselInfo.imo_number,
            latest_report_rank_subquery.c.report_month,
            latest_report_rank_subquery.c.report_date,
            latest_report_rank_subquery.c.propeller_margin_percent
        ).join(
            VesselInfo,
            latest_report_rank_subquery.c.imo == VesselInfo.imo_number
        ).filter(
            latest_report_rank_subquery.c.rn == 1,
            MonthlyISOPerformanceData.imo_number.in_(allowed_imos)
        ).all()
       
        overview_data = []
        for name, imo, month, date, margin_percent in results:
            overview_data.append({
                "vessel_name": format_vessel_name(name), 
                "imo_number": imo,
                "report_month": month,
                "report_date": date.isoformat() if date else None,
                "propeller_margin_percent": float(margin_percent) if margin_percent is not None else None
            })
           
        return {
            "message": f"Retrieved latest propeller margin for {len(overview_data)} vessels.",
            "total_vessels_reported": len(overview_data),
            "data": overview_data
        }

    except Exception as e:
        logger.error(f"Error fetching propeller margin overview: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
# ... (inside app/api.py)

@app.get("/api/v1/fleet/propeller-margin-trend", tags=["Fleet Overview"])
async def get_propeller_margin_trend(
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)   # ← ADD THIS
) -> Dict[str, Any]:
    """
    Retrieves the latest margin AND a history of the last 12 reports 
    for every vessel to generate sparkline charts.
    
    UPDATED: Returns the raw Propeller Margin % directly from the database
    (No longer calculates deviation from 100).
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)  
    from sqlalchemy import func, desc
    
    # 1. Subquery: Get last 12 reports for every vessel where margin is not null
    subquery = db.query(
        MonthlyReportHeader.imo_number,
        MonthlyReportHeader.report_date,
        MonthlyISOPerformanceData.propeller_margin_percent,
        func.row_number().over(
            partition_by=MonthlyReportHeader.imo_number,
            order_by=desc(MonthlyReportHeader.report_date)
        ).label('rn')
    ).join(
        MonthlyISOPerformanceData,
        MonthlyReportHeader.report_id == MonthlyISOPerformanceData.report_id
    ).filter(
        MonthlyISOPerformanceData.propeller_margin_percent.isnot(None),
        MonthlyReportHeader.imo_number.in_(allowed_imos) 
    ).subquery()

    # 2. Query: Fetch the Top 12 records per vessel
    raw_data = db.query(
        VesselInfo.vessel_name,
        VesselInfo.imo_number,
        VesselInfo.display_order,
        subquery.c.report_date,
        subquery.c.propeller_margin_percent
    ).join(
        VesselInfo,
        subquery.c.imo_number == VesselInfo.imo_number
    ).filter(
        subquery.c.rn <= 12 
    ).order_by(
        VesselInfo.display_order.asc(),
        VesselInfo.vessel_name,
        subquery.c.report_date.asc() # Sort ascending for the graph (Oldest -> Newest)
    ).all()

    # 3. Processing: Group data by Vessel
    grouped = {}
    for name, imo, order, r_date, margin in raw_data:
        if imo not in grouped:
            grouped[imo] = {
                "vessel_name": format_vessel_name(name),
                "imo_number": imo,
                "display_order": order,
                "current_margin": None,
                "history": []
            }
        
        # --- UPDATED LOGIC ---
        # Get raw value from DB directly (e.g., 91.5)
        # Previous logic removed: final_value = round(100.0 - db_value, 2)
        
        db_value = float(margin) if margin is not None else 0
        final_value = round(db_value, 2)

        # Add to history list for the graph
        grouped[imo]["history"].append({
            "date": r_date.strftime("%Y-%m-%d"), 
            "value": final_value 
        })
        
        # Save current margin for the badge
        # Since the query is ordered by Date ASC, the last iteration for an IMO is the latest date
        grouped[imo]["current_margin"] = final_value

    return {
        "data": list(grouped.values())
    }
@app.get("/performance/ae-alerts/fleet")
async def get_ae_fleet_alert_summary(
    year: Optional[int] = None,
    month: Optional[int] = None,
    imo_number: Optional[int] = None,
    status_filter: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """Get AE alert summaries for entire fleet with optional filters."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    report = db.query(MEAlertSummary).filter_by(report_id=report_id).first()
    query = db.query(AEAlertSummary).filter(
        AEAlertSummary.imo_number.in_(allowed_imos)
    )
    from sqlalchemy import extract, and_, desc
   
    try:
        query = db.query(AEAlertSummary)
       
        filters = []
        if year:
            filters.append(extract('year', AEAlertSummary.report_date) == year)
        if month:
            filters.append(extract('month', AEAlertSummary.report_date) == month)
        if imo_number:
            filters.append(AEAlertSummary.imo_number == imo_number)
        if status_filter and status_filter in ['Normal', 'Warning', 'Critical']:
            filters.append(AEAlertSummary.dominant_status == status_filter)
       
        if filters:
            query = query.filter(and_(*filters))
       
        summaries = query.order_by(desc(AEAlertSummary.report_date)).all()
       
        result = []
        for summary in summaries:
            result.append({
                "report_id": summary.report_id,
                "generator_designation": summary.generator_designation,
                "vessel_name": format_vessel_name(summary.vessel_name),
                "imo_number": summary.imo_number,
                "report_date": summary.report_date.isoformat(),
                "report_month": summary.report_month,
                "dominant_status": summary.dominant_status,
                "alert_counts": {
                    "normal": summary.normal_count,
                    "warning": summary.warning_count,
                    "critical": summary.critical_count,
                    "total": summary.normal_count + summary.warning_count + summary.critical_count
                }
            })
       
        status_breakdown = {
            "normal": sum(1 for r in result if r["dominant_status"] == "Normal"),
            "warning": sum(1 for r in result if r["dominant_status"] == "Warning"),
            "critical": sum(1 for r in result if r["dominant_status"] == "Critical")
        }
       
        return {
            "total_reports": len(result),
            "fleet_status_breakdown": status_breakdown,
            "filters_applied": {
                "year": year,
                "month": month,
                "imo_number": imo_number,
                "status": status_filter
            },
            "reports": result
        }
       
    except Exception as e:
        logger.error(f"Error fetching AE fleet summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/performance/ae-alerts/summary/{report_id}")
async def get_ae_alert_summary_endpoint(
    report_id: int, 
    db: Session = Depends(get_db), 
    current_user: Any = Depends(auth.get_current_user)
):
    """Get precomputed AE alert summary"""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    report = db.query(MEAlertSummary).filter_by(report_id=report_id).first()
    if report and str(report.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    from app.ae_alert_processor import get_ae_alert_summary
    try:
        return get_ae_alert_summary(db, report_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error fetching AE alert summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/performance/ae-alerts/{report_id}")
async def get_ae_alerts(report_id: int, db: Session = Depends(get_db), current_user: Any = Depends(auth.get_current_user)):
    """Get all AE alerts for a specific report"""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    report = db.query(MEAlertSummary).filter_by(report_id=report_id).first()
    if report and str(report.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    from app.ae_alert_processor import get_ae_alerts_by_report
    try:
        return get_ae_alerts_by_report(db, report_id)
    except Exception as e:
        logger.error(f"Error fetching AE alerts: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/performance/ae-alerts/reprocess/{report_id}")
async def reprocess_ae_alerts(report_id: int, db: Session = Depends(get_db)):
    """Manually reprocess AE alerts for a report"""
    from app.ae_alert_processor import process_ae_alerts
    try:
        result = process_ae_alerts(db, report_id)
        return {
            "message": "AE alerts reprocessed successfully",
            **result
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error reprocessing AE alerts: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/performance/ae-dashboard-summary")
async def get_ae_dashboard_summary(
    year: int,
    month: Optional[int] = None,
    imo_number: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """AE Dashboard Summary - mirrors ME dashboard structure"""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)  # ADD
    if imo_number and str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    from sqlalchemy import extract, and_, func, desc
    from app.generator_models import AECriticalAlert, AEWarningAlert, AENormalStatus

    try:
        base_query = db.query(
            GeneratorMonthlyReportHeader.report_id,
            GeneratorMonthlyReportHeader.report_date,
            GeneratorMonthlyReportHeader.report_month,
            VesselGenerator.generator_id,
            VesselGenerator.designation,
            VesselGenerator.imo_number,
            VesselInfo.vessel_name
        ).join(
            VesselGenerator, GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
        ).join(
            VesselInfo, VesselGenerator.imo_number == VesselInfo.imo_number
        ).filter(
            extract('year', GeneratorMonthlyReportHeader.report_date) == year
        )
        base_query = base_query.filter(VesselGenerator.imo_number.in_(allowed_imos))
        if imo_number:
            base_query = base_query.filter(VesselGenerator.imo_number.in_(allowed_imos))

        if month is None:
            latest_dates_subquery = db.query(
                GeneratorMonthlyReportHeader.generator_id.label('gen_id'),
                extract('month', GeneratorMonthlyReportHeader.report_date).label('report_month_num'),
                func.max(GeneratorMonthlyReportHeader.report_date).label('latest_date')
            ).filter(
                extract('year', GeneratorMonthlyReportHeader.report_date) == year
            ).group_by(
                GeneratorMonthlyReportHeader.generator_id,
                extract('month', GeneratorMonthlyReportHeader.report_date)
            ).subquery()

            reports_query = db.query(
                GeneratorMonthlyReportHeader,
                VesselGenerator.designation,
                VesselGenerator.imo_number,
                VesselInfo.vessel_name
            ).join(
                VesselGenerator, GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
            ).join(
                VesselInfo, VesselGenerator.imo_number == VesselInfo.imo_number
            ).join(
                latest_dates_subquery,
                and_(
                    GeneratorMonthlyReportHeader.generator_id == latest_dates_subquery.c.gen_id,
                    GeneratorMonthlyReportHeader.report_date == latest_dates_subquery.c.latest_date
                )
            )
            # ALWAYS filter by allowed IMOs
            reports_query = reports_query.filter(VesselGenerator.imo_number.in_(allowed_imos))
            
            if imo_number:
                reports_query = reports_query.filter(VesselGenerator.imo_number == imo_number)
               
            reports_query = reports_query.order_by(VesselInfo.vessel_name, VesselGenerator.designation)

        else:
            reports_query = base_query.filter(
                extract('month', GeneratorMonthlyReportHeader.report_date) == month
            ).order_by(VesselInfo.vessel_name, VesselGenerator.designation, GeneratorMonthlyReportHeader.report_date)

        reports = reports_query.all()
       
        if not reports:
            return {"data": [], "count": 0}
       
        is_monthly_summary = month is None
       
        if is_monthly_summary:
            report_ids = [r[0].report_id for r in reports]
        else:
            report_ids = [r.report_id for r in reports]
           
        summaries = db.query(AEAlertSummary).filter(AEAlertSummary.report_id.in_(report_ids)).all()
        summary_dict = {s.report_id: s for s in summaries}
       
        response = []
        for item in reports:
            if is_monthly_summary:
                report, designation, imo, vessel_name = item
            else:
                report = item
                designation = item.designation
                vessel_name = item.vessel_name
                imo = item.imo_number

            summary = summary_dict.get(report.report_id)
            dominant_status = summary.dominant_status if summary else "No Report"
           
            dom_params = []
            if dominant_status == "Critical":
                params = db.query(AECriticalAlert).filter_by(report_id=report.report_id).limit(5).all()
                dom_params = [{
                    "parameter": p.metric_name,
                    "baseline": float(p.baseline_value) if p.baseline_value else None,
                    "actual": float(p.actual_value) if p.actual_value else None,
                    "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                    "status": "Critical"
                } for p in params]
            elif dominant_status == "Warning":
                params = db.query(AEWarningAlert).filter_by(report_id=report.report_id).limit(5).all()
                dom_params = [{
                    "parameter": p.metric_name,
                    "baseline": float(p.baseline_value) if p.baseline_value else None,
                    "actual": float(p.actual_value) if p.actual_value else None,
                    "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                    "status": "Warning"
                } for p in params]
            else:
                params = db.query(AENormalStatus).filter_by(report_id=report.report_id).limit(5).all()
                dom_params = [{
                    "parameter": p.metric_name,
                    "baseline": float(p.baseline_value) if p.baseline_value else None,
                    "actual": float(p.actual_value) if p.actual_value else None,
                    "deviation_pct": float(p.deviation_pct) if p.deviation_pct else None,
                    "status": "Normal"
                } for p in params]
           
            response.append({
                "report_id": report.report_id,
                "generator_designation": designation,
                "vessel_name": format_vessel_name(vessel_name),
                "imo_number": imo,
                "report_date": report.report_date.strftime("%Y-%m-%d"),
                "report_month": report.report_month,
                "status": dominant_status,
                "dominant_parameters": dom_params
            })
       
        return {"data": response, "count": len(response)}
       
    except Exception as e:
        logger.error(f"Error fetching AE dashboard summary: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/v1/fleet/days-elapsed-overview", tags=["Fleet Overview"])
async def get_days_elapsed_overview(db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
) -> Dict[str, Any]:
    """Calculates days elapsed since the latest report date for each vessel."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    from sqlalchemy import extract
    from datetime import timedelta, date
   
    logger.info("Executing fleet days elapsed overview query.")
   
    try:
        latest_date_subquery = db.query(
            MonthlyReportHeader.imo_number.label('imo'),
            func.max(MonthlyReportHeader.report_date).label('latest_report_date')
        ).group_by(
            MonthlyReportHeader.imo_number
        ).subquery()
       
        results = db.query(
            VesselInfo.vessel_name,
            VesselInfo.imo_number,
            VesselInfo.display_order,
            latest_date_subquery.c.latest_report_date,
        ).join(
            latest_date_subquery,
            VesselInfo.imo_number == latest_date_subquery.c.imo
        ).order_by(
            VesselInfo.display_order.asc() # <--- CHANGE 2: Add sorting
        ).filter(
            VesselInfo.imo_number.in_(allowed_imos)
        ).all()

        today = date.today()
       
        overview_data = []
        for name, imo, order, latest_date in results:
           
            days_elapsed = "N/A"
            if latest_date:
                 time_difference: timedelta = today - latest_date
                 days_elapsed = time_difference.days
                 
                 if days_elapsed < 0:
                      days_elapsed = 0

            overview_data.append({
                "vessel_name": format_vessel_name(name),
                "imo_number": imo,
                "display_order": order,
                "report_date": latest_date.isoformat() if latest_date else None,
                "days_elapsed": days_elapsed
            })
           
        return {
            "message": f"Retrieved days elapsed for {len(overview_data)} vessels.",
            "data": overview_data
        }

    except Exception as e:
        logger.error(f"Error fetching days elapsed overview: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


# @app.get("/api/v1/fleet/ae-performance-overview", tags=["Fleet Overview"])
# async def get_ae_performance_overview(db: Session = Depends(get_db)) -> Dict[str, Any]:
#     """Retrieves latest report date and last 3 load percentages for every generator."""
#     from sqlalchemy import func, desc
   
#     try:
#         latest_report_rank_subquery = db.query(
#             GeneratorMonthlyReportHeader.generator_id.label('gen_id'),
#             GeneratorMonthlyReportHeader.report_date,
#             func.row_number().over(
#                 partition_by=GeneratorMonthlyReportHeader.generator_id,
#                 order_by=desc(GeneratorMonthlyReportHeader.report_date)
#             ).label('rn')
#         ).subquery()

#         latest_reports = db.query(
#             VesselInfo.vessel_name,
#             VesselInfo.imo_number,
#             VesselGenerator.designation,
#             latest_report_rank_subquery.c.report_date,
#         ).join(
#             VesselGenerator,
#             latest_report_rank_subquery.c.gen_id == VesselGenerator.generator_id
#         ).join(
#             VesselInfo,
#             VesselGenerator.imo_number == VesselInfo.imo_number
#         ).filter(
#             latest_report_rank_subquery.c.rn == 1
#         ).all()
       
#         running_hours_data = []
#         for name, imo, designation, date in latest_reports:
#             running_hours_data.append({
#                 "vessel_name": name,
#                 "imo_number": imo,
#                 "generator_designation": designation,
#                 "report_date": date.isoformat() if date else None,
#                 "running_hours": None
#             })

#         historical_load_rank_subquery = db.query(
#             VesselGenerator.designation.label('designation'),
#             VesselInfo.vessel_name.label('vessel_name'),
#             GeneratorMonthlyReportHeader.report_date,
#             GeneratorMonthlyPerformanceData.load_percentage,
#             func.row_number().over(
#                 partition_by=GeneratorMonthlyReportHeader.generator_id,
#                 order_by=desc(GeneratorMonthlyReportHeader.report_date)
#             ).label('rn')
#         ).join(
#             VesselGenerator,
#             GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
#         ).join(
#             VesselInfo,
#             VesselGenerator.imo_number == VesselInfo.imo_number
#         ).join(
#             GeneratorMonthlyPerformanceData,
#             GeneratorMonthlyReportHeader.report_id == GeneratorMonthlyPerformanceData.report_id
#         ).filter(
#              GeneratorMonthlyPerformanceData.load_percentage.isnot(None)
#         ).subquery()

#         historical_loads = db.query(
#             historical_load_rank_subquery.c.vessel_name,
#             historical_load_rank_subquery.c.designation,
#             historical_load_rank_subquery.c.report_date,
#             historical_load_rank_subquery.c.load_percentage.label('load_percent'),
#             historical_load_rank_subquery.c.rn
#         ).filter(
#             historical_load_rank_subquery.c.rn <= 3
#         ).order_by(
#             historical_load_rank_subquery.c.vessel_name,
#             historical_load_rank_subquery.c.designation,
#             historical_load_rank_subquery.c.rn
#         ).all()
       
#         load_history_map = {}
#         for vessel_name, designation, report_date, load_percent, rn in historical_loads:
#             key = f"{vessel_name}-{designation}"
#             if key not in load_history_map:
#                 load_history_map[key] = {
#                     "vessel_name": vessel_name,
#                     "generator_designation": designation,
#                     "load_history": [None, None, None]
#                 }
           
#             if rn <= 3:
#                 load_history_map[key]["load_history"][rn - 1] = {
#                     "report_date": report_date.isoformat() if report_date else None,
#                     "load_percent": float(load_percent) if load_percent is not None else None,
#                     "rank": rn
#                 }
           
#         return {
#             "message": f"Retrieved AE performance overview data.",
#             "running_hours_data": running_hours_data,
#             "load_history_data": list(load_history_map.values())
#         }

#     except Exception as e:
#         logger.error(f"Error fetching AE performance overview: {e}", exc_info=True)
#         raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


# @app.get("/api/v1/fleet/ae-performance-overview", tags=["Fleet Overview"])
# async def get_ae_performance_overview(
#     db: Session = Depends(get_db)
# ) -> Dict[str, Any]:
#     """
#     Retrieves:
#     1. Latest report date for every generator.
#     2. Last 3 load percentages for history.
#     3. Alert Status History for the last 12 months per generator.
#     """
#     from sqlalchemy import func, desc, and_
#     from datetime import date, timedelta
#     from dateutil.relativedelta import relativedelta

#     try:
#         # --- Date Calculation (Last 12 Months) ---
#         today = date.today()
#         # Start from the 1st of the month, 11 months ago (total 12 including current)
#         start_date = (today - relativedelta(months=11)).replace(day=1)

#         # --- 1. Latest Report Date ---
#         latest_report_rank_subquery = db.query(
#             GeneratorMonthlyReportHeader.generator_id.label('gen_id'),
#             GeneratorMonthlyReportHeader.report_date,
#             func.row_number().over(
#                 partition_by=GeneratorMonthlyReportHeader.generator_id,
#                 order_by=desc(GeneratorMonthlyReportHeader.report_date)
#             ).label('rn')
#         ).subquery()

#         latest_reports = db.query(
#             VesselInfo.vessel_name,
#             VesselInfo.imo_number,
#             VesselGenerator.designation,
#             latest_report_rank_subquery.c.report_date,
#         ).join(
#             VesselGenerator,
#             latest_report_rank_subquery.c.gen_id == VesselGenerator.generator_id
#         ).join(
#             VesselInfo,
#             VesselGenerator.imo_number == VesselInfo.imo_number
#         ).filter(
#             latest_report_rank_subquery.c.rn == 1
#         ).all()
       
#         running_hours_data = []
#         for name, imo, designation, r_date in latest_reports:
#             running_hours_data.append({
#                 "vessel_name": name,
#                 "imo_number": imo,
#                 "generator_designation": designation,
#                 "report_date": r_date.isoformat() if r_date else None,
#                 "running_hours": None 
#             })

#         # --- 2. Load History (Last 3) ---
#         historical_load_rank_subquery = db.query(
#             VesselGenerator.designation.label('designation'),
#             VesselInfo.vessel_name.label('vessel_name'),
#             GeneratorMonthlyReportHeader.report_date,
#             GeneratorMonthlyPerformanceData.load_percentage,
#             func.row_number().over(
#                 partition_by=GeneratorMonthlyReportHeader.generator_id,
#                 order_by=desc(GeneratorMonthlyReportHeader.report_date)
#             ).label('rn')
#         ).join(
#             VesselGenerator,
#             GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
#         ).join(
#             VesselInfo,
#             VesselGenerator.imo_number == VesselInfo.imo_number
#         ).join(
#             GeneratorMonthlyPerformanceData,
#             GeneratorMonthlyReportHeader.report_id == GeneratorMonthlyPerformanceData.report_id
#         ).filter(
#              GeneratorMonthlyPerformanceData.load_percentage.isnot(None)
#         ).subquery()

#         historical_loads = db.query(
#             historical_load_rank_subquery.c.vessel_name,
#             historical_load_rank_subquery.c.designation,
#             historical_load_rank_subquery.c.report_date,
#             historical_load_rank_subquery.c.load_percentage.label('load_percent'),
#             historical_load_rank_subquery.c.rn
#         ).filter(
#             historical_load_rank_subquery.c.rn <= 3
#         ).order_by(
#             historical_load_rank_subquery.c.vessel_name,
#             historical_load_rank_subquery.c.designation,
#             historical_load_rank_subquery.c.rn
#         ).all()
       
#         load_history_map = {}
#         for vessel_name, designation, report_date, load_percent, rn in historical_loads:
#             key = f"{vessel_name}-{designation}"
#             if key not in load_history_map:
#                 load_history_map[key] = {
#                     "vessel_name": vessel_name,
#                     "generator_designation": designation,
#                     "load_history": [None, None, None]
#                 }
#             if rn <= 3:
#                 load_history_map[key]["load_history"][rn - 1] = {
#                     "report_date": report_date.isoformat() if report_date else None,
#                     "load_percent": float(load_percent) if load_percent is not None else None,
#                     "rank": rn
#                 }

#         # --- 3. Alert Status History (Last 12 Months per Generator) ---
#         # Fetch status where report_date >= start_date
#         status_records = db.query(
#             AEAlertSummary.imo_number,
#             AEAlertSummary.generator_designation,
#             AEAlertSummary.report_month, # String like "January" or "Jan" depending on DB
#             AEAlertSummary.report_date,  # Use date to format YYYY-MM
#             AEAlertSummary.dominant_status
#         ).filter(
#             AEAlertSummary.report_date >= start_date
#         ).all()

#         # Structure: { imo: { "AE1": { "2025-12": "Normal" } } }
#         history_map = {} 

#         for imo, gen_desig, month_str, r_date, status in status_records:
#             if imo not in history_map:
#                 history_map[imo] = {}
#             if gen_desig not in history_map[imo]:
#                 history_map[imo][gen_desig] = {}
            
#             # Key by YYYY-MM for easy frontend matching
#             month_key = r_date.strftime("%Y-%m") 
            
#             # Logic: If duplicate reports exist for same month, take worst status
#             priority = {"Critical": 3, "Warning": 2, "Normal": 1}
#             current_status = history_map[imo][gen_desig].get(month_key, "None")
            
#             if priority.get(status, 0) > priority.get(current_status, 0):
#                  history_map[imo][gen_desig][month_key] = status
#             elif current_status == "None":
#                  history_map[imo][gen_desig][month_key] = status

#         return {
#             "message": "Retrieved AE performance overview data.",
#             "running_hours_data": running_hours_data,
#             "load_history_data": list(load_history_map.values()),
#             "status_history_data": history_map # ✅ New Data Structure
#         }

#     except Exception as e:
#         # logger.error(f"Error fetching AE performance overview: {e}", exc_info=True)
#         raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")


@app.get("/api/aux-engine/deviation/history-table/{generator_id}")
async def get_ae_deviation_history_table(
    generator_id: int,
    limit: int = 6,
    ref_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Fetches specific AE deviation parameters joined with Report Date for the last N reports.
    Now joins with GeneratorMonthlyPerformanceData to ensure 'Actual' values represent
    the report AVERAGES (matching the Summary table) rather than Peak/Worst values.
    """
    generator = db.query(VesselGenerator).filter(
        VesselGenerator.generator_id == generator_id
    ).first()
    if generator:
        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(generator.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
    try:
        target_date = None

        # 1. Determine the Target Date based on ref_date
        if ref_date:
            try:
                if len(ref_date) == 7: # Format: YYYY-MM
                    dt = datetime.strptime(ref_date, "%Y-%m").date()
                    # Calculate end of month
                    next_month = dt.replace(day=28) + timedelta(days=4)
                    target_date = next_month - timedelta(days=next_month.day)
                else: # Format: YYYY-MM-DD
                    target_date = datetime.strptime(ref_date, "%Y-%m-%d").date()
            except ValueError:
                logger.warning(f"Invalid ref_date format: {ref_date}, falling back to latest.")
                target_date = None

        # 2. If no ref_date, fallback to absolute latest in DB
        if not target_date:
            latest_in_db = db.query(
                GeneratorMonthlyReportHeader.report_date
            ).filter(
                GeneratorMonthlyReportHeader.generator_id == generator_id
            ).order_by(
                desc(GeneratorMonthlyReportHeader.report_date)
            ).first()
           
            if latest_in_db:
                target_date = latest_in_db[0]
            else:
                return {"generator_id": generator_id, "count": 0, "history": []}

        # 3. Query History with JOIN to Performance Data
        results = db.query(
            AEDeviationHistory,
            GeneratorMonthlyReportHeader.report_date,
            GeneratorMonthlyReportHeader.report_month,
            GeneratorMonthlyPerformanceData  # <--- Added to fetch Average values
        ).join(
            GeneratorMonthlyReportHeader,
            AEDeviationHistory.report_id == GeneratorMonthlyReportHeader.report_id
        ).join(
            GeneratorMonthlyPerformanceData, # <--- Joined Performance Data
            GeneratorMonthlyReportHeader.report_id == GeneratorMonthlyPerformanceData.report_id
        ).filter(
            AEDeviationHistory.generator_id == generator_id,
            GeneratorMonthlyReportHeader.report_date <= target_date
        ).order_by(
            desc(GeneratorMonthlyReportHeader.report_date)
        ).limit(limit).all()

        history_data = []
       
        # Unpack 4 items now (added perf)
        for dev, report_date, report_month, perf in results:
            
            # Helper to safely get float
            def get_val(val):
                return float(val) if val is not None else None

            history_data.append({
                "report_id": dev.report_id,
                "report_date": report_date.isoformat() if report_date else None,
                "report_month": report_month,
               
                # 1. LOAD (Keep from dev table)
                "load_percentage": float(dev.load_percentage) if dev.load_percentage else 0,
                "load_kw": float(dev.load_kw) if dev.load_kw else 0,
               
                # 2. FIPI (Fuel Rack Position) - Use Perf Data for Average
                "fipi_actual": get_val(perf.fuel_rack_position_mm or perf.fuel_pump_index_graph),
                "fipi_dev": float(dev.fuel_rack_dev) if dev.fuel_rack_dev is not None else None,

                # 3. Scavenge Air Pressure - Use Perf Data
                "scav_air_actual": get_val(perf.scav_air_pressure_bar or perf.boost_air_pressure_graph_bar),
                "scav_air_dev": float(dev.scav_air_dev) if dev.scav_air_dev is not None else None,

                # 4. Pmax - Use Perf Data (Average) instead of Dev (Peak)
                "pmax_actual": get_val(perf.max_combustion_pressure_bar or perf.pmax_graph_bar),
                "pmax_baseline": float(dev.pmax_baseline) if dev.pmax_baseline is not None else None,
                "pmax_dev": float(dev.pmax_dev) if dev.pmax_dev is not None else None,
                "pmax_dev_pct": float(dev.pmax_dev_pct) if dev.pmax_dev_pct is not None else None,

                # 5. Exhaust TC Inlet - Use Perf Data
                "tc_in_actual": get_val(perf.exhaust_gas_temp_before_tc_c or perf.exh_temp_tc_inlet_graph_c),
                "tc_in_dev": float(dev.tc_in_dev) if dev.tc_in_dev is not None else None,

                # 6. Exhaust TC Outlet - Use Perf Data
                "tc_out_actual": get_val(perf.exhaust_gas_temp_after_tc_c or perf.exh_temp_tc_outlet_graph_c),
                "tc_out_dev": float(dev.tc_out_dev) if dev.tc_out_dev is not None else None,

                # 7. Exhaust Cylindrical Outlet - Use Perf Data (Average)
                # Note: dev.exh_cyl_out_actual usually holds the Max cylinder temp, perf holds Average
                "exh_cyl_out_actual": get_val(perf.exh_temp_cyl_outlet_avg_graph_c),
                "exh_cyl_out_dev": float(dev.exh_cyl_out_dev) if dev.exh_cyl_out_dev is not None else None,
            })

        return {
            "generator_id": generator_id,
            "count": len(history_data),
            "history": history_data
        }

    except Exception as e:
        logger.error(f"Error fetching AE deviation history table: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/api/me-engine/alert-details/{report_id}")
async def get_me_alert_details_api(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Get detailed ME parameters for a specific report.
    UPDATED MAPPING:
    - 'pmax' & 'pcomp': ACTUAL values (ISO Corrected or Observed).
    - 'pmax_dev' & 'pcomp_dev': DEVIATION values from 'me_deviation_history' table.
    """
    raw_report = db.query(MonthlyReportHeader).filter(
        MonthlyReportHeader.report_id == report_id
    ).first()
    if raw_report:
        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(raw_report.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Fetch Data
        raw_report = db.query(MonthlyReportHeader).filter(MonthlyReportHeader.report_id == report_id).first()
        iso_data = db.query(MonthlyISOPerformanceData).filter(MonthlyISOPerformanceData.report_id == report_id).first()
        
        # --- Fetch Deviation History Table ---
        dev_history = db.query(MEDeviationHistory).filter(MEDeviationHistory.report_id == report_id).first()
        if dev_history:
            print("🔍 MEDeviationHistory columns for report:", report_id)
            print(list(dev_history.__dict__.keys()))   # Shows real DB column names
            print("👉 pmax_actual =", getattr(dev_history, "pmax_actual", None))
            print("👉 pmax_dev =", getattr(dev_history, "pmax_dev", None))
            print("👉 pmax_avg_dev =", getattr(dev_history, "pmax_avg_dev", None))
            print("👉 pcomp_dev =", getattr(dev_history, "pcomp_dev", None))
            print("👉 pcomp_avg_dev =", getattr(dev_history, "pcomp_avg_dev", None))
        else:
            print("⚠ No MEDeviationHistory record for this report")

        # Debugging: Print to console to verify data existence
        if not dev_history:
            print(f"WARNING: No MEDeviationHistory found for report_id {report_id}")
        
        if not raw_report:
            raise HTTPException(status_code=404, detail="Report data not found")

        vessel = raw_report.vessel 

        # 2. Helper to safely get float
        def get_val(val):
            try:
                return float(val) if val is not None else None
            except:
                return None

        # 3. Helpers to extract Deviation values safely (Handles potential model naming mismatches)
        def get_dev_val(obj, attr_name):
            if not obj:
                return None
            # Try to get attribute, return None if it doesn't exist on the model
            val = getattr(obj, attr_name, None)
            return get_val(val)

        # 4. Create the Formatted Actuals Object
        
        # --- FOC Logic ---
        foc_actual = None
        if iso_data and iso_data.fuel_consumption_total_graph_kg_h is not None:
            foc_actual = get_val(iso_data.fuel_consumption_total_graph_kg_h)
        elif raw_report.fo_consumption_mt_hr is not None:
            foc_actual = get_val(raw_report.fo_consumption_mt_hr) * 1000 

        # --- Turbo Speed Logic ---
        # turbo_actual = None
        # if iso_data and iso_data.turbocharger_speed_graph_x1000_rpm_scaled is not None:
        #     turbo_actual = get_val(iso_data.turbocharger_speed_graph_x1000_rpm_scaled)
        # elif raw_report.turbocharger_rpm_avg is not None:
        #     turbo_actual = get_val(raw_report.turbocharger_rpm_avg) / 1000 
        turbo_actual = get_val(raw_report.turbocharger_rpm_avg)

        formatted_actuals = {
            # -----------------------------------------------------------
            # REQUESTED MAPPING
            # -----------------------------------------------------------
            
            # 1. EXISTING KEYS -> ACTUAL VALUES (ISO or Observed)
            "pmax": get_val(iso_data.max_combustion_pressure_iso_bar) if iso_data else get_val(raw_report.max_comb_pr_avg_bar),
            "pcomp": get_val(iso_data.compression_pressure_iso_bar) if iso_data else get_val(raw_report.comp_pr_avg_bar),

            # 2. NEW KEYS -> DEVIATION VALUES (from me_deviation_history)
            # We try 'pmax_avg_dev' first. If your model uses 'pmax_dev', checking getattr prevents a crash.
            "pmax_dev": get_dev_val(dev_history, "pmax_avg_dev"),
            "pcomp_dev": get_dev_val(dev_history, "pcomp_avg_dev"),
            "cylinder_readings": raw_report.cylinder_readings,
            # -----------------------------------------------------------
            "scavair": get_val(iso_data.scav_air_pressure_graph_kg_cm2) if iso_data else get_val(raw_report.scavenge_pr_bar), 
            "engspeed": get_val(iso_data.engine_speed_graph_rpm) if iso_data else get_val(raw_report.rpm),
            "exh_t/c_inlet": get_val(iso_data.exh_temp_tc_inlet_iso_c) if iso_data else get_val(raw_report.tc_exhaust_gas_temp_in_c),
            "exh_t/c_outlet": get_val(iso_data.exh_temp_tc_outlet_iso_c) if iso_data else get_val(raw_report.tc_exhaust_gas_temp_out_c),
            "exh_cylinder_outlet": get_val(iso_data.cyl_exhaust_gas_temp_outlet_graph_c) if iso_data else get_val(raw_report.exh_temp_cylinder_outlet_ave_c),
            "fipi": get_val(iso_data.fuel_inj_pump_index_graph_mm) if iso_data else get_val(raw_report.fuel_injection_pump_index_mm),
            "sfoc": get_val(iso_data.sfoc_graph_g_kwh) if iso_data else get_val(raw_report.sfoc_calculated_g_kwh),
            "turbospeed": turbo_actual,
            "foc": foc_actual,
            "propeller": get_val(iso_data.propeller_margin_percent) if iso_data else None,
            "load_percentage": get_val(iso_data.load_percentage) if iso_data else get_val(raw_report.load_percent),
            "power": get_val(raw_report.shaft_power_kw) or get_val(raw_report.effective_power_kw)
        }

        # 5. Fetch the Alert Statuses
        normal_alerts = db.query(MENormalStatus).filter_by(report_id=report_id).all()
        warning_alerts = db.query(MEWarningAlert).filter_by(report_id=report_id).all()
        critical_alerts = db.query(MECriticalAlert).filter_by(report_id=report_id).all()
       
        def map_alert(a):
            return {
                "parameter": a.metric_name,
                "baseline": float(a.baseline_value) if a.baseline_value is not None else None,
                "actual": float(a.actual_value) if a.actual_value is not None else None,
                "deviation": float(a.deviation) if a.deviation is not None else None,
                "deviation_pct": float(a.deviation_pct) if a.deviation_pct is not None else None,
                "unit": a.unit if hasattr(a, 'unit') else ""
            }
        # secure_raw_url = generate_sas_url(raw_report.raw_report_url)
        # secure_gen_url = generate_sas_url(raw_report.generated_report_url)
        vessel_name_safe = raw_report.vessel.vessel_name.replace(" ", "_") if raw_report.vessel else "Unknown"
        month_safe = raw_report.report_month.replace(" ", "_") if raw_report.report_month else "Unknown"
        raw_filename = f"{vessel_name_safe}_Monthly_Log_{month_safe}.pdf"
        gen_filename = f"{vessel_name_safe}_Analytical_Report_{month_safe}.pdf"
        secure_raw_view_url = generate_sas_url(raw_report.raw_report_url)
        secure_gen_view_url = generate_sas_url(raw_report.generated_report_url)
        secure_raw_download_url = generate_sas_url(
            raw_report.raw_report_url, 
            download_name=raw_filename
        )
        secure_gen_download_url = generate_sas_url(
            raw_report.generated_report_url, 
            download_name=gen_filename
        )


        return {
            "report_id": report_id,
            "mcr_limit_kw": float(vessel.mcr_limit_kw) if vessel and vessel.mcr_limit_kw is not None else None,
            "mcr_limit_percentage": float(vessel.mcr_limit_percentage) if vessel and vessel.mcr_limit_percentage is not None else None,
            "formatted_actuals": formatted_actuals,
            "raw_report_view_url": secure_raw_view_url,  
            "raw_report_download_url": secure_raw_download_url,  
            "generated_report_view_url": secure_gen_view_url, 
            "generated_report_download_url": secure_gen_download_url, 
            "critical": [map_alert(a) for a in critical_alerts],
            "warning": [map_alert(a) for a in warning_alerts],
            "normal": [map_alert(a) for a in normal_alerts]
        }
       
    except Exception as e:
        logger.error(f"Error fetching ME alert details: {e}", exc_info=True)
        # Return 500 but verify logs to see if it's an attribute error
        raise HTTPException(status_code=500, detail=str(e))
# ============================================
# ME DEVIATION HISTORY ENDPOINT (FIXED UNIT CONVERSION)
# ============================================
# ==============================================================================
# FIX: ME DEVIATION HISTORY TABLE TO RETURN ISO CORRECTED VALUES (MATCHING SUMMARY)
# ==============================================================================
@app.get("/api/me-engine/deviation/history-table/{imo_number}")
async def get_me_deviation_history_table(
    imo_number: int,
    limit: int = 6,
    ref_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Returns ME deviation table history.
    Joins with MonthlyISOPerformanceData to ensure 'Actual' values are ISO corrected,
    exactly matching the Summary Table values.
    """

    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        target_date = None

        # 1) Validate and apply ref_date
        if ref_date:
            try:
                if len(ref_date) == 7:  # YYYY-MM
                    dt = datetime.strptime(ref_date, "%Y-%m").date()
                    # end of month
                    next_m = dt.replace(day=28) + timedelta(days=4)
                    target_date = next_m - timedelta(days=next_m.day)
                else:  # YYYY-MM-DD
                    target_date = datetime.strptime(ref_date, "%Y-%m-%d").date()
            except ValueError:
                logger.warning(f"Invalid ref_date '{ref_date}', falling back to latest history date.")
                target_date = None

        # 2) If no ref_date provided → fallback to latest ME report date
        if not target_date:
            latest_report = db.query(MonthlyReportHeader.report_date)\
                .filter(MonthlyReportHeader.imo_number == imo_number)\
                .order_by(desc(MonthlyReportHeader.report_date))\
                .first()
            if latest_report:
                target_date = latest_report[0]
            else:
                return {"imo_number": imo_number, "count": 0, "history": []}

        # 3) Query history WITH JOIN TO ISO DATA
        results = db.query(
            MEDeviationHistory,
            MonthlyReportHeader.report_date,
            MonthlyReportHeader.report_month,
            MonthlyISOPerformanceData, # <--- NEW: Get ISO Data
            MonthlyReportHeader        # <--- Needed for fallback data like Shaft Power/FOC
        ).join(
            MonthlyReportHeader,
            MEDeviationHistory.report_id == MonthlyReportHeader.report_id
        ).join(
            MonthlyISOPerformanceData, # <--- Join Condition
            MonthlyReportHeader.report_id == MonthlyISOPerformanceData.report_id
        ).filter(
            MEDeviationHistory.imo_number == imo_number,
            MonthlyReportHeader.report_date <= target_date
        ).order_by(
            desc(MonthlyReportHeader.report_date)
        ).limit(limit).all()

        if not results:
            return {"imo_number": imo_number, "count": 0, "history": []}

        history = []
        
        # Unpack 5 items now
        for dev, rep_date, rep_month, iso, header in results:
            
            # Helper to safely get float
            def get_val(val):
                return float(val) if val is not None else None

            # Logic for FOC: Prefer ISO Graph value, fallback to Header (converted from MT/h to kg/h)
            foc_val = get_val(iso.fuel_consumption_total_graph_kg_h)
            if foc_val is None and header.fo_consumption_mt_hr is not None:
                 foc_val = float(header.fo_consumption_mt_hr) * 1000

            history.append({
                "report_id": dev.report_id,
                "report_date": rep_date.isoformat() if rep_date else None,
                "report_month": rep_month,
                
                # Load & Power (Use ISO/Header values)
                "load_percentage": get_val(iso.load_percentage),
                "load_kw": get_val(header.shaft_power_kw),

                # --- 1. PROPELLER MARGIN ---
                # Use ISO value (e.g. 91.17) so frontend can calc deviation (91.17 - 100 = -8.83%)
                "propeller_margin_actual": get_val(iso.propeller_margin_percent),
                # We can leave dev/baseline fields as is or null, since Frontend now calculates them dynamically
                "propeller_margin_baseline": float(dev.propeller_margin_baseline) if dev.propeller_margin_baseline is not None else None,
                "propeller_margin_dev": float(dev.propeller_margin_dev) if dev.propeller_margin_dev is not None else None,

                # --- 2. FUEL INDEX ---
                "fuel_index_actual": get_val(iso.fuel_inj_pump_index_graph_mm),
                "fuel_index_baseline": float(dev.fuel_index_baseline) if dev.fuel_index_baseline is not None else None,
                "fuel_index_dev": float(dev.fuel_index_dev) if dev.fuel_index_dev is not None else None,

                # --- 3. TURBO RPM ---
                # "turbo_rpm_actual": get_val(iso.turbocharger_speed_graph_x1000_rpm_scaled),
                "turbo_rpm_actual": get_val(header.turbocharger_rpm_avg),
                "turbo_rpm_baseline": float(dev.turbo_rpm_baseline) if dev.turbo_rpm_baseline is not None else None,
                "turbo_rpm_dev": float(dev.turbo_rpm_dev) if dev.turbo_rpm_dev is not None else None,

                # --- 4. ENGINE RPM ---
                "engine_rpm_actual": get_val(iso.engine_speed_graph_rpm),
                "engine_rpm_baseline": float(dev.engine_rpm_baseline) if dev.engine_rpm_baseline is not None else None,
                "engine_rpm_dev": float(dev.engine_rpm_dev) if dev.engine_rpm_dev is not None else None,

                # --- 5. SFOC ---
                "sfoc_actual": get_val(iso.sfoc_graph_g_kwh),
                "sfoc_dev": float(dev.sfoc_dev) if dev.sfoc_dev is not None else None,

                # --- 6. PMAX (ISO) ---
                "pmax_actual": get_val(iso.max_combustion_pressure_iso_bar),
                "pmax_dev": float(dev.pmax_dev) if dev.pmax_dev is not None else None,
                # These might be used if Pmax graph wasn't available, but we prefer ISO above
                "pmax_avg_actual": get_val(iso.max_combustion_pressure_iso_bar), 
                "pmax_avg_dev": float(dev.pmax_avg_dev) if dev.pmax_avg_dev is not None else None,

                # --- 7. PCOMP (ISO) ---
                "pcomp_actual": get_val(iso.compression_pressure_iso_bar),
                "pcomp_dev": float(dev.pcomp_dev) if dev.pcomp_dev is not None else None,
                "pcomp_avg_actual": get_val(iso.compression_pressure_iso_bar),
                "pcomp_avg_dev": float(dev.pcomp_avg_dev) if dev.pcomp_avg_dev is not None else None,

                # --- 8. SCAV AIR (ISO) ---
                "scav_actual": get_val(iso.scav_air_pressure_graph_kg_cm2),
                "scav_dev": float(dev.scavenge_pressure_dev) if dev.scavenge_pressure_dev is not None else None,

                # --- 9. TC INLET (ISO) ---
                "exh_tc_in_actual": get_val(iso.exh_temp_tc_inlet_iso_c),
                "exh_tc_in_dev": float(dev.tc_in_dev) if dev.tc_in_dev is not None else None,

                # --- 10. TC OUTLET (ISO) ---
                "exh_tc_out_actual": get_val(iso.exh_temp_tc_outlet_iso_c),
                "exh_tc_out_dev": float(dev.tc_out_dev) if dev.tc_out_dev is not None else None,

                # --- 11. CYL OUTLET (ISO) ---
                "exh_cyl_out_actual": get_val(iso.cyl_exhaust_gas_temp_outlet_graph_c),
                "exh_cyl_out_dev": float(dev.exhaust_cyl_dev) if dev.exhaust_cyl_dev is not None else None,

                # --- 12. FOC ---
                "foc_actual": foc_val,
                "foc_dev": float(dev.foc_dev * 1000) if dev.foc_dev is not None else None
            })

        return {
            "imo_number": imo_number,
            "count": len(history),
            "history": history
        }

    except Exception as exc:
        logger.error(f"Error retrieving ME deviation history table: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal server error")


@app.get("/api/me-engine/baseline/reference/{imo_number}")
async def get_me_baseline_reference(
    imo_number: int, 
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)):
    """
    Baseline interpolation API for Main Engine.
    Fetches Shop Trial data to allow the frontend to calculate deviation at any load.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Get Vessel
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail=f"Vessel with IMO {imo_number} not found")

        # 2. Get Shop Trial Session
        session = db.query(ShopTrialSession).filter(
            ShopTrialSession.engine_no == vessel.engine_no
        ).first()
       
        # If no session found, return empty data instead of 404 to prevent frontend crash
        if not session:
            logger.warning(f"No shop trial session found for IMO {imo_number}")
            return {"imo_number": imo_number, "baseline_data": []}

        # 3. Get Records
        baseline_records = db.query(ShopTrialPerformanceData).filter(
            ShopTrialPerformanceData.session_id == session.session_id
        ).order_by(ShopTrialPerformanceData.load_percentage).all()

        if not baseline_records:
            return {"imo_number": imo_number, "baseline_data": []}

        # 4. Map Data (Handling ISO vs Observed & Unit Conversions)
        formatted_data = []
        for r in baseline_records:
            # Helper to prefer ISO value, fallback to Observed
            def get_val(iso, obs):
                if iso is not None: return float(iso)
                if obs is not None: return float(obs)
                return None

            # Logic for Scav Air: Prefer ISO kg/cm2, then Observed kg/cm2, then Bar converted to kg/cm2
            scav_val = None
            if r.scav_air_pressure_iso_kg_cm2 is not None:
                scav_val = float(r.scav_air_pressure_iso_kg_cm2)
            elif r.turbocharger_gas_inlet_press_kg_cm2 is not None:
                scav_val = float(r.turbocharger_gas_inlet_press_kg_cm2)
            elif r.scav_air_pressure_bar is not None:
                scav_val = float(r.scav_air_pressure_bar) * 1.01972 # Convert Bar to kg/cm2

            formatted_data.append({
                "load_percentage": float(r.load_percentage),
               
                # --- Pressures ---
                "pmax": get_val(r.max_combustion_pressure_iso_bar, r.max_combustion_pressure_bar),
                "pcomp": get_val(r.compression_pressure_iso_bar, r.compression_pressure_bar),
                "scavair": scav_val,

                # --- Temperatures ---
                "exh_t/c_inlet": get_val(r.exh_temp_tc_inlet_iso_c, r.exh_temp_tc_inlet_c),
                "exh_t/c_outlet": get_val(r.exh_temp_tc_outlet_iso_c, r.exh_temp_tc_outlet_c),
                "exh_cylinder_outlet": float(r.exh_temp_cylinder_outlet_ave_c) if r.exh_temp_cylinder_outlet_ave_c else None,

                # --- Speeds & Consumption ---
                "turbospeed": get_val(r.turbocharger_speed_x1000_iso_rpm, r.turbocharger_speed_x1000_rpm) * 1000 if get_val(r.turbocharger_speed_x1000_iso_rpm, r.turbocharger_speed_x1000_rpm) else None,
                "engspeed": float(r.engine_speed_rpm) if r.engine_speed_rpm else None,
                "sfoc": get_val(r.fuel_oil_consumption_iso_g_kwh, r.fuel_oil_consumption_g_kwh),
                "foc": float(r.fuel_oil_consumption_kg_h) if r.fuel_oil_consumption_kg_h else None,
                "fipi": float(r.fuel_injection_pump_index_mm) if r.fuel_injection_pump_index_mm else None
            })

        # Debug print to server logs (Optional)
        # print(f"Sending {len(formatted_data)} baseline points for IMO {imo_number}")

        return {
            "imo_number": imo_number,
            "baseline_data": formatted_data
        }

    except Exception as e:
        # ✅ FIX: Use Python logger, NOT console.log
        logger.error(f"Error fetching ME baseline for {imo_number}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))






@app.get("/api/me-engine/alert-details/{report_id}")
async def get_me_alert_details_api(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Get detailed ME parameters for a specific report.
    UPDATED MAPPING:
    - 'pmax' & 'pcomp': ACTUAL values (ISO Corrected or Observed).
    - 'pmax_dev' & 'pcomp_dev': DEVIATION values from 'me_deviation_history' table.
    """
    raw_report = db.query(MonthlyReportHeader).filter(
        MonthlyReportHeader.report_id == report_id
    ).first()
    if raw_report:
        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(raw_report.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Fetch Data
        raw_report = db.query(MonthlyReportHeader).filter(MonthlyReportHeader.report_id == report_id).first()
        iso_data = db.query(MonthlyISOPerformanceData).filter(MonthlyISOPerformanceData.report_id == report_id).first()
        
        # --- Fetch Deviation History Table ---
        dev_history = db.query(MEDeviationHistory).filter(MEDeviationHistory.report_id == report_id).first()
        if dev_history:
            print("🔍 MEDeviationHistory columns for report:", report_id)
            print(list(dev_history.__dict__.keys()))   # Shows real DB column names
            print("👉 pmax_actual =", getattr(dev_history, "pmax_actual", None))
            print("👉 pmax_dev =", getattr(dev_history, "pmax_dev", None))
            print("👉 pmax_avg_dev =", getattr(dev_history, "pmax_avg_dev", None))
            print("👉 pcomp_dev =", getattr(dev_history, "pcomp_dev", None))
            print("👉 pcomp_avg_dev =", getattr(dev_history, "pcomp_avg_dev", None))
        else:
            print("⚠ No MEDeviationHistory record for this report")

        # Debugging: Print to console to verify data existence
        if not dev_history:
            print(f"WARNING: No MEDeviationHistory found for report_id {report_id}")
        
        if not raw_report:
            raise HTTPException(status_code=404, detail="Report data not found")

        # 2. Helper to safely get float
        def get_val(val):
            try:
                return float(val) if val is not None else None
            except:
                return None

        # 3. Helpers to extract Deviation values safely (Handles potential model naming mismatches)
        def get_dev_val(obj, attr_name):
            if not obj:
                return None
            # Try to get attribute, return None if it doesn't exist on the model
            val = getattr(obj, attr_name, None)
            return get_val(val)

        # 4. Create the Formatted Actuals Object
        
        # --- FOC Logic ---
        foc_actual = None
        if iso_data and iso_data.fuel_consumption_total_graph_kg_h is not None:
            foc_actual = get_val(iso_data.fuel_consumption_total_graph_kg_h)
        elif raw_report.fo_consumption_mt_hr is not None:
            foc_actual = get_val(raw_report.fo_consumption_mt_hr) * 1000 

        # --- Turbo Speed Logic ---
        # turbo_actual = None
        # if iso_data and iso_data.turbocharger_speed_graph_x1000_rpm_scaled is not None:
        #     turbo_actual = get_val(iso_data.turbocharger_speed_graph_x1000_rpm_scaled)
        # elif raw_report.turbocharger_rpm_avg is not None:
        #     turbo_actual = get_val(raw_report.turbocharger_rpm_avg) / 1000 
        turbo_actual = get_val(raw_report.turbocharger_rpm_avg)

        formatted_actuals = {
            # -----------------------------------------------------------
            # REQUESTED MAPPING
            # -----------------------------------------------------------
            
            # 1. EXISTING KEYS -> ACTUAL VALUES (ISO or Observed)
            "pmax": get_val(iso_data.max_combustion_pressure_iso_bar) if iso_data else get_val(raw_report.max_comb_pr_avg_bar),
            "pcomp": get_val(iso_data.compression_pressure_iso_bar) if iso_data else get_val(raw_report.comp_pr_avg_bar),

            # 2. NEW KEYS -> DEVIATION VALUES (from me_deviation_history)
            # We try 'pmax_avg_dev' first. If your model uses 'pmax_dev', checking getattr prevents a crash.
            "pmax_dev": get_dev_val(dev_history, "pmax_avg_dev"),
            "pcomp_dev": get_dev_val(dev_history, "pcomp_avg_dev"),

            # -----------------------------------------------------------
            "scavair": get_val(iso_data.scav_air_pressure_graph_kg_cm2) if iso_data else get_val(raw_report.scavenge_pr_bar), 
            "engspeed": get_val(iso_data.engine_speed_graph_rpm) if iso_data else get_val(raw_report.rpm),
            "exh_t/c_inlet": get_val(iso_data.exh_temp_tc_inlet_iso_c) if iso_data else get_val(raw_report.tc_exhaust_gas_temp_in_c),
            "exh_t/c_outlet": get_val(iso_data.exh_temp_tc_outlet_iso_c) if iso_data else get_val(raw_report.tc_exhaust_gas_temp_out_c),
            "exh_cylinder_outlet": get_val(iso_data.cyl_exhaust_gas_temp_outlet_graph_c) if iso_data else get_val(raw_report.exh_temp_cylinder_outlet_ave_c),
            "fipi": get_val(iso_data.fuel_inj_pump_index_graph_mm) if iso_data else get_val(raw_report.fuel_injection_pump_index_mm),
            "sfoc": get_val(iso_data.sfoc_graph_g_kwh) if iso_data else get_val(raw_report.sfoc_calculated_g_kwh),
            "turbospeed": turbo_actual,
            "foc": foc_actual,
            "propeller": get_val(iso_data.propeller_margin_percent) if iso_data else None,
            "load_percentage": get_val(iso_data.load_percentage) if iso_data else get_val(raw_report.load_percent),
            "power": get_val(raw_report.shaft_power_kw) or get_val(raw_report.effective_power_kw)
        }

        # 5. Fetch the Alert Statuses
        normal_alerts = db.query(MENormalStatus).filter_by(report_id=report_id).all()
        warning_alerts = db.query(MEWarningAlert).filter_by(report_id=report_id).all()
        critical_alerts = db.query(MECriticalAlert).filter_by(report_id=report_id).all()
        
        def map_alert(a):
            return {
                "parameter": a.metric_name,
                "baseline": float(a.baseline_value) if a.baseline_value is not None else None,
                "actual": float(a.actual_value) if a.actual_value is not None else None,
                "deviation": float(a.deviation) if a.deviation is not None else None,
                "deviation_pct": float(a.deviation_pct) if a.deviation_pct is not None else None,
                "unit": a.unit if hasattr(a, 'unit') else ""
            }

        return {
            "report_id": report_id,
            "formatted_actuals": formatted_actuals,
            "critical": [map_alert(a) for a in critical_alerts],
            "warning": [map_alert(a) for a in warning_alerts],
            "normal": [map_alert(a) for a in normal_alerts]
        }
        
    except Exception as e:
        logger.error(f"Error fetching ME alert details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
# --- ADD THIS TO app/api.py ---


from collections import defaultdict

# In app/api.py

# In app/api.py

# app/api.py

@app.get("/api/v1/fleet/ae-report-details/{report_id}")
async def get_ae_report_details(
    report_id: int,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)  # ADD
):
    """
    Fetches raw AE report data, baseline curves, and SECURE DUAL SAS URLs.
    """
    try:
        # 1. Fetch Report, Data, Generator, and Vessel Info
        result = db.query(
            GeneratorMonthlyReportHeader, 
            GeneratorMonthlyPerformanceData,
            VesselGenerator,
            VesselInfo
        ).join(
            GeneratorMonthlyPerformanceData, 
            GeneratorMonthlyReportHeader.report_id == GeneratorMonthlyPerformanceData.report_id
        ).join(
            VesselGenerator, 
            GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
        ).join(
            VesselInfo,
            VesselGenerator.imo_number == VesselInfo.imo_number
        ).filter(
            GeneratorMonthlyReportHeader.report_id == report_id
        ).first()

        if not result:
            raise HTTPException(status_code=404, detail="AE Report not found")

        header, data, gen, vessel = result
        allowed_imos, _ = await get_allowed_vessel_imos(current_user)
        if str(gen.imo_number) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
        # 2. Fetch Baseline Data
        baseline_records = db.query(GeneratorBaselineData).filter(
            GeneratorBaselineData.generator_id == header.generator_id
        ).order_by(GeneratorBaselineData.load_percentage).all()
        
        # 3. Transform Curves (Existing Logic)
        curves_map = defaultdict(list)
        for r in baseline_records:
            if r.load_percentage is None: continue
            lp = float(r.load_percentage)
            def add_point(key, val):
                if val is not None: curves_map[key].append([lp, float(val)])
            
            add_point('pmax_graph_bar', r.pmax_graph_bar or r.max_combustion_pressure_bar)
            add_point('scav_air_pressure_bar', r.scav_air_pressure_bar or r.boost_air_pressure_graph_bar)
            add_point('compression_pressure_bar', r.compression_pressure_bar)
            add_point('exh_temp_cyl_outlet_avg_graph_c', r.exh_temp_cyl_outlet_avg_graph_c)
            add_point('exh_temp_tc_inlet_graph_c', r.exh_temp_tc_inlet_graph_c or r.exhaust_gas_temp_before_tc_c)
            add_point('exh_temp_tc_outlet_graph_c', r.exh_temp_tc_outlet_graph_c or r.exhaust_gas_temp_after_tc_c)
            add_point('fuel_pump_index_graph', r.fuel_pump_index_graph or r.fuel_rack_position_mm)
            add_point('sfoc_graph_g_kwh', r.sfoc_graph_g_kwh or r.sfoc_g_kwh)

        # =========================================================
        # 🔥 NEW LOGIC: GENERATE DUAL SAS URLS (View vs Download)
        # =========================================================
        
        # Helper to clean strings for filenames
        def clean_str(s): return str(s).replace(" ", "_").replace("/", "-")
        
        v_name = clean_str(vessel.vessel_name)
        g_name = clean_str(gen.designation)
        r_month = clean_str(header.report_month)
        
        # 1. Prepare Filenames
        raw_filename = f"{v_name}_{g_name}_Raw_Log_{r_month}.pdf"
        gen_filename = f"{v_name}_{g_name}_Analytical_Report_{r_month}.pdf"

        # 2. Generate URLs (Safe check if URL exists in DB)
        raw_view = generate_sas_url(header.raw_report_url) if header.raw_report_url else None
        raw_dl = generate_sas_url(header.raw_report_url, download_name=raw_filename) if header.raw_report_url else None
        
        gen_view = generate_sas_url(header.generated_report_url) if header.generated_report_url else None
        gen_dl = generate_sas_url(header.generated_report_url, download_name=gen_filename) if header.generated_report_url else None

        # =========================================================

        # 4. Return Data
        return {
            "report": {
                "report_id": header.report_id,
                "report_date": header.report_date,
                "vessel_name": format_vessel_name(vessel.vessel_name),
                "generator_name": gen.designation,
                "load_kw": data.load_kw,
                "load_percentage": float(data.load_percentage) if data.load_percentage else 0,
                
                # ACTUAL VALUES (Ensure these keys match curves_map exactly)
                "pmax_bar": data.pmax_graph_bar or data.max_combustion_pressure_bar,
                "compression_pressure_bar": data.compression_pressure_bar,
                "scav_air_pressure_bar": data.scav_air_pressure_bar or getattr(data, 'boost_air_pressure_graph_bar', None),
                "exh_temp_cyl_outlet_avg_graph_c": data.exh_temp_cyl_outlet_avg_graph_c,
                "exh_temp_tc_inlet_graph_c": data.exh_temp_tc_inlet_graph_c or data.exhaust_gas_temp_before_tc_c,
                "exh_temp_tc_outlet_graph_c": data.exh_temp_tc_outlet_graph_c or data.exhaust_gas_temp_after_tc_c,
                "turbocharger_speed_rpm": data.turbocharger_speed_rpm,
                "fuel_pump_index_graph": data.fuel_pump_index_graph or data.fuel_rack_position_mm,
                "sfoc_graph_g_kwh": getattr(data, 'sfoc_graph_g_kwh', getattr(data, 'sfoc_g_kwh', None)),
                "engine_speed_rpm": data.engine_speed_rpm,

                "raw_report_view_url": raw_view,
                "raw_report_download_url": raw_dl,
                "generated_report_view_url": gen_view,
                "generated_report_download_url": gen_dl
            },
            "curves": curves_map 
        }

    except Exception as e:
        logger.error(f"Error in ae-report-details: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
# ==========================================
# 2. AE PERFORMANCE OVERVIEW (For the Dashboard)
# ==========================================
# In app/api.py

@app.get("/api/v1/fleet/ae-performance-overview", tags=["Fleet Overview"])
async def get_ae_performance_overview(
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
) -> Dict[str, Any]:
    """
    Retrieves:
    1. Latest report date for every generator.
    2. Last 3 load percentages for history.
    3. Alert Status History for the last 12 months per generator (The Dots).
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if not allowed_imos:
        return {"running_hours_data": [], "load_history_data":[], "status_history_data":[]}
    from sqlalchemy import func, desc, and_
    from datetime import date, datetime, timedelta
    from dateutil.relativedelta import relativedelta

    try:
        # --- Date Calculation (Last 12 Months) ---
        today = date.today()
        start_date = (today - relativedelta(months=11)).replace(day=1)

        # ==============================================================================
        # 1. RUNNING HOURS & INFO (LATEST REPORT DATE)
        # ==============================================================================
        latest_report_rank_subquery = db.query(
            GeneratorMonthlyReportHeader.generator_id.label('gen_id'),
            GeneratorMonthlyReportHeader.report_date,
            func.row_number().over(
                partition_by=GeneratorMonthlyReportHeader.generator_id,
                order_by=desc(GeneratorMonthlyReportHeader.report_date)
            ).label('rn')
        ).subquery()

        latest_reports = db.query(
            VesselInfo.vessel_name,
            VesselInfo.imo_number,
            VesselGenerator.designation,
            latest_report_rank_subquery.c.report_date,
            VesselInfo.display_order  # <--- [NEW] Select Order Column
        ).join(
            VesselGenerator,
            latest_report_rank_subquery.c.gen_id == VesselGenerator.generator_id
        ).join(
            VesselInfo,
            VesselGenerator.imo_number == VesselInfo.imo_number
        ).filter(
            latest_report_rank_subquery.c.rn == 1,
            VesselInfo.imo_number.in_(allowed_imos) # <--- Fixed Model Name
        ).order_by(
            VesselInfo.display_order.asc(),      # <--- [NEW] Sort by Display Order
            VesselInfo.vessel_name.asc(),        # Fallback
            VesselGenerator.designation.asc()
        ).all()
       
        running_hours_data = []
        # [FIX] Unpacking 5 variables now (added display_order)
        for name, imo, designation, r_date, display_order in latest_reports:
            running_hours_data.append({
                "vessel_name": format_vessel_name(name),
                "imo_number": imo,
                "display_order": display_order, # <--- Sending to frontend
                "generator_designation": designation,
                "report_date": r_date.isoformat() if r_date else None,
                "running_hours": None 
            })

        # ==============================================================================
        # 2. LOAD HISTORY (LAST 3 REPORTS)
        # ==============================================================================
        historical_load_rank_subquery = db.query(
            VesselGenerator.designation.label('designation'),
            VesselInfo.vessel_name.label('vessel_name'),
            VesselInfo.display_order.label('display_order'), # <--- [NEW] Must include in subquery
            GeneratorMonthlyReportHeader.report_date,
            GeneratorMonthlyPerformanceData.load_percentage,
            func.row_number().over(
                partition_by=GeneratorMonthlyReportHeader.generator_id,
                order_by=desc(GeneratorMonthlyReportHeader.report_date)
            ).label('rn')
        ).join(
            VesselGenerator,
            GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
        ).join(
            VesselInfo,
            VesselGenerator.imo_number == VesselInfo.imo_number
        ).join(
            GeneratorMonthlyPerformanceData,
            GeneratorMonthlyReportHeader.report_id == GeneratorMonthlyPerformanceData.report_id
        ).filter(
             GeneratorMonthlyPerformanceData.load_percentage.isnot(None),
             VesselGenerator.imo_number.in_(allowed_imos)
        ).subquery()

        historical_loads = db.query(
            historical_load_rank_subquery.c.vessel_name,
            historical_load_rank_subquery.c.designation,
            historical_load_rank_subquery.c.report_date,
            historical_load_rank_subquery.c.load_percentage.label('load_percent'),
            historical_load_rank_subquery.c.rn,
            historical_load_rank_subquery.c.display_order # <--- [NEW] Select from subquery
        ).filter(
            historical_load_rank_subquery.c.rn <= 3
        ).order_by(
            historical_load_rank_subquery.c.display_order.asc(), # <--- [NEW] Sort by Display Order
            historical_load_rank_subquery.c.vessel_name.asc(),
            historical_load_rank_subquery.c.designation.asc(),
            historical_load_rank_subquery.c.rn.asc()
        ).all()
       
        load_history_map = {}
        # [FIX] Unpacking 6 variables now (added display_order at the end)
        for vessel_name, designation, report_date, load_percent, rn, display_order in historical_loads:
            key = f"{vessel_name}-{designation}"
            if key not in load_history_map:
                load_history_map[key] = {
                    "vessel_name": format_vessel_name(vessel_name),
                    "generator_designation": designation,
                    "display_order": display_order, # <--- Sending to frontend
                    "load_history": [None, None, None]
                }
            if rn <= 3:
                load_history_map[key]["load_history"][rn - 1] = {
                    "report_date": report_date.isoformat() if report_date else None,
                    "load_percent": float(load_percent) if load_percent is not None else None,
                    "rank": rn
                }

        # ==============================================================================
        # 3. STATUS HISTORY (THE DOTS)
        # ==============================================================================
        cutoff_date = datetime.now() - timedelta(days=1850)
        raw_status = []

        # Check if AEAlertSummary exists (Optimized Query)
        if 'AEAlertSummary' in globals() or 'AEAlertSummary' in locals():
             raw_status = db.query(
                AEAlertSummary.vessel_name,
                AEAlertSummary.generator_designation,
                AEAlertSummary.report_date,
                AEAlertSummary.dominant_status.label('status'),
                AEAlertSummary.report_id,
                VesselInfo.display_order # <--- [NEW] Select Display Order
            ).join(
                VesselInfo, AEAlertSummary.imo_number == VesselInfo.imo_number # <--- [NEW] Join VesselInfo
            ).filter(
                AEAlertSummary.report_date >= cutoff_date,
                VesselGenerator.imo_number.in_(allowed_imos)
            ).order_by(
                VesselInfo.display_order.asc(), # <--- [NEW] Sort by Display Order
                AEAlertSummary.generator_designation.asc(),
                desc(AEAlertSummary.report_date)
            ).all()
        else:
            # Fallback (Complex Join)
            raw_status = db.query(
                VesselInfo.vessel_name,
                VesselGenerator.designation.label('generator_designation'),
                GeneratorMonthlyReportHeader.report_date,
                GeneratorMonthlyReportHeader.status,
                GeneratorMonthlyReportHeader.report_id,
                VesselInfo.display_order # <--- [NEW] Select Display Order
            ).join(
                VesselGenerator, GeneratorMonthlyReportHeader.generator_id == VesselGenerator.generator_id
            ).join(
                VesselInfo, VesselGenerator.imo_number == VesselInfo.imo_number
            ).filter(
                GeneratorMonthlyReportHeader.report_date >= cutoff_date,
                AEAlertSummary.imo_number.in_(allowed_imos)
            ).order_by(
                VesselInfo.display_order.asc(), # <--- [NEW] Sort by Display Order
                VesselGenerator.designation.asc(),
                desc(GeneratorMonthlyReportHeader.report_date)
            ).all()

        # ==========================================================
        # DE-DUPLICATE: ONLY ONE DOT (WORST STATUS) PER MONTH
        # ==========================================================
        dedup_map = {}
        priority = {"Critical": 3, "Warning": 2, "Normal": 1}

        for row in raw_status:
            current_status = row.status if row.status else "Normal"
            
            # Safely extract Year-Month (e.g., '2025-12')
            if hasattr(row.report_date, 'strftime'):
                month_key = row.report_date.strftime("%Y-%m")
            else:
                month_key = str(row.report_date)[:7]
                
            # Create a unique tracking key for Vessel + Generator + Month
            unique_key = f"{row.vessel_name}_{row.generator_designation}_{month_key}"
            
            if unique_key not in dedup_map:
                dedup_map[unique_key] = {
                    "vessel_name": format_vessel_name(row.vessel_name),
                    "generator_designation": row.generator_designation,
                    "report_date": row.report_date,
                    "status": current_status,
                    "report_id": row.report_id,
                    "display_order": row.display_order
                }
            else:
                # If we find another report for the SAME month, keep the WORST status
                existing_status = dedup_map[unique_key]["status"]
                if priority.get(current_status, 0) > priority.get(existing_status, 0):
                    dedup_map[unique_key]["status"] = current_status
                    # Update report_id so clicking the dot opens the worst report
                    dedup_map[unique_key]["report_id"] = row.report_id
                    dedup_map[unique_key]["report_date"] = row.report_date

        # Convert dictionary values back to a flat list for the frontend
        status_history_list = list(dedup_map.values())

        return {
            "running_hours_data": running_hours_data,
            "load_history_data": list(load_history_map.values()),
            "status_history_data": status_history_list
        }

    except Exception as e:
        logger.error(f"Error fetching AE performance overview: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
        
# ============================================
# SHOP TRIAL UPLOAD ENDPOINT
# ============================================
@app.post("/upload-shop-trial-report/", summary="Upload Shop Trial PDF for a specific vessel")
async def upload_shop_trial_report(
    file: UploadFile = File(...),
    imo_number: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    Uploads a Shop Trial PDF, saves it to Azure, and links it to the vessel's Shop Trial Session.
    Creates a new session if one doesn't exist, marking the vessel as 'Configured'.
    """
    logger.info(f"Received Shop Trial upload for IMO {imo_number}: {file.filename}")

    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        # 1. Verify Vessel Exists
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail="Vessel not found")

        # 2. Read File Content
        contents = await file.read()
        
        # 3. Upload to Azure Blob Storage
        # Structure: shop_trials/{imo_number}/{filename}
        folder_path = f"shop_trials/{imo_number}"
        
        blob_url = upload_file_to_azure(
            file_data=contents, 
            filename=file.filename, 
            folder_path=folder_path
        )

        if not blob_url:
            raise HTTPException(status_code=500, detail="Failed to upload file to Azure Storage")

        # 4. Find or Create Shop Trial Session
        # We look for an existing session for this engine.
        session = db.query(ShopTrialSession).filter(
            ShopTrialSession.engine_no == vessel.engine_no
        ).order_by(desc(ShopTrialSession.trial_date)).first()

        if session:
            # Update existing session with the new file URL
            session.raw_report_url = blob_url
            session.document_title = file.filename
            session.updated_at = datetime.utcnow()
            logger.info(f"Updated existing Shop Trial Session {session.session_id} with URL")
        else:
            # Create a new session. This effectively marks the vessel as "Configured" 
            # because the dashboard counts distinct IMOs in the ShopTrialSession table.
            session = ShopTrialSession(
                engine_no=vessel.engine_no,
                trial_date=datetime.utcnow().date(), # Default to today
                trial_type='SHOP_TRIAL',
                status='COMPLETED',
                document_title=file.filename,
                raw_report_url=blob_url
            )
            db.add(session)
            logger.info(f"Created new Shop Trial Session for {vessel.engine_no}")

        db.commit()
        db.refresh(session)

        return {
            "message": "Shop Trial uploaded successfully",
            "vessel_name": format_vessel_name(vessel.vessel_name),
            "engine_no": vessel.engine_no,
            "file_url": blob_url
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading shop trial: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
# Open app/api.py

# ... existing imports ...

# Add this endpoint near the bottom or with other Shop Trial endpoints
@app.get("/api/shop-trial-url/{imo_number}", summary="Get secure link for Shop Trial PDF")
async def get_shop_trial_url(imo_number: int, db: Session = Depends(get_db), current_user: Any = Depends(auth.get_current_user)):
    """
    Retrieves the SAS (Secure) URL for the Shop Trial PDF associated with a vessel.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Get Vessel
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail="Vessel not found")

        # 2. Get Shop Trial Session
        session = db.query(ShopTrialSession).filter(
            ShopTrialSession.engine_no == vessel.engine_no
        ).order_by(desc(ShopTrialSession.trial_date)).first()

        if not session or not session.raw_report_url:
            raise HTTPException(status_code=404, detail="No shop trial report found for this vessel.")

        # 3. Generate Secure URL
        # ensure generate_sas_url is imported from app.blob_storage
        secure_url = generate_sas_url(session.raw_report_url)
        
        if not secure_url:
             raise HTTPException(status_code=500, detail="Could not generate access link.")

        return {
            "imo_number": imo_number,
            "url": secure_url,
            "filename": session.document_title or "Shop_Trial.pdf"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching shop trial URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
# Open app/api.py and add this near the other Shop Trial endpoints

@app.get("/api/shop-trial-details/{imo_number}", summary="Get Shop Trial Performance Data Values")
async def get_shop_trial_details(imo_number: int, db: Session = Depends(get_db), current_user: Any = Depends(auth.get_current_user)):
    """
    Fetches the raw Shop Trial performance data points for the latest session.
    Maps database columns exactly to frontend keys.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if str(imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Get Vessel
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == imo_number).first()
        if not vessel:
            raise HTTPException(status_code=404, detail="Vessel not found")

        # 2. Get Latest Shop Trial Session
        session = db.query(ShopTrialSession).filter(
            ShopTrialSession.engine_no == vessel.engine_no
        ).order_by(desc(ShopTrialSession.trial_date)).first()

        # Fuzzy match fallback if strict match fails (optional)
        if not session:
             session = db.query(ShopTrialSession).filter(
                ShopTrialSession.engine_no.like(f"%{vessel.engine_no}%")
            ).order_by(desc(ShopTrialSession.trial_date)).first()

        if not session:
            # Return empty data instead of 404 to avoid frontend crash
            return {
                "vessel_name": format_vessel_name(vessel.vessel_name),
                "engine_no": vessel.engine_no,
                "test_date": "N/A",
                "data": []
            }

        # 3. Get Performance Data Records
        records = db.query(ShopTrialPerformanceData).filter(
            ShopTrialPerformanceData.session_id == session.session_id
        ).order_by(ShopTrialPerformanceData.load_percentage).all()

        # 4. Map DB Columns to Frontend Keys
        data_points = []
        for r in records:
            data_points.append({
                # Key (Frontend) : Value (Database Column)
                "load_percentage": float(r.load_percentage) if r.load_percentage is not None else 0,
                
                # Speed & Power
                "engine_speed": float(r.engine_speed_rpm) if r.engine_speed_rpm is not None else None,
                "engine_output": float(r.engine_output_kw) if r.engine_output_kw is not None else None,
                
                # Pressures
                "pmax": float(r.max_combustion_pressure_bar) if r.max_combustion_pressure_bar is not None else None,
                "pcomp": float(r.compression_pressure_bar) if r.compression_pressure_bar is not None else None,
                "pmean": float(r.mean_effective_pressure_bar) if r.mean_effective_pressure_bar is not None else None,
                "scav_air_press": float(r.scav_air_pressure_bar) if r.scav_air_pressure_bar is not None else None,
                
                # Temperatures
                "scav_air_temp": float(r.scav_air_temperature_c) if r.scav_air_temperature_c is not None else None,
                "exh_temp_cyl_out": float(r.exh_temp_cylinder_outlet_ave_c) if r.exh_temp_cylinder_outlet_ave_c is not None else None,
                "exh_temp_tc_in": float(r.exh_temp_tc_inlet_c) if r.exh_temp_tc_inlet_c is not None else None,
                "exh_temp_tc_out": float(r.exh_temp_tc_outlet_c) if r.exh_temp_tc_outlet_c is not None else None,
                
                # Turbo & Fuel
                "turbo_speed": float(r.turbocharger_speed_x1000_rpm) if r.turbocharger_speed_x1000_rpm is not None else None,
                "fipi": float(r.fuel_injection_pump_index_mm) if r.fuel_injection_pump_index_mm is not None else None,
                
                # Consumption
                "foc_kg_h": float(r.fuel_oil_consumption_kg_h) if r.fuel_oil_consumption_kg_h is not None else None,
                "sfoc_iso": float(r.fuel_oil_consumption_iso_g_kwh) if r.fuel_oil_consumption_iso_g_kwh is not None else None,
            })

        return {
            "vessel_name": format_vessel_name(vessel.vessel_name),
            "engine_no": vessel.engine_no,
            "test_date": session.trial_date.isoformat() if session.trial_date else "N/A",
            "data": data_points
        }

    except Exception as e:
        logger.error(f"Error fetching shop trial details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

# In app/api.py

# ... imports ...

# ============================================
# ADMIN DATA SYNC ENDPOINT
# ============================================
@app.post("/api/admin/data-sync", tags=["Admin"])
async def admin_data_sync(
    file: UploadFile = File(...),
    engine_type: str = Form(...),
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Admin endpoint to sync Excel data.
    """
    _, role = await get_allowed_vessel_imos(current_user)
    if role not in ("ADMIN", "SUPERUSER"):
        raise HTTPException(status_code=403, detail="Admin access required")
    logger.info(f"Admin Data Sync initiated for {engine_type} with file: {file.filename}")
    
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only Excel files allowed.")

    temp_file_path = None
    try:
        # 1. Save uploaded file to temp disk
        suffix = ".xlsx" if file.filename.endswith(".xlsx") else ".xls"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            temp_file_path = tmp.name

        # 2. Run the Loader Script Logic
        success = False
        
        if engine_type == 'mainEngine':
            # create_tables=False prevents "Table already exists" errors
            success = load_excel_to_database(
                excel_path=temp_file_path,
                ae_excel_path=None,
                create_tables=False, 
                dry_run=False
            )
        elif engine_type == 'auxiliaryEngine':
            success = load_excel_to_database(
                excel_path=None,
                ae_excel_path=temp_file_path,
                create_tables=False, 
                dry_run=False
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid engine type.")

        # --- SAFETY CHECK ---
        # If the script ran but forgot to return True (returns None), treat it as success to avoid 500 Error
        if success is None:
            logger.warning(f"Script for {engine_type} finished but returned None. Assuming success.")
            success = True

        if success:
            logger.info(f"✅ Data Sync Successful for {engine_type}")
            return {"message": f"✅ Successfully synced {engine_type} data."}
        else:
            logger.error("❌ Data sync script returned explicit False.")
            raise HTTPException(status_code=500, detail="Script failed to load data (returned False). Check logs.")

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Sync Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # 3. Cleanup temp file (Windows Safe)
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                # Log warning but do NOT crash the request
                logger.warning(f"Windows file lock prevented deleting temp file: {e}")

@app.post("/api/admin/upload-baseline", tags=["Admin"])
async def upload_baseline_data(
    file: UploadFile = File(...),
    engine_type: str = Form(...),
    imo_number: str = Form(...),  # <--- NEW: Require IMO Number
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Handles Baseline Data Uploads.
    - ME: Expects Excel (.xlsx) -> Database
    - AE: Expects PDF (.pdf) -> Extracts -> Appends to 'data/ae_shop_trial.xlsx'
    """
    _, role = await get_allowed_vessel_imos(current_user)
    if role not in ("ADMIN", "SUPERUSER"):
        raise HTTPException(status_code=403, detail="Admin access required")
    logger.info(f"Baseline Upload: Type={engine_type}, IMO={imo_number}, File={file.filename}")

    # Read file content into memory
    file_content = await file.read() 
    
    try:
        success = False
        message = ""

        # --- CASE 1: MAIN ENGINE (Excel Logic) ---
        if engine_type == 'shopTrialData':
            if not file.filename.lower().endswith(('.xlsx', '.xls')):
                raise HTTPException(status_code=400, detail="Main Engine requires an Excel (.xlsx) file.")
            
            # Save temp file for pandas to read
            temp_path = f"temp_{file.filename}"
            with open(temp_path, "wb") as f:
                f.write(file_content)
            
            try:
                # Import service here to ensure it's loaded
                from app.services.shop_trial_excel_service import process_shop_trial_excel
                
                # Process the Excel file
                success = process_shop_trial_excel(temp_path, db)
                message = "Main Engine Shop Trial (Excel) processed successfully."
            finally:
                # Cleanup temp file
                if os.path.exists(temp_path):
                    os.remove(temp_path)

        # --- CASE 2: AUXILIARY ENGINE (PDF Extraction Logic) ---
        elif engine_type == 'aeShopTrialData':
            if not file.filename.lower().endswith('.pdf'):
                raise HTTPException(status_code=400, detail="Auxiliary Engine requires a PDF file.")
            
            # ✅ Pass file content AND imo_number to the extractor
            output_path = extract_and_save_ae_pdf(file_content, imo_number=imo_number)
            
            if output_path:
                success = True
                message = f"AE PDF processed successfully. Data saved to '{output_path}'."
            else:
                # If None is returned, extraction failed or no data was found
                raise HTTPException(status_code=500, detail="PDF processing failed. No valid data extracted.")

        else:
            raise HTTPException(status_code=400, detail="Invalid engine type.")

        return {"message": f"✅ Success: {message}"}

    except HTTPException as he:
        raise he
    except ValueError as ve:
        logger.error(f"Validation Error: {ve}")
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"System Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Processing failed: {str(e)}")


# ============================================
# 1. AE SHOP TRIAL UPLOAD ENDPOINT
# Corrected for: shop_trial_report_url
# ============================================
@app.post("/api/aux/upload-shop-trial/", summary="Upload Shop Trial PDF for a specific Generator")
async def upload_ae_shop_trial(
    file: UploadFile = File(...),
    generator_id: int = Form(...),
    db: Session = Depends(get_db)
):
    """
    Uploads a Shop Trial PDF for a specific Generator, saves to Azure, 
    and links it to the VesselGenerator record in the database.
    """
    logger.info(f"Received AE Shop Trial upload for Gen ID {generator_id}: {file.filename}")

    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        # 1. Verify Generator Exists
        generator = db.query(VesselGenerator).filter(VesselGenerator.generator_id == generator_id).first()
        if not generator:
            raise HTTPException(status_code=404, detail="Generator not found")

        # 2. Read File Content
        contents = await file.read()
        
        # 3. Upload to Azure Blob Storage
        # Path: aux_shop_trials/{imo}/{gen_id}/{filename}
        folder_path = f"aux_shop_trials/{generator.imo_number}/{generator_id}"
        
        blob_url = upload_file_to_azure(
            file_data=contents, 
            filename=file.filename, 
            folder_path=folder_path
        )

        if not blob_url:
            raise HTTPException(status_code=500, detail="Failed to upload file to Azure Storage")

        # 4. Update Database
        # âœ… CORRECTED: Using 'shop_trial_report_url' to match your Model
        generator.shop_trial_report_url = blob_url 
        
        db.commit()
        db.refresh(generator)

        return {
            "message": "AE Shop Trial uploaded successfully",
            "generator": generator.designation,
            "file_url": blob_url
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading AE shop trial: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 2. AE SHOP TRIAL DATA VALUES ENDPOINT
# Corrected to map your GeneratorBaselineData columns
# ============================================
@app.get("/api/aux/shop-trial-details/{generator_id}", summary="Get AE Shop Trial Data Values")
async def get_ae_shop_trial_details(generator_id: int, db: Session = Depends(get_db), current_user: Any = Depends(auth.get_current_user)):
    """
    Fetches the raw Shop Trial performance data points for a specific Generator.
    Maps database columns to frontend keys.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    generator = db.query(VesselGenerator).filter_by(generator_id=generator_id).first()
    if generator and str(generator.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Get Generator & Vessel Info
        generator = db.query(VesselGenerator).filter(VesselGenerator.generator_id == generator_id).first()
        if not generator:
            raise HTTPException(status_code=404, detail="Generator not found")
            
        vessel = db.query(VesselInfo).filter(VesselInfo.imo_number == generator.imo_number).first()

        # 2. Get Baseline Records
        records = db.query(GeneratorBaselineData).filter(
            GeneratorBaselineData.generator_id == generator_id
        ).order_by(GeneratorBaselineData.load_percentage).all()

        if not records:
            return {
                "vessel_name": vessel.vessel_name if vessel else "Unknown",
                "engine_no": generator.engine_no,
                "data": []
            }

        # 3. Map to Frontend format
        data_points = []
        for r in records:
            # Helper: Get float value safely
            def val(v): return float(v) if v is not None else None
            # Helper: Check Column A, if null check Column B
            def fallback(a, b): return val(a) if a is not None else val(b)

            data_points.append({
                "load_percentage": val(r.load_percentage),
                
                # Output
                "engine_output": fallback(r.engine_output_kw, r.load_kw),
                "engine_speed": val(r.engine_speed_rpm),
                
                # Pressures (Prioritize 'graph' columns from your model)
                "pmax": fallback(r.pmax_graph_bar, r.max_combustion_pressure_bar),
                "pcomp": val(r.compression_pressure_bar),
                "scav_air_press": fallback(r.scav_air_pressure_bar, r.boost_air_pressure_graph_bar),
                
                # Temperatures
                "exh_temp_cyl_out": val(r.exh_temp_cyl_outlet_avg_graph_c),
                "exh_temp_tc_in": fallback(r.exh_temp_tc_inlet_graph_c, r.exhaust_gas_temp_before_tc_c),
                "exh_temp_tc_out": fallback(r.exh_temp_tc_outlet_graph_c, r.exhaust_gas_temp_after_tc_c),
                
                # Turbo & Fuel
                "turbo_speed": val(r.turbocharger_speed_rpm),
                "fipi": fallback(r.fuel_pump_index_graph, r.fuel_rack_position_mm),
                
                # Consumption
                "sfoc_iso": fallback(r.sfoc_graph_g_kwh, r.sfoc_g_kwh),
            })

        return {
            "vessel_name": vessel.vessel_name if vessel else "Unknown",
            "engine_no": generator.engine_no,
            "test_date": "Baseline",
            "data": data_points
        }

    except Exception as e:
        logger.error(f"Error fetching AE shop trial details: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# 3. AE SHOP TRIAL PDF URL ENDPOINT
# Corrected for: shop_trial_report_url
# ============================================
@app.get("/api/aux/shop-trial-url/{generator_id}", summary="Get secure link for AE Shop Trial PDF")
async def get_ae_shop_trial_url(generator_id: int, db: Session = Depends(get_db), current_user: Any = Depends(auth.get_current_user)):
    """
    Retrieves the SAS (Secure) URL for the AE Shop Trial PDF.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    generator = db.query(VesselGenerator).filter_by(generator_id=generator_id).first()
    if generator and str(generator.imo_number) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        # 1. Get Generator
        generator = db.query(VesselGenerator).filter(VesselGenerator.generator_id == generator_id).first()
        if not generator:
            raise HTTPException(status_code=404, detail="Generator not found")

        # 2. Check for URL
        # âœ… CORRECTED: Checking 'shop_trial_report_url'
        pdf_url = getattr(generator, 'shop_trial_report_url', None)
        
        if not pdf_url:
             raise HTTPException(status_code=404, detail="No shop trial PDF uploaded for this generator.")

        # 3. Generate Secure URL
        secure_url = generate_sas_url(pdf_url)
        
        if not secure_url:
             raise HTTPException(status_code=500, detail="Could not generate access link.")

        return {
            "generator_id": generator_id,
            "url": secure_url,
            "filename": f"{generator.designation}_Shop_Trial.pdf"
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching AE shop trial URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# --- ADD THIS TO app/api.py ---

@app.get("/api/performance/raw-download-link/{report_id}")
async def get_raw_report_download_link(
    report_id: int, 
    engine_type: str, # 'mainEngine' or 'auxiliaryEngine'
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Fetches the SECURE SAS URL for the ORIGINAL uploaded PDF 
    from the raw_report_url database column.
    """
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    try:
        url_in_db = None
        vessel_name = "Ship"
        
        # 1. Look in the correct table based on type
        if engine_type == 'mainEngine':
            report = db.query(MonthlyReportHeader).filter(MonthlyReportHeader.report_id == report_id).first()
            if report:
                url_in_db = report.raw_report_url
                vessel_name = report.vessel.vessel_name if report.vessel else "ME"
        else:
            report = db.query(GeneratorMonthlyReportHeader).filter(GeneratorMonthlyReportHeader.report_id == report_id).first()
            if report:
                url_in_db = report.raw_report_url
                vessel_name = report.generator.designation if report.generator else "AE"

        if not url_in_db:
            raise HTTPException(status_code=404, detail="Original upload URL not found in database.")

        # 2. Generate a Secure SAS URL for downloading
        # We clean the filename for the browser download prompt
        clean_vessel = vessel_name.replace(" ", "_")
        download_filename = f"{clean_vessel}_Original_Report_{report_id}.pdf"
        
        secure_url = generate_sas_url(url_in_db, download_name=download_filename)

        return {"download_url": secure_url}

    except Exception as e:
        logger.error(f"Error fetching raw download link: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# --- Add this to app/api.py ---
class BatchDownloadRequest(BaseModel):
    report_ids: List[int]
    engine_type: str

@app.post("/api/performance/batch-raw-download-links")
async def get_batch_raw_download_links(
    request: BatchDownloadRequest,
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """Fetches multiple secure SAS URLs at once."""
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    results = []
    model = MonthlyReportHeader if request.engine_type == 'mainEngine' else GeneratorMonthlyReportHeader
    
    reports = db.query(model).filter(model.report_id.in_(request.report_ids)).all()
    
    for r in reports:
        if r.raw_report_url:
            # Determine filename
            v_name = "Ship"
            if request.engine_type == 'mainEngine':
                v_name = r.vessel.vessel_name if r.vessel else "ME"
            else:
                v_name = r.generator.designation if r.generator else "AE"
            
            clean_filename = f"{v_name.replace(' ', '_')}_Report_{r.report_id}.pdf"
            secure_url = generate_sas_url(r.raw_report_url, download_name=clean_filename)
            results.append(secure_url)
            
    return {"urls": results}

@app.post("/api/performance/batch-download-zip")
async def download_reports_zip(
    request: BatchDownloadRequest, 
    db: Session = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    # 1. Determine the Model (Expanded to support all 3 types)
    allowed_imos, _ = await get_allowed_vessel_imos(current_user)
    if request.engine_type == 'mainEngine':
        model = MonthlyReportHeader
    elif request.engine_type == 'auxiliaryEngine':
        model = GeneratorMonthlyReportHeader
    else:
        raise HTTPException(status_code=400, detail="Invalid engine type")

    reports = db.query(model).filter(model.report_id.in_(request.report_ids)).all()
    if not reports:
        raise HTTPException(status_code=404, detail="No reports found")
    if request.engine_type == 'lubeOil':
        for r in reports:
            if r.imo_number not in allowed_imos:
                raise HTTPException(status_code=403, detail=f"Unauthorized to download report for IMO {r.imo_number}")


    if not reports:
        raise HTTPException(status_code=404, detail="No reports found")

    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for r in reports:
            # 2. Extract the correct URL attribute
            # Main/Aux Engine use 'raw_report_url', Lube Oil uses 'report_url'
            url = getattr(r, 'raw_report_url', None) or getattr(r, 'report_url', None)

            if url:
                try:
                    from app.blob_storage import download_blob_bytes 
                    file_bytes = download_blob_bytes(url)
                    
                    # 3. Differentiated Filename Logic per Engine Type
                    if request.engine_type == 'mainEngine':
                        v_name = r.vessel.vessel_name if r.vessel else f"Vessel_{r.imo_number}"
                        clean_vname = v_name.replace(' ', '_').replace('/', '-')
                        filename = f"{clean_vname}_ME_Report_{r.report_month}.pdf"
                    
                    elif request.engine_type == 'auxiliaryEngine':
                        v_name = r.generator.designation if r.generator else f"Gen_{r.generator_id}"
                        clean_vname = v_name.replace(' ', '_').replace('/', '-')
                        filename = f"{clean_vname}_AE_Report_{r.report_month}.pdf"

                    elif request.engine_type == 'lubeOil':
                        # Custom naming for Lube Oil using IMO and Sample Date
                        v_name = r.vessel.vessel_name if r.vessel else f"IMO_{r.imo_number}"
                        filename = f"{v_name}_LubeReport_{r.report_date}.pdf"
                    
                    zip_file.writestr(filename, file_bytes)
                except Exception as e:
                    logger.error(f"Failed to add {url} to zip: {e}")

    zip_buffer.seek(0)
    # Use a dynamic name for the zip itself
    zip_name = f"Reports_Batch_{datetime.now().strftime('%Y%m%d')}.zip"
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f"attachment; filename={zip_name}"}
    )

@app.get("/api/v1/user/vessels", tags=["User"])
async def get_user_assigned_vessels(
    current_user: Any = Depends(auth.get_current_user),
    control_db: AsyncSession = Depends(get_control_db)  # inject properly as async dependency
):
    from app.model.control.vessel import Vessel as ControlVessel
    from sqlalchemy import select

    allowed_imos, role = await get_allowed_vessel_imos(current_user)

    result = await control_db.execute(
        select(ControlVessel).where(ControlVessel.imo.in_(allowed_imos))
    )
    vessels = result.scalars().all()

    return [
        {"imo": v.imo, "name": v.name}
        for v in vessels
    ]

