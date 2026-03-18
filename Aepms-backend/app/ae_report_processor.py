import logging
from decimal import Decimal
from datetime import date
from typing import Dict, Any, Optional, BinaryIO, List
from sqlalchemy.orm import Session

# Assuming necessary imports from your application structure
from app.ae_pdf_extractor import extract_ae_performance_data
from app.ae_crud import get_or_create_generator, save_ae_monthly_report
from app.generator_models import GeneratorMonthlyReportHeader, GeneratorPerformanceGraphData

# 🔥 NEW: Import deviation processor
from app.ae_deviation_processor import compute_and_save_ae_deviation

logger = logging.getLogger(__name__)

AE_PARAMETER_INTERVALS = {
    "scavairtemp": {"min": 0, "max": 70, "label": "Scav Air Temp"},
    "tcexhintemp": {"min": 200, "max": 600, "label": "TC Exh In Temp"},
    "tcexhouttemp": {"min": 200, "max": 550, "label": "TC Exh Out Temp"},
    "fuelrackaverage": {"min": 0, "max": 100, "label": "Fuel Index (Pump Indicator)"},
    "exhausttempaverage": {"min": 200, "max": 500, "label": "TC Exhaust Cylinder Outlet Temp"},
    "pmaxaverage": {"min": 50, "max": 250, "label": "Pmax"},
    # "sfoc": {"min": 120, "max": 250, "label": "SFOC"}
}

# -----------------------------------------------------------
# SAFE DECIMAL PARSER (Helper for data robustness)
# -----------------------------------------------------------
def _safe_decimal(raw_data: dict, key: str) -> Optional[Decimal]:
    """
    Safely converts a value from raw_data dict to Decimal.
    Returns None if key is missing, empty, or conversion fails.
    """
    value = raw_data.get(key)
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    try:
        return Decimal(str(value).strip())
    except Exception:
        logger.warning(f"[SAFE_DECIMAL] Failed converting '{key}'='{value}' → Decimal")
        return None


# -----------------------------------------------------------
# CYLINDER AVERAGE CALCULATOR (Uses safe_decimal)
# -----------------------------------------------------------
def process_cylinder_data(raw_data: dict) -> Dict[str, Decimal]:
    """
    Extracts cylinder data (Pmax, Exhaust Temp, Fuel Rack) and computes averages.
    Returns a dict with averaged values for graph data storage.
    """
    pmax_vals, exh_vals, fuel_vals = [], [], []

    for i in range(1, 7):
        # Extract Pmax
        for pk in (f"pmaxunit#{i}", f"pmax#{i}"):
            v = _safe_decimal(raw_data, pk)
            if v is not None:
                pmax_vals.append(v)
                break

        # Extract Exhaust Temperature
        for ek in (f"exhausttempunit#{i}", f"exhausttemp#{i}"):
            v = _safe_decimal(raw_data, ek)
            if v is not None:
                exh_vals.append(v)
                break

        # Extract Fuel Rack
        for fk in (f"fuelrackunit#{i}", f"fuelrack#{i}"):
            v = _safe_decimal(raw_data, fk)
            if v is not None:
                fuel_vals.append(v)
                break

    out = {}

    if pmax_vals:
        out["pmax_graph_bar"] = (sum(pmax_vals) / len(pmax_vals)).quantize(Decimal("0.01"))
    if exh_vals:
        out["exh_temp_cyl_outlet_avg_graph_c"] = (sum(exh_vals) / len(exh_vals)).quantize(Decimal("0.1"))
    if fuel_vals:
        out["fuel_pump_index_graph"] = (sum(fuel_vals) / len(fuel_vals)).quantize(Decimal("0.01"))

    return out

def extract_cylinder_readings(raw_data: dict) -> dict:
    """
    Builds a per-cylinder readings dict from the raw PDF extraction data.
    Mirrors the ME cylinder_readings structure used on the frontend.

    Returns:
        {
            "1": {"pmax": 125, "exhaust_temp": 295, "fuel_rack": 22, "jcw_temp_out": 78},
            "2": {...},
            ...
        }
    """
    readings = {}

    for i in range(1, 7):
        # Read each parameter using the same key patterns as process_cylinder_data()
        pmax = None
        for pk in (f"pmaxunit#{i}", f"pmax#{i}"):
            v = _safe_decimal(raw_data, pk)
            if v is not None:
                pmax = float(v)
                break

        exhaust_temp = None
        for ek in (f"exhausttempunit#{i}", f"exhausttemp#{i}"):
            v = _safe_decimal(raw_data, ek)
            if v is not None:
                exhaust_temp = float(v)
                break

        fuel_rack = None
        for fk in (f"fuelrackunit#{i}", f"fuelrack#{i}"):
            v = _safe_decimal(raw_data, fk)
            if v is not None:
                fuel_rack = float(v)
                break

        jcw_temp_out = None
        for jk in (f"jcwtempoutunit#{i}", f"jcwtempout#{i}"):
            v = _safe_decimal(raw_data, jk)
            if v is not None:
                jcw_temp_out = float(v)
                break

        # Only include cylinder if at least one value is present
        if any(v is not None for v in [pmax, exhaust_temp, fuel_rack, jcw_temp_out]):
            readings[str(i)] = {
                "pmax": pmax,
                "exhaust_temp": exhaust_temp,
                "fuel_rack": fuel_rack,
                "jcw_temp_out": jcw_temp_out,
            }

    return readings
# -----------------------------------------------------------
# BUILD GRAPH DATA (Uses safe_decimal and raises mandatory check)
# -----------------------------------------------------------
def build_graph_data(raw_data: dict) -> Dict[str, Any]:
    """
    Builds the graph_data dictionary from raw PDF extraction data.
    Includes load, temperatures, pressures, and cylinder averages.
    Raises ValueError if critical %load is missing.
    """
    graph = {}

    # Load kW
    load_kw = _safe_decimal(raw_data, "load")
    if load_kw is not None:
        graph["load_kw"] = load_kw

    # Load percentage (MANDATORY)
    load_pct = _safe_decimal(raw_data, "%load")
    if load_pct is not None:
        graph["load_percentage"] = load_pct

    # Scavenge Air Pressure
    scav_air = _safe_decimal(raw_data, "scavairpress")
    if scav_air is not None:
        graph["boost_air_pressure_graph_bar"] = scav_air.quantize(Decimal("0.01"))

    # TC inlet temperature
    tc_in = _safe_decimal(raw_data, "tcexhintemp")
    if tc_in is not None:
        graph["exh_temp_tc_inlet_graph_c"] = tc_in

    # TC outlet temperature
    tc_out = _safe_decimal(raw_data, "tcexhouttemp")
    if tc_out is not None:
        graph["exh_temp_tc_outlet_graph_c"] = tc_out

    # Cylinder summary (pmax, avg exhaust temp, fuel pump index)
    graph.update(process_cylinder_data(raw_data))
    cyl_readings = extract_cylinder_readings(raw_data)
    if cyl_readings:
        graph["cylinder_readings"] = cyl_readings
    # CRITICAL CHECK: load_percentage must exist
    if "load_percentage" not in graph:
        raise ValueError("Critical missing value: %load not present in PDF.")

    return graph


# -----------------------------------------------------------
# AE vs ME VALIDATION
# -----------------------------------------------------------
def validate_ae_report_type(raw_data: dict) -> bool:
    """
    Validates if the uploaded PDF is an AE (Auxiliary Engine) report.
    Returns True if AE, False if ME (Main Engine).
    Raises ValueError if unable to determine.
    """
    ae_keys = ["engineselection", "aemaker", "scavairpress"]
    me_keys = ["enginemaker", "vesselname", "rpm_percent", "shaft_power_kw"]

    ae_count = sum(1 for k in ae_keys if k in raw_data)
    me_count = sum(1 for k in me_keys if k in raw_data)

    # Strong AE indicator: engineselection field
    if "engineselection" in raw_data:
        sel = str(raw_data["engineselection"]).strip()
        if sel in ("0.1", "0.2", "0.3"):
            logger.info(f"[TYPE] AE detected via engineselection={sel}")
            return True

    if me_count > ae_count:
        logger.warning(f"[TYPE] ME report detected → AE:{ae_count}, ME:{me_count}")
        return False

    if ae_count > me_count:
        logger.info(f"[TYPE] AE report detected → AE:{ae_count}, ME:{me_count}")
        return True

    raise ValueError("Unable to determine AE/ME type from PDF.")


# -----------------------------------------------------------
# MAIN ENTRY - SAVE REPORT FROM PDF
# -----------------------------------------------------------
def save_ae_monthly_report_from_pdf(
    pdf_file_stream: BinaryIO,
    filename: str,
    session: Session
) -> Optional[Dict[str, Any]]:
    """
    Main entry point for processing and saving an AE monthly report from PDF.
    
    Steps:
    1. Extract data from PDF
    2. Validate report type (AE vs ME)
    3. Get or create generator record
    4. Check for duplicates (BY EXACT DATE NOW)
    5. Build and save graph data
    6. Compute deviations (NEW!)
    7. Process alerts
    
    Args:
        pdf_file_stream: File stream of the PDF
        filename: Name of the uploaded file
        session: SQLAlchemy database session
        
    Returns:
        Dict containing report details or None if processing fails
    """
    logger.info(f"📄 Processing PDF: {filename}")

    try:
        # 1️⃣ Extract data from PDF
        raw_data = extract_ae_performance_data(pdf_file_stream, filename)
        if not raw_data:
            raise ValueError("PDF extraction returned no data.")

        missing_params = check_ae_parameters_integrity(raw_data)
        range_alerts = validate_ae_parameter_intervals(raw_data)

        validation_errors = missing_params + range_alerts

        # 2️⃣ Validate AE/ME type
        if not validate_ae_report_type(raw_data):
            raise ValueError("Uploaded PDF is ME report. Upload correct AE report.")

        # 3️⃣ Extract core fields
        imo = raw_data.get("imo")
        rpt_date = raw_data.get("performancedate")

        if not imo:
            raise ValueError("IMO number missing in PDF.")
        if not isinstance(rpt_date, date):
            raise ValueError(f"Invalid report date: {rpt_date}")

        rpt_month = rpt_date.strftime("%Y-%m")

        # 4️⃣ Determine generator designation
        gen_sel = str(raw_data.get("engineselection", "")).strip().lower()
        designation_map = {
            "0.1": "Aux Engine No.1",
            "0.2": "Aux Engine No.2",
            "0.3": "Aux Engine No.3",
            "aux engine no.1": "Aux Engine No.1",
            "aux engine no.2": "Aux Engine No.2",
            "aux engine no.3": "Aux Engine No.3",
        }
        designation = designation_map.get(gen_sel, None)

        # 5️⃣ Extract Maker & Model
        maker = str(raw_data.get("aemaker", "YANMAR")).strip()
        model = str(raw_data.get("aemodel", "6EY18ALW")).strip()

        # 6️⃣ Get or create generator master record
        generator = get_or_create_generator(
            session=session,
            imo_number=imo,
            designation=designation,
            engine_maker_in=maker,
            engine_model_in=model
        )

        # 🔥 CRITICAL: Capture generator info BEFORE commit
        # (after commit, generator object may become detached from session)
        generator_id = generator.generator_id
        generator_designation = generator.designation
        generator_engine_maker = generator.engine_maker
        generator_engine_model = generator.engine_model

        # 7️⃣ Check for duplicate report (BY EXACT DATE)
        # CHANGED: Filter by report_date instead of report_month to allow multiple reports per month
        new_run_hrs = _safe_decimal(raw_data, "totalenginerunhrs")
        new_load_kw = _safe_decimal(raw_data, "load")

        # Query Header joined with GraphData to check all fields
        existing = session.query(GeneratorMonthlyReportHeader).join(
            GeneratorPerformanceGraphData,
            GeneratorMonthlyReportHeader.report_id == GeneratorPerformanceGraphData.report_id
        ).filter(
            GeneratorMonthlyReportHeader.generator_id == generator_id,
            GeneratorMonthlyReportHeader.report_date == rpt_date,
            GeneratorMonthlyReportHeader.total_engine_run_hrs == new_run_hrs,
            GeneratorPerformanceGraphData.load_kw == new_load_kw
        ).first()

        if existing:
            session.rollback()
            logger.info(f"📋 Exact duplicate detected (Date: {rpt_date}, KW: {new_load_kw}, Hrs: {new_run_hrs})")
            return {
                "report_id": existing.report_id,
                "generator_id": generator_id,
                "report_month": rpt_month,
                "report_date": existing.report_date,
                "is_duplicate": True,
                "missing_parameters": validation_errors
            }

        # 8️⃣ Build graph data
        graph = build_graph_data(raw_data)

        # 9️⃣ Save report (header + JSON + graph data)
        header = save_ae_monthly_report(
            session=session,
            generator=generator,
            report_date=rpt_date,
            report_month=rpt_month,
            raw_json_data=raw_data,
            graph_data=graph
        )

        session.commit()
        session.flush()  # Ensure all data is written to database

        # 🔥 NEW: Compute and save deviation analysis
        logger.info(f"[AE_PROCESSOR] 📊 Computing deviations for report_id={header.report_id}")
        try:
            compute_and_save_ae_deviation(session, header.report_id)
            logger.info(f"[AE_PROCESSOR] ✅ Deviations computed successfully")
        except Exception as dev_err:
            logger.error(f"[DEVIATION] ⚠️ Non-critical error: {dev_err}", exc_info=True)
            # Continue processing even if deviation fails

        # 🚨 Process alerts (runs AFTER deviation computation)
        logger.info(f"[AE_PROCESSOR] 🚨 Processing alerts for report_id={header.report_id}")
        try:
            from app.ae_alert_processor import process_ae_alerts
            process_ae_alerts(session, header.report_id)
            logger.info(f"[AE_PROCESSOR] ✅ Alerts processed successfully")
        except Exception as alert_err:
            logger.error(f"[ALERT] ⚠️ Non-critical error: {alert_err}", exc_info=True)

        # 🎯 Return success response
        return {
            "report_id": header.report_id,
            "generator_id": generator_id,
            "generator_designation": generator_designation,
            "engine_maker": generator_engine_maker,
            "engine_model": generator_engine_model,
            "report_month": rpt_month,
            "report_date": rpt_date,
            "is_duplicate": False,
            "missing_parameters": validation_errors 
        }

    except ValueError as e:
        logger.error(f"[AE_PROCESSOR] ❌ Validation Error: {e}", exc_info=True)
        session.rollback()
        raise
    except Exception as e:
        logger.error(f"[AE_PROCESSOR] ❌ Critical Error: {e}", exc_info=True)
        session.rollback()
        raise

def check_ae_parameters_integrity(raw_data: Dict[str, Any]) -> List[str]:
    """
    Checks for missing AE values.
    Returns human-readable names of missing parameters.
    """
    missing = []
    
    def is_empty(val):
        return val in [None, "", 0, "0", 0.0, "0.0"]

    # 1. Simple Mandatory Fields
    simple_fields = {
        "imo": "IMO Number", 
        "performancedate": "Performance Date", 
        "load": "Load (kW)",
        "%load": "Load %", 
        "folcv": "FO LCV", 
        "current": "Current (A)",
        "lotempin": "LO Temp In", 
        "lotempout": "LO Temp Out",
        "fopressure": "FO Pressure", 
        "minjcwtemp": "Min JCW Temp",
        "scavairtemp": "Scav Air Temp", 
        "tcexhintemp": "TC Exh In Temp",
        "scavairpress": "Scav Air Press", 
        "tcexhouttemp": "TC Exh Out Temp",
        "maxunitexhtemp": "Max Unit Exh Temp", 
        "foinjectiontemp": "FO Injection Temp",
        "scavairtemphigh": "Scav Air Temp High", 
        "aircoolercwinlet": "AC CW In Temp",
        "aircoolercwoutlet": "AC CW Out Temp", 
        "totalenginerunhrs": "Total Engine Run Hrs",
        "unitexhtempdeviation": "Unit Exh Temp Dev", 
        "fuelinjectorohaulinterval": "Fuel Inj O'haul Interval"
    }

    for key, label in simple_fields.items():
        if is_empty(raw_data.get(key)):
            missing.append(label)

    # 2. Group Logic (Avg vs Cylinders 1-6)
    groups = {
        "P-Max": {"avg": "pmaxaverage", "cyls": [f"pmaxunit#{i}" for i in range(1, 7)]},
        "Exhaust Temp": {"avg": "exhausttempaverage", "cyls": [f"exhausttempunit#{i}" for i in range(1, 7)]},
        "Fuel Rack": {"avg": "fuelrackaverage", "cyls": [f"fuelrackunit#{i}" for i in range(1, 7)]},
        "JCW Temp Out": {"avg": "jcwtempoutaverage", "cyls": [f"jcwtempoutunit#{i}" for i in range(1, 7)]}
    }

    for label, keys in groups.items():
        # If Average is empty, check if ALL cylinders are also empty
        if is_empty(raw_data.get(keys["avg"])):
            all_cyls_empty = all(is_empty(raw_data.get(c)) for c in keys["cyls"])
            if all_cyls_empty:
                missing.append(f"{label} (Avg/Cyl)")

    return missing

def validate_ae_parameter_intervals(raw_data: Dict[str, Any]) -> List[str]:
    """
    Checks if extracted AE values are within the intervals defined in AE_PARAMETER_INTERVALS.
    Returns a list of warning messages for the client.
    """
    interval_alerts = []

    for key, bounds in AE_PARAMETER_INTERVALS.items():
        # Get the value (handles if data is a dict {'value': x} or just a value)
        raw_val = raw_data.get(key)
        val = raw_val.get("value") if isinstance(raw_val, dict) else raw_val

        # Only validate if the value is not empty (integrity check handles empties)
        if val not in [None, "", 0, "0", 0.0, "0.0"]:
            try:
                num_val = float(val)
                if num_val < bounds["min"] or num_val > bounds["max"]:
                    interval_alerts.append(
                        f"Out of Range: {bounds['label']} ({num_val}). Expected {bounds['min']} to {bounds['max']}."
                    )
            except (ValueError, TypeError):
                continue # Skip if conversion to float fails
                
    return interval_alerts