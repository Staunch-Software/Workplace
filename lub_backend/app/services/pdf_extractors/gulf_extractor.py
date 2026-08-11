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


def _extract_own_report_date(text: str) -> Optional[str]:
    """
    Reads THIS page's own "Report Date" line from its Equipment Information
    header. Unlike Sampled Date, Report Date is a single value per page (not
    a per-sample-column value), so plain regex is enough — no column
    matching needed.

    Confirmed on a real file that this genuinely varies page-to-page within
    one PDF: every Gulf page said "Report Date 25-Mar-2026" except the Main
    Engine System page, which said "Report Date 19-Feb-2026". Each machine
    must read its own value rather than assume one date applies document-wide.
    """
    m = re.search(r"REPORT DATE\s+(\S+)", text, re.IGNORECASE)
    if m:
        parsed = _parse_date(m.group(1))
        if parsed:
            return parsed
    td = re.search(r"dated\s+(\d{2}[-/]\w{3}[-/]\d{4})", text, re.IGNORECASE)
    if td:
        return _parse_date(td.group(1))
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


# ─── Position-based column matching ──────────────────────────────────────────
# Gulf tables can have blank/missing history columns (e.g. a report with only
# 2 of 4 sample slots populated). The whitespace-token approach above assumes
# every row has as many tokens as the header has columns — a blank cell means
# no token at all, which silently shifts every later column's value left by
# one. These helpers instead read each value's physical (x, y) position on
# the page and match it to the nearest sample-column anchor, so a missing
# cell is correctly recorded as missing instead of corrupting later columns.

_NUM_RE    = re.compile(r'^[<>]?\d+\.?\d*$')
_DATE_RE   = re.compile(r'^\d{1,2}-[A-Za-z]{3}-\d{2,4}$')
_STATUS_RE = re.compile(r'^(Normal|Critical|Caution|Warning)$', re.IGNORECASE)


def _visible_page(page):
    """
    Crops a page to its own visible area (0,0)-(width,height).

    This PDF format authors each report as one tall canvas per physical
    page, with the *next* machine's block positioned far outside the visible
    print area (word 'top' coordinates observed ranging from -5879 to +3728
    on an 842-tall page) rather than on a separate page object. Reading
    words/text WITHOUT cropping pulls in every other machine's off-page
    content too — this is the literal mechanism behind "the PDF visually
    shows one machine but the text layer returns a different one": the raw
    text layer contains far more than what's printed on that page. Cropping
    to the visible bbox first restores 1 page ≈ 1 machine.
    """
    return page.crop((0, 0, page.width, page.height))


def _extract_word_rows(page) -> List[List[Dict]]:
    """
    Groups a page's words (each with x0/x1/top/bottom from pdfplumber) into
    visual rows by their vertical position, ordered left-to-right within each
    row. This preserves true column position, unlike extract_text() which
    flattens everything into a single string with no coordinates.
    """
    page = _visible_page(page)
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    words.sort(key=lambda w: (w['top'], w['x0']))
    rows: List[List[Dict]] = []
    for w in words:
        if rows and abs(w['top'] - rows[-1][0]['top']) <= 4.0:
            rows[-1].append(w)
        else:
            rows.append([w])
    for row in rows:
        row.sort(key=lambda w: w['x0'])
    return rows


def _rows_matching(rows: List[List[Dict]], label_pattern: str) -> List[List[Dict]]:
    """
    Returns ALL rows whose text matches label_pattern — not just the first.
    Gulf pages repeat some labels (e.g. a "Lubricant Condition" banner at the
    page header/footer showing a single overall word, plus the real per-
    sample-column table row further down). Taking only the first match can
    silently grab the banner instead of the table row it looks identical to.
    """
    matches = []
    for row in rows:
        text = " ".join(w['text'] for w in row)
        if re.search(label_pattern, text, re.IGNORECASE):
            matches.append(row)
    return matches


def _nearest_token(rows: List[List[Dict]], label_pattern: str, target_x: float,
                    token_re: "re.Pattern", tolerance: float) -> Optional[str]:
    """
    Among all tokens matching `token_re` in ANY row matching `label_pattern`,
    returns the one physically closest to target_x (within `tolerance`).
    Searching across every matching row — not just the first — is what makes
    this immune to duplicate/banner rows: a banner's single word is far from
    the real table column's x position and loses on distance.
    """
    best_txt, best_dist = None, None
    for row in _rows_matching(rows, label_pattern):
        for w in row:
            txt = w['text'].strip()
            if not token_re.match(txt):
                continue
            xc = (w['x0'] + w['x1']) / 2.0
            dist = abs(xc - target_x)
            if dist <= tolerance and (best_dist is None or dist < best_dist):
                best_txt, best_dist = txt, dist
    return best_txt


def _column_target_x(rows: List[List[Dict]]) -> Optional[float]:
    """
    Finds the 'Sampled Date' row(s) and returns the x-center of whichever
    date column holds the most recent date — the physical position of the
    sample column we should extract values from.
    """
    best_x, best_date = None, datetime.min
    for row in _rows_matching(rows, r"Sampled?\s*Date"):
        for w in row:
            txt = w['text'].strip()
            if _DATE_RE.match(txt):
                dt = None
                for fmt in ("%d-%b-%y", "%d-%b-%Y"):
                    try:
                        dt = datetime.strptime(txt, fmt)
                        break
                    except ValueError:
                        pass
                if dt and dt > best_date:
                    best_date = dt
                    best_x = (w['x0'] + w['x1']) / 2.0
    return best_x


def _avg_column_spacing(rows: List[List[Dict]]) -> float:
    """Estimates typical column width from the Sampled Date row(s), for a sane match tolerance."""
    centers = []
    for row in _rows_matching(rows, r"Sampled?\s*Date"):
        centers.extend((w['x0'] + w['x1']) / 2.0 for w in row if _DATE_RE.match(w['text'].strip()))
    centers = sorted(set(round(c, 1) for c in centers))
    if len(centers) < 2:
        return 30.0
    diffs = [b - a for a, b in zip(centers, centers[1:])]
    return max(min(diffs) / 2.0, 15.0)


def _parse_block_by_position(page, page_text: str, page_idx: int, seen_samples: set) -> Optional[Dict[str, Any]]:
    """
    Parses a single Gulf equipment block using each value's physical (x, y)
    position on the page, so blank history columns can never shift a later
    column's value into the wrong place. Used when exactly one machine
    occupies this physical page (the common case observed in practice).
    """
    rows = _extract_word_rows(page)
    target_x = _column_target_x(rows)
    tol = _avg_column_spacing(rows)

    if target_x is None:
        # No usable date column found positionally — fall back to the
        # proven token-counting parser rather than silently dropping data.
        return _parse_block_by_tokens(page_text, page_idx, seen_samples)

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

    # ── 1. Machine name (single value per line — no column ambiguity) ──────
    unit_m = re.search(r"Machinery Unit\s+(.+?)(?:\n|Equipment S/N|$)", page_text, re.IGNORECASE)
    loc_m  = re.search(r"Sample Location\s+(.+?)(?:\n|$)", page_text, re.IGNORECASE)
    machinery_unit  = unit_m.group(1).strip() if unit_m else ""
    sample_location = loc_m.group(1).strip()  if loc_m  else ""
    machine["name"] = _build_machine_name(machinery_unit, sample_location)

    # This page's OWN Report Date — see _extract_own_report_date's docstring
    # for why this can't be assumed to match the document's other pages.
    machine["sample_info"]["report_date"] = _extract_own_report_date(page_text)

    # ── 2. Sample metadata (position-matched) ───────────────────────────────
    sample_no_raw = _nearest_token(rows, r"Sample\s*No", target_x, _NUM_RE, tol)
    if sample_no_raw:
        sample_no = re.sub(r'[^\w]', '', sample_no_raw)
        machine["sample_info"]["number"] = sample_no
        if sample_no in seen_samples:
            return None
        seen_samples.add(sample_no)

    sd_raw = _nearest_token(rows, r"Sampled?\s*Date", target_x, _DATE_RE, tol)
    if sd_raw:
        machine["sample_info"]["date"] = _parse_date(sd_raw)

    th_raw = _nearest_token(rows, r"Total Machine Hours", target_x, _NUM_RE, tol)
    if th_raw:
        machine["sample_info"]["hours_equipment"] = _clean_number(th_raw)

    lh_raw = _nearest_token(rows, r"Lubricant Hours", target_x, _NUM_RE, tol)
    if lh_raw:
        machine["sample_info"]["hours_oil"] = _clean_number(lh_raw)

    # ── 3. Status (position-matched, non-numeric token) ─────────────────────
    # Searches across all "Lubricant Condition" rows (there can be a banner
    # plus the real per-column table row) and picks the token nearest the
    # target column — see _nearest_token's docstring.
    cond_raw = _nearest_token(rows, r"Lubricant Condition", target_x, _STATUS_RE, tol)
    if cond_raw:
        raw_status = cond_raw.strip().lower()
        if raw_status == "critical":
            machine["status"] = "Critical"
        elif raw_status in ("caution", "warning"):
            machine["status"] = "Warning"
        else:
            machine["status"] = "Normal"

    # ── 4. Diagnosis (free text, unaffected by column layout) ───────────────
    # Gulf PDFs are inconsistent about the colon after "Recommendations" —
    # some pages print "Recommendations:" and others just "Recommendations"
    # on its own line — so the colon must be optional here.
    rec_m = re.search(r"Recommendations\s*:?\s*(.+?)(?:\n\s*Lubricant Condition|\Z)", page_text, re.DOTALL | re.IGNORECASE)
    if rec_m:
        raw_diag = rec_m.group(1).replace("\n", " ").strip()
        machine["diagnosis"] = re.split(r'\bKV@40|\bWear Elemental Analysis|\bOil Properties|\bPollutants|\bParameters Explanation', raw_diag, flags=re.IGNORECASE)[0].strip()

    # ── 5. Chemistry values (position-matched) ──────────────────────────────
    wear = machine["chemistry"]["wear"]
    cont = machine["chemistry"]["contamination"]
    adds = machine["chemistry"]["additives"]
    phys = machine["chemistry"]["physical"]

    def val(label_pattern: str) -> Optional[float]:
        raw = _nearest_token(rows, label_pattern, target_x, _NUM_RE, tol)
        return _clean_number(raw)

    wear["iron"]      = val(r"Iron\s*\(Fe\)")
    wear["copper"]    = val(r"Copper\s*\(Cu\)")
    wear["lead"]      = val(r"Lead\s*\(Pb\)")
    wear["tin"]       = val(r"Tin\s*\(Sn\)")
    wear["chromium"]  = val(r"Chromium\s*\(Cr\)")
    wear["aluminium"] = val(r"Aluminium\s*\(Al\)")
    wear["nickel"]    = val(r"Nickel\s*\(Ni\)")
    wear["wpi_index"] = val(r"PQ\s*Index/2ml")

    cont["water_pct"] = val(r"Water\s*\[%wt\]")
    cont["soot_pct"]  = val(r"Soot/Insoluble\s*\[%wt\]")
    cont["sodium"]    = val(r"Sodium\s*\(Na\)")
    cont["silicon"]   = val(r"Silicon\s*\(Si\)")

    adds["calcium"] = val(r"Calcium\s*\(Ca\)")
    if adds["calcium"] is not None: adds["calcium"] = round(adds["calcium"] / 10000.0, 3)

    adds["zinc"] = val(r"Zinc\s*\(Zn\)")
    if adds["zinc"] is not None: adds["zinc"] = round(adds["zinc"] / 10000.0, 3)

    adds["phosphorus"] = val(r"Phosphorus\s*\(P\)")
    if adds["phosphorus"] is not None: adds["phosphorus"] = round(adds["phosphorus"] / 10000.0, 3)

    adds["boron"]     = val(r"Boron\s*\(B\)")
    adds["magnesium"] = val(r"Magnesium\s*\(Mg\)")

    phys["viscosity_40c"]  = val(r"KV@40\S+C\s*\[mm\S/s\]")
    phys["viscosity_100c"] = val(r"KV@100\S+C\s*\[mm\S/s\]")
    phys["tbn"] = val(r"BN\s*\[mgKOH/g\]")
    phys["tan"] = val(r"(?:TAN|AN|Acid Number)\s*\[mgKOH/g\]")

    # Filter out empty dicts
    machine["chemistry"] = {k: v for k, v in machine["chemistry"].items() if v}

    _generate_alerts(machine)
    return machine


def _parse_block_by_tokens(block: str, page_idx: int, seen_samples: set) -> Optional[Dict[str, Any]]:
    """
    Legacy parser: reads a single Gulf equipment block by whitespace-token
    position (original behavior, unchanged). Used as a fallback when the
    position-based parser can't locate a date column, and for the case where
    multiple machines are stacked on a single physical PDF page.
    """
    # DETERMINE WHICH COLUMN HAS THE LATEST DATE
    col_idx = _get_latest_column_index(block)

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

    # ── 1. Machine name ───────────────────────────────────────────────────
    unit_m = re.search(r"Machinery Unit\s+(.+?)(?:\n|Equipment S/N|$)", block, re.IGNORECASE)
    loc_m  = re.search(r"Sample Location\s+(.+?)(?:\n|$)", block, re.IGNORECASE)
    machinery_unit  = unit_m.group(1).strip() if unit_m else ""
    sample_location = loc_m.group(1).strip()  if loc_m  else ""
    machine["name"] = _build_machine_name(machinery_unit, sample_location)

    # This block's OWN Report Date — see _extract_own_report_date's docstring
    # for why this can't be assumed to match the document's other pages.
    machine["sample_info"]["report_date"] = _extract_own_report_date(block)

    # ── 2. Sample metadata ────────────────────────────────────────────────
    sample_no_raw = _get_token_at_index(block, r"Sample No", col_idx)
    if sample_no_raw:
        sample_no = re.sub(r'[^\w]', '', sample_no_raw)  # Strip stray characters if any
        machine["sample_info"]["number"] = sample_no
        # Skip duplicates (same sample appearing in repeated page renders)
        if sample_no in seen_samples:
            return None
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

    # ── 3. Status ─────────────────────────────────────────────────────────
    cond_raw = _get_token_at_index(block, r"Lubricant Condition", col_idx)
    if cond_raw:
        raw_status = cond_raw.strip().lower()
        if raw_status == "critical":
            machine["status"] = "Critical"
        elif raw_status in ("caution", "warning"):
            machine["status"] = "Warning"
        else:
            machine["status"] = "Normal"

    # ── 4. Diagnosis ──────────────────────────────────────────────────────
    # Capture from 'Recommendations' (colon optional — Gulf PDFs vary) until
    # 'Lubricant Condition' (which is the footer) or end of block
    rec_m = re.search(r"Recommendations\s*:?\s*(.+?)(?:\n\s*Lubricant Condition|\Z)", block, re.DOTALL | re.IGNORECASE)
    if rec_m:
        raw_diag = rec_m.group(1).replace("\n", " ").strip()
        # Strip PDF footer glossary and chart legends which falsely trigger alerts
        machine["diagnosis"] = re.split(r'\bKV@40|\bWear Elemental Analysis|\bOil Properties|\bPollutants|\bParameters Explanation', raw_diag, flags=re.IGNORECASE)[0].strip()

    # ── 5. Chemistry Values ───────────────────────────────────────────────
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
    return machine


# ─── Main Extractor ──────────────────────────────────────────────────────────

def extract(pdf) -> Optional[Dict[str, Any]]:
    """
    Receives an open pdfplumber PDF object and returns the standard
    extracted-report dictionary used by luboil_report_processor.py.

    Strategy: loop over every physical page. Gulf reports may put ONE machine
    per physical page (the common case observed in practice) or, in older
    files, stack multiple machines on a single physical page. Either way,
    `page_index` on each returned machine is always the TRUE 0-based physical
    page number it came from — this is required for the PDF-preview lookup
    in api.py (which indexes directly into the PDF's real page list) to show
    the same page the data was actually extracted from.
    """
    if not pdf.pages:
        return None

    # ── Confirm this looks like a Gulf Marine PDF (checked across all pages,
    #     since page 1 alone may not contain the literal "gulf marine" text
    #     — some Gulf report variants only show it as a non-text logo) ──────
    doc_is_gulf = False
    for page in pdf.pages:
        t = (_visible_page(page).extract_text() or "").lower()
        if "gulf marine" in t or ("machinery unit" in t and "sample location" in t):
            doc_is_gulf = True
            break
    if not doc_is_gulf:
        return None

    logger.info("Gulf Marine extractor activated.")

    # ── Global Metadata (scan pages until both fields are found) ───────────
    metadata = {
        "vessel_name": None,
        "report_date": None,
        "lab_name":    "Gulf Marine",
        "oil_source":  "GULF",
    }

    for page in pdf.pages:
        t = _visible_page(page).extract_text() or ""
        if not t:
            continue
        if metadata["vessel_name"] is None:
            v_match = re.search(r"VESSEL NAME\s+(.+)", t, re.IGNORECASE)
            if v_match:
                metadata["vessel_name"] = v_match.group(1).strip()
        if metadata["report_date"] is None:
            d_match = re.search(r"REPORT DATE\s+(\S+)", t, re.IGNORECASE)
            if d_match:
                metadata["report_date"] = _parse_date(d_match.group(1))
            # Fallback: "dated DD-Mon-YYYY" in the title line
            if not metadata["report_date"]:
                td = re.search(r"dated\s+(\d{2}[-/]\w{3}[-/]\d{4})", t, re.IGNORECASE)
                if td:
                    metadata["report_date"] = _parse_date(td.group(1))
        if metadata["vessel_name"] and metadata["report_date"]:
            break

    # ── Per-page extraction ─────────────────────────────────────────────────
    machineries: List[Dict] = []
    seen_samples: set = set()

    for page_idx, page in enumerate(pdf.pages):
        # Crop to the visible print area first — see _visible_page() docstring.
        # Without this, a page's raw text layer can contain other machines'
        # blocks positioned off the visible canvas, which is what causes
        # extracted values to disagree with what the page visually shows.
        visible_text = _visible_page(page).extract_text() or ""
        if "Machinery Unit" not in visible_text or "Results" not in visible_text:
            continue  # Not a Gulf equipment page (e.g. a Tribocare/Viswa page mixed into this file)

        # Count only blocks that actually contain a full machine record —
        # a bare trailing "Equipment Information" label bleeding in from the
        # next page's header (with no Machinery Unit/Results after it) is
        # noise, not a second machine, and must not force the legacy path.
        candidate_blocks = re.split(r"(?=Equipment Information\s*\n)", visible_text)
        real_blocks = [b for b in candidate_blocks if "Machinery Unit" in b and "Results" in b]

        if len(real_blocks) <= 1:
            # Common case: exactly one machine on this physical page.
            # Use coordinate-based column matching so blank/missing sample
            # columns can never shift later values into the wrong column.
            machine = _parse_block_by_position(page, visible_text, page_idx, seen_samples)
            if machine is not None:
                machineries.append(machine)
        else:
            # Legacy case: multiple machines stacked on one physical page.
            # Preserve the original whitespace-token parsing exactly; only
            # the page_index assignment is corrected to the true physical page.
            for block in real_blocks:
                machine = _parse_block_by_tokens(block, page_idx, seen_samples)
                if machine is not None:
                    machineries.append(machine)

    if not machineries:
        return None

    # Fallback: only if a machine's OWN page had no parseable Report Date,
    # use the document-level date (the first page's, captured above in
    # `metadata`) for that machine specifically — never overwrite a machine
    # that successfully read its own Report Date.
    for machine in machineries:
        if not machine["sample_info"].get("report_date"):
            machine["sample_info"]["report_date"] = metadata.get("report_date")

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
