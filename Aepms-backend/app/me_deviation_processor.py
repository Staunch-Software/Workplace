# app/me_deviation_processor.py

import logging
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional, Any
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models import (
    MonthlyReportHeader,
    MonthlyReportDetailsJsonb,
    MonthlyISOPerformanceData,
    ShopTrialSession,
    ShopTrialPerformanceData,
    MEDeviationHistory
)

logger = logging.getLogger(__name__)

def safe_decimal(value: Any) -> Optional[Decimal]:
    if value is None: return None
    try: return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError): return None

def extract_cylinder_values(json_data: Dict, param_prefix: str, num_cylinders: int = 6) -> List[Optional[Decimal]]:
    values = []
    for i in range(1, num_cylinders + 1):
        key_flat = f"{param_prefix}#{i}"
        key_nested = f"#{i}"
        val = None
        if param_prefix in json_data and isinstance(json_data[param_prefix], dict):
            v = json_data[param_prefix].get(key_nested, {})
            val = v.get('value') if isinstance(v, dict) else v
        else:
            v = json_data.get(key_flat, {})
            val = v.get('value') if isinstance(v, dict) else v
        values.append(safe_decimal(val))
    return values

def compute_worst_cylinder_value(raw_values: List[Optional[Decimal]], avg_raw: Optional[Decimal], avg_iso: Optional[Decimal]) -> Dict[str, Any]:
    valid_vals = [v for v in raw_values if v is not None]
    if not valid_vals:
        return {'worst_val_iso': None}
    
    calc_avg_raw = sum(valid_vals) / len(valid_vals)
    used_avg_raw = avg_raw if (avg_raw and avg_raw > 0) else calc_avg_raw
    
    max_dev = Decimal(-1)
    worst_raw_val = None
    
    for val in valid_vals:
        dev = abs(val - used_avg_raw)
        if dev > max_dev:
            max_dev = dev
            worst_raw_val = val
            
    if avg_iso and used_avg_raw > 0:
        ratio = avg_iso / used_avg_raw
        worst_val_iso = worst_raw_val * ratio
    else:
        worst_val_iso = worst_raw_val
        
    return {'worst_val_iso': worst_val_iso.quantize(Decimal('0.01')) if worst_val_iso else None}

def interpolate_baseline(load_pct: Decimal, baseline_data: List, field: str, fallback_fields: List = None) -> Optional[Decimal]:
    if not baseline_data: return None
    fields = [field] + (fallback_fields or [])
    for f in fields:
        lower, upper = None, None
        for p in baseline_data:
            pl = safe_decimal(p.load_percentage)
            pv = getattr(p, f, None)
            if pl is None or pv is None: continue
            pv = safe_decimal(pv)
            if pl <= load_pct: lower = (pl, pv)
            if pl >= load_pct and upper is None: upper = (pl, pv)
        if lower or upper:
            if not lower: return upper[1]
            if not upper: return lower[1]
            if lower[0] == upper[0]: return lower[1]
            res = lower[1] + (load_pct - lower[0]) * (upper[1] - lower[1]) / (upper[0] - lower[0])
            return res.quantize(Decimal('0.0001'))
    return None

def compute_and_save_me_deviation(session: Session, report_id: int) -> Optional[MEDeviationHistory]:
    try:
        logger.info(f"🚀 Computing ME Deviation for Report {report_id}")
        
        header = session.query(MonthlyReportHeader).filter_by(report_id=report_id).first()
        iso = session.query(MonthlyISOPerformanceData).filter_by(report_id=report_id).first()
        
        if not iso:
            logger.error("❌ ISO data missing. Cannot compute deviation.")
            return None
            
        json_rec = session.query(MonthlyReportDetailsJsonb).filter(
            MonthlyReportDetailsJsonb.report_id == report_id,
            MonthlyReportDetailsJsonb.section_name.in_(['raw_extract', 'raw_extract_me'])
        ).first()
        json_data = json_rec.data_jsonb if json_rec else {}
        
        vessel = header.vessel
        st_session = session.query(ShopTrialSession).filter_by(engine_no=vessel.engine_no).first()
        baselines = []
        if st_session:
            baselines = session.query(ShopTrialPerformanceData).filter_by(
                session_id=st_session.session_id
            ).order_by(ShopTrialPerformanceData.load_percentage).all()
            
        load_pct = safe_decimal(header.load_percent) or Decimal('0')
        
        # Calculations for Cylinder-wise metrics
        pmax_raw_list = extract_cylinder_values(json_data, 'pmax')
        pmax_res = compute_worst_cylinder_value(pmax_raw_list, safe_decimal(header.max_comb_pr_avg_bar), safe_decimal(iso.max_combustion_pressure_iso_bar))
        
        pcomp_raw_list = extract_cylinder_values(json_data, 'pcomp')
        pcomp_res = compute_worst_cylinder_value(pcomp_raw_list, safe_decimal(header.comp_pr_avg_bar), safe_decimal(iso.compression_pressure_iso_bar))
        
        exh_raw_list = extract_cylinder_values(json_data, 'exhausttemp')
        avg_exh_raw = safe_decimal(header.exh_temp_cylinder_outlet_ave_c)
        exh_res = compute_worst_cylinder_value(exh_raw_list, avg_exh_raw, avg_exh_raw) 
        
        def get_dev(actual, base_field, fallbacks):
            base = interpolate_baseline(load_pct, baselines, base_field, fallbacks)
            if actual is None or base is None: return None, None, None
            diff = actual - base
            pct = (diff / base * 100) if base != 0 else 0
            return base, diff.quantize(Decimal('0.01')), pct.quantize(Decimal('0.01'))

        # --- CALCULATIONS ---
        
        # 1. Engine RPM (Mapped to new columns engine_rpm_actual, etc.)
        rpm_actual_val = safe_decimal(header.rpm)
        rpm_base, rpm_d, rpm_dp = get_dev(rpm_actual_val, 'engine_speed_rpm', [])

        # 2. Pressures & Temps
        pmax_base, pmax_d, pmax_dp = get_dev(pmax_res['worst_val_iso'], 'max_combustion_pressure_iso_bar', ['max_combustion_pressure_bar'])
        pcomp_base, pcomp_d, pcomp_dp = get_dev(pcomp_res['worst_val_iso'], 'compression_pressure_iso_bar', ['compression_pressure_bar'])
        pmax_iso_avg = safe_decimal(iso.max_combustion_pressure_iso_bar)
        pmax_avg_base, pmax_avg_d, pmax_avg_dp = get_dev(pmax_iso_avg, 'max_combustion_pressure_iso_bar', ['max_combustion_pressure_bar'])
        pcomp_iso_avg = safe_decimal(iso.compression_pressure_iso_bar)
        pcomp_avg_base, pcomp_avg_d, pcomp_avg_dp = get_dev(pcomp_iso_avg, 'compression_pressure_iso_bar', ['compression_pressure_bar'])
        exh_base, exh_d, exh_dp = get_dev(exh_res['worst_val_iso'], 'exh_temp_cylinder_outlet_ave_c', ['exh_temp_tc_outlet_c'])
        scav_base, scav_d, scav_dp = get_dev(iso.scav_air_pressure_graph_kg_cm2, 'scav_air_pressure_iso_kg_cm2', ['scav_air_pressure_bar'])
        tc_base, tc_d, tc_dp = get_dev(iso.turbocharger_speed_graph_x1000_rpm_scaled, 'turbocharger_speed_x1000_iso_rpm', ['turbocharger_speed_x1000_rpm'])
        sfoc_base, sfoc_d, sfoc_dp = get_dev(iso.sfoc_graph_g_kwh, 'fuel_oil_consumption_iso_g_kwh', ['fuel_oil_consumption_g_kwh'])
        
        tc_out_base, tc_out_d, tc_out_dp = get_dev(iso.exh_temp_tc_outlet_iso_c, 'exh_temp_tc_outlet_iso_c', ['exh_temp_tc_outlet_c'])
        tc_in_base, tc_in_d, tc_in_dp = get_dev(iso.exh_temp_tc_inlet_iso_c, 'exh_temp_tc_inlet_iso_c', ['exh_temp_tc_inlet_c'])
        avg_exh_base, avg_exh_d, avg_exh_dp = get_dev(avg_exh_raw, 'exh_temp_cylinder_outlet_ave_c', [])
        fipi_base, fipi_d, fipi_dp = get_dev(iso.fuel_inj_pump_index_graph_mm, 'fuel_injection_pump_index_mm', [])

        # FOC: Convert to MT/h
        foc_actual_kg = iso.fuel_consumption_total_graph_kg_h
        foc_actual_mt = foc_actual_kg / Decimal(1000) if foc_actual_kg else None
        foc_base_kg = interpolate_baseline(load_pct, baselines, 'fuel_oil_consumption_kg_h', [])
        foc_base_mt = foc_base_kg / Decimal(1000) if foc_base_kg else None
        
        foc_base, foc_d, foc_dp = (None, None, None)
        if foc_actual_mt is not None and foc_base_mt is not None:
            foc_base = foc_base_mt.quantize(Decimal('0.001'))
            foc_d = (foc_actual_mt - foc_base_mt).quantize(Decimal('0.001'))
            foc_dp = (((foc_actual_mt - foc_base_mt) / foc_base_mt * 100) if foc_base_mt != 0 else 0).quantize(Decimal('0.01'))
            foc_actual_mt = foc_actual_mt.quantize(Decimal('0.001'))

        # Propeller Margin
        prop_actual = iso.propeller_margin_percent
        prop_base, prop_d, prop_dp = (None, None, None)
        if prop_actual is not None:
            prop_base = Decimal('100.00')
            prop_d = (prop_actual - prop_base).quantize(Decimal('0.01'))
            prop_dp = prop_d 

        # Save
        dev_rec = session.query(MEDeviationHistory).filter_by(report_id=report_id).first()
        if not dev_rec:
            dev_rec = MEDeviationHistory(report_id=report_id, imo_number=header.imo_number)
            
        dev_rec.load_percentage = load_pct
        dev_rec.load_kw = header.shaft_power_kw
        
        # --- SAVING RPM DATA (UPDATED) ---
        dev_rec.engine_rpm_actual = rpm_actual_val
        dev_rec.engine_rpm_baseline = rpm_base
        dev_rec.engine_rpm_dev = rpm_d
        dev_rec.engine_rpm_dev_pct = rpm_dp
        # ---------------------------------
        
        dev_rec.pmax_actual = pmax_res['worst_val_iso']
        dev_rec.pmax_baseline = pmax_base
        dev_rec.pmax_dev = pmax_d
        dev_rec.pmax_dev_pct = pmax_dp

        dev_rec.pmax_avg_actual = pmax_iso_avg    # <--- NEW
        dev_rec.pmax_avg_dev = pmax_avg_d         # <--- NEW
        dev_rec.pmax_avg_dev_pct = pmax_avg_dp    # <--- NEW
        
        dev_rec.pcomp_actual = pcomp_res['worst_val_iso']
        dev_rec.pcomp_baseline = pcomp_base
        dev_rec.pcomp_dev = pcomp_d
        dev_rec.pcomp_dev_pct = pcomp_dp
        
        dev_rec.pcomp_avg_actual = pcomp_iso_avg  # <--- NEW
        dev_rec.pcomp_avg_dev = pcomp_avg_d       # <--- NEW
        dev_rec.pcomp_avg_dev_pct = pcomp_avg_dp  # <--- NEW

        
        dev_rec.exhaust_cyl_actual = exh_res['worst_val_iso']
        dev_rec.exhaust_cyl_baseline = exh_base
        dev_rec.exhaust_cyl_dev = exh_d
        dev_rec.exhaust_cyl_dev_pct = exh_dp
        
        dev_rec.scavenge_pressure_actual = iso.scav_air_pressure_graph_kg_cm2
        dev_rec.scavenge_pressure_baseline = scav_base
        dev_rec.scavenge_pressure_dev = scav_d
        dev_rec.scavenge_pressure_dev_pct = scav_dp
        
        dev_rec.turbo_rpm_actual = iso.turbocharger_speed_graph_x1000_rpm_scaled
        dev_rec.turbo_rpm_baseline = tc_base
        dev_rec.turbo_rpm_dev = tc_d
        dev_rec.turbo_rpm_dev_pct = tc_dp
        
        dev_rec.sfoc_actual = iso.sfoc_graph_g_kwh
        dev_rec.sfoc_baseline = sfoc_base
        dev_rec.sfoc_dev = sfoc_d
        dev_rec.sfoc_dev_pct = sfoc_dp
        
        dev_rec.propeller_margin_actual = prop_actual
        dev_rec.propeller_margin_baseline = prop_base
        dev_rec.propeller_margin_dev = prop_d
        dev_rec.propeller_margin_dev_pct = prop_dp

        dev_rec.tc_out_actual = iso.exh_temp_tc_outlet_iso_c
        dev_rec.tc_out_baseline = tc_out_base
        dev_rec.tc_out_dev = tc_out_d
        dev_rec.tc_out_dev_pct = tc_out_dp

        dev_rec.tc_in_actual = iso.exh_temp_tc_inlet_iso_c
        dev_rec.tc_in_baseline = tc_in_base
        dev_rec.tc_in_dev = tc_in_d
        dev_rec.tc_in_dev_pct = tc_in_dp

        dev_rec.exhaust_avg_actual = avg_exh_raw
        dev_rec.exhaust_avg_baseline = avg_exh_base
        dev_rec.exhaust_avg_dev = avg_exh_d
        dev_rec.exhaust_avg_dev_pct = avg_exh_dp

        dev_rec.foc_actual = foc_actual_mt
        dev_rec.foc_baseline = foc_base
        dev_rec.foc_dev = foc_d
        dev_rec.foc_dev_pct = foc_dp

        dev_rec.fuel_index_actual = iso.fuel_inj_pump_index_graph_mm
        dev_rec.fuel_index_baseline = fipi_base
        dev_rec.fuel_index_dev = fipi_d
        dev_rec.fuel_index_dev_pct = fipi_dp
        
        session.add(dev_rec)
        session.flush()
        
        logger.info("✅ ME Deviation Calculated and Saved (Incl. Engine RPM & Propeller Margin).")
        return dev_rec
        
    except Exception as e:
        logger.exception(f"❌ Deviation Calculation Failed: {e}")
        return None