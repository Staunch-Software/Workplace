# app/ae_excel_loader.py
import pandas as pd
import logging
from typing import Dict, List
from .utils.data_utils import (clean_column_name, safe_convert_str, safe_convert_int, 
                    safe_convert_decimal, safe_convert_date)

logger = logging.getLogger(__name__)

class AEExcelDataLoader:
    """Handles loading Auxiliary Engine data from Excel files."""
    
    def __init__(self, excel_file_path: str):
        self.excel_file_path = excel_file_path
        self.workbook = None
        self.extracted_data = {
            'vessel_generators': [],
            'generator_baseline_data': []
        }
    
    def load_workbook(self) -> bool:
        """Load Excel workbook."""
        try:
            self.workbook = pd.ExcelFile(self.excel_file_path, engine='openpyxl')
            logger.info(f"Loaded AE Excel file: {self.excel_file_path}")
            return True
        except Exception as e:
            logger.error(f"Failed to load AE Excel file: {e}")
            return False
    
    def extract_all_data(self) -> Dict[str, List[Dict]]:
        """Extract all AE data from Excel."""
        if not self.workbook:
            raise ValueError("Workbook not loaded. Call load_workbook() first.")
        
        sheet_names = self.workbook.sheet_names
        
        for sheet_name in sheet_names:
            try:
                if 'vessel_generators' in sheet_name.lower():
                    self._extract_vessel_generators(sheet_name)
                elif 'generator_baseline_data' in sheet_name.lower():
                    self._extract_generator_baseline_data(sheet_name)
            except Exception as e:
                logger.error(f"Error processing AE sheet {sheet_name}: {e}")
                continue
        
        logger.info(f"AE extraction: {len(self.extracted_data['vessel_generators'])} generators, "
                   f"{len(self.extracted_data['generator_baseline_data'])} baseline records")
        return self.extracted_data
    
    def _extract_vessel_generators(self, sheet_name: str) -> None:
        """Extract vessel generator information."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                imo_number = safe_convert_int(row.get('imo_number'))
                engine_no = safe_convert_str(row.get('engine_no'))
                designation = safe_convert_str(row.get('designation'))
                
                if not imo_number or not engine_no or not designation:
                    logger.warning(f"Skipping generator row: missing IMO/engine_no/designation")
                    continue
                
                gen_data = {
                    'imo_number': imo_number,
                    'engine_no': engine_no,
                    'designation': designation,

                    # MATCH DATABASE COLUMN NAMES EXACTLY ↓↓↓
                    'engine_maker': safe_convert_str(row.get('maker')),
                    'engine_model': safe_convert_str(row.get('model')),
                    'num_of_cylinders': safe_convert_int(row.get('num_of_cylinders')),
                    'mcr_power_kw': safe_convert_decimal(row.get('rated_engine_output_kw')),
                    'mcr_rpm': safe_convert_decimal(row.get('rated_speed_rpm')),
                }

                
                self.extracted_data['vessel_generators'].append(gen_data)
                logger.debug(f"Extracted generator: {engine_no} - {designation}")
                
        except Exception as e:
            logger.error(f"Error extracting generators from {sheet_name}: {e}")
    
    def _extract_generator_baseline_data(self, sheet_name: str) -> None:
        """Extract generator baseline performance data. Updated to include engine_no."""
        try:
            df = pd.read_excel(self.workbook, sheet_name=sheet_name, header=0)
            df.columns = [clean_column_name(col) for col in df.columns]
            
            for _, row in df.iterrows():
                imo_number = safe_convert_int(row.get('imo_number'))
                # --- NEW: Extract engine_no from the excel sheet ---
                engine_no = safe_convert_str(row.get('engine_no'))
                # --------------------------------------------------
                load_percentage = safe_convert_decimal(row.get('load_percentage'))
                load_kw = safe_convert_decimal(row.get('load_kw'))
                
                # --- UPDATE VALIDATION: Now checks for engine_no ---
                if not imo_number or not engine_no or load_percentage is None or load_kw is None:
                    logger.warning(f"Skipping baseline row: missing required fields (IMO: {imo_number}, Engine: {engine_no})")
                    continue
                
                baseline_data = {
                    'imo_number': imo_number,
                    'engine_no': engine_no, # --- NEW: Pass engine_no for loader lookup ---
                    'load_percentage': load_percentage,
                    'load_kw': load_kw,
                    'pmax_raw_mpa': safe_convert_decimal(row.get('pmax_raw_mpa')),
                    'boost_air_pressure_raw_mpa': safe_convert_decimal(row.get('boost_air_pressure_raw_mpa')),
                    'exh_temp_tc_inlet_graph_c': safe_convert_decimal(row.get('exh_temp_tc_inlet_graph_c')),
                    'exh_temp_cyl_outlet_avg_graph_c': safe_convert_decimal(row.get('exh_temp_cyl_outlet_avg_graph_c')),
                    'exh_temp_tc_outlet_graph_c': safe_convert_decimal(row.get('exh_temp_tc_outlet_graph_c')),
                    'fuel_pump_index_graph': safe_convert_decimal(row.get('fuel_pump_index_graph')),
                    'sfoc_graph_g_kwh': safe_convert_decimal(row.get('sfoc_graph_g_kwh')),
                    'fuel_consumption_total_graph_kg_h': safe_convert_decimal(row.get('fuel_consumption_total_graph_kg_h'))
                }
                
                self.extracted_data['generator_baseline_data'].append(baseline_data)
                
        except Exception as e:
            logger.error(f"Error extracting baseline data from {sheet_name}: {e}")

def load_ae_excel_data(excel_file_path: str) -> Dict[str, List[Dict]]:
    """Main function to load AE data from Excel."""
    loader = AEExcelDataLoader(excel_file_path)
    if not loader.load_workbook():
        raise ValueError(f"Failed to load AE Excel file: {excel_file_path}")
    return loader.extract_all_data()