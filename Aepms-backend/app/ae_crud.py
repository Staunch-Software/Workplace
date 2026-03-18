# app/ae_crud.py
# âœ… CORRECT VERSION - Uses actual database column names

import logging
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy.orm import Session

from app.generator_models import (
    VesselGenerator, GeneratorMonthlyReportHeader,
    GeneratorMonthlyReportDetailsJsonb, GeneratorPerformanceGraphData
)
from app.models import VesselInfo

logger = logging.getLogger(__name__)


def serialize_for_json(obj):
    """Convert Decimal/date objects to JSON-safe types."""
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    return obj


def get_or_create_generator(
    session: Session,
    imo_number: int,
    engine_no: str = None,
    designation: str = None,
    engine_maker_in: str = "YANMAR",
    engine_model_in: str = "6EY18ALW"
) -> VesselGenerator:
    """
    âœ… CORRECT: Uses actual database column names (engine_maker, engine_model)
    """
    
    # Validate vessel
    vessel = session.query(VesselInfo).filter(
        VesselInfo.imo_number == imo_number
    ).first()

    if not vessel:
        raise ValueError(f"Vessel with IMO {imo_number} not found")

    logger.info(f"[GENERATOR] Vessel found: {vessel.vessel_name} ({imo_number})")

    # Clean designation
    if designation:
        designation = str(designation).strip()
        if designation.replace(".", "").isdigit():
            logger.warning(f"Invalid designation '{designation}' â†’ auto-generating")
            designation = None
        else:
            logger.info(f"Using designation: '{designation}'")

    # Clean maker
    if engine_maker_in:
        engine_maker_in = str(engine_maker_in).strip()
        if engine_maker_in.replace(".", "").isdigit():
            engine_maker_in = "YANMAR"
            logger.warning("Engine maker looked numeric â†’ defaulting to YANMAR")

    # Clean model
    if engine_model_in:
        engine_model_in = str(engine_model_in).strip()
        if engine_model_in.replace(".", "").isdigit():
            engine_model_in = "6EY18ALW"
            logger.warning("Engine model looked numeric â†’ defaulting to 6EY18ALW")

    # Generate engine_no if missing
    if not engine_no:
        count = session.query(VesselGenerator).filter(
            VesselGenerator.imo_number == imo_number
        ).count()
        engine_no = f"E{imo_number}-AE{count + 1}"

    # Look up generator by engine_no
    existing = session.query(VesselGenerator).filter(
        VesselGenerator.engine_no == engine_no
    ).first()

    if existing:
        logger.info(f"[GENERATOR] Found existing generator by engine_no: {existing.engine_no}")
        return existing

    # Look up generator by designation
    if designation:
        existing2 = session.query(VesselGenerator).filter(
            VesselGenerator.imo_number == imo_number,
            VesselGenerator.designation == designation
        ).first()

        if existing2:
            logger.info(f"[GENERATOR] Found existing generator by designation: {designation}")
            return existing2

    # Auto-generate designation
    if not designation:
        count = session.query(VesselGenerator).filter(
            VesselGenerator.imo_number == imo_number
        ).count()
        designation = f"Aux Engine No.{count + 1}"
        logger.info(f"Auto-generated designation â†’ {designation}")

    # âœ… CORRECT: Uses actual database column names
    new_gen = VesselGenerator(
        imo_number=imo_number,
        engine_no=engine_no,
        designation=designation,
        engine_maker=engine_maker_in,    # Correct column name
        engine_model=engine_model_in      # Correct column name
    )

    session.add(new_gen)
    session.flush()

    logger.info(
        f"âœ… New generator created â†’ ID: {new_gen.generator_id}, "
        f"Designation: {new_gen.designation}, Engine No: {new_gen.engine_no}"
    )

    return new_gen


def save_ae_monthly_report(
    session: Session,
    generator: VesselGenerator,
    report_date: date,
    report_month: str,
    raw_json_data: dict,
    graph_data: dict
) -> GeneratorMonthlyReportHeader:
    """Save AE monthly report to database."""
    
    def get_graph_value(key, default_value=None):
        val = graph_data.get(key)
        if val is None and default_value is not None:
            return Decimal(str(default_value))
        return val

    # 1️⃣ CREATE HEADER
    header = GeneratorMonthlyReportHeader(
        generator_id=generator.generator_id,
        report_date=report_date,
        report_month=report_month,
        total_engine_run_hrs=raw_json_data.get("totalenginerunhrs"),
        measured_by=raw_json_data.get("measuredby"),
        chief_engineer_name=raw_json_data.get("chiefengineername_sign"),
        cylinder_readings=graph_data.get("cylinder_readings")
    )

    session.add(header)
    session.flush()

    logger.info(f"📄 Header created → Report ID: {header.report_id}")

    # 2️⃣ SAVE RAW JSON
    json_safe = {
        k: serialize_for_json(v)
        for k, v in raw_json_data.items()
    }

    details = GeneratorMonthlyReportDetailsJsonb(
        report_id=header.report_id,
        data_jsonb=json_safe
    )

    session.add(details)
    logger.info(f"📦 JSONB saved → {len(json_safe)} fields")

    # 3️⃣ SAVE GRAPH DATA
    graph_record = GeneratorPerformanceGraphData(
        report_id=header.report_id,
        load_percentage=get_graph_value("load_percentage", 0),
        load_kw=get_graph_value("load_kw", 0),
        pmax_graph_bar=get_graph_value("pmax_graph_bar", 0),
        max_combustion_pressure_bar=get_graph_value("pmax_graph_bar"),
        boost_air_pressure_graph_bar=get_graph_value("boost_air_pressure_graph_bar"),
        scav_air_pressure_bar=get_graph_value("boost_air_pressure_graph_bar"),
        exh_temp_tc_inlet_graph_c=get_graph_value("exh_temp_tc_inlet_graph_c"),
        exhaust_gas_temp_before_tc_c=get_graph_value("exh_temp_tc_inlet_graph_c"),
        exh_temp_tc_outlet_graph_c=get_graph_value("exh_temp_tc_outlet_graph_c"),
        exhaust_gas_temp_after_tc_c=get_graph_value("exh_temp_tc_outlet_graph_c"),
        fuel_pump_index_graph=get_graph_value("fuel_pump_index_graph"),
        fuel_rack_position_mm=get_graph_value("fuel_pump_index_graph"),
        engine_speed_rpm=get_graph_value("engine_speed_rpm"),
        compression_pressure_bar=get_graph_value("compression_pressure_bar"),
        turbocharger_speed_rpm=get_graph_value("turbocharger_speed_rpm"),
        sfoc_g_kwh=get_graph_value("sfoc_g_kwh"),
        exh_temp_cyl_outlet_avg_graph_c=get_graph_value("exh_temp_cyl_outlet_avg_graph_c"),
        fuel_consumption_total_kg_h=get_graph_value("fuel_consumption_total_graph_kg_h")
        # 🔥 ADDED: This stores the nested cylinder data (pmax, exhaust_temp, fuel_rack) per cylinder
        # cylinder_readings=graph_data.get("cylinder_readings") 
    )

    session.add(graph_record)
    logger.info(f"📊 Graph data saved → {len(graph_data)} parameters stored")
    logger.info(f"[CYL SAVE] cylinder_readings = {graph_data.get('cylinder_readings')}")

    return header