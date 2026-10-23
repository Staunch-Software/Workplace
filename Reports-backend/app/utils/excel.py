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
            if f.lower() in ("1 day", "daily"): f = "Daily"
            elif f.lower() == "1 month": f = "Monthly"
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
    freq_prefix = {"Daily": "DY", "Weekly": "WK", "Monthly": "MO", "Quarterly": "QT", "Half-Yearly": "HY", "Yearly": "YR"}.get(freq, "XX")
    report_code = f"{freq_prefix}-{str(sr).zfill(2)}-{title[:30].strip().replace(' ', '_')}"

    return {
        "report_code": report_code,
        "report_name": title,
        "department": dept,
        "frequency": freq,
        "type": rtype,
    }

def halfyearly_default_configs() -> list[dict]:
    """The 27 half-yearly Cargo Hold / Water Ballast Tank reports.

    These are scraped by their own flow (run_halfyearly_scraper in
    app/scraper/smartpal_scraper.py), which recognises them by report_code:
    301.01-301.09 and 305.03.03-305.03.20. Generated here rather than stored
    in the JSON snapshot so the 45 original defaults stay untouched.
    """
    out = []
    for n in range(1, 10):
        out.append({
            "report_code": f"301.{n:02d}",
            "report_name": f"CARGO HOLD NO {n}",
            "department": "CARGO",
            "frequency": "Half-Yearly",
            "type": "TECHNICAL",
        })
    for k in range(18):  # 305.03.03 .. 305.03.20 -> tank 1..9, P then S
        out.append({
            "report_code": f"305.03.{k + 3:02d}",
            "report_name": f"WATER BALLAST TANK NO {k // 2 + 1} ({'P' if k % 2 == 0 else 'S'})",
            "department": "BALLAST",
            "frequency": "Half-Yearly",
            "type": "TECHNICAL",
        })
    return out


def get_default_configs() -> list[dict]:
    """
    Return the master report configs used by "Assign Defaults": the 45 from
    the static JSON snapshot plus the 27 half-yearly Cargo Hold / Water
    Ballast Tank reports.

    Reads from a static JSON snapshot (DEFAULT_REPORTS_JSON_PATH) instead of
    parsing the Excel workbook on every request. The snapshot was generated
    once from the Reports sheet via generate_default_configs_from_excel()
    below, so report_code values are unchanged and existing configs/reports
    keyed on them keep matching.
    """
    if not os.path.exists(DEFAULT_REPORTS_JSON_PATH):
        return []

    with open(DEFAULT_REPORTS_JSON_PATH, "r", encoding="utf-8") as f:
        defaults = json.load(f)

    existing = {d["report_code"] for d in defaults}
    return defaults + [d for d in halfyearly_default_configs() if d["report_code"] not in existing]


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
