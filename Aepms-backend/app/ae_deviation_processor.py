# app/ae_deviation_processor.py
"""
🔥 AE DEVIATION PROCESSOR - Production-Ready Module
Computes deviations between actual AE performance and baseline curves.
Key Features:
1. Cylinder-level analysis (Worst Cylinder vs Baseline).
2. Average-level analysis (Reported Average vs Baseline).
3. Duplicate prevention.
"""

import logging
from decimal import Decimal
from typing import Optional, Dict, List, Tuple, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, select, func
from sqlalchemy.orm import selectinload

from app.generator_models import (
    GeneratorMonthlyReportHeader,
    GeneratorPerformanceGraphData,
    GeneratorBaselineData,
    AEDeviationHistory
)

logger = logging.getLogger(__name__)


async def compute_and_save_ae_deviation(session: AsyncSession, report_id: int) -> None:
    """
    Main entry point: Computes and saves AE deviation data for a given report.
    """
    try:
        # 🛑 DUPLICATE PREVENTION: Check if record already exists
        result = await session.execute(
            select(AEDeviationHistory).where(AEDeviationHistory.report_id == report_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            logger.info(f"[AE DEVIATION] Record already exists for report_id={report_id}, skipping.")
            return

        # 📥 Step 1: Fetch report header
        result = await session.execute(
            select(GeneratorMonthlyReportHeader)
            .options(selectinload(GeneratorMonthlyReportHeader.details_json))
            .where(GeneratorMonthlyReportHeader.report_id == report_id)
        )
        header = result.scalar_one_or_none()
        if not header:
            logger.error(f"[AE DEVIATION] No header found for report_id={report_id}")
            return

        generator_id = header.generator_id
        logger.info(f"[AE DEVIATION] Processing report_id={report_id}, generator_id={generator_id}")

        # 📥 Step 2: Fetch graph data (contains load%)
        result = await session.execute(
            select(GeneratorPerformanceGraphData).where(GeneratorPerformanceGraphData.report_id == report_id)
        )
        graph = result.scalar_one_or_none()
        if not graph or graph.load_percentage is None:
            raise ValueError(f"[AE DEVIATION] Missing load_percentage for report_id={report_id}")

        load_pct = float(graph.load_percentage)
        load_kw = float(graph.load_kw) if graph.load_kw else None
        
        # 📥 Step 3: Fetch baseline data for this generator
        result = await session.execute(
            select(GeneratorBaselineData)
            .where(GeneratorBaselineData.generator_id == generator_id)
            .order_by(GeneratorBaselineData.load_percentage)
        )
        baseline_rows = result.scalars().all()

        if not baseline_rows:
            logger.error(f"[AE DEVIATION] No baseline data for generator_id={generator_id}")
            return

        # 📥 Step 4: Extract cylinder data AND JSON AVERAGES
        cylinder_data = _extract_cylinder_data(header)

        # 🧮 Step 5: Initialize Record
        deviation_record = AEDeviationHistory(
            report_id=report_id,
            generator_id=generator_id,
            load_percentage=Decimal(str(load_pct)),
            load_kw=Decimal(str(load_kw)) if load_kw else None
        )

        # 🧮 Step 6: Process Parameters
        # Pmax & Pcomp (Dual Calculation: Worst & Average)
        _process_pmax(graph, baseline_rows, load_pct, cylinder_data, deviation_record)
        _process_pcomp(graph, baseline_rows, load_pct, cylinder_data, deviation_record)
        
        # Other Parameters (Single Deviation)
        _process_scav_air(graph, baseline_rows, load_pct, deviation_record)
        _process_tc_inlet(graph, baseline_rows, load_pct, deviation_record)
        _process_tc_outlet(graph, baseline_rows, load_pct, deviation_record)
        _process_exh_cyl_outlet(graph, baseline_rows, load_pct, cylinder_data, deviation_record)
        _process_turbo_speed(graph, baseline_rows, load_pct, deviation_record)
        _process_fuel_rack(graph, baseline_rows, load_pct, deviation_record)
        _process_sfoc(graph, baseline_rows, load_pct, deviation_record)
        _process_foc(graph, baseline_rows, load_pct, deviation_record)

        # 💾 Step 7: Save to database
        session.add(deviation_record)
        await session.flush()
        logger.info(f"[AE DEVIATION] ✅ Successfully saved deviations for report_id={report_id}")

    except Exception as e:
        await session.rollback()
        logger.error(f"[AE DEVIATION] ❌ Error processing report_id={report_id}: {str(e)}", exc_info=True)

def _extract_cylinder_data(header: GeneratorMonthlyReportHeader) -> Dict[str, Any]:
    """
    Extracts cylinder-level data AND pre-calculated averages from JSON.
    """
    data = {
        'pmax': [],
        'pcomp': [],
        'exhaust_temp': [],
        'averages': {
            'pmax': None,
            'pcomp': None,
            'exhaust': None,
            'fuel_rack': None
        }
    }

    if not header.details_json or not header.details_json.data_jsonb:
        return data

    json_data = header.details_json.data_jsonb

    # 1. Extract Pre-calculated Averages from JSON
    # This ensures we use the exact number reported in the PDF
    try:
        if json_data.get('pmaxaverage') is not None:
            data['averages']['pmax'] = float(json_data['pmaxaverage'])
        
        if json_data.get('pcompaverage') is not None:
            data['averages']['pcomp'] = float(json_data['pcompaverage'])
            
        if json_data.get('exhausttempaverage') is not None:
            data['averages']['exhaust'] = float(json_data['exhausttempaverage'])
            
        if json_data.get('fuelrackaverage') is not None:
            data['averages']['fuel_rack'] = float(json_data['fuelrackaverage'])
    except (ValueError, TypeError):
        logger.warning("Error parsing averages from JSON, will calculate manually.")

    # 2. Extract Individual Cylinder Values
    for i in range(1, 10): 
        val = json_data.get(f"pmaxunit#{i}")
        if val is not None: data['pmax'].append(float(val))
        
        val = json_data.get(f"pcompunit#{i}")
        if val is not None: data['pcomp'].append(float(val))
        
        val = json_data.get(f"exhausttempunit#{i}")
        if val is not None: data['exhaust_temp'].append(float(val))

    return data


def _get_worst_cylinder_value(cylinder_values: List[float]) -> Optional[float]:
    """Computes the worst cylinder value based on max deviation from average."""
    if not cylinder_values:
        return None
    
    avg = sum(cylinder_values) / len(cylinder_values)
    deviations = [(val, abs(val - avg)) for val in cylinder_values]
    worst_cylinder = max(deviations, key=lambda x: x[1])
    return worst_cylinder[0]


def _interpolate_baseline(baseline_rows: List[GeneratorBaselineData], 
                          load_pct: float, 
                          field_name: str) -> Optional[float]:
    """Linear interpolation to find baseline value at actual load."""
    lower_row = None
    upper_row = None

    for row in baseline_rows:
        row_load = float(row.load_percentage)
        if row_load <= load_pct:
            lower_row = row
        if row_load >= load_pct and upper_row is None:
            upper_row = row
            break

    # Interpolation Logic
    lower_val = getattr(lower_row, field_name, None) if lower_row else None
    upper_val = getattr(upper_row, field_name, None) if upper_row else None

    if lower_val is None and upper_val is None: return None
    if lower_val is None: return float(upper_val)
    if upper_val is None: return float(lower_val)

    lower_load = float(lower_row.load_percentage)
    upper_load = float(upper_row.load_percentage)

    if lower_load == upper_load: return float(lower_val)
    
    return float(lower_val) + ((load_pct - lower_load) / (upper_load - lower_load)) * (float(upper_val) - float(lower_val))


def _compute_deviation(actual: Optional[float], 
                       baseline: Optional[float]) -> Tuple[Optional[Decimal], Optional[Decimal]]:
    """Returns (deviation, deviation_pct) as Decimals."""
    if actual is None or baseline is None or baseline == 0:
        return None, None

    dev = actual - baseline
    dev_pct = (dev / baseline) * 100

    return Decimal(str(round(dev, 2))), Decimal(str(round(dev_pct, 2)))


# ==================== PARAMETER PROCESSORS ====================

def _process_pmax(graph, baseline_rows, load_pct, cylinder_data, record):
    """
    Process Pmax: 
    1. Worst Cylinder Deviation (stored in pmax_...)
    2. Average Value Deviation (stored in pmax_avg_...)
    """
    cyl_vals = cylinder_data['pmax']
    
    # --- 1. Average Value ---
    avg_val = cylinder_data['averages']['pmax']
    # Fallback if JSON average is missing
    if avg_val is None and cyl_vals:
        avg_val = sum(cyl_vals) / len(cyl_vals)
    # Fallback to graph if everything else fails
    if avg_val is None and graph.pmax_graph_bar:
        avg_val = float(graph.pmax_graph_bar)

    # --- 2. Worst Cylinder Value ---
    worst_val = _get_worst_cylinder_value(cyl_vals)
    if worst_val is None: worst_val = avg_val 

    # --- 3. Baseline ---
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'pmax_graph_bar')
    
    if baseline:
        # Save WORST Deviation
        if worst_val is not None:
            record.pmax_actual = Decimal(str(worst_val))
            record.pmax_baseline = Decimal(str(baseline))
            record.pmax_dev, record.pmax_dev_pct = _compute_deviation(worst_val, baseline)

        # Save AVERAGE Deviation
        if avg_val is not None:
            record.pmax_avg_actual = Decimal(str(avg_val))
            record.pmax_avg_baseline = Decimal(str(baseline)) 
            record.pmax_avg_dev, record.pmax_avg_dev_pct = _compute_deviation(avg_val, baseline)
            
        logger.debug(f"[PMAX] Worst={worst_val}, Avg={avg_val}, Base={baseline}")


def _process_pcomp(graph, baseline_rows, load_pct, cylinder_data, record):
    """
    Process Pcomp: 
    1. Worst Cylinder Deviation (stored in pcomp_...)
    2. Average Value Deviation (stored in pcomp_avg_...)
    """
    cyl_vals = cylinder_data['pcomp']

    # --- 1. Average Value ---
    avg_val = cylinder_data['averages']['pcomp']
    if avg_val is None and cyl_vals:
        avg_val = sum(cyl_vals) / len(cyl_vals)
    if avg_val is None and graph.compression_pressure_bar:
        avg_val = float(graph.compression_pressure_bar)

    # --- 2. Worst Cylinder Value ---
    worst_val = _get_worst_cylinder_value(cyl_vals)
    if worst_val is None: worst_val = avg_val

    # --- 3. Baseline ---
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'compression_pressure_bar')
    # Fallback for Pcomp baseline
    if baseline is None: 
        baseline = _interpolate_baseline(baseline_rows, load_pct, 'max_combustion_pressure_bar')

    if baseline:
        # Save WORST Deviation
        if worst_val is not None:
            record.pcomp_actual = Decimal(str(worst_val))
            record.pcomp_baseline = Decimal(str(baseline))
            record.pcomp_dev, record.pcomp_dev_pct = _compute_deviation(worst_val, baseline)

        # Save AVERAGE Deviation
        if avg_val is not None:
            record.pcomp_avg_actual = Decimal(str(avg_val))
            record.pcomp_avg_dev, record.pcomp_avg_dev_pct = _compute_deviation(avg_val, baseline)

        logger.debug(f"[PCOMP] Worst={worst_val}, Avg={avg_val}, Base={baseline}")


def _process_exh_cyl_outlet(graph, baseline_rows, load_pct, cylinder_data, record):
    """
    Process Exhaust: Currently stores Worst Cylinder deviation.
    """
    cyl_vals = cylinder_data['exhaust_temp']

    # Determine values
    avg_val = cylinder_data['averages']['exhaust']
    if avg_val is None and cyl_vals:
        avg_val = sum(cyl_vals) / len(cyl_vals)
    
    worst_val = _get_worst_cylinder_value(cyl_vals)
    if worst_val is None: worst_val = avg_val
    if worst_val is None and graph.exh_temp_cyl_outlet_avg_graph_c:
        worst_val = float(graph.exh_temp_cyl_outlet_avg_graph_c)

    baseline = _interpolate_baseline(baseline_rows, load_pct, 'exh_temp_cyl_outlet_avg_graph_c')

    if baseline and worst_val is not None:
        record.exh_cyl_out_actual = Decimal(str(worst_val))
        record.exh_cyl_out_baseline = Decimal(str(baseline))
        record.exh_cyl_out_dev, record.exh_cyl_out_dev_pct = _compute_deviation(worst_val, baseline)


def _process_scav_air(graph, baseline_rows, load_pct, record):
    actual = None
    if graph.scav_air_pressure_bar: actual = float(graph.scav_air_pressure_bar)
    elif graph.boost_air_pressure_graph_bar: actual = float(graph.boost_air_pressure_graph_bar)
    
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'scav_air_pressure_bar')
    if baseline is None: baseline = _interpolate_baseline(baseline_rows, load_pct, 'boost_air_pressure_graph_bar')
    
    if actual and baseline:
        record.scav_air_actual = Decimal(str(actual))
        record.scav_air_baseline = Decimal(str(baseline))
        record.scav_air_dev, record.scav_air_dev_pct = _compute_deviation(actual, baseline)


def _process_tc_inlet(graph, baseline_rows, load_pct, record):
    actual = None
    if graph.exhaust_gas_temp_before_tc_c: actual = float(graph.exhaust_gas_temp_before_tc_c)
    elif graph.exh_temp_tc_inlet_graph_c: actual = float(graph.exh_temp_tc_inlet_graph_c)

    baseline = _interpolate_baseline(baseline_rows, load_pct, 'exhaust_gas_temp_before_tc_c')
    if baseline is None: baseline = _interpolate_baseline(baseline_rows, load_pct, 'exh_temp_tc_inlet_graph_c')
    
    if actual and baseline:
        record.tc_in_actual = Decimal(str(actual))
        record.tc_in_baseline = Decimal(str(baseline))
        record.tc_in_dev, record.tc_in_dev_pct = _compute_deviation(actual, baseline)


def _process_tc_outlet(graph, baseline_rows, load_pct, record):
    actual = None
    if graph.exhaust_gas_temp_after_tc_c: actual = float(graph.exhaust_gas_temp_after_tc_c)
    elif graph.exh_temp_tc_outlet_graph_c: actual = float(graph.exh_temp_tc_outlet_graph_c)

    baseline = _interpolate_baseline(baseline_rows, load_pct, 'exhaust_gas_temp_after_tc_c')
    if baseline is None: baseline = _interpolate_baseline(baseline_rows, load_pct, 'exh_temp_tc_outlet_graph_c')
    
    if actual and baseline:
        record.tc_out_actual = Decimal(str(actual))
        record.tc_out_baseline = Decimal(str(baseline))
        record.tc_out_dev, record.tc_out_dev_pct = _compute_deviation(actual, baseline)


def _process_turbo_speed(graph, baseline_rows, load_pct, record):
    actual = float(graph.turbocharger_speed_rpm) if graph.turbocharger_speed_rpm else None
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'turbocharger_speed_rpm')
    
    if actual and baseline:
        record.turbo_speed_actual = Decimal(str(actual))
        record.turbo_speed_baseline = Decimal(str(baseline))
        record.turbo_speed_dev, record.turbo_speed_dev_pct = _compute_deviation(actual, baseline)


def _process_fuel_rack(graph, baseline_rows, load_pct, record):
    # Try using average from JSON first
    actual = None # cylinder_data passed to parent scope, handled via closure if needed, but not passed here.
    # Re-extracting logic simplified for single param
    if graph.fuel_rack_position_mm: actual = float(graph.fuel_rack_position_mm)
    elif graph.fuel_pump_index_graph: actual = float(graph.fuel_pump_index_graph)
    
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'fuel_rack_position_mm')
    if baseline is None: baseline = _interpolate_baseline(baseline_rows, load_pct, 'fuel_pump_index_graph')
    
    if actual and baseline:
        record.fuel_rack_actual = Decimal(str(actual))
        record.fuel_rack_baseline = Decimal(str(baseline))
        record.fuel_rack_dev, record.fuel_rack_dev_pct = _compute_deviation(actual, baseline)


def _process_sfoc(graph, baseline_rows, load_pct, record):
    actual = float(graph.sfoc_g_kwh) if graph.sfoc_g_kwh else None
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'sfoc_g_kwh')
    
    if actual and baseline:
        record.sfoc_actual = Decimal(str(actual))
        record.sfoc_baseline = Decimal(str(baseline))
        record.sfoc_dev, record.sfoc_dev_pct = _compute_deviation(actual, baseline)


def _process_foc(graph, baseline_rows, load_pct, record):
    actual = float(graph.fuel_consumption_total_kg_h) if graph.fuel_consumption_total_kg_h else None
    baseline = _interpolate_baseline(baseline_rows, load_pct, 'fuel_consumption_total_kg_h')
    
    if actual and baseline:
        record.foc_actual = Decimal(str(actual))
        record.foc_baseline = Decimal(str(baseline))
        record.foc_dev, record.foc_dev_pct = _compute_deviation(actual, baseline)