import pdfplumber
import re
import logging
import json
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Optional, BinaryIO

logger = logging.getLogger(__name__)

# ==========================================
# 1. HELPER FUNCTIONS
# ==========================================

def parse_date(date_str: str) -> Optional[str]:
    """
    Parses dates like '11/Oct/2025' or '11/10/2025' into 'YYYY-MM-DD'.
    """
    if not date_str: return None
    date_str = date_str.strip()

    formats = [
        "%d/%b/%Y",  # 11/Oct/2025
        "%d-%b-%y",  # 11-Oct-25
        "%d/%m/%Y",  # 11/10/2025
        "%d-%m-%Y",  # 11-10-2025
        "%Y-%m-%d"   # 2025-10-11
    ]

    for fmt in formats:
        try:
            return datetime.strptime(date_str, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def clean_number(value: Any) -> Optional[float]:
    """
    Cleans strings like '>190', '<0.1', '1,000' into pure floats.
    Returns None if invalid.
    """
    if value is None: return None
    if isinstance(value, (int, float)): return float(value)

    clean_str = re.sub(r'[^\d.-]', '', str(value))
    try:
        if not clean_str: return None
        return float(clean_str)
    except ValueError:
        return None


def extract_value_by_regex(text: str, pattern: str) -> Optional[float]:
    """
    Helper to find a number based on a Regex pattern.
    """
    match = re.search(pattern, text, re.IGNORECASE)
    if match:
        return clean_number(match.group(1))
    return None


def clean_machine_name(raw: str, vessel_name: str = None) -> str:
    """
    BUG FIX: Machine name lines in this PDF format include the full header row,
    e.g. "Main Engine - System GCL GANGA - 940097 OZELLAR GLOBAL PTE. LTD."
    This function strips the vessel code and everything that follows it,
    then removes any embedded vessel name.

    Examples:
      "Main Engine - System GCL GANGA - 940097 OZELLAR..."  → "Main Engine - System"
      "Stern Tube - Bearings and Seals  - 940097 OZELLAR..." → "Stern Tube - Bearings and Seals"
      "Auxiliary Diesel Engine No.1 - Crankcase "            → "Auxiliary Diesel Engine No.1 - Crankcase"
    """
    # Step 1: Remove vessel name substring if embedded in the string
    if vessel_name and vessel_name in raw:
        raw = raw.replace(vessel_name, "")

    # Step 2: Strip from " - NNNNN" (5-digit vessel code) onwards
    # This removes "- 940097 OZELLAR GLOBAL PTE. LTD." and any preceding spaces
    raw = re.sub(r'\s*-\s*\d{5,}.*$', '', raw)

    # Step 3: Strip trailing/leading whitespace and stray dashes
    raw = raw.strip(" -")

    return raw


def extract_alert_parameters(page) -> list:
    """
    Extracts alerted parameters by cross-referencing the Diagnosis text
    with chemistry table values.

    WHY THIS APPROACH:
    Shell LubeAnalyst PDFs contain NO stroke/border colors in their PDF structure. 
    The visual 'orange border box' is rendered purely from row fill colors.
    
    SOLUTION:
    Shell always explicitly mentions flagged parameters in the Diagnosis section.
    This function extracts values using full labels (including units) to ensure
    the UI displays the exact parameter name found in the report.
    """
    alerts = []
    text = page.extract_text() or ""

    # ── STEP 1: Extract chemistry values using FULL DISPLAY NAMES ──────────
    # The keys here are exactly what will be stored in your 'parameter' field.
    PARAM_PATTERNS = [
        # Contamination / Key Indices
        ("Index of Contamination (IC) %", r"Index of Contamination.*?%\s+([\d.<>]+)"),
        ("ISO 4407",                      r"ISO 4407\s+([\d/]+)"),
        ("WPI Index",                     r"WPI Index\s+([\d.<>]+)"),
        ("Demerit Point (DP)",            r"Demerit Point.*?\s+([\d.<>]+)"),
        ("Merit of Dispersancy (MD)",      r"Merit of Dispersancy.*?\s+([\d.<>]+)"),
        # Wear metals
        ("Iron (Fe) ppm",                 r"Iron \(Fe\) ppm\s+([\d.<>]+)"),
        ("Chromium (Cr) ppm",             r"Chromium \(Cr\) ppm\s+([\d.<>]+)"),
        ("Tin (Sn) ppm",                  r"Tin \(Sn\) ppm\s+([\d.<>]+)"),
        ("Lead (Pb) ppm",                 r"Lead \(Pb\) ppm\s+([\d.<>]+)"),
        ("Copper (Cu) ppm",               r"Copper \(Cu\) ppm\s+([\d.<>]+)"),
        ("Aluminium (Al) ppm",            r"Aluminium \(Al\) ppm\s+([\d.<>]+)"),
        ("Nickel (Ni) ppm",               r"Nickel \(Ni\) ppm\s+([\d.<>]+)"),
        ("Vanadium (V) ppm",              r"Vanadium \(V\) ppm\s+([\d.<>]+)"),
        ("Antimony (Sb) ppm",             r"Antimony \(Sb\) ppm\s+([\d.<>]+)"),
        # Physical
        ("TBN mg KOH/g",                  r"TBN.*?mg KOH/g\s+([\d.<>]+)"),
        ("TAN mg KOH/g",                  r"TAN.*?mg KOH/g\s+([\d.<>]+)"),
        ("Viscosity 100°C cSt",           r"Viscosity 100.*?cSt\s+([\d.<>]+)"),
        ("Viscosity 40°C cSt",            r"Viscosity 40.*?cSt\s+([\d.<>]+)"),
        # Contamination
        ("Water Content %",               r"Water Content.*?%\s+([\d.<>]+)"),
        ("Silicon (Si) ppm",              r"Silicon \(Si\) ppm\s+([\d.<>]+)"),
        ("Sodium (Na) ppm",               r"Sodium \(Na\) ppm\s+([\d.<>]+)"),
        ("Insolubles %",                  r"Insolubles.*?%\s+([<\d.]+)"),
    ]

    param_values = {}
    for name, pattern in PARAM_PATTERNS:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            # .group(1) ensures we get the string value, avoiding serialization errors
            param_values[name] = m.group(1).strip()

    # ── STEP 2: Isolate the Diagnosis section text only ───────────────────
    diag_match = re.search(
        r"Diagnosis\s+(.*?)\s+Sample Information",
        text,
        re.DOTALL | re.IGNORECASE
    )
    diagnosis = diag_match.group(1) if diag_match else text[:800]

    # ── STEP 3: Match diagnosis mentions → Map to FULL DISPLAY NAMES ──────
    # Rules: (regex in diagnosis) -> (exact key from PARAM_PATTERNS)
    DIAGNOSIS_RULES = [
        (r"\bLead\s*\(Pb\)",                    "Lead (Pb) ppm"),
        (r"ISO\s*4407|Particle\s*Counting",      "ISO 4407"),
        (r"\bIndex of Contamination\b|I\.C\.",  "Index of Contamination (IC) %"),
        (r"\bWPI\b",                             "WPI Index"),
        (r"\bDemerit Point\b|\bDP\b",            "Demerit Point (DP)"),
        (r"\bMerit of Dispersancy\b|\bMD\b",     "Merit of Dispersancy (MD)"),
        (r"\bTBN\b",                             "TBN mg KOH/g"),
        (r"\bTAN\b",                             "TAN mg KOH/g"),
        (r"\bIron\s*\(Fe\)",                     "Iron (Fe) ppm"),
        (r"\bCopper\s*\(Cu\)",                   "Copper (Cu) ppm"),
        (r"\bChromium\s*\(Cr\)",                 "Chromium (Cr) ppm"),
        (r"\bTin\s*\(Sn\)",                      "Tin (Sn) ppm"),
        (r"\bAluminium\s*\(Al\)",                "Aluminium (Al) ppm"),
        (r"\bNickel\s*\(Ni\)",                   "Nickel (Ni) ppm"),
        (r"\bVanadium\s*\(V\)",                  "Vanadium (V) ppm"),
        (r"\bWater Content\b|\bwater\b",         "Water Content %"),
        (r"\bViscosity\b",                       "Viscosity 100°C cSt"),
        (r"\bSilicon\s*\(Si\)",                  "Silicon (Si) ppm"),
        (r"\bSodium\s*\(Na\)",                   "Sodium (Na) ppm"),
        (r"\bInsolubles\b|\bsoot\b",             "Insolubles %"),
    ]

    seen = set()
    for pattern, full_param_name in DIAGNOSIS_RULES:
        if re.search(pattern, diagnosis, re.IGNORECASE):
            if full_param_name not in seen and full_param_name in param_values:
                alerts.append({
                    "parameter": full_param_name, # Stores e.g. "Lead (Pb) ppm"
                    "value": param_values[full_param_name]
                })
                seen.add(full_param_name)

    return alerts


# ==========================================
# 2. MAIN EXTRACTOR LOGIC
# ==========================================

def extract_lube_oil_report_data(pdf_file_stream: BinaryIO) -> Optional[Dict[str, Any]]:
    """
    Reads a Shell LubeAnalyst PDF stream and returns a structured dictionary.
    """
    logger.info("Starting Lube Oil PDF Extraction...")

    full_report = {
        "metadata": {
            "vessel_name": None,
            "report_date": None,
            "lab_name": "Shell LubeAnalyst",
            "oil_source": None
        },
        "machineries": []
    }

    try:
        with pdfplumber.open(pdf_file_stream) as pdf:

            # ── STEP A: GLOBAL METADATA (Page 1) ──────────────────────────
            if len(pdf.pages) > 0:
                p1_text = pdf.pages[0].extract_text() or ""
                
                header_text = p1_text.lower()
                if "shell lubeanalyst" in header_text or "shell" in header_text:
                    full_report['metadata']['lab_name'] = "Shell LubeAnalyst"
                    full_report['metadata']['oil_source'] = "SHELL"
                elif "castrol" in header_text or "labcheck" in header_text:
                    full_report['metadata']['lab_name'] = "Castrol Labcheck"
                    full_report['metadata']['oil_source'] = "CASTROL"
                elif "mobil" in header_text or "mobil serv" in header_text:
                    full_report['metadata']['lab_name'] = "Mobil Serv"
                    full_report['metadata']['oil_source'] = "MOBIL"
                else:
                    full_report['metadata']['oil_source'] = "UNKNOWN"

                # 1. EXTRACT VESSEL NAME
                # Strategy A: "Report Summary" Header (AM TARANG style)
                v_match = re.search(r"Report Summary\s*\n\s*(.*?)\s+-\s+(\d{5,})", p1_text, re.IGNORECASE)
                if v_match:
                    full_report['metadata']['vessel_name'] = v_match.group(1).strip()
                    full_report['metadata']['vessel_code'] = v_match.group(2).strip()

                # Strategy B: Fallback — "Name - 5+ Digit Code" on any line
                # Strategy B: Fallback — "Name - 5+ Digit Code" on any line
                if not full_report['metadata']['vessel_name']:
                    lines = p1_text.split('\n')
                    for line in lines:
                        # Look for text followed by a dash and a 5+ digit code
                        match = re.search(r"(.*?)\s+-\s+(\d{5,})", line)
                        if match:
                            candidate = match.group(1).strip()
                            
                            # FIX: pdfplumber sometimes merges columns like:
                            # "Stern Tube - Bearings and Seals AM KIRTI"
                            
                            # 1. Split by multiple spaces if they exist
                            if "  " in candidate:
                                candidate = candidate.split("  ")[-1].strip()
                                
                            # 2. Strip out merged equipment prefixes using regex
                            noise_pattern = r"(?i).*(?:bearings and seals|crankcase|system|filter|pump|crane|gear|winch|tube|engine)\s*"
                            candidate = re.sub(noise_pattern, "", candidate).strip()

                            bad_keywords = [
                                "Manufacturer", "Model", "LubeAnalyst", "Code",
                                "Site/Vessel", "Component", "Precision", "Crane",
                                "System", "Hydraulic", "Provision", "Registered", "Lubricant"
                            ]
                            if any(bad.lower() in candidate.lower() for bad in bad_keywords): 
                                continue
                            if len(candidate) < 3: 
                                continue
                                
                            full_report['metadata']['vessel_name'] = candidate
                            full_report['metadata']['vessel_code'] = match.group(2)
                            break
                            
                # 2. EXTRACT REPORT DATE
                # Strategy A: Standard Date Pattern (DD/MM/YYYY)
                dates = re.findall(r"(\d{2}/\d{2}/\d{4})", p1_text)
                if dates:
                    full_report['metadata']['report_date'] = parse_date(dates[-1])

                # Strategy B: "Sample Date 06/Nov/2025" style
                if not full_report['metadata']['report_date']:
                    s_date_match = re.search(
                        r"Sample Date\s+(\d{2}/[A-Za-z]{3}/\d{4})", p1_text, re.IGNORECASE
                    )
                    if s_date_match:
                        full_report['metadata']['report_date'] = parse_date(s_date_match.group(1))

            # ── STEP B: DETAIL PAGES SCAN ─────────────────────────────────
            for i, page in enumerate(pdf.pages):
                text = page.extract_text()
                if not text: continue
                if "Equipment - Component" not in text: continue

                machine = {
                    "page_index": i,
                    "name": None,
                    "status": "Unknown",
                    "summary_error": None,
                    "lube_analyst_code": None,
                    "alerts": [],
                    "diagnosis": None,
                    "sample_info": {
                        "date": None,
                        "number": None,
                        "hours_equipment": None,
                        "hours_oil": None
                    },
                    "chemistry": {
                        "wear": {},
                        "contamination": {},
                        "additives": {},
                        "physical": {}
                    }
                }

                # ── 1. EXTRACT MACHINERY NAME ──────────────────────────────
                lines = text.split('\n')
                name_found = False

                for idx, line in enumerate(lines):
                    if "Equipment - Component" in line:
                        for offset in range(1, 4):
                            if idx + offset < len(lines):
                                candidate = lines[idx + offset].strip()
                                bad_keywords = [
                                    "Site/Vessel", "Customer", "Manufacturer",
                                    "LubeAnalyst", "Sample Number"
                                ]
                                if candidate and not any(bad in candidate for bad in bad_keywords):
                                    # BUG FIX: Strip vessel code + customer text appended on same line
                                    machine['name'] = clean_machine_name(
                                        candidate,
                                        full_report['metadata']['vessel_name']
                                    )
                                    name_found = True
                                    break
                    if name_found: break

                # Fallback Regex if line parsing fails
                if not machine['name']:
                    fallback = re.search(r"Equipment - Component\s*\n(.*?)\n", text, re.DOTALL)
                    if fallback:
                        machine['name'] = clean_machine_name(
                            fallback.group(1).strip(),
                            full_report['metadata']['vessel_name']
                        )
                la_match = (
                    re.search(r"LubeAnalyst Code\s+(\d{6,}[A-Z0-9]*)", text) or
                    re.search(r"LubeAnalyst Code\s*\n\s*(\d{6,}[A-Z0-9]*)", text) or
                    re.search(r"LubeAnalyst Code\s*\n.*?\n\s*(\d{6,}[A-Z0-9]*)", text, re.DOTALL)
                )
                if la_match:
                    machine['lube_analyst_code'] = la_match.group(1).strip()
                    logger.info(f"   🔑 Lube Analyst Code: {machine['lube_analyst_code']}")
                else:
                    # Last resort: find any 6-digit code followed by letters near the header
                    header_section = text[:500]
                    fallback = re.search(r"\b(\d{6}[A-Z]\d{2})\b", header_section)
                    if fallback:
                        machine['lube_analyst_code'] = fallback.group(1).strip()
                        logger.info(f"   🔑 Lube Analyst Code (fallback): {machine['lube_analyst_code']}")
                    else:
                        logger.warning(f"   ⚠️ No Lube Analyst Code found on page {i}")
                # ── 2. EXTRACT STATUS & DIAGNOSIS ─────────────────────────
                header_text = text[:1000]
                if re.search(r"\bAction\b", header_text, re.IGNORECASE):
                    machine['status'] = "Critical"
                elif re.search(r"\bAttention\b", header_text, re.IGNORECASE):
                    machine['status'] = "Warning"
                elif re.search(r"\bNormal\b", header_text, re.IGNORECASE):
                    machine['status'] = "Normal"

                diag_match = re.search(r"Diagnosis\s+(.*?)\s+Sample Information", text, re.DOTALL)
                if diag_match:
                    machine['diagnosis'] = diag_match.group(1).replace('\n', ' ').strip()

                # ── ALERT & SUMMARY EXTRACTION ────────────────────────────
                found_alerts = extract_alert_parameters(page)
                machine['alerts'] = found_alerts

                if found_alerts:
                    # This joins all alerts with an '&' symbol
                    summary_parts = [f"{a['parameter']} is {a['value']}" for a in found_alerts]
                    machine['summary_error'] = " & ".join(summary_parts)
                elif machine['status'] != "Normal" and machine.get('diagnosis'):
                    # BUG FIX: Use regex split to avoid truncating at abbreviation dots
                    # e.g. "I.C." contains dots that .split('.')[0] would cut at incorrectly
                    first_sentence = re.split(r'\.\s+', machine['diagnosis'])[0]
                    machine['summary_error'] = first_sentence

                # ── 3. EXTRACT SAMPLE INFO ────────────────────────────────
                s_date = re.search(r"Sample Date\s+(\d{2}/\w{3}/\d{4})", text, re.IGNORECASE)
                if s_date: machine['sample_info']['date'] = parse_date(s_date.group(1))

                s_num = re.search(r"Sample Number\s+(\d+)", text)
                if s_num: machine['sample_info']['number'] = s_num.group(1)

                eq_life = re.search(r"Equipment Life\s+(\d+)", text)
                if eq_life: machine['sample_info']['hours_equipment'] = clean_number(eq_life.group(1))

                oil_life = re.search(r"Lubricant Life\s+(\d+)", text)
                if oil_life: machine['sample_info']['hours_oil'] = clean_number(oil_life.group(1))

                # ── 4. EXTRACT CHEMISTRY DATA ─────────────────────────────

                # A. Physical Properties
                phys = machine['chemistry']['physical']
                phys['viscosity_100c'] = extract_value_by_regex(text, r"Viscosity 100.*?C.*?\s+([\d.]+)")
                phys['viscosity_40c']  = extract_value_by_regex(text, r"Viscosity 40.*?C.*?\s+([\d.]+)")
                phys['flash_point']    = extract_value_by_regex(text, r"Flash Point.*?\s+([>\d.]+)")
                phys['tbn']            = extract_value_by_regex(text, r"TBN.*?mg KOH/g\s+([\d.]+)")
                phys['tan']            = extract_value_by_regex(text, r"TAN.*?mg KOH/g\s+([\d.]+)")

                # B. Wear Metals
                wear = machine['chemistry']['wear']
                wear['iron']      = extract_value_by_regex(text, r"Iron \(Fe\) ppm\s+([\d.]+)")
                wear['chromium']  = extract_value_by_regex(text, r"Chromium \(Cr\) ppm\s+([\d.]+)")
                wear['tin']       = extract_value_by_regex(text, r"Tin \(Sn\) ppm\s+([\d.]+)")
                wear['lead']      = extract_value_by_regex(text, r"Lead \(Pb\) ppm\s+([\d.]+)")
                wear['copper']    = extract_value_by_regex(text, r"Copper \(Cu\) ppm\s+([\d.]+)")
                wear['aluminium'] = extract_value_by_regex(text, r"Aluminium \(Al\) ppm\s+([\d.]+)")
                wear['vanadium']  = extract_value_by_regex(text, r"Vanadium \(V\) ppm\s+([\d.]+)")
                wear['nickel']    = extract_value_by_regex(text, r"Nickel \(Ni\) ppm\s+([\d.]+)")
                wear['antimony']  = extract_value_by_regex(text, r"Antimony \(Sb\) ppm\s+([\d.]+)")
                wear['wpi_index'] = extract_value_by_regex(text, r"WPI Index\s+([\d.]+)")

                # C. Contamination
                contam = machine['chemistry']['contamination']
                contam['water_pct'] = extract_value_by_regex(text, r"Water Content.*?%\s+([\d.]+)")
                contam['iso_4407'] = re.search(r"ISO 4407\s+([\d/]+)", text)
                contam['silicon']   = extract_value_by_regex(text, r"Silicon \(Si\) ppm\s+([\d.]+)")
                contam['sodium']    = extract_value_by_regex(text, r"Sodium \(Na\) ppm\s+([\d.]+)")
                contam['soot_pct']  = extract_value_by_regex(text, r"Insolubles.*?%\s+([<\d.]+)")
                contam['ic_index']  = extract_value_by_regex(text, r"Index of Contamination.*?%\s+([\d.]+)")
                iso_match = re.search(r"ISO 4407\s+([\d/]+)", text)
                if iso_match:
                    contam['iso_4407'] = iso_match.group(1) # Extract the string value
                else:
                    contam['iso_4407'] = None
                # D. Additives
                adds = machine['chemistry']['additives']
                adds['calcium']    = extract_value_by_regex(text, r"Calcium \(Ca\).*?%\s+([\d.]+)")
                adds['zinc']       = extract_value_by_regex(text, r"Zinc \(Zn\).*?%\s+([\d.]+)")
                adds['phosphorus'] = extract_value_by_regex(text, r"Phosphorus \(P\).*?%\s+([\d.]+)")
                adds['magnesium']  = extract_value_by_regex(text, r"Magnesium \(Mg\) ppm\s+([\d.]+)")
                adds['boron']      = extract_value_by_regex(text, r"Boron \(B\) ppm\s+([\d.]+)")
                adds['molybdenum'] = extract_value_by_regex(text, r"Molybdenum \(Mo\) ppm\s+([\d.]+)")
                adds['barium']     = extract_value_by_regex(text, r"Barium \(Ba\).*?%\s+([\d.]+)")
                
                
                if not full_report['metadata'].get('oil_source'):
                    mfg_line_match = re.search(r"Manufacturer\s*-\s*Model[^\n]*\n([^\n]+)", text, re.IGNORECASE)
                    
                    if mfg_line_match:
                        full_line = mfg_line_match.group(1).strip()
                        
                        # Split using the 6+ digit LubeAnalyst Code as the divider
                        parts = re.split(r'\s+\d{6,}[A-Z0-9]*\s+', full_line)
                        
                        if len(parts) > 1:
                            lubricant_string = parts[-1].strip() # Isolates "Shell - Melina S 30"
                            if lubricant_string and "Equipment" not in lubricant_string:
                                brand = lubricant_string.split('-')[0].strip().upper()
                                full_report['metadata']['oil_source'] = brand
                # ── 5. DEDUPLICATION & STORAGE ────────────────────────────
                if machine['name']:
                    exists = False
                    for existing in full_report['machineries']:
                        # CHANGE: Check both name AND sample number to allow multiple ME samples
                        if existing['name'] == machine['name'] and existing['sample_info']['number'] == machine['sample_info']['number']:
                            exists = True
                            # Only update if the existing one was missing data
                            if (not existing['chemistry']['wear'].get('iron') and machine['chemistry']['wear'].get('iron')):
                                existing.update(machine)
                            break
                    if not exists:
                        full_report['machineries'].append(machine)

        logger.info(
            f"Extracted {len(full_report['machineries'])} machineries "
            f"from {full_report['metadata']['vessel_name']}"
        )
        return full_report

    except Exception as e:
        logger.error(f"PDF Extraction Failed: {e}", exc_info=True)
        return None


# ==========================================
# TEST BLOCK (Run this file directly to test)
# ==========================================
if __name__ == "__main__":
    import sys
    import os

    test_pdf_path = "GCL GANGA -96.pdf"

    if os.path.exists(test_pdf_path):
        with open(test_pdf_path, "rb") as f:
            result = extract_lube_oil_report_data(f)

        if result:
            print(json.dumps(result, indent=2, default=str))
        else:
            print("Extraction failed.")
    else:
        print(f"Test file '{test_pdf_path}' not found.")