# app/utils.py
import pandas as pd
import re
import json
import logging
from datetime import datetime, date, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Optional

logger = logging.getLogger(__name__)

def clean_column_name(col_name: str) -> str:
    """Clean column name by removing constraint information in parentheses."""
    if pd.isna(col_name):
        return 'unnamed_column'
    cleaned = re.sub(r'\s*\([^)]*\)', '', str(col_name))
    return cleaned.strip().lower().replace(' ', '_')

def safe_convert_str(value: Any) -> Optional[str]:
    """Safely convert value to string."""
    if hasattr(value, 'iloc'): 
        value = value.iloc[0] if len(value) > 0 else None
    if value is None or pd.isna(value):
        return None
    s_value = str(value).strip()
    return s_value if s_value else None

def safe_convert_int(value: Any) -> Optional[int]:
    """Safely convert value to int."""
    if value is None or pd.isna(value):
        return None
    try:
        if isinstance(value, str):
            value = value.strip().replace(',', '')
            if not value:
                return None
        return int(float(value))
    except (ValueError, TypeError):
        return None

def safe_convert_decimal(value: Any) -> Optional[Decimal]:
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

def safe_convert_date(value: Any) -> Optional[date]:
    """Safely convert value to date."""
    if value is None or pd.isna(value):
        return None
    try:
        if isinstance(value, (datetime, pd.Timestamp)):
            return value.date()
        elif isinstance(value, str):
            for fmt in ['%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y', '%d-%m-%Y', '%Y-%m-%dT%H:%M:%S', '%Y/%m/%d', '%d-%b-%y', '%d-%b-%Y']:
                try:
                    return datetime.strptime(value.strip(), fmt).date()
                except ValueError:
                    continue
        elif isinstance(value, (int, float)):
            base_date = datetime(1899, 12, 30)
            return (base_date + timedelta(days=value)).date()
        return None
    except (ValueError, TypeError, OverflowError) as e:
        logger.debug(f"Could not convert '{value}' to date: {e}")
        return None

def safe_convert_time(value: Any) -> Optional[time]:
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

def safe_convert_bool(value: Any) -> Optional[bool]:
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

def safe_convert_json(value: Any) -> Optional[dict]:
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