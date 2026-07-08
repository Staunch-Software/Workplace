"""
Gulf Marine Lube Oil PDF Extractor
====================================
Handles reports from Gulf Marine Pte Ltd.

PDF Format (observed):
  - All 10 equipment blocks are stacked vertically in one long document.
  - pdfplumber renders this as 12 repeated physical pages (all same content).
  - The CORRECT approach: extract the full text ONCE from page 1, then split
    on "Equipment Information" boundary markers to find each machine block.

Each block looks like:
  Equipment Information
  ...
  Machinery Unit   MAIN ENGINE
  Sample Location  CRANKCASE
  Sample No        26047483
  Sampled Date     04-Jun-26
  Total Machine Hours  96542
  Lubricant Hours      96542
  Lubricant Condition  Normal
  Results
  Analysis
  KV@40°C [mm²/s]   107.8
  KV@100°C [mm²/s]  11.98
  BN [mgKOH/g]      8.0
  Iron (Fe)          5
  ...
  Recommendations :
  The oil is fit for further use...
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
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _clean_number(val: str) -> Optional[float]:
    if val is None:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _regex_val(text: str, pattern: str) -> Optional[float]:
    m = re.search(pattern, text, re.IGNORECASE)
    return _clean_number(m.group(1)) if m else None


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
        sno_m = re.search(r"Sample No\s+(\d+)", block, re.IGNORECASE)
        if sno_m:
            sample_no = sno_m.group(1)
            machine["sample_info"]["number"] = sample_no
            # Skip duplicates (same sample appearing in repeated page renders)
            if sample_no in seen_samples:
                continue
            seen_samples.add(sample_no)

        sd_m = re.search(r"Sampled Date\s+(\S+)", block, re.IGNORECASE)
        if sd_m:
            machine["sample_info"]["date"] = _parse_date(sd_m.group(1))

        th_m = re.search(r"Total Machine Hours\s+([\d,]+)", block, re.IGNORECASE)
        if th_m:
            machine["sample_info"]["hours_equipment"] = _clean_number(th_m.group(1).replace(",", ""))

        lh_m = re.search(r"Lubricant Hours\s+([\d,]+)", block, re.IGNORECASE)
        if lh_m:
            machine["sample_info"]["hours_oil"] = _clean_number(lh_m.group(1).replace(",", ""))

        # ── 3. Status ─────────────────────────────────────────────────────
        cond_m = re.search(r"Lubricant Condition\s+(\w+)", block, re.IGNORECASE)
        if cond_m:
            raw_status = cond_m.group(1).strip().lower()
            if raw_status == "critical":
                machine["status"] = "Critical"
            elif raw_status in ("caution", "warning"):
                machine["status"] = "Warning"
            else:
                machine["status"] = "Normal"

        # ── 4. Diagnosis ──────────────────────────────────────────────────
        rec_m = re.search(r"Recommendations\s*:\s*(.+?)(?:\n\n|\Z)", block, re.DOTALL | re.IGNORECASE)
        if rec_m:
            machine["diagnosis"] = rec_m.group(1).replace("\n", " ").strip()[:300]

        if machine["status"] != "Normal" and machine["diagnosis"]:
            machine["summary_error"] = machine["diagnosis"][:200]

        # ── 5. Chemistry ──────────────────────────────────────────────────
        phys = machine["chemistry"]["physical"]
        wear = machine["chemistry"]["wear"]
        cont = machine["chemistry"]["contamination"]
        adds = machine["chemistry"]["additives"]

        # Physical
        phys["viscosity_40c"]  = _regex_val(block, r"KV@40[°C\s\u00b0]+\[mm[²2]/s\]\s+([<>]?[\d.]+)")
        phys["viscosity_100c"] = _regex_val(block, r"KV@100[°C\s\u00b0]+\[mm[²2]/s\]\s+([<>]?[\d.]+)")
        phys["tbn"]            = _regex_val(block, r"(?:\bTBN\b|\bBN\b|\bBase Number\b)(?:\(.*?\)|\[.*?\]|[^\d\n])*([<>]?[0-9]*\.[0-9]+|[<>]?[0-9]+)")
        phys["tan"]            = _regex_val(block, r"(?:\bTAN\b|\bAN\b|\bAcid Number\b)(?:\(.*?\)|\[.*?\]|[^\d\n])*([<>]?[0-9]*\.[0-9]+|[<>]?[0-9]+)")
        fp_m = re.search(r"Flash Point\s*\[.C\]\s+([<>]?[\d.A-Za-z]+)", block, re.IGNORECASE)
        if fp_m:
            phys["flash_point"] = _clean_number(fp_m.group(1))

        # Wear metals
        wear["iron"]      = _regex_val(block, r"Iron\s*\(Fe\)\s+([<>]?[\d.]+)")
        wear["copper"]    = _regex_val(block, r"Copper\s*\(Cu\)\s+([<>]?[\d.]+)")
        wear["chromium"]  = _regex_val(block, r"Chromium\s*\(Cr\)\s+([<>]?[\d.]+)")
        wear["aluminium"] = _regex_val(block, r"Aluminium\s*\(Al\)\s+([<>]?[\d.]+)")
        wear["lead"]      = _regex_val(block, r"Lead\s*\(Pb\)\s+([<>]?[\d.]+)")
        wear["tin"]       = _regex_val(block, r"Tin\s*\(Sn\)\s+([<>]?[\d.]+)")
        wear["nickel"]    = _regex_val(block, r"Nickel\s*\(Ni\)\s+([<>]?[\d.]+)")
        wear["vanadium"]  = _regex_val(block, r"Vanadium\s*\(V\)\s+([<>]?[\d.]+)")
        wear["antimony"]  = _regex_val(block, r"Antimony\s*\(Sb\)\s+([<>]?[\d.]+)")
        pq_m = re.search(r"PQ Index.*?\s+([<>]?[\d.]+)", block, re.IGNORECASE)
        if pq_m:
            wear["wpi_index"] = _clean_number(pq_m.group(1))


        # Contamination
        cont["water_pct"] = _regex_val(block, r"Water\s*\[%wt\]\s+([<>]?[\d.]+)")
        cont["soot_pct"]  = _regex_val(block, r"Soot/Insoluble\s*\[%wt\]\s+([<>]?[\d.]+)")
        cont["sodium"]    = _regex_val(block, r"Sodium\s*\(Na\)\s+([<>]?[\d.]+)")
        cont["silicon"]   = _regex_val(block, r"Silicon\s*\(Si\)\s+([<>]?[\d.]+)")

        # Additives
        adds["molybdenum"] = _regex_val(block, r"Molybdenum\s*\(Mo\)\s+([<>]?[\d.]+)")
        adds["barium"]     = _regex_val(block, r"Barium\s*\(Ba\)\s+([<>]?[\d.]+)")
        adds["calcium"]    = _regex_val(block, r"Calcium\s*\(Ca\)\s+([<>]?[\d.]+)")
        if adds["calcium"] is not None: adds["calcium"] = round(adds["calcium"] / 10000.0, 3)
        adds["zinc"]       = _regex_val(block, r"Zinc\s*\(Zn\)\s+([<>]?[\d.]+)")
        if adds["zinc"] is not None: adds["zinc"] = round(adds["zinc"] / 10000.0, 3)
        adds["phosphorus"] = _regex_val(block, r"Phosphorus\s*\(P\)\s+([<>]?[\d.]+)")
        if adds["phosphorus"] is not None: adds["phosphorus"] = round(adds["phosphorus"] / 10000.0, 3)
        adds["boron"]      = _regex_val(block, r"Boron\s*\(B\)\s+([<>]?[\d.]+)")
        adds["magnesium"]  = _regex_val(block, r"Magnesium\s*\(Mg\)\s+([<>]?[\d.]+)")


        # ── 6. Alerts (Smart Scan) ────────────────────────────────────────
        _generate_alerts(machine)

        # ── 7. Store ──────────────────────────────────────────────────────
        if machine["name"]:
            machineries.append(machine)
            logger.info(
                f"  Gulf extracted: '{machine['name']}' | "
                f"Sample {machine['sample_info']['number']} | "
                f"Iron: {wear.get('iron')} | Visc40: {phys.get('viscosity_40c')}"
            )

    if not machineries:
        logger.warning("Gulf extractor: no equipment blocks found in full text.")
        return None

    return {"metadata": metadata, "machineries": machineries}


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
        (r"\bViscosity\b",                       "Viscosity 40°C cSt", "physical", "viscosity_40c"),
        (r"\bViscosity\b",                       "Viscosity 100°C cSt", "physical", "viscosity_100c"),
        (r"\bFlash\s*Point\b",                   "Flash Point °C", "physical", "flash_point"),
        (r"\bSilicon(?:\s*\(Si\))?",             "Silicon (Si) ppm", "contamination", "silicon"),
        (r"\bSodium(?:\s*\(Na\))?",              "Sodium (Na) ppm", "contamination", "sodium"),
        (r"\bInsolubles\b|\bsoot\b",             "Insolubles %", "contamination", "soot_pct"),
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
