# /pdf extractor 
import os
import re
import json
from datetime import datetime, date, time
from decimal import Decimal
from typing import Any, Dict, Optional, BinaryIO
from PyPDF2 import PdfReader

import logging

logger = logging.getLogger(__name__)

def parse_date_flexibly(date_str: str, key_name: str = "") -> Optional[date]:
    """
    Parse dates in multiple formats flexibly.
    Common formats in shipping PDFs.
    """
    if not date_str or not isinstance(date_str, str):
        return None
    
    date_str = date_str.strip()
    if not date_str:
        return None
    
    # List of date formats to try
    date_formats = [
        "%d/%m/%y",      # <--- ADD THIS LINE (Matches 30/9/25)
        "%d-%B-%y",      # (Matches 30-September-25)
        "%d-%b-%y",      # (Matches 30-Sep-25)
        "%Y-%m-%d",
        "%d/%m/%Y",
        '%d-%b-%y',      # 23-May-25
        '%d-%b-%Y',      # 23-May-2025
        '%d-%B-%y',      # 18-June-25 (full month name with 2-digit year)
        '%d-%B-%Y',      # 18-June-2025 (full month name with 4-digit year)
        '%b-%y',         # Jun-25 (report month)
        '%B-%y',         # June-25 (report month full name)
        '%d/%m/%Y',      # 23/05/2025
        '%d-%m-%Y',      # 23-05-2025
        '%m/%d/%Y',      # 05/23/2025 (US format)
        '%Y-%m-%d',      # 2025-05-23 (ISO format)
        '%d.%m.%Y',      # 23.05.2025
        '%b %d, %Y',     # May 23, 2025
        '%B %d, %Y',     # May 23, 2025 (full month name)
        '%d %b %Y',      # 23 May 2025
        '%d %B %Y',      # 23 May 2025 (full month name)
        '%d-%m-%y',      # 23-05-25
        '%m-%d-%y',      # 05-23-25
        '%d/%m/%y',      # 23/05/25
        '%m/%d/%y',      # 05/23/25
    ]
    
    for fmt in date_formats:
        try:
            parsed_date = datetime.strptime(date_str, fmt).date()
            
            # Handle 2-digit years (assuming 20xx for years 00-50, 19xx for 51-99)
            if parsed_date.year < 1950:
                if parsed_date.year <= 50:
                    parsed_date = parsed_date.replace(year=parsed_date.year + 2000)
                else:
                    parsed_date = parsed_date.replace(year=parsed_date.year + 1900)
            
            logger.info(f"Successfully parsed date '{date_str}' as {parsed_date} using format '{fmt}'")
            return parsed_date
            
        except ValueError:
            continue
    
    logger.warning(f"Could not parse date '{date_str}' for key '{key_name}'. Keeping as string.")
    return None

def parse_time_flexibly(time_str: str, key_name: str = "") -> Optional[time]:
    """
    Parse time in multiple formats flexibly.
    """
    if not time_str or not isinstance(time_str, str):
        return None
    
    time_str = time_str.strip()
    if not time_str:
        return None
    
    # List of time formats to try
    time_formats = [
        '%H:%M',         # 14:30
        '%H.%M',         # 14.30
        '%H:%M:%S',      # 14:30:00
        '%I:%M %p',      # 2:30 PM
        '%I:%M%p',       # 2:30PM (no space)
    ]
    
    for fmt in time_formats:
        try:
            parsed_time = datetime.strptime(time_str, fmt).time()
            logger.info(f"Successfully parsed time '{time_str}' as {parsed_time} using format '{fmt}'")
            return parsed_time
        except ValueError:
            continue
    
    logger.warning(f"Could not parse time '{time_str}' for key '{key_name}'. Keeping as string.")
    return None

def truncate_string_for_db_field(value: str, field_name: str, max_length: int = 20) -> str:
    """
    Truncate string values that are too long for database fields.
    """
    if len(value) <= max_length:
        return value
    
    truncated = value[:max_length]
    logger.warning(f"Truncated field '{field_name}' from '{value}' to '{truncated}' (max_length: {max_length})")
    return truncated

def clean_value_for_acroform(v: Any, key_name: Optional[str] = None) -> Any:
    """
    Convert Yes/No to bool, numbers to int/float/Decimal; handle dates and specific strings.
    This function aims to return values in their most appropriate Python type.
    """
    if v is None:
        return None
    if isinstance(v, str):
        vv = v.strip()
        if vv == "":
            return None
        
        # Specific type handling based on key name or content
        if key_name and key_name.lower() == 'eplimplemented':
            return vv.lower() == 'yes'
        
        # Enhanced date parsing with flexible formats
        if key_name and key_name.lower() in ['date', 'revdate', 'reportmonth', 'revision_date', 'reportdate', 'report_date']:
            parsed_date = parse_date_flexibly(vv, key_name)
            if parsed_date:
                return parsed_date
            else:
                # Keep as string if date parsing fails
                return vv
        
        # Enhanced time parsing with flexible formats
        if key_name and key_name.lower() in ['timestart', 'timefinish', 'start_time', 'finish_time', 'time']:
            parsed_time = parse_time_flexibly(vv, key_name)
            if parsed_time:
                return parsed_time
            else:
                # Keep as string if time parsing fails
                return vv
        
        # Handle percentage fields
        if key_name and ('slip%' in key_name.lower() or 'percentage' in key_name.lower() or key_name.lower().endswith('%')):
            try:
                # Remove % symbol and other non-numeric characters except decimal point and minus
                numeric_val = re.sub(r'[^\d.-]', '', vv)
                if numeric_val and numeric_val not in ['-', '.', '-.']:
                    return Decimal(numeric_val)
            except Exception:
                logger.warning(f"Could not convert percentage value '{vv}' to Decimal for key '{key_name}'. Keeping as string.")
                return vv
        
        # Handle IMO numbers - should be integers
        if key_name and key_name.lower() in ['imo', 'imo_number', 'imonumber']:
            numeric_val = re.sub(r'[^\d]', '', vv)  # Only digits for IMO
            if numeric_val:
                try:
                    return int(numeric_val)  # Return as integer
                except ValueError:
                    logger.warning(f"Could not convert IMO '{vv}' to integer. Keeping as string.")
                    return vv
        

        text_fields = ['model', 'enginemodel', 'engine_model', 'type', 'enginetype', 'engine_type', 'maker', 'enginemaker', 'engine_maker', 'vesselname']
        if key_name and key_name.lower() in text_fields:
            return vv

            
        # General numeric conversion (after specific string handling)
        # Convert to Decimal for numbers to preserve precision.
        try:
            # Remove commas first
            numeric_val_cleaned = vv.replace(',', '')
            # Try to extract numeric value from strings with units or other characters
            match = re.fullmatch(r'[^.\d-]*(-?\d*\.?\d+)[^.\d-]*', numeric_val_cleaned)
            if match:
                numeric_val_for_decimal = match.group(1)
                return Decimal(numeric_val_for_decimal)
            elif re.fullmatch(r'-?\d*\.?\d+', numeric_val_cleaned):
                return Decimal(numeric_val_cleaned)
        except Exception:
            pass  # Fall through to string handling
        
        # Handle potential database field length constraints for specific string fields
        # Common shipping form fields that might be long
        if key_name and key_name.lower() in [
            'chiefengineersign', 'chief_engineer_name', 'measuredby', 'measured_by',
            'weather', 'location', 'shipcondition', 'ship_condition', 'windforce', 
            'wind_force', 'seastate', 'sea_state', 'remarks', 'formname', 'techno'
        ]:
            # These might need truncation - adjust max_length based on your DB schema
            max_lengths = {
                'chiefengineersign': 50,
                'chief_engineer_name': 50,
                'measuredby': 50,
                'measured_by': 50,
                'weather': 30,
                'location': 20,
                'shipcondition': 20,
                'ship_condition': 20,
                'windforce': 25,
                'wind_force': 25,
                'seastate': 20,
                'sea_state': 20,
                'remarks': 200,
                'formname': 50,
                'techno': 30
            }
            max_length = max_lengths.get(key_name.lower(), 20)
            if len(vv) > max_length:
                return truncate_string_for_db_field(vv, key_name, max_length)
        
        # Return the string as-is if no conversions applied
        return vv
    
    return v

def extract_data_from_monthly_report_pdf(pdf_file_stream: BinaryIO, filename: str = "uploaded_pdf.pdf") -> Optional[Dict[str, Any]]:
    """
    Extracts form fields. 
    PRESERVED: Original FIPI priority logic, MT to KG conversion, and existing aliases.
    UPDATED: Dynamic cylinder detection (1-18) and MAN SL2014 parameter mapping.
    """
    logger.info(f"Starting AcroForm extraction for monthly report PDF: {filename}")
    
    reader = PdfReader(pdf_file_stream)
    raw_fields = {}
    
    # --- Extraction Logic ---
    root = reader.trailer.get("/Root")
    if root:
        root_obj = root.get_object()
        if "/AcroForm" in root_obj:
            form = root_obj["/AcroForm"]
            form_obj = form.get_object()
            if "/Fields" in form_obj:
                for field in form_obj["/Fields"]:
                    field_obj = field.get_object()
                    name = field_obj.get("/T")
                    value = field_obj.get("/V")
                    if name:
                        raw_fields[name] = value

    if not raw_fields:
        logger.warning(f"No form fields extracted from '{filename}'.")
        return None

    logger.info(f"Raw fields extracted: {list(raw_fields.keys())}")

    # --- NEW: Translation Mapping for MAN SL2014 Forms ---
    # This ensures new parameters match what report_processor.py expects
    MAN_TRANSLATION_MAP = {
        'Heat value, kJ/kg': 'netenergyasperbdn/folcvselection',
        'Eff. Fuel Consumption': 'sfoccalculated',
        'Fuel Index ECU': 'fuel index (ECU %)',
        'Ambient Pressure': 'barometricpressure',
        'Engine RPM': 'rpm',
        'Draft Fore, m': 'draft_fore',
        'Draft Aft, m': 'draft_aft',
        '▲p Filter': 'ap_filter',
        '▲p Cooler': 'ap_air_cooler',
        'No. of Cyl.': 'noofcyl',
        'No. of Cyl': 'noofcyl'
    }

    # --- Setup Variables for FIPI Search (PRESERVED) ---
    fipi_table_avg = None      
    fipi_standalone_box = None 
    fipi_cylinders = []        
    fipi_keywords = ['fuelindex', 'pumpmark', 'rackposition', 'pumpindex']

    cleaned_data = {}
    
    # --- Dynamic Cylinder Count Detection ---
    # Look for cylinder count to handle vessels with > 6 cylinders
    raw_cyl_val = raw_fields.get('No. of Cyl.') or raw_fields.get('No. of Cyl') or raw_fields.get('noofcyl')
    try:
        # If found, use it; otherwise, existing logic will just extract what it finds
        num_cyls = int(float(str(raw_cyl_val).strip())) if raw_cyl_val else 18 
    except:
        num_cyls = 18

    # --- Cleaning & Search Loop ---
    for key, value in raw_fields.items():
        cleaned_value = clean_value_for_acroform(value, key_name=key)
        
        # 1. Apply SL2014 Mapping if applicable
        if key in MAN_TRANSLATION_MAP:
            cleaned_data[MAN_TRANSLATION_MAP[key]] = cleaned_value
        
        # 2. Map Cylinder Grids (Pmax, Pcomp, Pi, Exhaust)
        # Standardizing formats like "Pmax_1" or "Pmax, bar_1" to "pmax#1" for the processor
        key_lower = key.lower()
        if any(match in key_lower for match in ['pmax', 'pcomp', 'exhaust', 'pi', 'pumpmark']):
            # Regex to find cylinder number at the end of the string

            if 'offset' in key_lower:
                # Still store it under the original name, but don't map it to #cyl
                cleaned_data[key] = cleaned_value
                continue 
                
            cyl_match = re.search(r'(\d+)$', key)
            if cyl_match:
                cyl_num = cyl_match.group(1)
                if 'pmax' in key_lower: cleaned_data[f'pmax#{cyl_num}'] = cleaned_value
                elif 'pcomp' in key_lower: cleaned_data[f'pcomp#{cyl_num}'] = cleaned_value
                elif 'pi' in key_lower: cleaned_data[f'pi#{cyl_num}'] = cleaned_value
                elif 'exhaust' in key_lower: cleaned_data[f'exhausttemp#{cyl_num}'] = cleaned_value
                elif any(kw in key_lower for kw in fipi_keywords): 
                    cleaned_data[f'pumpmark/fuelindex#{cyl_num}'] = cleaned_value

        # 3. Store the cleaned value under the original key (PRESERVED)
        cleaned_data[key] = cleaned_value
        
        # --- [PRESERVED] Logic to Identify FIPI Fields ---
        if isinstance(key, str) and cleaned_value is not None:
            key_norm = key.lower().replace(' ', '').replace('_', '').replace('.', '').replace('(', '').replace(')', '')
            
            if any(kw in key_norm for kw in fipi_keywords):
                if 'avg' in key_norm or 'mean' in key_norm:
                    if isinstance(cleaned_value, (Decimal, float, int)):
                        fipi_table_avg = cleaned_value
                elif any(char.isdigit() for char in key_norm) and 'ecu' not in key_norm:
                    if isinstance(cleaned_value, (Decimal, float, int)):
                        if cleaned_value < 200: 
                            fipi_cylinders.append(cleaned_value)
                else:
                    if isinstance(cleaned_value, (Decimal, float, int)):
                        if 10 < cleaned_value < 150:
                            fipi_standalone_box = cleaned_value
        # -----------------------------------------------

        # ISO Aliases (PRESERVED)
        if key and isinstance(key, str):
            check_key = key.lower().replace(' ', '').strip()
            if 'cwtempaircoolerinlet#1' in check_key:
                cleaned_data['cwtempaircoolerinlet_1'] = cleaned_value
            if 'turbochargerairinlettemp#1' in check_key:
                cleaned_data['turbochargerairinlettemp_1'] = cleaned_value

    # --- [PRESERVED] FIPI Decision Logic ---
    final_fipi = None
    source_used = "None"
    
    if fipi_table_avg is not None and fipi_table_avg > 0:
        final_fipi = fipi_table_avg
        source_used = "Table Average"
    elif fipi_standalone_box is not None and fipi_standalone_box > 0:
        final_fipi = fipi_standalone_box
        source_used = "Standalone/ECU Box"
    elif fipi_cylinders:
        try:
            avg_val = sum(fipi_cylinders) / len(fipi_cylinders)
            final_fipi = Decimal(avg_val).quantize(Decimal("0.01"))
            source_used = f"Calculated ({len(fipi_cylinders)} cyls)"
        except Exception:
            final_fipi = None

    if final_fipi:
        cleaned_data['fuel_inj_pump_index_mm'] = final_fipi
        logger.info(f"✅ FIPI Extracted: {final_fipi} (Source: {source_used})")

    # --- [PRESERVED] Unit Conversion Logic ---
    if 'foconsumptionmt_hr' in cleaned_data and cleaned_data['foconsumptionmt_hr'] is not None:
        if isinstance(cleaned_data['foconsumptionmt_hr'], Decimal):
            cleaned_data['foconsumptionmt_hr_kg_h'] = cleaned_data['foconsumptionmt_hr'] * Decimal('1000')
        else:
            cleaned_data['foconsumptionmt_hr_kg_h'] = None
    else:
        cleaned_data['foconsumptionmt_hr_kg_h'] = None

    # Filter out None values and return
    final_cleaned_data = {k: v for k, v in cleaned_data.items() if v is not None}
    return final_cleaned_data
    
# Custom JSON Encoder for date/time/Decimal objects (useful for debugging extracted data)
class DateEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, date):
            return obj.isoformat() 
        if isinstance(obj, time):
            return obj.isoformat()
        if isinstance(obj, Decimal):
            return str(obj)  # Represent Decimal as string for exact precision
        return json.JSONEncoder.default(self, obj)

# Example Usage (for testing this module directly)
if __name__ == "__main__":
    import io
    # --- Define your PDF path here ---
    monthly_report_pdf_path = "TE-07 ME Performance Sheet JUNE 2025.pdf" 

    print("\n--- Attempting Monthly Report PDF Extraction (AcroForm-based) ---")
    if os.path.exists(monthly_report_pdf_path):
        try:
            with open(monthly_report_pdf_path, 'rb') as f:  # Open in binary read mode
                monthly_report_raw_json_data = extract_data_from_monthly_report_pdf(f, os.path.basename(monthly_report_pdf_path))
            
            if monthly_report_raw_json_data:
                print("\n✅ Monthly Report Data Extraction Successful!")
                print(json.dumps(monthly_report_raw_json_data, indent=2, cls=DateEncoder))
                
                print(f"\nExtracted Vessel Name: {monthly_report_raw_json_data.get('vesselname')}")
                print(f"Extracted IMO: {monthly_report_raw_json_data.get('imo')} (Type: {type(monthly_report_raw_json_data.get('imo'))})")
                print(f"Extracted Date: {monthly_report_raw_json_data.get('date')} (Type: {type(monthly_report_raw_json_data.get('date'))})")
                print(f"Extracted Shaft Power: {monthly_report_raw_json_data.get('shaftpower')} kW (Type: {type(monthly_report_raw_json_data.get('shaftpower'))})")
                print(f"Extracted SFOC: {monthly_report_raw_json_data.get('sfoc')} g/kWh (Type: {type(monthly_report_raw_json_data.get('sfoc'))})")
                print(f"Extracted Fuel Flow (kg/h): {monthly_report_raw_json_data.get('foconsumptionmt_hr_kg_h')} kg/h (Type: {type(monthly_report_raw_json_data.get('foconsumptionmt_hr_kg_h'))})")
                print(f"EPL Implemented: {monthly_report_raw_json_data.get('eplimplemented')} (Type: {type(monthly_report_raw_json_data.get('eplimplemented'))})")
            else:
                print("\n❌ Monthly Report Data Extraction Failed or no AcroForm fields found.")
        except Exception as e:
            logger.error(f"An unexpected error occurred: {e}", exc_info=True)
            print(f"\n❌ An error occurred during PDF processing: {e}")
    else:
        print(f"❌ Error: Monthly Report PDF file not found at {monthly_report_pdf_path}")
        print("Please ensure the PDF file path is correct and accessible.")