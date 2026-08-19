import json
import os
import openpyxl

from app.core.config import settings

EXCEL_PATH = settings.REPORT_EXCEL_PATH
DEFAULT_REPORTS_JSON_PATH = settings.DEFAULT_REPORTS_JSON_PATH
def _make_entry(sr, title, rtype, freq) -> dict:
    title = str(title).strip()
    rtype = str(rtype).strip().upper() if rtype else "TECHNICAL"
    
    def normalize_freq(freq):
        if freq:
            f = str(freq).strip()
            if f.lower() == "1 month": f = "Monthly"
            elif f.lower() == "3 month": f = "Quarterly"
            elif f.lower() == "6 month": f = "Half-Yearly"
            elif f.lower() == "12 month": f = "Yearly"
            return f
        return "Monthly"

    freq = normalize_freq(freq)

    # Derive department from title keywords
    dept = "ENGINE"
    title_up = title.upper()
    if any(k in title_up for k in ["DECK", "PAINT", "CORROSION", "VESSEL CONDITION"]):
        dept = "DECK"
    elif any(k in title_up for k in ["MARPOL", "GARBAGE", "BALLAST", "BWTS", "OIL RECORD"]):
        dept = "MARPOL"
    elif any(k in title_up for k in ["ELECTRICAL", "BATTERY", "ICCP", "MGPS"]):
        dept = "ELECTRICAL"

    # Build a clean report_code from sr + frequency prefix
    freq_prefix = {"Weekly": "WK", "Monthly": "MO", "Quarterly": "QT", "Half-Yearly": "HY", "Yearly": "YR"}.get(freq, "XX")
    report_code = f"{freq_prefix}-{str(sr).zfill(2)}-{title[:30].strip().replace(' ', '_')}"

    return {
        "report_code": report_code,
        "report_name": title,
        "department": dept,
        "frequency": freq,
        "type": rtype,
    }

def get_default_configs() -> list[dict]:
    """
    Return the 45 master report configs used by "Assign 45 Defaults".

    Reads from a static JSON snapshot (DEFAULT_REPORTS_JSON_PATH) instead of
    parsing the Excel workbook on every request. The snapshot was generated
    once from the Reports sheet via generate_default_configs_from_excel()
    below, so report_code values are unchanged and existing configs/reports
    keyed on them keep matching.
    """
    if not os.path.exists(DEFAULT_REPORTS_JSON_PATH):
        return []

    with open(DEFAULT_REPORTS_JSON_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def generate_default_configs_from_excel() -> list[dict]:
    """
    Parse the Reports sheet and return the 45 master reports.

    Offline utility only — used to (re)generate DEFAULT_REPORTS_JSON_PATH
    when the source Excel changes. Not called on the request path.
    """
    if not os.path.exists(EXCEL_PATH):
        return []

    wb = openpyxl.load_workbook(EXCEL_PATH)
    ws = wb["Reports"]

    reports = []
    current_freq = None

    for row in ws.iter_rows(min_row=1, values_only=True):
        sr, title, rtype, freq = (row[0], row[1], row[2], row[3]) if len(row) >= 4 else (None, None, None, None)

        if sr is None and title is None:
            continue

        if sr == 1 and isinstance(title, str) and ("REVIEW" in title.upper() or "QUARTERLY" in title.upper()):
            if freq:
                current_freq = str(freq)
            else:
                current_freq = "Monthly"
            if rtype:
                reports.append(_make_entry(sr, title, rtype, current_freq))
            continue

        if isinstance(sr, int) and title and rtype:
            if freq:
                current_freq = str(freq)
            reports.append(_make_entry(sr, title, rtype, current_freq or "Monthly"))

    return reports
