# app/me_iso_corrector.py

import logging
from decimal import Decimal, InvalidOperation, getcontext
from typing import Optional, Dict, Any, List
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.models import (
    MonthlyReportHeader,
    MonthlyReportDetailsJsonb,
    ShopTrialSession,
    ShopTrialPerformanceData,
    MonthlyISOPerformanceData
)

# Set precision
getcontext().prec = 12
logger = logging.getLogger(__name__)

# --- CONSTANTS ---
ISO_REF_TEMP_C = Decimal('25.0')      # Reference T_air and T_cw
ISO_REF_P_AMB_MBAR = Decimal('1000.0')

# Unit Conversions
MBAR_TO_MMHG = Decimal('0.750062')
BAR_TO_KG_CM2 = Decimal('1.01972')
MT_HR_TO_KG_H = Decimal('1000')
RPM_TO_X1000 = Decimal('0.001')

# --- ISO FACTORS (MAN B&W Linear Formula) ---
# Format: { 'F1': Air Inlet Factor, 'F2': Cooling Water Factor, 'K': Constant }
ISO_FACTORS = {
    'pmax':  {'F1': Decimal('0.002198'),  'F2': Decimal('-0.000810'), 'K': Decimal('1.0')},
    'pcomp': {'F1': Decimal('0.002954'),  'F2': Decimal('-0.001530'), 'K': Decimal('1.0')},
    'psc':   {'F1': Decimal('0.002856'),  'F2': Decimal('-0.002220'), 'K': Decimal('1.0')},
    'tex':   {'F1': Decimal('-0.002446'), 'F2': Decimal('-0.000590'), 'K': Decimal('273.0')}
}

def safe_decimal(value: Any) -> Optional[Decimal]:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None

class MEISOCorrector:
    
    def __init__(self, session: AsyncSession):
        self.session = session
    
    # --- HELPER: Baseline Interpolation (Preserved from original code) ---
    def _interpolate_baseline(self, baseline_records: List, load_pct: Decimal, field_name: str) -> Optional[Decimal]:
        if not baseline_records:
            return None
        
        lower = None
        upper = None
        
        for r in baseline_records:
            r_load = safe_decimal(r.load_percentage)
            v = getattr(r, field_name, None)
            if r_load is None or v is None:
                continue
            v = safe_decimal(v)
            
            if r_load <= load_pct:
                lower = (r_load, v)
            if r_load >= load_pct and upper is None:
                upper = (r_load, v)
        
        if not lower and not upper:
            return None
        if not lower: return upper[1]
        if not upper: return lower[1]
        if lower[0] == upper[0]: return lower[1]
        
        load_lower, val_lower = lower
        load_upper, val_upper = upper
        
        interp = val_lower + (load_pct - load_lower) * (val_upper - val_lower) / (load_upper - load_lower)
        return interp.quantize(Decimal('0.0001'))
    
    async def get_reference_values_for_load(self, engine_no: str, load_pct: Decimal) -> Dict[str, Optional[Decimal]]:
        """
        Preserved for compatibility. 
        Note: The new MAN formula uses static 25C ref, but we keep this in case 
        Shop Trial P_back is needed for other analysis.
        """
        try:
            result = await self.session.execute(
                select(ShopTrialSession).where(ShopTrialSession.engine_no == engine_no)
            )
            session_rec = result.scalar_one_or_none()
            if not session_rec:
                return {'t_sc_ref': ISO_REF_TEMP_C, 'p_back_ref': Decimal('50.0')}
            
            result = await self.session.execute(
                select(ShopTrialPerformanceData)
                .where(ShopTrialPerformanceData.session_id == session_rec.session_id)
                .order_by(ShopTrialPerformanceData.load_percentage)
            )
            baseline_records = result.scalars().all()
            
            if not baseline_records:
                return {'t_sc_ref': ISO_REF_TEMP_C, 'p_back_ref': Decimal('50.0')}
            
            t_sc_ref = self._interpolate_baseline(baseline_records, load_pct, 'scav_air_temperature_ref_c') or ISO_REF_TEMP_C
            p_back_ref = self._interpolate_baseline(baseline_records, load_pct, 'tc_outlet_back_press_ref_mmaq') or Decimal('50.0')
            
            return {'t_sc_ref': t_sc_ref, 'p_back_ref': p_back_ref}
        except Exception as e:
            logger.exception(f"Error fetching baseline references: {e}")
            return {'t_sc_ref': ISO_REF_TEMP_C, 'p_back_ref': Decimal('50.0')}

    # --- NEW: MAN Linear Correction Formula ---
    def _calculate_correction(self, measured_val: Optional[Decimal], 
                              t_air_meas: Optional[Decimal], 
                              t_cw_meas: Optional[Decimal], 
                              factors: Dict) -> Optional[Decimal]:
        """
        Applies: Corrected = Measured + Correction_Air + Correction_CW
        Correction = (T_meas - 25) * Factor * (K + Measured)
        """
        if measured_val is None:
            return None
            
        # Default corrections to 0 if temp is missing
        corr_air = Decimal('0')
        if t_air_meas is not None:
            delta_t_air = t_air_meas - ISO_REF_TEMP_C
            corr_air = delta_t_air * factors['F1'] * (factors['K'] + measured_val)

        corr_cw = Decimal('0')
        if t_cw_meas is not None:
            delta_t_cw = t_cw_meas - ISO_REF_TEMP_C
            corr_cw = delta_t_cw * factors['F2'] * (factors['K'] + measured_val)

        return (measured_val + corr_air + corr_cw).quantize(Decimal('0.0001'))

    def correct_turbocharger_speed(self, tc_rpm, t_inlet, p_amb_mmhg, psc_meas, psc_corr):
        # Standard TC Speed correction logic (Preserved)
        if any(v is None for v in [tc_rpm, t_inlet, p_amb_mmhg, psc_meas, psc_corr]) or psc_meas == 0:
            return None
        try:
            t_inlet_k = t_inlet + Decimal('273.15')
            # Term 1: sqrt(298.15 / T_inlet_K)
            term1 = (Decimal('298.15') / t_inlet_k).sqrt() 
            pr_ratio = psc_corr / psc_meas
            corr_rpm = tc_rpm * term1 * pr_ratio
            return (corr_rpm * RPM_TO_X1000).quantize(Decimal('0.0001'))
        except Exception:
            return None

    def extract_measured(self, header: MonthlyReportHeader, json_data: dict = None) -> Dict:
        """
        Extracts measured values with robust fallbacks for all parameters.
        Includes extensive JSON key search for Scavenge Pressure and Fuel Index.
        """
        # 1. Standard Header Extraction
        p_amb_raw = safe_decimal(header.barometric_pressure_mmh2o)
        p_amb_mmhg = None
        if p_amb_raw:
            if p_amb_raw > 2000: 
                 p_amb_mmhg = (p_amb_raw / Decimal('10.197')) * MBAR_TO_MMHG
            else: 
                 p_amb_mmhg = p_amb_raw * MBAR_TO_MMHG
        
        foc_mt = safe_decimal(header.fo_consumption_mt_hr)
        
        # --- PREPARE JSON DATA (Lazy Loading) ---
        if json_data is None:
            json_data = {}

        # --- HELPER: Extract Value from potential Dictionary ---
        def get_val_from_json(data, keys):
            for k in keys:
                if k in data:
                    raw_val = data[k]
                    # Handle Enriched JSON format: {"value": "35", "unit": "C"}
                    if isinstance(raw_val, dict) and 'value' in raw_val:
                        raw_val = raw_val['value']
                    
                    val = safe_decimal(raw_val)
                    if val is not None:
                        return val
            return None

        # --- 1. COOLING WATER (T_cw) ---
        t_cw = None
        if hasattr(header, 'scav_air_cooler_cw_in_temp_c'):
            t_cw = safe_decimal(header.scav_air_cooler_cw_in_temp_c)
        if t_cw is None and hasattr(header, 'cwtempaircoolerinlet_1'):
            t_cw = safe_decimal(header.cwtempaircoolerinlet_1)
        
        if t_cw is None:
            data = json_data
            cw_keys = ['cwtempaircoolerinlet#1', 'cwtempaircoolerinlet_1', 'cw_temp_air_cooler_inlet', 'scav_air_cooler_cw_in_temp_c']
            t_cw = get_val_from_json(data, cw_keys)
            if t_cw is not None:
                logger.info(f"✅ Found T_cw in JSONB: {t_cw}")

        if t_cw is None:
            logger.warning(f"⚠️ Report {header.report_id}: Cooling Water Temp NOT FOUND. ISO Calc will assume 0 correction.")

        # --- 2. AIR INLET (T_inlet) ---
        t_inlet = None
        if hasattr(header, 'tc_air_inlet_temp_c'):
            t_inlet = safe_decimal(header.tc_air_inlet_temp_c)
        if t_inlet is None and hasattr(header, 'turbochargerairinlettemp_1'):
            t_inlet = safe_decimal(header.turbochargerairinlettemp_1)
            
        if t_inlet is None:
            data = json_data
            inlet_keys = ['turbochargerairinlettemp#1', 'turbochargerairinlettemp_1', 'tc_air_inlet_temp_c']
            t_inlet = get_val_from_json(data, inlet_keys)

        # --- 3. SCAVENGE PRESSURE (P_scav) ---
        psc = safe_decimal(header.scavenge_pr_bar)
        if psc is None:
            data = json_data
            psc_keys = ['scavengepr', 'scavenge_pr', 'scavenge_pressure', 'scav_air_pressure', 'scav_pres', 'scavenge_pr_bar']
            psc = get_val_from_json(data, psc_keys)

        # --- 4. FUEL PUMP INDICATOR / FUEL INDEX (FIPI) ---
        # Look for standard column first
        fipi = safe_decimal(header.fuel_injection_pump_index_mm)
        
        if fipi is None:
            data = json_data
            # 'fuelindexecu%' is the key in your specific JSON
            fipi_keys = [
                'fuelindexecu%', 
                'fuel_index_ecu', 
                'fuel_index', 
                'fuel_pump_mark', 
                'pump_mark', 
                'fuel_injection_pump_index_mm'
            ]
            fipi = get_val_from_json(data, fipi_keys)
            
            if fipi:
                logger.info(f"✅ Found Fuel Index/Pump Mark in JSONB: {fipi}")

        # --- 5. SFOC (Robust Search) ---
        sfoc = safe_decimal(header.sfoc_measured_g_kwh) or safe_decimal(header.sfoc_calculated_g_kwh)
        if sfoc is None:
            data = json_data
            sfoc = get_val_from_json(data, ['sfoc', 'sfoc_g_kwh', 'sfoccalculated'])

        return {
            'p_amb_mmhg': p_amb_mmhg,
            'p_back_mmaq': safe_decimal(header.tc_filter_dp_mmh2o),
            't_inlet': t_inlet,
            't_cw': t_cw,
            't_sc': safe_decimal(header.scavenge_temp_c),
            'pmax': safe_decimal(header.max_comb_pr_avg_bar),
            'pcomp': safe_decimal(header.comp_pr_avg_bar),
            'psc': psc,
            'tex_in': safe_decimal(header.tc_exhaust_gas_temp_in_c),
            'tex_out': safe_decimal(header.tc_exhaust_gas_temp_out_c),
            'tex_cyl_avg': safe_decimal(header.exh_temp_cylinder_outlet_ave_c), 
            'tc_rpm': safe_decimal(header.turbocharger_rpm_avg),
            'sfoc': sfoc,
            'fipi': fipi, # <--- Added explicit key for internal tracking if needed, primarily used in next step
            'foc_kg_h': (foc_mt * MT_HR_TO_KG_H) if foc_mt else None
        }
        
             
    async def process_and_save_iso_correction(self, report_id: int) -> Optional[MonthlyISOPerformanceData]:
        try:
            logger.info(f"🔥 processing_and_save_iso_correction for Report ID: {report_id}")
          
            result = await self.session.execute(
                select(MonthlyReportHeader)
                .options(selectinload(MonthlyReportHeader.vessel))
                .where(MonthlyReportHeader.report_id == report_id)
            )
            header = result.scalar_one_or_none()
            if not header: return None
            
            load_pct = safe_decimal(header.load_percent) or Decimal('0')

            # Fetch JSON Data for robust searching
            json_result = await self.session.execute(
                select(MonthlyReportDetailsJsonb).where(MonthlyReportDetailsJsonb.report_id == report_id)
            )
            json_rec = json_result.scalar_one_or_none()
            json_data = json_rec.data_jsonb if json_rec and json_rec.data_jsonb else {}

            measured = self.extract_measured(header, json_data)

            # =========================================================
            # PART A: ENSURE CORRECT ACTUAL SFOC (Fix for 179.2 vs 194.68)
            # =========================================================
            # The JSON contains "sfoc" (179.2) and "sfoccalculated" (194.67).
            # We MUST use "sfoccalculated" as the starting point (Actual) if it exists.
            
            measured_sfoc = measured['sfoc']
            
            # Check JSON for a more accurate calculated value
            if 'sfoccalculated' in json_data:
                val = json_data['sfoccalculated']
                calc_sfoc = safe_decimal(val.get('value') if isinstance(val, dict) else val)
                if calc_sfoc and calc_sfoc > 0:
                    measured_sfoc = calc_sfoc
                    logger.info(f"Using 'sfoccalculated' from JSON: {measured_sfoc}")

            # =========================================================
            # PART B: EXTRACT LCV (Lower Calorific Value)
            # =========================================================
            actual_lcv = None

            # 1. Check Standard DB Columns
            if hasattr(header, 'fo_lcv_mj_kg') and header.fo_lcv_mj_kg:
                actual_lcv = safe_decimal(header.fo_lcv_mj_kg)
            elif hasattr(header, 'lcv') and header.lcv:
                actual_lcv = safe_decimal(header.lcv)

            # 2. Check JSON Data (Added 'netenergyasperbdn/folcv' based on your JSON)
            if actual_lcv is None:
                lcv_keys = [
                    'netenergyasperbdn/folcv',  # <--- Found in your specific JSON
                    'FO LCV (MJ/kg)', 
                    'fo_lcv_mj_kg', 
                    'lcv', 
                    'lower_calorific_value', 
                    'fo_lcv'
                ]
                for k in lcv_keys:
                    if k in json_data:
                        val = json_data[k]
                        if isinstance(val, dict):
                            actual_lcv = safe_decimal(val.get('value'))
                        else:
                            actual_lcv = safe_decimal(val)
                        if actual_lcv: break
            
            # 3. UNIT CONVERSION (MJ/kg -> kJ/kg)
            # Your JSON has 41.99 MJ/kg. ISO requires kJ/kg (e.g., 41990).
            if actual_lcv is not None and actual_lcv < 100:
                actual_lcv = actual_lcv * Decimal('1000')

            # 4. Fallback (Standard ISO LCV)
            ISO_LCV_REF = Decimal('42707')
            if actual_lcv is None or actual_lcv == 0:
                actual_lcv = ISO_LCV_REF

            logger.info(f"Report {report_id}: Actual SFOC={measured_sfoc}, LCV={actual_lcv}")

            iso = {}
            
            # =========================================================
            # PART C: ISO CALCULATIONS (Thermodynamic - 4 Params Only)
            # =========================================================
            
            iso['pmax'] = self._calculate_correction(
                measured['pmax'], measured['t_inlet'], measured['t_cw'], ISO_FACTORS['pmax']
            )
            iso['pcomp'] = self._calculate_correction(
                measured['pcomp'], measured['t_inlet'], measured['t_cw'], ISO_FACTORS['pcomp']
            )
            iso['psc'] = self._calculate_correction(
                measured['psc'], measured['t_inlet'], measured['t_cw'], ISO_FACTORS['psc']
            )
            iso['tex_cyl'] = self._calculate_correction(
                measured['tex_cyl_avg'], measured['t_inlet'], measured['t_cw'], ISO_FACTORS['tex']
            )

            # =========================================================
            # PART D: NO CORRECTION (Force Actual)
            # =========================================================
            
            iso['tex_in'] = measured['tex_in']
            iso['tex_out'] = measured['tex_out']

            # Turbocharger Speed -> Force Actual (Scale only)
            if measured['tc_rpm'] is not None:
                iso['tc_rpm'] = (measured['tc_rpm'] * RPM_TO_X1000).quantize(Decimal('0.0001'))
            else:
                iso['tc_rpm'] = None

            # =========================================================
            # PART E: SFOC CORRECTION
            # Formula: Actual_SFOC * (Actual_LCV / 42707)
            # =========================================================
            
            iso_sfoc = None
            
            if measured_sfoc is not None:
                # e.g., 194.67 * (41990 / 42707) = 191.40
                correction_factor = actual_lcv / ISO_LCV_REF
                iso_sfoc = (measured_sfoc * correction_factor).quantize(Decimal('0.01'))
            
            # =========================================================
            # PART F: DERIVED VALUES & SAVING
            # =========================================================
            
            scav_kg_cm2 = (iso['psc'] * BAR_TO_KG_CM2).quantize(Decimal('0.0001')) if iso['psc'] else None
            cyl_exh_graph = iso['tex_cyl'] if iso['tex_cyl'] else measured['tex_cyl_avg']
            
            # Propeller Margin
            prop_margin = None
            if header.shaft_power_kw and header.vessel.mcr_power_kw and header.vessel.mcr_rpm and header.rpm:
                p_mcr, n_mcr = safe_decimal(header.vessel.mcr_power_kw), safe_decimal(header.vessel.mcr_rpm)
                actual_p, actual_n = safe_decimal(header.shaft_power_kw), safe_decimal(header.rpm)
                
                if n_mcr > 0 and p_mcr > 0:
                    n_ref = n_mcr 
                    svc_power = p_mcr * ((actual_n / n_ref) ** 3)
                    if svc_power > 0:
                        prop_margin = ((actual_p - svc_power) / svc_power * Decimal('100')).quantize(Decimal('0.01'))

            # Save to Database
            iso_result = await self.session.execute(
                select(MonthlyISOPerformanceData).where(MonthlyISOPerformanceData.report_id == report_id)
            )
            iso_record = iso_result.scalar_one_or_none()
            if not iso_record:
                iso_record = MonthlyISOPerformanceData(report_id=report_id)
            
            iso_record.imo_number = header.imo_number
            iso_record.load_percentage = load_pct
            iso_record.correction_date = header.report_date
            
            # Store Corrected Values
            iso_record.max_combustion_pressure_iso_bar = iso['pmax']
            iso_record.compression_pressure_iso_bar = iso['pcomp']
            iso_record.scav_air_pressure_iso_bar = iso['psc']
            iso_record.exh_temp_tc_inlet_iso_c = iso['tex_in']             # ACTUAL
            iso_record.exh_temp_tc_outlet_iso_c = iso['tex_out']           # ACTUAL
            iso_record.turbocharger_speed_x1000_iso_rpm = iso['tc_rpm']    # ACTUAL
            
            # Store Graph/Graph-related Values
            iso_record.engine_speed_graph_rpm = safe_decimal(header.rpm)
            iso_record.scav_air_pressure_graph_kg_cm2 = scav_kg_cm2
            iso_record.cyl_exhaust_gas_temp_outlet_graph_c = cyl_exh_graph # CORRECTED
            iso_record.fuel_consumption_total_graph_kg_h = measured['foc_kg_h']
            iso_record.turbocharger_speed_graph_x1000_rpm_scaled = iso['tc_rpm']
            
            # *** SAVE THE CORRECTED SFOC ***
            iso_record.sfoc_graph_g_kwh = iso_sfoc
            
            iso_record.fuel_inj_pump_index_graph_mm = safe_decimal(header.fuel_injection_pump_index_mm)
            iso_record.propeller_margin_percent = prop_margin
            
            self.session.add(iso_record)
            await self.session.flush()
            
            logger.info(f"✅ MonthlyISOPerformanceData saved for Report {report_id} (SFOC ISO: {iso_sfoc})")
            return iso_record
            
        except Exception as e:
            logger.exception(f"❌ Failed to process/save ISO data: {e}")
            return None