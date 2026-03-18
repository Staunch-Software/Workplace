# app/ae_pdf_extractor.py
import re
import logging
from datetime import datetime, date
from decimal import Decimal
from typing import Any, Dict, Optional, BinaryIO
from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)

def parse_date_flexibly(date_str: str) -> Optional[date]:
    """Parse date in multiple formats"""
    if not date_str or not isinstance(date_str, str):
        return None
    
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
            parsed = datetime.strptime(date_str.strip(), fmt).date()
            if parsed.year < 100:
                parsed = parsed.replace(year=parsed.year + 2000)
            logger.info(f"Parsed date '{date_str}' as {parsed}")
            return parsed
        except ValueError:
            continue
    
    logger.warning(f"Could not parse date '{date_str}'")
    return None

def clean_numeric_value(value: Any, key_name: str = None) -> Any:
    """Convert string to appropriate numeric type"""
    if value is None or value == "":
        return None
    
    if isinstance(value, str):
        v = value.strip().replace(',', '')
        
        # Skip empty or placeholder values
        if v in ['-', 'N/A', 'NA', '', 'None']:
            return None
        
        # IMO - return as integer
        if key_name and 'imo' in key_name.lower():
            digits = re.sub(r'[^\d]', '', v)
            return int(digits) if digits else None
        
        # General numeric
        match = re.search(r'(-?\d*\.?\d+)', v)
        if match:
            return Decimal(match.group(1))
    
    return value

def extract_ae_performance_data(pdf_file_stream: BinaryIO, filename: str = "ae_performance.pdf") -> Optional[Dict[str, Any]]:
    """Extract AE performance data from PDF AcroForm"""
    logger.info(f"Extracting AE data from: {filename}")
    
    try:
        reader = PdfReader(pdf_file_stream)
        raw_fields = {}
        
        root = reader.trailer.get("/Root")
        if not root:
            logger.error("No /Root in PDF")
            return None
        
        root_obj = root.get_object()
        if "/AcroForm" not in root_obj:
            logger.error("No /AcroForm in PDF")
            return None
        
        form_obj = root_obj["/AcroForm"].get_object()
        if "/Fields" not in form_obj:
            logger.error("No /Fields in AcroForm")
            return None
        
        for field in form_obj["/Fields"]:
            field_obj = field.get_object()
            name = field_obj.get("/T")
            value = field_obj.get("/V")
            if name and value:
                raw_fields[name] = value
        
        if not raw_fields:
            logger.warning("No fields extracted")
            return None
        
        logger.info(f"Extracted {len(raw_fields)} fields")
        logger.info(f"Field names: {list(raw_fields.keys())[:30]}")  # Log first 30 field names
        
        # Clean and structure data
        cleaned_data = {}
        for key, value in raw_fields.items():
            key_lower = key.lower()
            
            # Parse dates
            if any(x in key_lower for x in ['date', 'month']) and 'deviation' not in key_lower:
                cleaned_value = parse_date_flexibly(str(value))
                if not cleaned_value:
                    cleaned_value = value
            else:
                cleaned_value = clean_numeric_value(value, key)
            
            if cleaned_value is not None:
                cleaned_data[key] = cleaned_value
                logger.debug(f"Field '{key}' = '{cleaned_value}' (type: {type(cleaned_value).__name__})")
        
        logger.info(f"Cleaned data contains {len(cleaned_data)} non-null fields")

        CYL_PATTERNS = [
            ("pmax",        "pmaxunit"),
            ("exhausttemp", "exhausttempunit"),
            ("exhaust",     "exhausttempunit"),
            ("fuelrack",    "fuelrackunit"),
            ("jcwtempout",  "jcwtempoutunit"),
        ]

        for raw_key, raw_val in list(cleaned_data.items()):
            key_norm = raw_key.lower().replace(" ", "").replace("_", "")
            cyl_match = re.search(r'#?(\d+)$', key_norm)
            if not cyl_match:
                continue
            cyl_num = cyl_match.group(1)
            for keyword, prefix in CYL_PATTERNS:
                if keyword in key_norm:
                    mapped_key = f"{prefix}#{cyl_num}"
                    cleaned_data[mapped_key] = raw_val
                    logger.debug(f"Cylinder mapped: '{raw_key}' → '{mapped_key}' = {raw_val}")
                    break
        
        return cleaned_data
        
    except Exception as e:
        logger.error(f"AE extraction error: {e}", exc_info=True)
        return None