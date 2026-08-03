"""
Viswa Lab PDF Extractor
=========================
Handles reports from Viswa Lab (VISWA LAB INDIA / www.theviswagroup.com).

PDF Format (observed):
  - ONE machine ("Equipment") per page — unlike Gulf/Tribocare, which stack
    multiple machines onto page 1. Each page is a fully self-contained
    "LUBE OIL TREND REPORT" for a single piece of equipment.
  - Label and value sit on the same line, e.g.:
        "Iron - ppm ASTM D5185 16"
        "Viscosity @40°C - mm2/s ASTM D445 143.9 128.3"
    When two numbers appear on a line, the FIRST is the "Reference Oil"
    baseline and the LAST is the current Sample #1 result, so we always
    take the last whitespace-separated numeric token on the line.
"""
import re
import logging
from datetime import datetime
from typing import Any, Dict, Optional, List

logger = logging.getLogger(__name__)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _parse_date(raw: str) -> Optional[str]:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%d-%b-%Y", "%d-%b-%y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _clean_number(val: Optional[str]) -> Optional[float]:
    if val is None:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


_NUM_TOKEN = re.compile(r"^[<>]?\d+\.?\d*$")


def _line_value(text: str, label_pattern: str) -> Optional[float]:
    """
    Finds the line starting with `label_pattern` and returns the LAST
    whitespace-separated numeric token on that line — the current
    Sample #1 result (Reference Oil / method codes precede it, if present).
    """
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if re.match(label_pattern, line, re.IGNORECASE):
            numeric_tokens = [t for t in line.split() if _NUM_TOKEN.match(t)]
            if numeric_tokens:
                return _clean_number(numeric_tokens[-1])
            return None
    return None


def _line_text_value(text: str, label_pattern: str) -> Optional[str]:
    """Returns the raw remainder of a line after label_pattern (non-numeric fields)."""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        m = re.match(label_pattern, line, re.IGNORECASE)
        if m:
            rest = line[m.end():].strip()
            return rest or None
    return None


_ALERT_KEYWORDS = [
    ("nickel",      "wear", "nickel"),
    ("iron",        "wear", "iron"),
    ("copper",      "wear", "copper"),
    ("lead",        "wear", "lead"),
    ("chromium",    "wear", "chromium"),
    ("tin",         "wear", "tin"),
    ("aluminium",   "wear", "aluminium"),
    ("vanadium",    "wear", "vanadium"),
    ("sodium",      "contamination", "sodium"),
    ("silicon",     "contamination", "silicon"),
    ("water",       "contamination", "water_pct"),
    ("viscosity",   "physical", "viscosity_40c"),
    ("flash point", "physical", "flash_point"),
]


def _generate_summary_error(comments: Optional[str], chemistry: Dict[str, Any]) -> Optional[str]:
    """
    Scans the lab's free-text COMMENTS for element names it called out and
    pairs each with the corresponding extracted value (mirrors the Gulf
    extractor's diagnosis-driven alert summary).
    """
    if not comments:
        return None
    found = []
    seen = set()
    lowered = comments.lower()
    for keyword, category, key in _ALERT_KEYWORDS:
        if re.search(r"\b" + re.escape(keyword) + r"\b", lowered):
            val = chemistry.get(category, {}).get(key)
            if val is not None and key not in seen:
                found.append(f"{keyword.capitalize()} is {val}")
                seen.add(key)
    return " & ".join(found) if found else None


# ─── Main Extractor ──────────────────────────────────────────────────────────

def extract(pdf) -> Optional[Dict[str, Any]]:
    """
    Receives an open pdfplumber PDF object and returns the standard
    extracted-report dictionary used by luboil_report_processor.py.

    Returns None if this PDF cannot be identified as a Viswa Lab report.
    """
    if not pdf.pages:
        return None

    p0_text = pdf.pages[0].extract_text() or ""
    p0_lower = p0_text.lower()
    if "viswa lab" not in p0_lower and "theviswagroup" not in p0_lower:
        return None

    logger.info("Viswa Lab extractor activated.")

    metadata = {
        "vessel_name": None,
        "report_date": None,
        "lab_name":    "Viswa Lab",
        "oil_source":  "VISWA",
    }

    v_match = re.search(r"Vessel\s+(.+?)\s+NORMAL\b", p0_text, re.IGNORECASE)
    if v_match:
        metadata["vessel_name"] = v_match.group(1).strip()

    d_match = re.search(r"Report Date\s+(\S+)", p0_text, re.IGNORECASE)
    if d_match:
        metadata["report_date"] = _parse_date(d_match.group(1))

    machineries: List[Dict[str, Any]] = []
    seen_samples: set = set()

    for page_idx, page in enumerate(pdf.pages):
        text = page.extract_text() or ""
        if "lube oil trend report" not in text.lower():
            continue

        machine: Dict[str, Any] = {
            "page_index":        page_idx,
            "name":              None,
            "status":            "Normal",
            "summary_error":     None,
            "lube_analyst_code": None,
            "alerts":            [],
            "diagnosis":         None,
            "sample_info": {
                "date":            None,
                "number":          None,
                "hours_equipment": None,
                "hours_oil":       None,
            },
            "chemistry": {
                "wear":          {},
                "contamination": {},
                "additives":     {},
                "physical":      {},
            },
        }

        # ── Machine name ("Equipment ... OIL CONDITION") ──────────────────
        eq_m = re.search(r"Equipment\s+(.+?)\s+OIL CONDITION", text, re.IGNORECASE)
        machine["name"] = eq_m.group(1).strip() if eq_m else f"Unknown Equipment (p{page_idx + 1})"

        # ── Sample identity ────────────────────────────────────────────────
        report_id = _line_text_value(text, r"Report ID")
        if report_id:
            sample_no = re.sub(r"\s+", "", report_id)
            machine["sample_info"]["number"] = sample_no
            if sample_no in seen_samples:
                continue
            seen_samples.add(sample_no)

        sd_raw = _line_text_value(text, r"Sampling Date")
        if sd_raw:
            machine["sample_info"]["date"] = _parse_date(sd_raw)

        machine["sample_info"]["hours_equipment"] = _line_value(text, r"Unit Usage\s*\(hrs\)")
        machine["sample_info"]["hours_oil"] = _line_value(text, r"Total Lubricant hours")

        # ── Status ──────────────────────────────────────────────────────────
        rating_raw = _line_text_value(text, r"Oil Condition Rating")
        if rating_raw:
            r = rating_raw.strip().lower()
            if r in ("critical", "action"):
                machine["status"] = "Critical"
            elif r in ("caution", "warning", "attention"):
                machine["status"] = "Warning"
            else:
                machine["status"] = "Normal"

        # ── Diagnosis (COMMENTS block) ────────────────────────────────────
        comments_m = re.search(
            r"COMMENTS\s*\n(.+?)(?:\nTEST\s+Reference|\nGeneral\s+TEST)",
            text, re.DOTALL | re.IGNORECASE
        )
        comments_text = None
        if comments_m:
            comments_text = " ".join(comments_m.group(1).split())
            machine["diagnosis"] = comments_text

        # ── Chemistry Values ─────────────────────────────────────────────
        wear = machine["chemistry"]["wear"]
        cont = machine["chemistry"]["contamination"]
        adds = machine["chemistry"]["additives"]
        phys = machine["chemistry"]["physical"]

        wear["iron"]      = _line_value(text, r"Iron\s*-\s*ppm")
        wear["copper"]    = _line_value(text, r"Copper\s*-\s*ppm")
        wear["lead"]      = _line_value(text, r"Lead\s*-\s*ppm")
        wear["chromium"]  = _line_value(text, r"Chromium\s*-\s*ppm")
        wear["tin"]       = _line_value(text, r"Tin\s*-\s*ppm")
        wear["aluminium"] = _line_value(text, r"Aluminium\s*-\s*ppm")
        wear["nickel"]    = _line_value(text, r"Nickel\s*-\s*ppm")
        wear["vanadium"]  = _line_value(text, r"Vanadium\s*-\s*ppm")

        cont["water_pct"] = _line_value(text, r"Water\s*-\s*%")
        cont["sodium"]    = _line_value(text, r"Sodium\s*-\s*ppm")
        cont["silicon"]   = _line_value(text, r"Silicon\s*-\s*ppm")

        adds["calcium"]    = _line_value(text, r"Calcium\s*-\s*ppm")
        adds["zinc"]       = _line_value(text, r"Zinc\s*-\s*ppm")
        adds["phosphorus"] = _line_value(text, r"Phosphorus\s*-\s*ppm")
        adds["magnesium"]  = _line_value(text, r"Magnesium\s*-\s*ppm")
        adds["boron"]      = _line_value(text, r"Boron\s*-\s*ppm")
        adds["molybdenum"] = _line_value(text, r"Molybdenum\s*-\s*ppm")
        adds["barium"]     = _line_value(text, r"Barium\s*-\s*ppm")

        phys["viscosity_40c"] = _line_value(text, r"Viscosity\s*@\s*40.C")
        phys["flash_point"]   = _line_value(text, r"Flash Point\s*-\s*.C")
        phys["tbn"]           = _line_value(text, r"Total Base\s*-\s*mg")
        phys["tan"]           = _line_value(text, r"Total Acid\s*-\s*mg")

        # Filter out empty chemistry sub-dicts (matches Gulf extractor convention)
        machine["chemistry"] = {k: v for k, v in machine["chemistry"].items() if v}

        machine["summary_error"] = _generate_summary_error(comments_text, machine["chemistry"])

        machineries.append(machine)

    if not machineries:
        return None

    return {
        "metadata": metadata,
        "machineries": machineries
    }
