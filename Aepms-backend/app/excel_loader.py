# app/excel_loader.py (Final Corrected Version for Excel Epoch and IMO Type)
import pandas as pd
import numpy as np
from datetime import datetime, date, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Tuple, Optional, Any, Union
import re
import logging
import json

logger = logging.getLogger(__name__)

class ExcelDataLoader:
    """Handles loading and transforming shop trial data from Excel files."""
    
    def __init__(self, excel_file_path: str):
        """Initialize with Excel file path."""
        self.excel_file_path = excel_file_path
        self.workbook = None
        self.sheet_names = []
        self.extracted_data = {
            'vessels': [],
            'sessions': [],
            'performance_data': [],
            'crank_deflections': [], 
            'bearing_temperatures': [], 
            'monthly_headers': [],
            'monthly_details': []
        }
    
    def load_workbook(self) -> bool:
        """Load Excel workbook and get sheet names."""
        try:
            self.workbook = pd.ExcelFile(self.excel_file_path, engine='openpyxl')
            self.sheet_names = self.workbook.sheet_names
            logger.info(f"Loaded Excel file with {len(self.sheet_names)} sheets: {self.sheet_names}")
            return True
        except Exception as e:
            logger.error(f"Failed to load Excel file {self.excel_file_path}: {e}")
            return False
    
    def extract_all_data(self) -> Dict[str, List[Dict]]:
        """
        Extract all data from Excel file based on sheet names and structure.
        
        Returns:
            Dict containing extracted data organized by type
        """
        if not self.workbook:
            raise ValueError("Workbook not loaded. Call load_workbook() first.")
        
        for sheet_name in self.sheet_names:
            try:
                logger.info(f"Processing sheet: {sheet_name}")
                
                if 'vessel_info' in sheet_name.lower():
                    self._extract_vessel_info(sheet_name)
                elif 'shop_trial_session' in sheet_name.lower():
                    self._extract_shop_trial_sessions(sheet_name)
                elif 'shop_trial_performance_data' in sheet_name.lower():
                    self._extract_performance_data(sheet_name)
                elif 'crank_shaft_deflection' in sheet_name.lower():
                    self._extract_crank_deflections(sheet_name) 
                elif 'bearing_temperature' in sheet_name.lower():
                    self._extract_bearing_temperatures(sheet_name)
                elif 'monthly_report_header' in sheet_name.lower():
                    self._extract_monthly_headers(sheet_name)
                elif 'monthly_report_details' in sheet_name.lower():
                    self._extract_monthly_details(sheet_name)
                else:
                    logger.warning(f"Unknown sheet type: {sheet_name}")
                
            except Exception as e:
                logger.error(f"Error processing sheet {sheet_name}: {e}")
                continue
        
        summary = {key: len(value) for key, value in self.extracted_data.items()}
        logger.info(f"Extraction summary: {summary}")
        
        return self.extracted_data
    
    def _extract_vessel_info(self, sheet_name: str) -> None:
        """Extract vessel information from vessel_info sheet."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                imo_number = self._safe_convert_int(row.get('imo_number')) 
                engine_no = self._safe_convert_str(row.get('engine_no'))

                if imo_number is None or not engine_no: 
                    logger.warning(f"Skipping vessel row due to missing IMO number or engine_no: {row.to_dict()}")
                    continue
                
                vessel_data = {
                    'imo_number': imo_number,
                    'vessel_name': self._safe_convert_str(row.get('vessel_name')),
                    'engine_no': engine_no,
                    'hull_no': self._safe_convert_str(row.get('hull_no')),
                    'owner': self._safe_convert_str(row.get('owner')),
                    'shipyard': self._safe_convert_str(row.get('shipyard')),
                    'engine_maker': self._safe_convert_str(row.get('engine_maker')),
                    'engine_type': self._safe_convert_str(row.get('engine_type')),
                    'engine_model': self._safe_convert_str(row.get('engine_model')),
                    'number_of_cylinders': self._safe_convert_int(row.get('number_of_cylinders')),
                    'propeller_pitch_mm': self._safe_convert_decimal(row.get('propeller_pitch_mm')),
                    'sfoc_target_gm_kwh': self._safe_convert_decimal(row.get('sfoc_target_gm_kwh')),
                    'mcr_power_kw': self._safe_convert_decimal(row.get('mcr_power_kw')),
                    'mcr_rpm': self._safe_convert_decimal(row.get('mcr_rpm')),
                    'csr_power_kw': self._safe_convert_decimal(row.get('csr_power_kw')),
                    'barred_speed_rpm_start': self._safe_convert_decimal(row.get('barred_speed_rpm_start')),
                    'barred_speed_rpm_end': self._safe_convert_decimal(row.get('barred_speed_rpm_end')),
                    'mcr_limit_kw': self._safe_convert_decimal(row.get('mcr_limit')),
                    'mcr_limit_percentage': self._safe_convert_decimal(row.get('mcr_limit_percentage'))
                }
                
                
                
                self.extracted_data['vessels'].append(vessel_data)
                logger.debug(f"Extracted vessel: IMO {imo_number}, Engine {engine_no}")
                
        except Exception as e:
            logger.error(f"Error extracting vessel info from {sheet_name}: {e}")
    
    def _extract_shop_trial_sessions(self, sheet_name: str) -> None:
        """Extract shop trial session information."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                engine_no = self._safe_convert_str(row.get('engine_no'))
                trial_date = self._safe_convert_date(row.get('trial_date'))
                
                if not engine_no or not trial_date:
                    logger.warning(f"Skipping shop trial session row due to missing engine_no or trial_date: {row.to_dict()}")
                    continue
                
                session_data = {
                    'engine_no': engine_no,
                    'trial_date': trial_date,
                    'trial_type': self._safe_convert_str(row.get('trial_type', 'SHOP_TRIAL')),
                    'conducted_by': self._safe_convert_str(row.get('conducted_by')),
                    'document_title': self._safe_convert_str(row.get('document_title')),
                    'document_reference': self._safe_convert_str(row.get('document_reference')),
                    'room_temp_cold_condition_c': self._safe_convert_decimal(row.get('room_temp_cold_condition_c')),
                    'lub_oil_temp_hot_condition_c': self._safe_convert_decimal(row.get('lub_oil_temp_hot_condition_c')),
                    'lub_oil_temp_overall_c': self._safe_convert_decimal(row.get('lub_oil_temp_overall_c')),
                    'remarks': self._safe_convert_str(row.get('remarks')),
                    'status': self._safe_convert_str(row.get('status', 'COMPLETED'))
                }
                
                self.extracted_data['sessions'].append(session_data)
                logger.debug(f"Extracted session: {session_data['engine_no']} - {session_data['trial_date']}")
                
        except Exception as e:
            logger.error(f"Error extracting shop trial sessions from {sheet_name}: {e}")
    
    def _extract_performance_data(self, sheet_name: str) -> None:
        """Extract performance data with engine_no from first column."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            # Fill forward engine_no values if it's sparse in Excel
            if 'engine_no' in df.columns:
                df['engine_no'] = df['engine_no'].ffill()
            
            for _, row in df.iterrows():
                engine_no = self._safe_convert_str(row['engine_no'] if 'engine_no' in row.index else None)
                load_val = row.get('load_percentage')
                output_val = row.get('engine_output_kw')
                
                # Check for critical missing values
                if not engine_no or pd.isna(load_val) or pd.isna(output_val):
                    logger.warning(f"Skipping performance row due to missing engine_no, load_percentage, or engine_output_kw: {row.to_dict()}")
                    continue
                    
                perf_data = {
                    'engine_no': engine_no,
                    # 'session_id': self._safe_convert_int(row.get('session_id')), # Placeholder: data_loader resolves
                    'load_percentage': self._safe_convert_decimal(load_val),
                    'test_sequence': self._safe_convert_int(row.get('test_sequence', 1)),
                    'engine_output_kw': self._safe_convert_decimal(output_val),
                    'engine_speed_rpm': self._safe_convert_decimal(row.get('engine_speed_rpm')),
                    'room_temperature_c': self._safe_convert_decimal(row.get('room_temperature_c')),
                    'room_humidity_percent': self._safe_convert_decimal(row.get('room_humidity_percent')),
                    'barometer_pressure_mbar': self._safe_convert_decimal(row.get('barometer_pressure_mbar')),
                    'tc_inlet_temp_c': self._safe_convert_decimal(row.get('tc_inlet_temp_c')),
                    'scav_air_temperature_c': self._safe_convert_decimal(row.get('scav_air_temperature_c')),
                    'tc_outlet_back_press_mmaq': self._safe_convert_decimal(row.get('tc_outlet_back_press_mmaq')),
                    'max_combustion_pressure_bar': self._safe_convert_decimal(row.get('max_combustion_pressure_bar')),
                    'compression_pressure_bar': self._safe_convert_decimal(row.get('compression_pressure_bar')),
                    'mean_effective_pressure_bar': self._safe_convert_decimal(row.get('mean_effective_pressure_bar')),
                    'fuel_injection_pump_index_mm': self._safe_convert_decimal(row.get('fuel_injection_pump_index_mm')),
                    'exh_temp_cylinder_outlet_ave_c': self._safe_convert_decimal(row.get('exh_temp_cylinder_outlet_ave_c')),
                    'exh_temp_tc_inlet_c': self._safe_convert_decimal(row.get('exh_temp_tc_inlet_c')),
                    'exh_temp_tc_outlet_c': self._safe_convert_decimal(row.get('exh_temp_tc_outlet_c')),
                    'turbocharger_speed_x1000_rpm': self._safe_convert_decimal(row.get('turbocharger_speed_x1000_rpm')),
                    'scav_air_pressure_bar': self._safe_convert_decimal(row.get('scav_air_pressure_bar')),
                    'turbocharger_gas_inlet_press_kg_cm2': self._safe_convert_decimal(row.get('turbocharger_gas_inlet_press_kg_cm2')),
                    'fuel_oil_temperature_c': self._safe_convert_decimal(row.get('fuel_oil_temperature_c')),
                    'fuel_oil_consumption_kg_h': self._safe_convert_decimal(row.get('fuel_oil_consumption_kg_h')),
                    'fuel_oil_consumption_g_kwh': self._safe_convert_decimal(row.get('fuel_oil_consumption_g_kwh')),
                    'max_combustion_pressure_iso_bar': self._safe_convert_decimal(row.get('max_combustion_pressure_iso_bar')),
                    'compression_pressure_iso_bar': self._safe_convert_decimal(row.get('compression_pressure_iso_bar')),
                    'scav_air_pressure_iso_kg_cm2': self._safe_convert_decimal(row.get('scav_air_pressure_iso_kg_cm2')),
                    'exh_temp_tc_inlet_iso_c': self._safe_convert_decimal(row.get('exh_temp_tc_inlet_iso_c')),
                    'exh_temp_tc_outlet_iso_c': self._safe_convert_decimal(row.get('exh_temp_tc_outlet_iso_c')),
                    'turbocharger_speed_x1000_iso_rpm': self._safe_convert_decimal(row.get('turbocharger_speed_x1000_iso_rpm')),
                    'fuel_oil_consumption_iso_g_kwh': self._safe_convert_decimal(row.get('fuel_oil_consumption_iso_g_kwh')),
                    'barometer_pressure_ref_mbar': self._safe_convert_decimal(row.get('barometer_pressure_ref_mbar')),
                    'tc_inlet_temp_ref_c': self._safe_convert_decimal(row.get('tc_inlet_temp_ref_c')),
                    'scav_air_temperature_ref_c': self._safe_convert_decimal(row.get('scav_air_temperature_ref_c')),
                    'tc_outlet_back_press_ref_mmaq': self._safe_convert_decimal(row.get('tc_outlet_back_press_ref_mmaq'))
                }
                
                self.extracted_data['performance_data'].append(perf_data)
                logger.debug(f"Extracted performance data for engine: {engine_no}, load: {perf_data['load_percentage']}%")
                
        except Exception as e:
            logger.error(f"Error extracting performance data from {sheet_name}: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
    
    def _extract_crank_deflections(self, sheet_name: str) -> None:
        """Extract crank shaft deflection data."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                engine_no = self._safe_convert_str(row.get('engine_no'))
                cylinder_no = self._safe_convert_int(row.get('cylinder_no'))

                if not engine_no or cylinder_no is None: 
                    logger.warning(f"Skipping crank deflection row due to missing engine_no or cylinder_no: {row.to_dict()}")
                    continue
                
                deflection_data = {
                    'engine_no': engine_no,  
                    # 'session_id': self._safe_convert_int(row.get('session_id')),  # Placeholder: data_loader resolves
                    'condition': self._safe_convert_str(row.get('condition', 'Hot')),
                    'room_temp_c': self._safe_convert_decimal(row.get('room_temp_c')),
                    'lub_oil_temp_c': self._safe_convert_decimal(row.get('lub_oil_temp_c')),
                    'crank_pin_position': self._safe_convert_str(row.get('crank_pin_position', 'TDC')),
                    'cylinder_no': cylinder_no,
                    'value_1_100_mm': self._safe_convert_decimal(row.get('value_1_100_mm'))
                }
                
                self.extracted_data['crank_deflections'].append(deflection_data)
                
        except Exception as e:
            logger.error(f"Error extracting crank deflections from {sheet_name}: {e}")
    
    def _extract_bearing_temperatures(self, sheet_name: str) -> None:
        """Extract bearing temperature data."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                engine_no = self._safe_convert_str(row.get('engine_no'))
                bearing_type = self._safe_convert_str(row.get('bearing_type'))

                if not engine_no or not bearing_type:
                    logger.warning(f"Skipping bearing temperature row due to missing engine_no or bearing_type: {row.to_dict()}")
                    continue
                
                bearing_data = {
                    'engine_no': engine_no,  
                    # 'session_id': self._safe_convert_int(row.get('session_id')),  # Placeholder: data_loader resolves
                    'bearing_type': bearing_type,
                    'bearing_no': self._safe_convert_int(row.get('bearing_no')),
                    'temperature_c': self._safe_convert_decimal(row.get('temperature_c'))
                }
                
                self.extracted_data['bearing_temperatures'].append(bearing_data)
                
        except Exception as e:
            logger.error(f"Error extracting bearing temperatures from {sheet_name}: {e}")
    
    def _extract_monthly_headers(self, sheet_name: str) -> None:
        """Extract monthly report headers, including IMO and new ISO fields."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                imo_number = self._safe_convert_int(row.get('imo_number')) 
                report_month = self._safe_convert_str(row.get('report_month'))
                
                if imo_number is None or not report_month: 
                    logger.warning(f"Skipping monthly header row due to missing imo_number or report_month: {row.to_dict()}")
                    continue
                
                monthly_data = {
                    'imo_number': imo_number, 
                    'engine_identifier': self._safe_convert_str(row.get('engine_identifier')), 
                    'report_month': report_month,
                    'report_date': self._safe_convert_date(row.get('report_date')),
                    'engine_run_hrs': self._safe_convert_decimal(row.get('engine_run_hrs')),
                    'epl_implemented': self._safe_convert_bool(row.get('epl_implemented')),
                    'max_power_limit_kw': self._safe_convert_decimal(row.get('max_power_limit_kw')),
                    'max_load_limit_percent_after_epl': self._safe_convert_decimal(row.get('max_load_limit_percent_after_epl')),
                    'load_percent': self._safe_convert_decimal(row.get('load_percent')),
                    'rpm_percent': self._safe_convert_decimal(row.get('rpm_percent')),
                    'rpm': self._safe_convert_decimal(row.get('rpm')),
                    'engine_indicated_power_kw': self._safe_convert_decimal(row.get('engine_indicated_power_kw')),
                    'effective_power_kw': self._safe_convert_decimal(row.get('effective_power_kw')),
                    'shaft_power_kw': self._safe_convert_decimal(row.get('shaft_power_kw')),
                    'load_indicator': self._safe_convert_decimal(row.get('load_indicator')),
                    
                    # New ISO-related fields
                    'max_comb_pr_avg_bar': self._safe_convert_decimal(row.get('max_comb_pr_avg_bar')),
                    'comp_pr_avg_bar': self._safe_convert_decimal(row.get('comp_pr_avg_bar')),
                    'scavenge_temp_c': self._safe_convert_decimal(row.get('scavenge_temp_c')),
                    'scavenge_pr_bar': self._safe_convert_decimal(row.get('scavenge_pr_bar')),
                    'tc_exhaust_gas_temp_in_c': self._safe_convert_decimal(row.get('tc_exhaust_gas_temp_in_c')),
                    'tc_exhaust_gas_temp_out_c': self._safe_convert_decimal(row.get('tc_exhaust_gas_temp_out_c')),
                    'turbocharger_rpm_avg': self._safe_convert_decimal(row.get('turbocharger_rpm_avg')),
                    'tc_air_inlet_temp_c': self._safe_convert_decimal(row.get('tc_air_inlet_temp_c')),
                    'tc_filter_dp_mmh2o': self._safe_convert_decimal(row.get('tc_filter_dp_mmh2o')),
                    'sfoc_measured_g_kwh': self._safe_convert_decimal(row.get('sfoc_measured_g_kwh')),
                    'sfoc_calculated_g_kwh': self._safe_convert_decimal(row.get('sfoc_calculated_g_kwh')),

                    'egb_pressure_drop_mmh2o': self._safe_convert_decimal(row.get('egb_pressure_drop_mmh2o')),
                    'ship_condition': self._safe_convert_str(row.get('ship_condition')),
                    'displacement_mt': self._safe_convert_decimal(row.get('displacement_mt')),
                    'draft_f': self._safe_convert_decimal(row.get('draft_f')),
                    'draft_a': self._safe_convert_decimal(row.get('draft_a')),
                    'trim_mtr': self._safe_convert_decimal(row.get('trim_mtr')),
                    'wind_force': self._safe_convert_str(row.get('wind_force')),
                    'sea_state': self._safe_convert_str(row.get('sea_state')),
                    'weather': self._safe_convert_str(row.get('weather')),
                    'location': self._safe_convert_str(row.get('location')),
                    'barometric_pressure_mmh2o': self._safe_convert_decimal(row.get('barometric_pressure_mmh2o')),
                    'sea_water_temp_c': self._safe_convert_decimal(row.get('sea_water_temp_c')),
                    'engine_room_temp_c': self._safe_convert_decimal(row.get('engine_room_temp_c')),
                    'speed_gps_kn': self._safe_convert_decimal(row.get('speed_gps_kn')),
                    'speed_log_kn': self._safe_convert_decimal(row.get('speed_log_kn')),
                    'speed_by_pitch_kn': self._safe_convert_decimal(row.get('speed_by_pitch_kn')),
                    'slip_percent': self._safe_convert_decimal(row.get('slip_percent')),
                    'time_start': self._safe_convert_time(row.get('time_start')),
                    'time_finish': self._safe_convert_time(row.get('time_finish')),
                    'revolution_counter_start': self._safe_convert_decimal(row.get('revolution_counter_start')),
                    'revolution_counter_finish': self._safe_convert_decimal(row.get('revolution_counter_finish')),
                    'measured_by': self._safe_convert_str(row.get('measured_by')),
                    'chief_engineer_name': self._safe_convert_str(row.get('chief_engineer_name')),
                    'tech_form_no': self._safe_convert_str(row.get('tech_form_no')),
                    'edition_no': self._safe_convert_int(row.get('edition_no')),
                    'revision_no': self._safe_convert_int(row.get('revision_no')),
                    'revision_date': self._safe_convert_date(row.get('revision_date'))
                }
                
                self.extracted_data['monthly_headers'].append(monthly_data)
                
        except Exception as e:
            logger.error(f"Error extracting monthly headers from {sheet_name}: {e}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
    
    def _extract_monthly_details(self, sheet_name: str) -> None:
        """Extract monthly report details (JSONB data)."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [self._clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                # Assuming details sheet has imo_number and report_month for linking
                imo_number = self._safe_convert_int(row.get('imo_number'))
                report_month = self._safe_convert_str(row.get('report_month'))
                section_name = self._safe_convert_str(row.get('section_name'))
                data_jsonb_raw = row.get('data_jsonb')

                if imo_number is None or not report_month or not section_name or pd.isna(data_jsonb_raw):
                    logger.warning(f"Skipping monthly details row due to missing linking fields or data: {row.to_dict()}")
                    continue
                
                detail_data = {
                    'imo_number': imo_number,        # Pass for resolver
                    'report_month': report_month,    # Pass for resolver
                    'section_name': section_name,
                    'data_jsonb': self._safe_convert_json(data_jsonb_raw)
                }
                
                self.extracted_data['monthly_details'].append(detail_data)
                
        except Exception as e:
            logger.error(f"Error extracting monthly details from {sheet_name}: {e}")
    
    # Helper methods for data cleaning and conversion
    
    def _clean_column_name(self, col_name: str) -> str:
        """Clean column name by removing constraint information in parentheses."""
        if pd.isna(col_name):
            return 'unnamed_column'
        
        cleaned = re.sub(r'\s*\([^)]*\)', '', str(col_name))
        return cleaned.strip().lower().replace(' ', '_')
    
    def _safe_convert_str(self, value: Any) -> Optional[str]:
        """Safely convert value to string."""
        if hasattr(value, 'iloc'): 
            value = value.iloc[0] if len(value) > 0 else None
        
        if value is None or pd.isna(value):
            return None
        s_value = str(value).strip()
        return s_value if s_value else None
    
    def _safe_convert_int(self, value: Any) -> Optional[int]:
        """Safely convert value to int."""
        if value is None or pd.isna(value):
            return None
        try:
            if isinstance(value, str):
                value = value.strip().replace(',', '')
                if not value:
                    return None
            return int(float(value)) # Handles decimal strings like "9481697.0"
        except (ValueError, TypeError):
            return None
    
    def _safe_convert_decimal(self, value: Any) -> Optional[Decimal]:
        """Safely convert value to Decimal."""
        if value is None or pd.isna(value):
            return None
        try:
            if isinstance(value, str):
                value = value.strip().replace(',', '')
                if not value:
                    return None
            return Decimal(str(value))
        except (InvalidOperation, ValueError, TypeError):
            return None
    
    def _safe_convert_date(self, value: Any) -> Optional[date]:
        """Safely convert value to date."""
        if value is None or pd.isna(value):
            return None
        try:
            if isinstance(value, (datetime, pd.Timestamp)):
                return value.date()
            elif isinstance(value, str):
                for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%Y-%m-%dT%H:%M:%S', '%Y/%m/%d', '%d-%b-%y', '%d-%b-%Y']: # Added more formats
                    try:
                        return datetime.strptime(value.strip(), fmt).date()
                    except ValueError:
                        continue
            elif isinstance(value, (int, float)):
                # Correct Excel's epoch base date for numeric dates
                # Excel day 1 is 1900-01-01, but it incorrectly treats 1900 as a leap year.
                # So the actual Python epoch is 1899-12-30.
                base_date = datetime(1899, 12, 30) 
                return (base_date + timedelta(days=value)).date()
            return None
        except (ValueError, TypeError, OverflowError) as e:
            logger.debug(f"Could not convert '{value}' to date: {e}")
            return None
    
    def _safe_convert_time(self, value: Any) -> Optional[time]:
        """Safely convert value to time."""
        if value is None or pd.isna(value):
            return None
        try:
            if isinstance(value, time):
                return value
            elif isinstance(value, (datetime, pd.Timestamp)):
                return value.time()
            elif isinstance(value, str):
                for fmt in ['%H:%M:%S', '%H:%M', '%I:%M:%S %p', '%I:%M %p']:
                    try:
                        return datetime.strptime(value.strip(), fmt).time()
                    except ValueError:
                        continue
            elif isinstance(value, (int, float)) and 0 <= value < 1: 
                total_seconds = int(value * 24 * 3600)
                hours = total_seconds // 3600
                minutes = (total_seconds % 3600) // 60
                seconds = total_seconds % 60
                return time(hours, minutes, seconds)
            return None
        except (ValueError, TypeError) as e:
            logger.debug(f"Could not convert '{value}' to time: {e}")
            return None
    
    def _safe_convert_bool(self, value: Any) -> Optional[bool]:
        """Safely convert value to boolean."""
        if value is None or pd.isna(value):
            return None
        
        if isinstance(value, bool):
            return value
        
        if isinstance(value, (int, float)):
            return bool(value)
        
        if isinstance(value, str):
            value = value.lower().strip()
            if value in ['true', '1', 'yes', 'y', 'on']:
                return True
            elif value in ['false', '0', 'no', 'n', 'off']:
                return False
        
        return None
    
    def _safe_convert_json(self, value: Any) -> Optional[dict]:
        """Safely convert value to JSON/dict."""
        if value is None or pd.isna(value):
            return None
        
        if isinstance(value, dict):
            return value
        
        if isinstance(value, str):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                logger.warning(f"Could not parse string as JSON: '{value[:100]}...'")
                return None
        
        return None


def load_excel_data(excel_file_path: str) -> Dict[str, List[Dict]]:
    """
    Main function to load shop trial data from Excel file.
    
    Args:
        excel_file_path: Path to Excel file
        
    Returns:
        Dict containing all extracted data organized by type
    """
    loader = ExcelDataLoader(excel_file_path)
    
    if not loader.load_workbook():
        raise ValueError(f"Failed to load Excel file: {excel_file_path}")
    
    return loader.extract_all_data()