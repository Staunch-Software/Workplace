import re
import io
import logging
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger(__name__)

# ─── Helper Functions ────────────────────────────────────────────────────────

def _parse_date(date_str: str) -> Optional[str]:
    """
    Gulf dates can be like '19-Jan-25' (2-digit year) or '24-Apr-2026' (4-digit year).
    We try both formats and convert to YYYY-MM-DD for the database.
    """
    if not date_str or not date_str.strip():
        return None
    date_str = date_str.strip()
    for fmt in ("%d-%b-%y", "%d-%b-%Y"):
        try:
            dt = datetime.strptime(date_str, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _get_latest_column_index(text: str) -> int:
    """
    Finds the 'Sampled Date' line, parses all dates, and returns the 0-based index
    of the most recent date. If not found or error, defaults to -1 (last column).
    """
    for raw_line in text.splitlines():
        line = _strip_limit_annotations(raw_line)
        if re.search(r"Sampled? Date", line, re.IGNORECASE):
            m = re.search(r"Sampled? Date", line, re.IGNORECASE)
            after_label = line[m.end():].strip()
            tokens = after_label.split()
            if not tokens:
                return -1
            
            max_date = datetime.min
            max_idx = -1
            
            for i, token in enumerate(tokens):
                token = token.strip()
                parsed_dt = None
                for fmt in ("%d-%b-%y", "%d-%b-%Y"):
                    try:
                        parsed_dt = datetime.strptime(token, fmt)
                        break
                    except ValueError:
                        pass
                
                if parsed_dt and parsed_dt > max_date:
                    max_date = parsed_dt
                    max_idx = i
            
            if max_idx != -1:
                return max_idx
    return -1


def _clean_number(val: str) -> Optional[float]:
    if val is None:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _strip_limit_annotations(text: str) -> str:
    """
    Gulf PDFs prepend limit/threshold markers like `>160*` or `>40*` on the
    same line as the element label (e.g. '>160* Sodium (Na) 5 10 12').
    pdfplumber extracts these on the same line, so we strip them out before
    value extraction to avoid them being picked up as data values.
    Anchored to the start of the line to prevent destroying '<1' data values.
    """
    return re.sub(r'^\s*[<>]?\d+\*?\s+', '', text)


def _get_token_at_index(text: str, label_pattern: str, col_idx: int) -> Optional[str]:
    """
    Finds the label and returns the whitespace-separated token at `col_idx` ON THAT SAME LINE.
    If `col_idx` is out of bounds, returns the last token (-1).
    Operates line-by-line to prevent cross-line contamination.
    Strips Gulf limit annotations (>40*, >160*) before searching.
    """
    for raw_line in text.splitlines():
        line = _strip_limit_annotations(raw_line)
        if re.search(label_pattern, line, re.IGNORECASE):
            # Find position after the label
            m = re.search(label_pattern, line, re.IGNORECASE)
            after_label = line[m.end():].strip()
            tokens = after_label.split()
            if tokens:
                try:
                    return tokens[col_idx]
                except IndexError:
                    return tokens[-1]
    return None


def _regex_val(text: str, pattern: str, col_idx: int) -> Optional[float]:
    """
    Gulf PDF history columns go Left-to-Right (Oldest -> Newest).
    Searches line-by-line for a line that contains the label AND a numeric value
    on the SAME line, then returns the numeric token at `col_idx` (the Current sample).
    If `col_idx` is out of bounds, returns the last numeric token.

    This prevents cross-line matching: e.g. 'Sodium (Na)' at end of summary
    header line cannot bleed into the next line containing 'KV@40C'.
    """
    for raw_line in text.splitlines():
        line = _strip_limit_annotations(raw_line)
        m = re.search(pattern, line, re.IGNORECASE)
        if not m:
            continue
        # Extract the portion of the line after the match start (label + first value)
        after_label = line[m.start(1):].strip() if m.lastindex else line[m.end():].strip()
        tokens = re.findall(r'[<>]?\d*\.?\d+', after_label)
        if tokens:
            try:
                return _clean_number(tokens[col_idx])
            except IndexError:
                return _clean_number(tokens[-1])
    return None


def _build_machine_name(machinery_unit: str, sample_location: str) -> str:
    """
    Combines Gulf's 'Machinery Unit' + 'Sample Location' into a descriptive name.
    e.g. MAIN ENGINE + CRANKCASE → "MAIN ENGINE (CRANKCASE)"
    """
    unit = (machinery_unit or "").strip().upper()
    loc  = (sample_location or "").strip().upper()
    if loc and loc not in unit:
        return f"{unit} ({loc})"
    return unit


# ─── Main Extractor ──────────────────────────────────────────────────────────

def extract(pdf) -> Optional[Dict[str, Any]]:
    """
    Receives an open pdfplumber PDF object and returns the standard
    extracted-report dictionary used by luboil_report_processor.py.

    Strategy: Extract the FULL text from page 1 (which contains all machines),
    then split on "Equipment Information" boundaries to get each machine block.
    """
    if not pdf.pages:
        return None

    # ── Confirm this is a Gulf Marine PDF ─────────────────────────────────
    p0_text = pdf.pages[0].extract_text() or ""
    if "gulf marine" not in p0_text.lower():
        return None

    logger.info("Gulf Marine extractor activated.")

    # ── Global Metadata ───────────────────────────────────────────────────
    metadata = {
        "vessel_name": None,
        "report_date": None,
        "lab_name":    "Gulf Marine",
        "oil_source":  "GULF",
    }

    v_match = re.search(r"VESSEL NAME\s+(.+)", p0_text, re.IGNORECASE)
    if v_match:
        metadata["vessel_name"] = v_match.group(1).strip()

    d_match = re.search(r"REPORT DATE\s+(\S+)", p0_text, re.IGNORECASE)
    if d_match:
        metadata["report_date"] = _parse_date(d_match.group(1))

    # Fallback: "dated DD-Mon-YYYY" in the title line
    if not metadata["report_date"]:
        td = re.search(r"dated\s+(\d{2}[-/]\w{3}[-/]\d{4})", p0_text, re.IGNORECASE)
        if td:
            metadata["report_date"] = _parse_date(td.group(1))

    # ── Split full text into per-equipment blocks ─────────────────────────
    # "Equipment Information" appears once per machine in Gulf reports
    # We use it as the boundary between machines.
    blocks = re.split(r"(?=Equipment Information\s*\n)", p0_text)

    machineries: List[Dict] = []
    seen_samples: set = set()
    equipment_count = 0  # Tracks how many real equipment blocks we've processed

    for block_idx, block in enumerate(blocks):
        # Only process blocks that contain actual machinery data
        if "Machinery Unit" not in block or "Results" not in block:
            continue

        equipment_count += 1  # 1-based: 1 = first equipment block in PDF
        
        # DETERMINE WHICH COLUMN HAS THE LATEST DATE
        col_idx = _get_latest_column_index(block)

        machine: Dict[str, Any] = {
            "page_index":        equipment_count,  # Used to crop correct y-region from stacked PDF
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

        # ── 1. Machine name ───────────────────────────────────────────────
        unit_m = re.search(r"Machinery Unit\s+(.+?)(?:\n|Equipment S/N|$)", block, re.IGNORECASE)
        loc_m  = re.search(r"Sample Location\s+(.+?)(?:\n|$)", block, re.IGNORECASE)
        machinery_unit  = unit_m.group(1).strip() if unit_m else ""
        sample_location = loc_m.group(1).strip()  if loc_m  else ""
        machine["name"] = _build_machine_name(machinery_unit, sample_location)

        # ── 2. Sample metadata ────────────────────────────────────────────
        sample_no_raw = _get_token_at_index(block, r"Sample No", col_idx)
        if sample_no_raw:
            sample_no = re.sub(r'[^\w]', '', sample_no_raw) # Strip stray characters if any
            machine["sample_info"]["number"] = sample_no
            # Skip duplicates (same sample appearing in repeated page renders)
            if sample_no in seen_samples:
                continue
            seen_samples.add(sample_no)

        sd_raw = _get_token_at_index(block, r"Sampled Date", col_idx)
        if sd_raw:
            machine["sample_info"]["date"] = _parse_date(sd_raw)

        th_raw = _get_token_at_index(block, r"Total Machine Hours", col_idx)
        if th_raw:
            machine["sample_info"]["hours_equipment"] = _clean_number(th_raw)

        lh_raw = _get_token_at_index(block, r"Lubricant Hours", col_idx)
        if lh_raw:
            machine["sample_info"]["hours_oil"] = _clean_number(lh_raw)

        # ── 3. Status ─────────────────────────────────────────────────────
        cond_raw = _get_token_at_index(block, r"Lubricant Condition", col_idx)
        if cond_raw:
            raw_status = cond_raw.strip().lower()
            if raw_status == "critical":
                machine["status"] = "Critical"
            elif raw_status in ("caution", "warning"):
                machine["status"] = "Warning"
            else:
                machine["status"] = "Normal"

        # ── 4. Diagnosis ──────────────────────────────────────────────────
        # Capture from 'Recommendations :' until 'Lubricant Condition' (which is the footer) or end of block
        rec_m = re.search(r"Recommendations\s*:\s*(.+?)(?:\n\s*Lubricant Condition|\Z)", block, re.DOTALL | re.IGNORECASE)
        if rec_m:
            raw_diag = rec_m.group(1).replace("\n", " ").strip()
            # Strip PDF footer glossary and chart legends which falsely trigger alerts
            machine["diagnosis"] = re.split(r'\bKV@40|\bWear Elemental Analysis|\bOil Properties|\bPollutants|\bParameters Explanation', raw_diag, flags=re.IGNORECASE)[0].strip()

        # ── 5. Chemistry Values ───────────────────────────────────────────
        wear = machine["chemistry"]["wear"]
        cont = machine["chemistry"]["contamination"]
        adds = machine["chemistry"]["additives"]
        phys = machine["chemistry"]["physical"]

        # WEAR
        wear["iron"]      = _regex_val(block, r"Iron\s*\(Fe\)\s+([<>]?[\d.]+)", col_idx)
        wear["copper"]    = _regex_val(block, r"Copper\s*\(Cu\)\s+([<>]?[\d.]+)", col_idx)
        wear["lead"]      = _regex_val(block, r"Lead\s*\(Pb\)\s+([<>]?[\d.]+)", col_idx)
        wear["tin"]       = _regex_val(block, r"Tin\s*\(Sn\)\s+([<>]?[\d.]+)", col_idx)
        wear["chromium"]  = _regex_val(block, r"Chromium\s*\(Cr\)\s+([<>]?[\d.]+)", col_idx)
        wear["aluminium"] = _regex_val(block, r"Aluminium\s*\(Al\)\s+([<>]?[\d.]+)", col_idx)
        wear["nickel"]    = _regex_val(block, r"Nickel\s*\(Ni\)\s+([<>]?[\d.]+)", col_idx)
        wear["wpi_index"]  = _regex_val(block, r"PQ\s*Index/2ml\s+([<>]?[\d.]+)", col_idx)

        # CONTAMINATION
        cont["water_pct"] = _regex_val(block, r"Water\s*\[%wt\]\s+([<>]?[\d.]+)", col_idx)
        cont["soot_pct"]  = _regex_val(block, r"Soot/Insoluble\s*\[%wt\]\s+([<>]?[\d.]+)", col_idx)
        cont["sodium"]    = _regex_val(block, r"Sodium\s*\(Na\)\s+([<>]?[\d.]+)", col_idx)
        cont["silicon"]   = _regex_val(block, r"Silicon\s*\(Si\)\s+([<>]?[\d.]+)", col_idx)

        # ADDITIVES (Converted from ppm to %)
        adds["calcium"]    = _regex_val(block, r"Calcium\s*\(Ca\)\s+([<>]?[\d.]+)", col_idx)
        if adds["calcium"] is not None: adds["calcium"] = round(adds["calcium"] / 10000.0, 3)
        
        adds["zinc"]       = _regex_val(block, r"Zinc\s*\(Zn\)\s+([<>]?[\d.]+)", col_idx)
        if adds["zinc"] is not None: adds["zinc"] = round(adds["zinc"] / 10000.0, 3)
        
        adds["phosphorus"] = _regex_val(block, r"Phosphorus\s*\(P\)\s+([<>]?[\d.]+)", col_idx)
        if adds["phosphorus"] is not None: adds["phosphorus"] = round(adds["phosphorus"] / 10000.0, 3)
        
        adds["boron"]      = _regex_val(block, r"Boron\s*\(B\)\s+([<>]?[\d.]+)", col_idx)
        adds["magnesium"]  = _regex_val(block, r"Magnesium\s*\(Mg\)\s+([<>]?[\d.]+)", col_idx)

        # PHYSICAL
        phys["viscosity_40c"]  = _regex_val(block, r"KV@40\S+C\s*\[mm\S/s\]\s+([<>]?[\d.]+)", col_idx)
        phys["viscosity_100c"] = _regex_val(block, r"KV@100\S+C\s*\[mm\S/s\]\s+([<>]?[\d.]+)", col_idx)
        phys["tbn"]            = _regex_val(block, r"BN\s*\[mgKOH/g\]\s+([<>]?[\d.]+)", col_idx)
        phys["tan"]            = _regex_val(block, r"(?:TAN|AN|Acid Number)\s*\[mgKOH/g\]\s+([<>]?[\d.]+)", col_idx)

        # Some fields don't map cleanly to numeric _regex_val, e.g. Flash Point 'Pass'/'Fail'
        # Can leave as None or extend extraction if needed.

        # Filter out empty dicts
        machine["chemistry"] = {k: v for k, v in machine["chemistry"].items() if v}

        _generate_alerts(machine)
        machineries.append(machine)

    if not machineries:
        return None

    return {
        "metadata": metadata,
        "machineries": machineries
    }


def _generate_alerts(machine: Dict[str, Any]):
    diagnosis = machine.get("diagnosis")
    if not diagnosis:
        return
        
    DIAGNOSIS_RULES = [
        (r"\bLead(?:\s*\(Pb\))?",               "Lead (Pb) ppm", "wear", "lead"),
        (r"ISO\s*4407|ISO\s*Code|Particulate?\s*count", "ISO Code", "physical", "iso_4407"),
        (r"\bIndex of Contamination\b|I\.C\.",  "Index of Contamination (IC) %", "contamination", "ic"),
        (r"\bWPI\b|PQ\s*Index",                  "WPI Index", "wear", "wpi_index"),
        (r"\bTBN\b|\bBN\b",                      "TBN mg KOH/g", "physical", "tbn"),
        (r"\bTAN\b|\bAN\b",                      "TAN mg KOH/g", "physical", "tan"),
        (r"\bIron(?:\s*\(Fe\))?",                "Iron (Fe) ppm", "wear", "iron"),
        (r"\bCopper(?:\s*\(Cu\))?",              "Copper (Cu) ppm", "wear", "copper"),
        (r"\bChromium(?:\s*\(Cr\))?",            "Chromium (Cr) ppm", "wear", "chromium"),
        (r"\bTin(?:\s*\(Sn\))?",                 "Tin (Sn) ppm", "wear", "tin"),
        (r"\bAluminium(?:\s*\(Al\))?",           "Aluminium (Al) ppm", "wear", "aluminium"),
        (r"\bNickel(?:\s*\(Ni\))?",              "Nickel (Ni) ppm", "wear", "nickel"),
        (r"\bVanadium(?:\s*\(V\))?",             "Vanadium (V) ppm", "wear", "vanadium"),
        (r"\bWater\b",                           "Water Content %", "contamination", "water_pct"),
        (r"\bViscosity\b|KV@40",                 "Viscosity 40°C cSt", "physical", "viscosity_40c"),
        (r"\bViscosity\b|KV@100",                "Viscosity 100°C cSt", "physical", "viscosity_100c"),
        (r"\bFlash\s*Point\b",                   "Flash Point °C", "physical", "flash_point"),
        (r"\bSilicon(?:\s*\(Si\))?",             "Silicon (Si) ppm", "contamination", "silicon"),
        (r"\bSodium(?:\s*\(Na\))?",              "Sodium (Na) ppm", "contamination", "sodium"),
        (r"\bInsolubles\b|\bincreased soot\b|\bhigh soot\b|\bsoot level\b", "Insolubles %", "contamination", "soot_pct"),
        (r"\bAntimony(?:\s*\(Sb\))?",            "Antimony (Sb) ppm", "wear", "antimony"),
    ]
    
    seen = set()
    found_alerts = []
    for pattern, display_name, category, key in DIAGNOSIS_RULES:
        if re.search(pattern, diagnosis, re.IGNORECASE):
            val = machine.get("chemistry", {}).get(category, {}).get(key)
            if val is not None and display_name not in seen:
                found_alerts.append(f"{display_name} is {val}")
                seen.add(display_name)
                
    if found_alerts:
        machine["summary_error"] = " & ".join(found_alerts)
    elif machine["status"] != "Normal" and diagnosis:
        # Fallback to first sentence if no specific anomalies matched
        machine["summary_error"] = re.split(r'\.\s+', diagnosis)[0]
