# app/report_processor.py

import re
from datetime import datetime, date, time
from typing import Any, Dict, Optional, List, BinaryIO
from decimal import Decimal, InvalidOperation, getcontext
import logging
import json
import os
from pathlib import Path

# Enhanced logging setup
file_handler = logging.FileHandler('app_debug.log')
file_handler.setLevel(logging.DEBUG)
file_formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
file_handler.setFormatter(file_formatter)

logger = logging.getLogger(__name__)
logger.addHandler(file_handler)
logger.setLevel(logging.DEBUG)

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from app.models import VesselInfo, MonthlyReportHeader, MonthlyReportDetailsJsonb, ShopTrialPerformanceData, MonthlyISOPerformanceData
from app.field_metadata import FIELD_METADATA_MAPPING
from app.pdf_extractor import extract_data_from_monthly_report_pdf
from app.crud import get_or_create_vessel
from app.config import ensure_data_dir

# IMPORTS
from app.me_iso_corrector import MEISOCorrector
from app.me_deviation_processor import compute_and_save_me_deviation
from app.me_iso_corrector import ISO_FACTORS, safe_decimal

getcontext().prec = 10

# --- METRIC CONFIGURATION ---
# 🔥 FIX: Added 'engine_speed_rpm' and 'sfoc_g_kwh' so they are processed
MONITORED_METRICS = [
    "max_combustion_pressure_bar",
    "compression_pressure_bar",
    "scav_air_pressure_kg_cm2",
    "turbocharger_speed_x1000_rpm",
    "engine_speed_rpm",           # Added
    "sfoc_g_kwh",                 # Added
    "engine_speed_rpm",           # Added
    "sfoc_g_kwh",                 # Added
    "exh_temp_tc_inlet_c",
    "exh_temp_tc_outlet_c",
    "cyl_exhaust_gas_temp_outlet_c",
    "fuel_inj_pump_index_mm",
    "fuel_consumption_total_kg_h"
]

UNIDIRECTIONAL_DETERIORATION_METRICS = [
    "exh_temp_tc_inlet_c",
    "exh_temp_tc_outlet_c",
    "cyl_exhaust_gas_temp_outlet_c",
    "fuel_consumption_total_kg_h",
    "sfoc_g_kwh"
]

ALERT_THRESHOLDS = {
    # Group A: Strict Percentage (Amber @ 3%, Red @ 5%)
    "max_combustion_pressure_bar": {"normal": 3.0, "warning": 5.0, "type": "%"},
    "compression_pressure_bar": {"normal": 3.0, "warning": 5.0, "type": "%"},
    "engine_speed_rpm": {"normal": 3.0, "warning": 5.0, "type": "%"},
    
    # Group B: Standard Percentage (Amber @ 5%, Red @ 10%)
    "scav_air_pressure_kg_cm2": {"normal": 5.0, "warning": 10.0, "type": "%"},
    "sfoc_g_kwh": {"normal": 5.0, "warning": 10.0, "type": "%"},
    "fuel_inj_pump_index_mm": {"normal": 5.0, "warning": 10.0, "type": "%"},
    "fuel_consumption_total_kg_h": {"normal": 5.0, "warning": 10.0, "type": "%"},

    # Absolute Deviations (Degrees Celsius) - Amber @ 40°C, Red @ 60°C
    "exh_temp_tc_inlet_c": {"normal": 40.0, "warning": 60.0, "type": "abs"},
    "exh_temp_tc_outlet_c": {"normal": 40.0, "warning": 60.0, "type": "abs"},
    "cyl_exhaust_gas_temp_outlet_c": {"normal": 40.0, "warning": 60.0, "type": "abs"},

    # Absolute Deviation (RPM) - Amber @ 500 (0.5), Red @ 1000 (1.0)
    # Backend uses x1000 units, so 0.5 = 500 RPM
    "turbocharger_speed_x1000_rpm": {"normal": 0.5, "warning": 1.0, "type": "abs"},
}

PARAMETER_INTERVALS = {
    "scavengepr": {"min": 0.5, "max": 4.0, "label": "Scavenge Air Pressure"},
    "shaftpower": {"min": 0, "max": 25000, "label": "Shaft Power"},
    "effectivepower": {"min": 0, "max": 25000, "label": "Effective Power"},
    "load": {"min": 0, "max": 100, "label": "Load %"},
    "barometricpressure": {"min": 900, "max": 1200, "label": "Barometric Pressure"},
    "lo temperatureengineinlet": {"min": 35, "max": 70, "label": "LO Inlet Temp"},
    "netenergyasperbdn/folcvselection": {"min": 35, "max": 50, "label": "FO LCV"},
    "turbochargerrpm#1": {"min": 0, "max": 20000, "label": "TC RPM"},
    "exhaustgastempt/cinlet#1": {"min": 300, "max": 650, "label": "TC Exhaust Inlet Temp"},
    "exhaustgastempt/coutlet#1": {"min": 250, "max": 550, "label": "TC Exhaust Outlet Temp"},
    "turbochargerairinlettemp#1": {"min": 0, "max": 55, "label": "TC Air Inlet Temp"},
    "cwtempaircoolerinlet#1": {"min": 0, "max": 50, "label": "CW Air Cooler Inlet Temp"},
    "cwtempaircooleroutlet#1": {"min": 0, "max": 50, "label": "CW Air Cooler Outlet Temp"},
    "pmaxaverage": {"min": 50, "max": 250, "label": "Pmax Avg"},
    "pcompaverage": {"min": 50, "max": 200, "label": "Pcomp Avg"},
    "exhausttempaverage": {"min": 200, "max": 500, "label": "Cyl Exhaust Outlet Temp"},
    "sfoccalculated": {"min": 120, "max": 250, "label": "SFOC"},
    "fuel_inj_pump_index_mm": {"min": 0, "max": 100, "label": "Fuel Index"},
    "draft_fore": {"min": 2, "max": 20, "label": "Draft Fore"},
    "draft_aft": {"min": 2, "max": 20, "label": "Draft Aft"},
    "ap_filter": {"min": 0, "max": 500, "label": "TC Filter DP"},
    "ap_air_cooler": {"min": 0, "max": 500, "label": "Air Cooler DP"}
}

def enrich_with_units(raw_data: Dict[str, Any], mapping: Dict[str, Dict[str, Optional[str]]]) -> Dict[str, Any]:
    enriched_data: Dict[str, Any] = {}
    for field_name, value in raw_data.items():
        metadata = mapping.get(field_name) or mapping.get(field_name.lower()) or {"unit": None, "target_column": None}
        unit = metadata.get("unit")
        enriched_data[field_name] = {"value": value, "unit": unit}
    return enriched_data

def build_header_from_enriched(
    enriched_data: Dict[str, Any],
    vessel_info: VesselInfo,
    session: AsyncSession,
    mapping: Dict[str, Dict[str, Optional[str]]]
) -> MonthlyReportHeader:
    
    header_values: Dict[str, Any] = {
        "imo_number": vessel_info.imo_number,
        "vessel": vessel_info,
        "engine_identifier": enriched_data.get('engine_no', {}).get('value') or vessel_info.engine_no
    }

    report_date_obj: Optional[date] = None
    valid_columns = set(column.name for column in MonthlyReportHeader.__table__.columns)

    for field_name, field_info in enriched_data.items():
        metadata = mapping.get(field_name) or mapping.get(field_name.lower())
        if metadata and metadata.get("target_column"):
            target_column = metadata["target_column"]
            value = field_info.get("value")

            if target_column not in valid_columns: continue
            if value is None: 
                header_values[target_column] = None
                continue

            if target_column == "report_date":
                if isinstance(value, date):
                    report_date_obj = value
                    header_values[target_column] = value
                else:
                    try:
                        if isinstance(value, str) and value:
                            header_values[target_column] = datetime.fromisoformat(value).date()
                            report_date_obj = header_values[target_column]
                    except:
                        header_values[target_column] = None
            
            elif target_column == "barometric_pressure_mmh2o":
                try:
                    dec_val = value if isinstance(value, Decimal) else Decimal(str(value))
                    header_values[target_column] = dec_val
                except:
                    header_values[target_column] = None
            
            else:
                coerced = value
                type_hint = metadata.get("type_hint")
                try:
                    if type_hint == Decimal and value: coerced = Decimal(str(value))
                    elif type_hint == int and value: coerced = int(float(value))
                    elif type_hint == str and value: coerced = str(value)
                except: pass
                header_values[target_column] = coerced

    if not header_values.get("load_percent"):
        try:
            val = enriched_data.get('load', {}).get('value')
            if val: header_values["load_percent"] = Decimal(str(val))
        except: pass

    if not report_date_obj:
        report_date_obj = date.today()
        header_values["report_date"] = report_date_obj

    header_values["report_month"] = report_date_obj.strftime('%Y-%m')
    return MonthlyReportHeader(**header_values)

def _serialize_header_to_dict(header: MonthlyReportHeader) -> Dict[str, Any]:
    return {c.name: getattr(header, c.name) for c in header.__table__.columns}

def _persist_upload_files(report_id: int, enriched_data: Dict, header_dict: Dict) -> Dict[str, str]:
    base_dir = ensure_data_dir()
    uploads_dir = base_dir / "uploads"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    
    e_path = uploads_dir / f"report_{report_id}_enriched.json"
    h_path = uploads_dir / f"report_{report_id}_header.json"
    
    def _default(o):
        return str(o) if isinstance(o, (Decimal, date, datetime, time)) else o

    with open(e_path, "w", encoding="utf-8") as f: json.dump(enriched_data, f, indent=2, default=_default)
    with open(h_path, "w", encoding="utf-8") as f: json.dump(header_dict, f, indent=2, default=_default)
    
    return {"enriched_json_path": str(e_path), "header_json_path": str(h_path)}

def validate_me_report_type(raw_data: Dict[str, Any]) -> bool:
    me_indicators = ['enginemaker', 'vesselname', 'rpm_percent', 'shaft_power_kw', 'scavenge_pr_bar', 'turbocharger_rpm_avg']
    ae_indicators = ['engineselection', 'aemaker', 'scavairpress']
    
    me_count = sum(1 for k in me_indicators if raw_data.get(k) is not None)
    ae_count = sum(1 for k in ae_indicators if raw_data.get(k) is not None)
    
    if raw_data.get('engineselection') in ['0.1', '0.2', '0.3']: return False
    if raw_data.get('aemaker'): return False
    
    return me_count >= ae_count

async def process_me_alerts(db: AsyncSession, report_id: int, baseline_data: List[Dict], monthly_data: Dict) -> Dict[str, int]:
    from app.models import MENormalStatus, MEWarningAlert, MECriticalAlert
    
    if not baseline_data or not monthly_data: return {}
    
    # Find baseline point closest to actual load
    actual_load = float(monthly_data.get("load_percent", 0))
    
    sorted_points = sorted(baseline_data, key=lambda x: x["load_percentage"])
    lower = None
    upper = None
    
    for p in sorted_points:
        if p["load_percentage"] <= actual_load:
            lower = p
        if p["load_percentage"] >= actual_load and (upper is None or p["load_percentage"] < upper["load_percentage"]):
            upper = p
            break
            
    def interpolate(lo, hi, lo_load, hi_load, target):
        if hi_load == lo_load: return lo
        return lo + ((target - lo_load) / (hi_load - lo_load)) * (hi - lo)

    interpolated_baseline = {}
    
    if not lower and not upper:
        logger.error(f"❌ Unable to find baseline bounds for load {actual_load}")
        return {"normal": 0, "warning": 0, "critical": 0}
        
    if not lower: lower = upper
    if not upper: upper = lower

    for metric in MONITORED_METRICS:
        lo_value = lower.get(metric)
        hi_value = upper.get(metric)

        if lo_value is not None and hi_value is not None:
            interpolated_baseline[metric] = interpolate(
                lo_value, hi_value,
                lower["load_percentage"],
                upper["load_percentage"],
                actual_load
            )
        else:
            interpolated_baseline[metric] = lo_value or hi_value
    
    alerts_added = {"normal": 0, "warning": 0, "critical": 0}
    
    for metric in MONITORED_METRICS:
        try:
            base_val = interpolated_baseline.get(metric)
            act_val = monthly_data.get(metric)
            
            if base_val is None or act_val is None:
                continue
            if base_val == 0: continue
            
            diff = act_val - base_val
            dev_val = 0.0
            
            cfg = ALERT_THRESHOLDS.get(metric, {"normal": 5.0, "warning": 15.0, "type": "%"})
            
            if cfg['type'] == 'abs':
                # Match UI: Use Absolute unit difference for Exhaust and Turbo
                dev_val = abs(diff)
            else:
                # Match UI: Use Percentage deviation for Group A & Group B
                if base_val != 0:
                    current_pct = (diff / base_val) * 100
                    # Handle metrics where only an increase is 'bad' (SFOC, Temps, Fuel)
                    if metric in UNIDIRECTIONAL_DETERIORATION_METRICS:
                        dev_val = current_pct if current_pct > 0 else 0.0
                    else:
                        dev_val = abs(current_pct)
                else:
                    dev_val = 0.0
            
            category = "normal"
            Model = MENormalStatus
            if dev_val > cfg['warning']: 
                category = "critical"
                Model = MECriticalAlert
            elif dev_val > cfg['normal']:
                category = "warning"
                Model = MEWarningAlert
                
            db.add(Model(
                report_id=report_id,
                metric_name=metric,
                baseline_value=base_val,
                actual_value=act_val,
                deviation=diff,
                deviation_pct=(diff/base_val*100) if base_val else 0
            ))
            alerts_added[category] += 1
            
        except Exception as e:
            logger.error(f"Alert error {metric}: {e}")

    # 🔥 CRITICAL FIX: Flush records so they are visible to the count query
    await db.flush()
    
    return alerts_added

async def update_me_alert_summary(db: AsyncSession, report_id: int, vessel_name: str, imo_number: int, report_date: date, report_month: str):
    from app.models import MENormalStatus, MEWarningAlert, MECriticalAlert, MEAlertSummary
    
    # 1. Count current alerts from the specific alert tables
    nc = (await db.execute(
        select(func.count(MENormalStatus.id)).where(MENormalStatus.report_id == report_id)
    )).scalar() or 0
    wc = (await db.execute(
        select(func.count(MEWarningAlert.id)).where(MEWarningAlert.report_id == report_id)
    )).scalar() or 0
    cc = (await db.execute(
        select(func.count(MECriticalAlert.id)).where(MECriticalAlert.report_id == report_id)
    )).scalar() or 0
    
    logger.info(f"Alert Summary Counts - Normal: {nc}, Warning: {wc}, Critical: {cc}")

    # 2. UPDATED LOGIC: Highest Severity Rule
    # This matches the Performance UI: Even 1 Critical alert makes the whole status Critical.
    # We no longer use 'max(nc, wc, cc)' which was misleading.
    if cc > 0:
        dom = "Critical"
    elif wc > 0:
        dom = "Warning"
    else:
        dom = "Normal"
            
    logger.info(f"Final Dominant Status Determined: {dom}")
    
    # 3. Find existing summary or create a new one
    result = await db.execute(
        select(MEAlertSummary).where(MEAlertSummary.report_id == report_id)
    )
    summ = result.scalar_one_or_none()
    if not summ:
        summ = MEAlertSummary(report_id=report_id)
        db.add(summ)
        
    # 4. Update all summary fields
    summ.vessel_name = vessel_name
    summ.imo_number = imo_number
    summ.report_date = report_date
    summ.report_month = report_month
    summ.normal_count = nc
    summ.warning_count = wc
    summ.critical_count = cc
    summ.dominant_status = dom  # This is the severity status (Normal/Warning/Critical)
    summ.updated_at = datetime.utcnow()
    
    # 5. Flush to ensure data is prepared for the transaction commit
    await db.flush()
    
    return {
        "dominant": dom, 
        "counts": {
            "n": nc, 
            "w": wc, 
            "c": cc
        }
    }

def check_parameters_integrity(raw_data: Dict[str, Any]) -> List[str]:
    """
    Checks for missing values but does NOT stop the process.
    Returns human-readable names of missing parameters.
    
    UPDATED: Now dynamically detects cylinder count (1-18) while 
    preserving all existing labels and mandatory field checks.
    """
    missing = []
    
    # Helper to check if the 'value' inside the dictionary is truly empty/zero (PRESERVED)
    def is_empty(field_data):
        if isinstance(field_data, dict):
            val = field_data.get("value")
        else:
            val = field_data
        return val in [None, "", 0, "0", 0.0, "0.0"]

    # --- 1. Detect Dynamic Cylinder Count ---
    # We look for 'noofcyl' which is mapped in the extractor. Default to 6 for safety.
    num_cyls_raw = raw_data.get('noofcyl')
    if isinstance(num_cyls_raw, dict):
        num_cyls_raw = num_cyls_raw.get("value")
    
    try:
        num_cyls = int(float(str(num_cyls_raw))) if num_cyls_raw else 6
    except (ValueError, TypeError):
        num_cyls = 6

    # --- 2. Simple Mandatory Fields (PRESERVED EXACTLY) ---
    simple_fields = {
        "imo": "IMO Number", "rpm": "Engine RPM", "date": "Report Date", 
        "load": "Load %", "memcr": "ME MCR", "mcrrpm": "MCR RPM",
        "shipname": "Ship Name", "timestart": "Time Start", "timefinish": "Time Finish",
        "scavengepr": "Scavenge Air Pressure", "shaftpower": "Shaft Power",
        "vesselname": "Vessel Name", "reportmonth": "Report Month",
        "enginerunhrs": "Engine Run Hours", "rpmpercentage": "RPM %",
        "effectivepower": "Effective Power", "engineroomtemp": "Engine Room Temp",
        "barometricpressure": "Barometric Pressure", "engineindicatedpowerkw": "Indicated Power (kW)",
        "revolutioncounterstart": "Rev Counter Start", "revolutioncounterfinish": "Rev Counter Finish",
        "lo temperatureengineinlet": "LO Inlet Temp", "netenergyasperbdn/folcvselection": "FO LCV Selection",
        "turbochargerrpm#1": "TC RPM #1", "exhaustgastempt/cinlet#1": "TC Exhaust Inlet Temp",
        "exhaustgastempt/coutlet#1": "TC Exhaust Outlet Temp", "turbochargerairinlettemp#1": "TC Air Inlet Temp",
        "cwtempaircoolerinlet#1": "CW Air Cooler Inlet Temp", "cwtempaircooleroutlet#1": "CW Air Cooler Outlet Temp"
    }

    for key, label in simple_fields.items():
        if is_empty(raw_data.get(key)):
            missing.append(label)

    # --- 3. Dynamic Group Logic (Pmax, Pcomp, Exhaust Temp) ---
    # Replaced hardcoded ["pmax#1"..."pmax#6"] with dynamic lists
    groups = {
        "Pmax": {
            "avg": "pmaxaverage", 
            "cyls": [f"pmax#{i}" for i in range(1, num_cyls + 1)]
        },
        "Pcomp": {
            "avg": "pcompaverage", 
            "cyls": [f"pcomp#{i}" for i in range(1, num_cyls + 1)]
        },
        "Exhaust Temp": {
            "avg": "exhausttempaverage", 
            "cyls": [f"exhausttemp#{i}" for i in range(1, num_cyls + 1)]
        }
    }

    for label, keys in groups.items():
        # Check Average first
        if is_empty(raw_data.get(keys["avg"])):
            # If Average is empty, check if ALL cylinders in the dynamic range are also empty
            all_cyls_empty = all(is_empty(raw_data.get(c)) for c in keys["cyls"])
            if all_cyls_empty:
                missing.append(f"{label} (Avg/Cyl)")

    # --- 4. SFOC Consolidated Logic (PRESERVED EXACTLY) ---
    sfoc_keys = ["sfoc", "sfoccalculated", "sfoc_calculated_g_kwh", "sfoc_g_kwh"]
    if all(is_empty(raw_data.get(k)) for k in sfoc_keys):
        missing.append("SFOC")

    # --- 5. Consolidated Fuel Index Logic (PRESERVED EXACTLY) ---
    fipi_sources = [
        "fuel_inj_pump_index_mm", 
        "fuel index (ECU %)", 
        "fuelindexecu%",
        "pumpmark/fuelindexaverage",
        "pumpmark/fuelindex#1"
    ]
    if all(is_empty(raw_data.get(key)) for key in fipi_sources):
        missing.append("Fuel Index (FIPI/ECU)")

    return missing

def validate_parameter_intervals(raw_data: Dict[str, Any]) -> List[str]:
    """
    Checks if values are within the allowed intervals defined in PARAMETER_INTERVALS.
    Returns a list of error messages for values outside the range.
    """
    interval_errors = []

    for key, bounds in PARAMETER_INTERVALS.items():
        field_data = raw_data.get(key)
        
        # Extract value logic (same as your is_empty function)
        val = field_data.get("value") if isinstance(field_data, dict) else field_data

        if val not in [None, "", 0, "0", 0.0, "0.0"]:
            try:
                numeric_val = float(val)
                if numeric_val < bounds["min"] or numeric_val > bounds["max"]:
                    interval_errors.append(
                        f"Out of Range: {bounds['label']} ({numeric_val}). Expected {bounds['min']} to {bounds['max']}"
                    )
            except (ValueError, TypeError):
                continue # Skip if it's not a number; the integrity check handles missing values
                
    return interval_errors

async def save_monthly_report(pdf_file_stream: BinaryIO, filename: str, session: AsyncSession, mapping: Dict) -> Optional[Dict]:
    logger.info(f"Processing monthly report: {filename}")
    
    # 1. Extract Raw Data from PDF
    raw_data = extract_data_from_monthly_report_pdf(pdf_file_stream, filename)
    if not raw_data: return None
    num_cyls = int(float(str(raw_data.get('noofcyl', 6))))
    # 2. Run Integrity Checks
    missing_params = check_parameters_integrity(raw_data)
    range_errors = validate_parameter_intervals(raw_data)
    validation_alerts = missing_params + range_errors
    
    if not validate_me_report_type(raw_data):
        raise ValueError("Invalid Report Type (Not ME)")
        
    try:
        vessel_info = await get_or_create_vessel(
            session,
            imo_number_from_pdf=raw_data.get('imo'),
            vessel_name_from_pdf=raw_data.get('vesselname'),
            engine_type_from_pdf=raw_data.get('enginetype'),
            engine_model_from_pdf=raw_data.get('model'),
            engine_maker_from_pdf=raw_data.get('enginemaker'),
            number_of_cylinders_from_pdf=raw_data.get('noofcyl')
        )
        if not vessel_info: raise ValueError("Vessel creation failed")
    except Exception as e:
        await session.rollback()
        raise e

    # 3. Enrich and Build Header
    enriched = enrich_with_units(raw_data, mapping)
    header = build_header_from_enriched(enriched, vessel_info, session, mapping)
    
    # Helper to clean numeric values for JSON storage
    def to_json_val(val):
        if val is None or val == "" or val == 0 or val == "0":
            return None
        try:
            return float(val)
        except (ValueError, TypeError):
            return None

    # 4. Duplicate Check Logic (Based on Date and Time)
    result = await session.execute(
        select(MonthlyReportHeader).where(
            MonthlyReportHeader.imo_number == header.imo_number,
            MonthlyReportHeader.report_date == header.report_date
        )
    )
    candidates = result.scalars().all()

    existing = None
    new_time_str = str(header.time_start)[:5] if header.time_start else None

    for candidate in candidates:
        db_time_str = str(candidate.time_start)[:5] if candidate.time_start else None
        if new_time_str == db_time_str:
            existing = candidate
            break
    
    if existing:
        # Save raw cylinder readings first
        cyl_data = {}
        for i in range(1, num_cyls + 1): 
            cyl_data[str(i)] = {
                "pmax": to_json_val(raw_data.get(f'pmax#{i}')),
                "pcomp": to_json_val(raw_data.get(f'pcomp#{i}')),
                "fuel_index": to_json_val(raw_data.get(f'pumpmark/fuelindex#{i}')),
                "exhaust_temp": to_json_val(raw_data.get(f'exhausttemp#{i}'))
            }
        existing.cylinder_readings = cyl_data
        await session.flush()

        # Apply ISO correction to cylinder readings (same as new report path)
        try:
            iso_corrector = MEISOCorrector(session)
            ambient = iso_corrector.extract_measured(existing)
            t_air = ambient.get('t_inlet')
            t_cw = ambient.get('t_cw')
            print(f"🌡️ t_air={t_air}, t_cw={t_cw}")

            corrected_readings = {}
            for cyl_no, vals in cyl_data.items():  
                print(f"🔧 Cyl {cyl_no} input: {vals}")
                corrected_readings[cyl_no] = {
                    "pmax": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["pmax"]), t_air, t_cw, ISO_FACTORS['pmax']
                    )) if vals["pmax"] else None,
                    "pcomp": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["pcomp"]), t_air, t_cw, ISO_FACTORS['pcomp']
                    )) if vals["pcomp"] else None,
                    "exhaust_temp": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["exhaust_temp"]), t_air, t_cw, ISO_FACTORS['tex']
                    )) if vals["exhaust_temp"] else None,
                    "fuel_index": vals["fuel_index"],
                    "is_iso_corrected": True
                }
            existing.cylinder_readings = corrected_readings
        except Exception as e:
            print(f"❌ ISO FAILED: {e}")
            logger.warning(f"ISO correction skipped for duplicate: {e}")
        print(f"📤 RETURNING: {existing.cylinder_readings}")
        await session.commit()
        return {
            "report_id": existing.report_id,
            "is_duplicate": True,
            "message": "Duplicate Report",
            "missing_parameters": validation_alerts,
            "iso_cylinder_data": existing.cylinder_readings
        }

    # 5. Process Initial Raw Cylinder Readings
    cyl_data = {}
    for i in range(1, num_cyls + 1):
        cyl_data[str(i)] = {
            "pmax": to_json_val(raw_data.get(f'pmax#{i}')),
            "pcomp": to_json_val(raw_data.get(f'pcomp#{i}')),
            "fuel_index": to_json_val(raw_data.get(f'pumpmark/fuelindex#{i}')),
            "exhaust_temp": to_json_val(raw_data.get(f'exhausttemp#{i}'))
        }
    header.cylinder_readings = cyl_data

    try:
        # Power Logic
        if (header.shaft_power_kw is None or header.shaft_power_kw == 0) and header.effective_power_kw:
            header.shaft_power_kw = header.effective_power_kw
            
        session.add(header)
        await session.flush()
        
        # 6. Store Raw JSON Data (Audit Trail - Never loses original values)
        def _make_json_serializable(obj):
            if isinstance(obj, (date, datetime, time)):
                return obj.isoformat()
            if isinstance(obj, Decimal):
                return str(obj)
            if isinstance(obj, dict):
                return {k: _make_json_serializable(v) for k, v in obj.items()}
            if isinstance(obj, list):
                return [_make_json_serializable(v) for v in obj]
            return obj

        session.add(MonthlyReportDetailsJsonb(
            report_id=header.report_id,
            section_name="raw_extract",
            data_jsonb=_make_json_serializable(enriched)
        ))
        await session.flush()

        # =========================================================
        # 🔥 7. ISO CORRECTION (Averages & Individual Cylinders)
        # =========================================================
        logger.info("🔧 Running ISO Correction...")
        iso_corrector = MEISOCorrector(session)
        iso_record = await iso_corrector.process_and_save_iso_correction(header.report_id)
        
        if not iso_record:
            logger.error("❌ ISO Correction returned None")
        else:
            logger.info("✅ ISO Averages saved. Processing individual cylinders...")
            
            # Use logic from me_iso_corrector to ensure math is identical to Pmax Average
            # from app.me_iso_corrector import ISO_FACTORS, safe_decimal
            
            # Extract measured ambient factors used for the averages
            ambient = iso_corrector.extract_measured(header)
            t_air = ambient.get('t_inlet')
            t_cw = ambient.get('t_cw')

            corrected_readings = {}
            for cyl_no, vals in header.cylinder_readings.items():
                corrected_readings[cyl_no] = {
                    # Correct Pmax using MAN Linear Factor
                    "pmax": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["pmax"]), t_air, t_cw, ISO_FACTORS['pmax']
                    )) if vals["pmax"] else None,

                    # Correct Pcomp using MAN Linear Factor
                    "pcomp": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["pcomp"]), t_air, t_cw, ISO_FACTORS['pcomp']
                    )) if vals["pcomp"] else None,

                    # Correct Exhaust Temp using MAN Linear Factor (K=273 logic)
                    "exhaust_temp": to_json_val(iso_corrector._calculate_correction(
                        safe_decimal(vals["exhaust_temp"]), t_air, t_cw, ISO_FACTORS['tex']
                    )) if vals["exhaust_temp"] else None,

                    "fuel_index": vals["fuel_index"], # Usually not ISO corrected
                    "is_iso_corrected": True
                }
            
            # Update header with corrected values
            header.cylinder_readings = corrected_readings
            await session.flush()

        # 8. Deviation Calculation
        logger.info("🔧 Running Deviation Calculation...")
        deviation_record = await compute_and_save_me_deviation(session, header.report_id)
        
        # 9. Alert Processing
        if iso_record:
            from app.models import ShopTrialSession as ShopTrialSessionModel
            st_result = await session.execute(
                select(ShopTrialPerformanceData)
                .join(ShopTrialSessionModel,
                      ShopTrialPerformanceData.session_id == ShopTrialSessionModel.session_id)
                .where(ShopTrialSessionModel.engine_no == vessel_info.engine_no)
                .order_by(ShopTrialPerformanceData.load_percentage)
            )
            st_sess = st_result.scalars().all()
            
            baseline_list = [{
                "load_percentage": float(r.load_percentage),
                "max_combustion_pressure_bar": float(r.max_combustion_pressure_iso_bar or 0),
                "compression_pressure_bar": float(r.compression_pressure_iso_bar or 0),
                "scav_air_pressure_kg_cm2": float(r.scav_air_pressure_iso_kg_cm2 or 0),
                "turbocharger_speed_x1000_rpm": float(r.turbocharger_speed_x1000_iso_rpm or 0),
                "exh_temp_tc_inlet_c": float(r.exh_temp_tc_inlet_iso_c or 0),
                "exh_temp_tc_outlet_c": float(r.exh_temp_tc_outlet_iso_c or 0),
                "cyl_exhaust_gas_temp_outlet_c": float(r.exh_temp_cylinder_outlet_ave_c or 0),
                "fuel_inj_pump_index_mm": float(r.fuel_injection_pump_index_mm or 0),
                "fuel_consumption_total_kg_h": float(r.fuel_oil_consumption_kg_h or 0),
                "engine_speed_rpm": float(r.engine_speed_rpm or 0),
                "sfoc_g_kwh": float(r.fuel_oil_consumption_iso_g_kwh or r.fuel_oil_consumption_g_kwh or 0)
            } for r in st_sess]
            
            monthly_dict = {
                "max_combustion_pressure_bar": float(iso_record.max_combustion_pressure_iso_bar or 0),
                "compression_pressure_bar": float(iso_record.compression_pressure_iso_bar or 0),
                "scav_air_pressure_kg_cm2": float(iso_record.scav_air_pressure_graph_kg_cm2 or 0),
                "turbocharger_speed_x1000_rpm": float(iso_record.turbocharger_speed_graph_x1000_rpm_scaled or 0),
                "exh_temp_tc_inlet_c": float(iso_record.exh_temp_tc_inlet_iso_c or 0),
                "exh_temp_tc_outlet_c": float(iso_record.exh_temp_tc_outlet_iso_c or 0),
                "cyl_exhaust_gas_temp_outlet_c": float(iso_record.cyl_exhaust_gas_temp_outlet_graph_c or 0),
                "fuel_inj_pump_index_mm": float(iso_record.fuel_inj_pump_index_graph_mm or 0),
                "fuel_consumption_total_kg_h": float(iso_record.fuel_consumption_total_graph_kg_h or 0),
                "engine_speed_rpm": float(iso_record.engine_speed_graph_rpm or 0),
                "sfoc_g_kwh": float(iso_record.sfoc_graph_g_kwh or 0),
                "load_percent": float(header.load_percent or 0)
            }
            
            await process_me_alerts(session, header.report_id, baseline_list, monthly_dict)
            await update_me_alert_summary(session, header.report_id, vessel_info.vessel_name, vessel_info.imo_number, header.report_date, header.report_month)

        await session.commit()
        logger.info("✅ All Data Committed Successfully.")

        return {
            "report_id": header.report_id, 
            "is_duplicate": False, 
            "missing_parameters": validation_alerts,
            "iso_cylinder_data": header.cylinder_readings 
        }

    except Exception as e:
        await session.rollback()
        logger.exception(f"Pipeline Failed: {e}")
        raise