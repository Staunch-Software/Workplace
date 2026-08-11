"""
Tribocare Lube Oil PDF Extractor
====================================
Handles reports from Tribocare FZC.

Two PDF formats have been observed, and both are supported:

  Format A — "stacked summary" (original format this extractor was built for):
    - ALL machines are embedded on one physical page (usually page 1).
    - That page starts with a summary table, then each machine block starts
      with "VESSEL NAME [IMO]" followed by the machine name.
    - Chemistry layout: horizontal table with columns: [Alert Limit] [Label] [Current] [Prev1] [Prev2]
      e.g.  "109  KV@40°C[mm²/s]   81.39   100.4   100.4"
    - Splitting strategy: split that page's text by "VESSEL [IMO]" markers;
      block 1 is the summary table (skipped), blocks 2-N are machines.

  Format B — "one machine per physical page" (seen when a Tribocare page is
    mixed into an otherwise different-lab report, e.g. one machine sampled
    by Tribocare inside a mostly Gulf Marine report):
    - A single physical page is entirely self-contained: "VESSEL [IMO]" then
      "MACHINE NAME [COMPONENT]" on the next line, followed directly by that
      one machine's own table — no summary block to skip.
    - Same field layout/regex as Format A; the only difference is there is
      exactly one block on the page instead of a summary + N machines.

Both formats are detected per-page: a page whose text splits into more than
one "VESSEL [IMO]"-bounded block is Format A (summary + machines); a page
that mentions Tribocare but splits into exactly one block is Format B (that
whole page IS the one machine).
"""
import re
import logging
from datetime import datetime
from typing import Any, Dict, Optional, List, Tuple

logger = logging.getLogger(__name__)


# ─── Helpers ────────────────────────────────────────────────────────────────

def _parse_date(raw: str) -> Optional[str]:
    if not raw:
        return None
    raw = raw.strip().replace("­", "-").replace("\xad", "-")
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _clean_number(val: str) -> Optional[float]:
    """Strip limit symbols (<, >, *) and return float. Returns None if not numeric."""
    if val is None:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", str(val).replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _first_col(text: str, pattern: str) -> Optional[float]:
    """
    Tribocare chemistry rows look like:
      "109  KV@40°C[mm²/s]  81.39  100.4  100.4"
    We capture the FIRST data column (current sample) after the label.
    """
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        return _clean_number(m.group(1))
    return None


def _extract_machine_name(block: str) -> Optional[str]:
    """
    Parse the machine name from a block that starts with:
      "GCL SARASWATI [9644500]
       EMERGENCY DIESEL GENERATOR ENGINE [CRANKCASE & CYLINDERS]"
    Returns: "EMERGENCY DIESEL GENERATOR ENGINE (CRANKCASE & CYLINDERS)"
    """
    lines = block.strip().split('\n')
    # First line is the vessel line like "GCL SARASWATI [9644500]"
    # Second line is the machine name
    for line in lines[1:4]:
        line = line.strip()
        if not line:
            continue
        # Skip lines that look like lab name or manufacturer
        if any(kw in line.upper() for kw in ['TRIBOCARE', 'MANUFACTURER', 'PORT LANDED', 'FUEL GRADE']):
            break
        if line:
            # Convert bracket notation [COMPONENT] → (COMPONENT)
            cleaned = re.sub(r"\[([^\]]+)\]", r"(\1)", line)
            # Strip embedded model/serial numbers that break fuzzy matching
            # e.g. "MAIN ENGINE4078" → "MAIN ENGINE"
            # Must run AFTER bracket conversion so we don't strip from (SYSTEM)
            cleaned = re.sub(r'(?<=[A-Z])\d{3,}(?=\s|\(|$)', '', cleaned)
            # Collapse whitespace
            cleaned = " ".join(cleaned.split())
            return cleaned.strip() if cleaned else None
    return None


def _looks_like_tribocare_page(text: str) -> bool:
    """
    True if this page's text layer identifies it as a Tribocare report.

    Some report variants render the "TRIBOCARE" wordmark as a logo image
    rather than real text, so the literal word never appears in the text
    layer at all (confirmed on a real file: a self-contained single-machine
    Tribocare page with zero occurrences of "tribocare" as text). "Oil
    Rating:" + "Unit Rating:" narrative sections are a reliable structural
    fallback — Gulf uses "Recommendations :" and Viswa uses a "COMMENTS"
    block, so this combination is unique to Tribocare's report style either way.
    """
    t = text.lower()
    if "tribocare" in t:
        return True
    return "oil rating:" in t and "unit rating:" in t


def _visible_page(page):
    """
    Crops a page to its own visible area (0,0)-(width,height) before text
    extraction. Some reports in this pipeline author off-canvas content (a
    neighboring machine's block positioned outside the printable area) that
    a raw, uncropped extract_text() picks up anyway — see the matching
    docstring in gulf_extractor.py for the full explanation. Applying the
    same crop here keeps Tribocare pages consistent even if a given file
    turns out to use that layout too.
    """
    return page.crop((0, 0, page.width, page.height))


def _parse_tribocare_block(block: str, page_idx: int, seen_samples: set) -> Optional[Dict[str, Any]]:
    """
    Parses a single Tribocare machine block (unchanged field extraction
    logic) and tags it with the TRUE physical page index it came from, so
    the PDF-preview lookup in api.py shows the same page the data was
    extracted from.
    """
    # Only process blocks that have chemistry data (KV@) and machine header (Manufacturer)
    if "KV@" not in block and "Manufacturer" not in block:
        return None

    machine: Dict[str, Any] = {
        "page_index":        page_idx,
        "name":              None,
        "status":            "Normal",
        "summary_error":     None,
        "lube_analyst_code": None,   # Tribocare has no analyst code
        "alerts":            [],
        "diagnosis":         None,
        "sample_info": {
            "date":            None,
            "report_date":     None,
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

    # ── 1. Machine Name ───────────────────────────────────────────────────
    machine["name"] = _extract_machine_name(block)

    if not machine["name"]:
        logger.warning(f"  Tribocare page {page_idx}: could not extract machine name, skipping.")
        return None

    # This block's own analysis date, where present (Format B pages end with
    # "...Dated: 30-Jun-2026"). Format A blocks don't have this line — left
    # as None, and the caller falls back to the document-level report_date.
    dated_m = re.search(r"\bDated:\s*(\S+)", block, re.IGNORECASE)
    if dated_m:
        machine["sample_info"]["report_date"] = _parse_date(dated_m.group(1))

    # ── 2. Sample Details ─────────────────────────────────────────────────
    sno_m = re.search(r"Sample\s+No\s+(\d{5,})", block, re.IGNORECASE)
    if sno_m:
        sample_no = sno_m.group(1)
        machine["sample_info"]["number"] = sample_no
        if sample_no in seen_samples:
            logger.debug(f"  Duplicate sample {sample_no}, skipping block.")
            return None
        seen_samples.add(sample_no)

    # Sampled date (first column = current)
    sd_m = re.search(r"Sampled\s+Date\s+(\S+)", block, re.IGNORECASE)
    if sd_m:
        machine["sample_info"]["date"] = _parse_date(sd_m.group(1))

    # Machine hours
    th_m = re.search(r"Unit\s+Service\s+Hrs\s+([^\s]+)", block, re.IGNORECASE)
    if th_m and th_m.group(1).lower() != "not":
        machine["sample_info"]["hours_equipment"] = _clean_number(th_m.group(1))

    oh_m = re.search(r"Oil\s+Service\s+Hrs\s+([^\s]+)", block, re.IGNORECASE)
    if oh_m and oh_m.group(1).lower() != "not":
        machine["sample_info"]["hours_oil"] = _clean_number(oh_m.group(1))

    # ── 3. Status ─────────────────────────────────────────────────────────
    rating_m = re.search(r"\bRating\s+(Critical|Caution|Normal|Immediate Action|Can Continue)", block, re.IGNORECASE)
    if rating_m:
        raw_r = rating_m.group(1).strip().lower()
        if "critical" in raw_r or "immediate" in raw_r:
            machine["status"] = "Critical"
        elif "caution" in raw_r:
            machine["status"] = "Warning"
        else:
            machine["status"] = "Normal"

    # ── 4. Diagnosis ──────────────────────────────────────────────────────
    oil_m = re.search(r"Oil\s*Rating:\s*(.*?)(?=Unit\s*Rating:|Action:|Critical\s*Value|Standard\s*Test|$)", block, re.DOTALL | re.IGNORECASE)
    unit_m = re.search(r"Unit\s*Rating:\s*(.*?)(?=Action:|Critical\s*Value|Standard\s*Test|$)", block, re.DOTALL | re.IGNORECASE)
    act_m = re.search(r"Action:\s*(.*?)(?=Critical\s*Value|Dated:|Standard\s*Test|$)", block, re.DOTALL | re.IGNORECASE)

    diag_parts = []
    if oil_m and oil_m.group(1).strip():
        diag_parts.append(f"(a) Oil Rating: {oil_m.group(1).strip().replace(chr(10), ' ')}")
    if unit_m and unit_m.group(1).strip():
        diag_parts.append(f"(b) Unit Rating: {unit_m.group(1).strip().replace(chr(10), ' ')}")
    if act_m and act_m.group(1).strip():
        diag_parts.append(f"(c) Action: {act_m.group(1).strip().replace(chr(10), ' ')}")

    if diag_parts:
        machine["diagnosis"] = " ".join(diag_parts)
    else:
        rec_m = re.search(
            r"(?:Recommendation|Comments)\s*[:\s]+(.+?)(?=Action\s+Rating|Critical\s*Value|\Z)",
            block, re.DOTALL | re.IGNORECASE
        )
        if rec_m:
            machine["diagnosis"] = rec_m.group(1).replace("\n", " ").strip()[:800]

    # Note: summary_error is set later by _generate_alerts, which uses the
    # actual chemistry values for precise anomaly strings.

    # ── 5. Chemistry ──────────────────────────────────────────────────────
    phys = machine["chemistry"]["physical"]
    wear = machine["chemistry"]["wear"]
    cont = machine["chemistry"]["contamination"]
    adds = machine["chemistry"]["additives"]

    # Physical
    phys["viscosity_40c"]  = _first_col(block, r"KV@40[^\[]*\[mm[^\]]*\]\s+([<>]?[\d.]+)")
    phys["viscosity_100c"] = _first_col(block, r"KV@100[^\[]*\[mm[^\]]*\]\s+([<>]?[\d.]+)")
    phys["tbn"]            = _first_col(block, r"(?:BN|TBN|Base Number)\[mgKOH/g\]\s+([<>]?[\d.]+)")
    phys["tan"]            = _first_col(block, r"(?:AN|TAN|Acid Number)\[mgKOH/g\]\s+([<>]?[\d.]+)")
    phys["flash_point"]    = _first_col(block, r"Flash\s*Point\[.C\]\s+([<>]?[\d.]+)")
    iso_m = re.search(r"ISO\s*Code\s+([\d/]+)", block, re.IGNORECASE)
    if iso_m:
        phys["iso_4407"] = iso_m.group(1).strip()

    # Wear metals
    wear["iron"]      = _first_col(block, r"Iron\s*\(Fe\)\s+([<>]?[\d.]+)")
    wear["copper"]    = _first_col(block, r"Copper\s*\(Cu\)\s+([<>]?[\d.]+)")
    wear["chromium"]  = _first_col(block, r"Chromium\s*\(Cr\)\s+([<>]?[\d.]+)")
    wear["aluminium"] = _first_col(block, r"Aluminium\s*\(Al\)\s+([<>]?[\d.]+)")
    wear["lead"]      = _first_col(block, r"Lead\s*\(Pb\)\s+([<>]?[\d.]+)")
    wear["tin"]       = _first_col(block, r"Tin\s*\(Sn\)\s+([<>]?[\d.]+)")
    wear["nickel"]    = _first_col(block, r"Nickel\s*\(Ni\)\s+([<>]?[\d.]+)")
    wear["vanadium"]  = _first_col(block, r"Vanadium\s*\(V\)\s+([<>]?[\d.]+)")
    wear["antimony"]  = _first_col(block, r"Antimony\s*\(Sb\)\s+([<>]?[\d.]+)")
    wear["wpi_index"] = _first_col(block, r"PQ\s*Index[^\n]*\s+([<>]?[\d.]+)")

    # Contamination
    cont["water_pct"] = _first_col(block, r"Water\[%wt\]\s+([<>]?[\d.]+)")
    cont["soot_pct"]  = _first_col(block, r"Soot[/\\]?Insoluble\[%wt\]\s+([<>]?[\d.]+)")
    cont["sodium"]    = _first_col(block, r"Sodium\s*\(Na\)\s+([<>]?[\d.]+)")
    cont["silicon"]   = _first_col(block, r"Silicon\s*\(Si\)\s+([<>]?[\d.]+)")

    # Additives
    adds["molybdenum"] = _first_col(block, r"Molybdenum\s*\(Mo\)\s+([<>]?[\d.]+)")
    adds["barium"]     = _first_col(block, r"Barium\s*\(Ba\)\s+([<>]?[\d.]+)")
    adds["calcium"]    = _first_col(block, r"Calcium\s*\(Ca\)\s+([<>]?[\d.]+)")
    if adds["calcium"] is not None: adds["calcium"] = round(adds["calcium"] / 10000.0, 3)
    adds["zinc"]       = _first_col(block, r"Zinc\s*\(Zn\)\s+([<>]?[\d.]+)")
    if adds["zinc"] is not None: adds["zinc"] = round(adds["zinc"] / 10000.0, 3)
    adds["phosphorus"] = _first_col(block, r"Phosphorus\s*\(P\)\s+([<>]?[\d.]+)")
    if adds["phosphorus"] is not None: adds["phosphorus"] = round(adds["phosphorus"] / 10000.0, 3)
    adds["boron"]      = _first_col(block, r"Boron\s*\(B\)\s+([<>]?[\d.]+)")
    adds["magnesium"]  = _first_col(block, r"Magnesium\s*\(Mg\)\s+([<>]?[\d.]+)")

    # ── 6. Alerts (Smart Scan) ──────────────────────────────────────────────
    _generate_alerts(machine)

    logger.info(
        f"  Tribocare extracted: '{machine['name']}' | "
        f"Sample: {machine['sample_info']['number']} | "
        f"Status: {machine['status']} | "
        f"Iron: {wear.get('iron')} | Visc40: {phys.get('viscosity_40c')}"
    )
    return machine


# ─── Main Extractor ──────────────────────────────────────────────────────────

def extract(pdf) -> Optional[Dict[str, Any]]:
    """
    Receives an open pdfplumber PDF object and returns the standard
    extracted-report dictionary used by luboil_report_processor.py.

    Returns None if this PDF cannot be identified as containing any
    Tribocare report pages.

    Every page mentioning "tribocare" is inspected (not just page 1) since a
    Tribocare page can appear anywhere in a file that otherwise uses a
    different lab's format. Each such page is classified as either:
      - Format A: a "stacked summary" page (splits into a summary block plus
        multiple machine blocks) — parsed exactly as originally implemented.
      - Format B: a self-contained single-machine page (splits into exactly
        one block) — the whole page IS that one machine.
    """
    if not pdf.pages:
        return None

    tribocare_pages: List[Tuple[int, str]] = []
    for page_idx, page in enumerate(pdf.pages):
        t = _visible_page(page).extract_text() or ""
        if _looks_like_tribocare_page(t):
            tribocare_pages.append((page_idx, t))

    if not tribocare_pages:
        return None

    logger.info("Tribocare extractor activated.")

    # ── Global Metadata ───────────────────────────────────────────────────
    metadata = {
        "vessel_name": None,
        "report_date": None,
        "lab_name":    "Tribocare",
        "oil_source":  "TRIBOCARE",
    }

    # Title: "Summary Report for GCL SARASWATI [ 9644500 ] dated 02-Jul-2026"
    # (only present in Format A files — harmless no-op otherwise)
    for _, t in tribocare_pages:
        title_m = re.search(
            r"Summary Report for\s+(.+?)\s*\[\s*(\d+)\s*\]\s+dated\s+(\S+)",
            t, re.IGNORECASE
        )
        if title_m:
            metadata["vessel_name"] = title_m.group(1).strip()
            raw_date = title_m.group(3).replace("­", "-").replace("\xad", "-")
            metadata["report_date"] = _parse_date(raw_date)
            break

    vessel_name = metadata.get("vessel_name", "")

    # Build the split pattern dynamically using vessel name from metadata.
    # Fall back to a generic pattern if vessel name not found.
    if vessel_name:
        vessel_escaped = re.escape(vessel_name.upper())
        split_pattern = rf"(?=(?:{vessel_escaped})\s*\[\d+\])"
    else:
        # Generic: split on any "[DIGITS]" preceded by uppercase text
        split_pattern = r"(?=[A-Z][\w\s]+\[\d{7}\])"

    machineries: List[Dict] = []
    seen_samples: set = set()
    consumed_pages: set = set()

    # ── Format A: stacked summary + multiple machines on one page ──────────
    for page_idx, text in tribocare_pages:
        # Classify using a real per-machine anchor ("Manufacturer :" starts
        # each machine's block) rather than the split pattern itself: the
        # generic fallback split_pattern is deliberately loose (matches any
        # "UPPERCASE ... [7 digits]" span) and can fire on multiple
        # substrings of a single vessel/IMO header line alone (e.g. both
        # "AMNSI..." and "MAXIMUS..." before the same "[9628893]"), which
        # would misclassify a genuine single-machine page as Format A.
        manufacturer_count = len(re.findall(r"Manufacturer\s*:", text, re.IGNORECASE))
        if manufacturer_count <= 1:
            continue  # Not a stacked-summary page — left for Format B below.

        blocks = re.split(split_pattern, text)
        blocks = [b.strip() for b in blocks if b.strip()]
        if len(blocks) <= 1:
            continue

        consumed_pages.add(page_idx)
        logger.info(f"Tribocare page {page_idx}: found {len(blocks)} blocks (1 summary + {len(blocks)-1} machines)")

        machine_blocks = blocks[1:]  # block 0 is the summary table
        for block in machine_blocks:
            machine = _parse_tribocare_block(block, page_idx, seen_samples)
            if machine is not None:
                machineries.append(machine)

    # ── Format B: one self-contained machine per physical page ─────────────
    for page_idx, text in tribocare_pages:
        if page_idx in consumed_pages:
            continue
        machine = _parse_tribocare_block(text, page_idx, seen_samples)
        if machine is not None:
            machineries.append(machine)

    if not machineries:
        logger.warning("Tribocare extractor: no machine blocks found.")
        return None

    # Fallback: only if a machine's OWN block had no "Dated:" line, use the
    # document-level date captured in `metadata` — never overwrite a machine
    # that successfully read its own date.
    for machine in machineries:
        if not machine["sample_info"].get("report_date"):
            machine["sample_info"]["report_date"] = metadata.get("report_date")

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
