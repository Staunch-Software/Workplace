# app/utils/report_date.py
#
# Works out which reporting period a report file actually belongs to.
#
# WHY THIS EXISTS
# ---------------
# SmartPAL's dates are submission dates, not reporting dates. A vessel takes
# July's readings at the end of July but only completes the job in MariApps at
# the start of August, so the Job History row reads:
#
#     Due Date 01-Aug-2026 | Job Start 01-Aug-2026 | Job End 01-Aug-2026
#
# ...for what is unambiguously the JULY report. Every date SmartPAL holds for
# that job says August; nothing in the portal records the reporting period
# (verified by dumping every field, hidden columns included, on the Job Order
# page). Worse, a batch of reports is often completed on the same day, so all
# of them share one job date and no rule based on job dates can tell a July
# report from a June catch-up.
#
# The period is only ever recorded INSIDE the document -- never the filename.
# A filename is typed by whoever exports the file that week, not validated
# against anything, and was found to actively produce wrong answers: a
# range like "31 AUG 2026 - 06 SEP 2026" in a filename silently lost its
# leading day ("Aug 1" instead of "Aug 31"), and a log-style workbook whose
# own latest logged entry said one thing while its filename claimed another
# month entirely. Every strategy below reads the file's own content instead:
#
# - Fillable AcroForm PDFs: when the vessel types "Jul-26" into the Report
#   Month cell, the value is stored against a form field named
#   `reportmonth`. Reading that field by name is exact -- it is the
#   vessel's own answer, not a guess -- and it is generic across all report
#   codes, because every report is built from the same Ozellar template.
#   Note the page TEXT layer is USELESS for these specific forms: it
#   renders only the blank template's labels ("Report Month", "Date"),
#   while the typed values live in the form field layer instead.
# - Flat (non-form) PDFs -- e.g. the WEEKLY DAILY WORK DONE bundles, or
#   machine-generated BWMS logs -- have no form layer at all, but DO carry
#   a plain-text label ("DATE :", "StartTime") on the page itself.
# - Excel reports carry a labelled cell ("Date", "Year / Month:"), or in at
#   least one real case the date sits in the WORKSHEET'S OWN TAB NAME
#   ("CMP 01.08.2026") rather than any cell.
# - Pure log/trend workbooks with no period field anywhere (a running
#   log of dated readings, appended to every month) fall back to the
#   latest plausible date actually recorded in the file -- still read
#   from the file's own content, just inferred rather than labelled.
#
# A report whose file has genuinely no date anywhere in its content (a
# scanned image with no extractable text, e.g. some Oil/Ballast/Garbage
# Record Books) is left unresolved (None) rather than guessed from its
# filename -- the caller/UI falls back to the job's own due/end date in
# that case, same as before this module existed.

import io
import logging
import re
from datetime import datetime

logger = logging.getLogger("scraper")

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_MONTH_RE = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec"

# Form fields naming the reporting period, best first. `reportmonth` is what
# the standard Ozellar template uses; the rest are defensive aliases so a
# retitled template degrades to a one-line change here rather than a silent
# loss of the date.
PERIOD_FIELDS = ("reportmonth", "reportingmonth", "monthofreport", "reportperiod")
DATE_FIELDS = ("date", "reportdate", "dateofreport")

# Fields that hold a date but NOT this report's period -- `revdate` is the
# template's own revision stamp (15-Jul-25 on every copy ever issued) and
# would otherwise be picked up as a July report by any naive date search.
IGNORE_FIELDS = ("revdate", "revisiondate", "lastdeflectiontakendate",
                 "testcarriedoutdate", "duedate", "nextduedate", "printdate")


def _to_period(value, day_first=True):
    """Parse a human-typed date into (year, month, day). None if unparseable.

    Returns the EXACT day the vessel typed whenever the value has one --
    '31-Aug-26' -> (2026, 8, 31), not the 1st of the month. Only falls back
    to day=1 when the value genuinely carries no day at all (a bare 'Jul-26'
    / 'JUNE  26' month-only field).

    Handles everything the vessels actually type: 'Jul-26', 'JULY-26',
    'JULY -26', 'JUNE  26', '31-Aug-26', '25 Jul 2026', '31/07/2026',
    '2026-07-31'.

    `day_first=False` swaps which number wins for the ambiguous
    numeric-slash pattern at the bottom (ties like '8/16/2026'). Only ever
    pass False for a field CONFIRMED to come from a US-format source --
    see _XLSX_MONTH_FIRST_LABELS -- everything else defaults to day-first
    because that is how every vessel-typed form and SmartPAL date in this
    system is written.
    """
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None

    # Day + month name + year -- e.g. '31-Aug-26', '25 Jul 2026', and
    # written-out ordinals like '31st AUG 2026' (real page text: 'DATE
    # :31st AUG 2026'). The optional (?:st|nd|rd|th)? consumes the ordinal
    # suffix so it doesn't break the day-to-separator match -- without it
    # '31st' failed to match at all (the letters 's'/'t' aren't in the
    # separator class), silently falling through to the month-only pattern
    # below and losing the day (producing "Aug 1" instead of "Aug 31").
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)?[-/.\s]+(%s)[a-z]*[-/.,\s]*(\d{2,4})" % _MONTH_RE, text, re.I)
    if m:
        day = int(m.group(1))
        year = int(m.group(3))
        if year < 100:
            year += 2000
        if 2000 <= year <= 2100 and 1 <= day <= 31:
            return year, MONTHS[m.group(2).lower()], day

    # Month name + year only, no day present -- e.g. 'Jul-26', 'JUNE  26'.
    m = re.search(r"(%s)[a-z]*\s*[-/., ]?\s*(\d{2,4})" % _MONTH_RE, text, re.I)
    if m:
        year = int(m.group(2))
        if year < 100:
            year += 2000
        if 2000 <= year <= 2100:
            return year, MONTHS[m.group(1).lower()], 1

    # ISO-ish: 2026-07-31
    m = re.search(r"(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})", text)
    if m:
        month, day = int(m.group(2)), int(m.group(3))
        if 1 <= month <= 12 and 1 <= day <= 31:
            return int(m.group(1)), month, day

    # Day-first: 31/07/2026 or 31-07-26. Day-first (not month-first) because
    # SmartPAL and these forms are all DD-MMM-YYYY / DD/MM/YYYY throughout --
    # unless `day_first=False`, for the one confirmed US-format exception.
    m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", text)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        day, month = (a, b) if day_first else (b, a)
        year = int(m.group(3))
        if year < 100:
            year += 2000
        if 1 <= month <= 12 and 1 <= day <= 31 and 2000 <= year <= 2100:
            return year, month, day

    return None


def _safe_date(year, month, day):
    """datetime(...) but tolerant of an out-of-range day (e.g. a mistyped
    31st in a 30-day month) -- falls back to the 1st rather than raising."""
    try:
        return datetime(year, month, day)
    except ValueError:
        return datetime(year, month, 1)


def _decode_pdf_string(value):
    """PDF text strings are byte strings; only UTF-16 ones carry a BOM."""
    if value is None:
        return None
    if isinstance(value, bytes):
        if value[:2] in (b"\xfe\xff", b"\xff\xfe"):
            try:
                return value.decode("utf-16", "replace")
            except Exception:
                pass
        # Decoding as UTF-16 without a BOM silently mangles plain ASCII --
        # b"Jul-26" comes back as '畊⵬昶' -- so never guess it.
        return value.decode("latin-1", "replace")
    return str(value)


def read_pdf_form_fields(pdf_bytes) -> dict:
    """Return {field_name: typed_value} for every filled field in the form."""
    try:
        import pdfplumber
    except ImportError:
        logger.warning("pdfplumber not installed -- cannot read report dates from PDF forms.")
        return {}

    fields = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for annot in (page.annots or []):
                name = annot.get("title")
                if not name:
                    continue
                value = (annot.get("data") or {}).get("V")
                if hasattr(value, "resolve"):
                    try:
                        value = value.resolve()
                    except Exception:
                        continue
                value = _decode_pdf_string(value)
                if value is None:
                    continue
                value = value.replace("\x00", "").strip()
                # First non-empty wins: a field repeated across pages (common
                # in these multi-page forms) is filled on page 1.
                if value and str(name) not in fields:
                    fields[str(name)] = value
    return fields


def _find_field(lowered, group):
    """First non-ignored field in `group` present on the form, parsed."""
    for wanted in group:
        hit = lowered.get(wanted)
        if not hit:
            continue
        key, value = hit
        if any(bad in key.lower() for bad in IGNORE_FIELDS):
            continue
        period = _to_period(value)
        if period:
            return key, value, period
    return None


def _period_from_form(pdf_bytes, filename=""):
    try:
        fields = read_pdf_form_fields(pdf_bytes)
    except Exception as e:
        logger.debug(f"Could not read PDF form fields: {e}")
        return None
    if not fields:
        return None

    lowered = {k.lower().replace(" ", ""): (k, v) for k, v in fields.items()}

    month_hit = _find_field(lowered, PERIOD_FIELDS)  # e.g. reportmonth = 'Aug-26'
    date_hit = _find_field(lowered, DATE_FIELDS)      # e.g. date = '31-Aug-26'

    # Check for accumulating log rows (e.g. 'testcarriedoutdate#34').
    # A real TECH-57 PDF form has stale 'reportmonth' and 'date' fields at
    # the top (e.g. Aug-26), but the crew adds new dates to the bottom of the
    # table each week (e.g. testcarriedoutdate#34 = '23-Aug-26'). The latest
    # date in the actual data table always wins over stale header fields.
    accumulating_dates = []
    for k, v in lowered.items():
        if k.startswith("testcarriedoutdate"):
            period = _to_period(v[1])
            if period:
                dt = _safe_date(*period)
                accumulating_dates.append((dt, period, v[0], v[1]))
    
    if accumulating_dates:
        accumulating_dates.sort(key=lambda x: x[0], reverse=True)
        _, best_period, best_k, best_v = accumulating_dates[0]
        return best_period, f"form:{best_k}={best_v!r}"

    if month_hit and date_hit:
        m_key, m_val, (m_year, m_month, _) = month_hit
        d_key, d_val, (d_year, d_month, d_day) = date_hit
        if (d_year, d_month) == (m_year, m_month):
            # Both fields agree on the period -- 'date' additionally gives
            # the exact day the vessel typed, so use it.
            return (m_year, m_month, d_day), f"form:{m_key}={m_val!r},{d_key}={d_val!r}"
            
        # Specific override for TECH-07 (ME Performance Sheet): The user
        # explicitly requested that the exact typed Date be prioritized over
        # Report Month when they disagree, even if it shifts the report's month.
        if "TECH-07" in filename.upper() or "TECH - 07" in filename.upper():
            return (d_year, d_month, d_day), f"form:{d_key}={d_val!r} (overrode {m_key}={m_val!r} for TECH-07)"

        # They disagree on the MONTH, not just the day -- this is the same
        # completion-lag pattern as SmartPAL's own dates (the crew signs the
        # form a few days into the next month), just showing up inside the
        # form itself. 'reportmonth' is the field that means "this report's
        # period"; 'date' here is acting as a signing date, not the report
        # date, so trusting its day would silently move the report into the
        # wrong month. Keep the month from reportmonth; there is no day to
        # trust for it, so default to the 1st.
        logger.warning(
            f"Report form fields disagree on period: {m_key}={m_val!r} vs "
            f"{d_key}={d_val!r} -- using {m_key} (the period field) and "
            f"discarding {d_key}'s day."
        )
        return (m_year, m_month, 1), f"form:{m_key}={m_val!r} (ignored {d_key}={d_val!r}, different month)"

    if month_hit:
        key, value, (year, month, _) = month_hit
        return (year, month, 1), f"form:{key}={value!r}"

    if date_hit:
        key, value, period = date_hit
        return period, f"form:{key}={value!r}"

    return None


# Cell text that means "this labels a period", matched EXACTLY (after
# normalizing separators/whitespace) -- not as a substring. A substring
# match on bare "month" was found to fire on "MONTH END RUNNING HOURS" and
# "TOTAL RUNNING HRS.LAST MONTH", two unrelated machinery-log column
# headers on the same sheet that DOES have a real, correctly-labelled
# period cell ("Year / Month: AUGUST 2026") -- the substring match grabbed
# a stray "safety valve last done" date instead of ever reaching the real
# label. Only "month year"/"year month" are listed (not every "/" and "-"
# variant) because _normalize_label folds any separator between the two
# words down to a single space before this set is checked -- a different
# report was found using "MONTH - YEAR :" (dash) where another used
# "Year / Month:" (slash); both normalize to the same two-word form.
# Split into "carries an exact day" vs "month/period only" groups -- a real
# workbook was found with a 'Month: Sep-26' row ABOVE a more precise
# 'Report date : 06/09/2026' row further down the SAME sheet. Scanning
# top-to-bottom and returning on the first label match hit "Month" first
# and returned Sep-1, silently discarding the exact day (6th) sitting a few
# rows later. Both groups are now collected across the whole sheet and a
# day-bearing hit always wins over a month-only one when present, the same
# priority already used for PDF form fields in _period_from_form.
_XLSX_DAY_LABELS = {
    "date", "report date", "reportdate", "date of report",
    "sample date", "test carried out on date",
}
_XLSX_MONTH_ONLY_LABELS = {
    "month", "report month", "reporting month", "reportmonth",
    "period", "year month", "month year",
    "report week", "week", "reporting period",
}
_XLSX_PERIOD_LABELS = _XLSX_DAY_LABELS | _XLSX_MONTH_ONLY_LABELS
_XLSX_IGNORE_LABELS_STARTSWITH = ("rev",)
_XLSX_IGNORE_LABELS_CONTAINS = ("revision", "form no")

# Labels whose values are confirmed to come from a US-format (month-first)
# source rather than a vessel-typed form. A real "Boiler & Cooling Water
# Test" log carries a "Sample date" column of plain text like '8/16/2026'
# and '8/13/2026' -- both invalid under this module's usual day-first
# reading (there is no 16th or 13th month), which is exactly what proves
# the column is M/D/YYYY, not D/M/YYYY. This is a per-label exception, not
# a change to the default: every other date in this module (SmartPAL,
# vessel-typed forms) stays day-first, because that is how those are
# actually written.
_XLSX_MONTH_FIRST_LABELS = {"sample date"}

# Labels that appear as TABLE COLUMN headers rather than same-row
# "label: value" pairs. A real "Cooling Test" log has 'DATE' at A2 with
# its actual values in A3, A7... below it, nothing to its right.
_XLSX_COLUMN_HEADER_LABELS = {"sample date", "date", "date of report", "test carried out on date"}


def _normalize_label(s):
    s = re.sub(r"[/\-]", " ", s)
    return re.sub(r"\s+", " ", s.strip().rstrip(":").strip()).lower()


def _merged_anchor_map(ws):
    """Map every non-anchor (row, col) covered by a merged range to its
    anchor (top-left) coordinate.

    openpyxl's read-only row iterator only carries a value on a merged
    range's anchor cell -- every OTHER cell in the range comes back as
    value=None, indistinguishable from a genuinely empty cell. These report
    templates commonly box a label and its typed value as merged, bordered
    cells (e.g. a 'Report date :' | '06/09/2026' two-box table, confirmed on
    a real "Hyd Corrosion Maintenance Plan" workbook), so without resolving
    this, a real date sitting right next to a recognised label was silently
    read as blank and the scan fell all the way through to the much less
    reliable sheet-title/latest-date fallbacks -- producing a stale/wrong
    answer (the sheet's own tab name, e.g. "CMP 01.08.2026") even though the
    correct date was typed directly into the form.
    """
    mapping = {}
    try:
        for rng in ws.merged_cells.ranges:
            anchor = (rng.min_row, rng.min_col)
            for r in range(rng.min_row, rng.max_row + 1):
                for c in range(rng.min_col, rng.max_col + 1):
                    if (r, c) != anchor:
                        mapping[(r, c)] = anchor
    except Exception:
        pass
    return mapping


def _period_from_xlsx_labelled(file_bytes):
    """Scan every sheet for an EXACT label ('Date', 'Year / Month:', ...)
    and parse the value(s) that follow it in the same row.

    Three real layouts required handling here:
    - label and value in adjacent cells: 'Date' | 2026-08-31 (one cell each)
    - label and value split across TWO more cells: 'Year / Month:' | 'AUGUST' | 2026
      -- neither 'AUGUST' nor '2026' alone parses as a period, only their
      concatenation does, so once a label is found the remaining cells in
      that row are also tried joined together.
    - label and/or value living in a MERGED cell (a bordered form box) --
      see _merged_anchor_map.

    Every hit is collected (not returned immediately) so a day-bearing
    label (e.g. 'Report date : 06/09/2026') found LATER in the sheet can
    still win over a month-only label (e.g. 'Month: Sep-26') found earlier
    -- see _XLSX_DAY_LABELS/_XLSX_MONTH_ONLY_LABELS.

    Across sheets, the LATEST resolved date wins, not the first one found --
    a real "Boiler & Cooling Water Test Weekly Report" workbook was found
    with 43 tabs (WEEK 41 2025 ... WEEK 31 2026, one appended per week, none
    ever overwritten), each carrying its own "DATE" cell. First-hit-wins
    picked WEEK 41's Oct-2025 date out of a file that was actually just
    submitted for the Aug-2026 week -- the same accumulating-log pattern
    already handled for sheet TITLES in _period_from_xlsx_sheet_titles, just
    showing up here in a labelled CELL instead. A one-sheet-per-submission
    file (the common case) only ever has one candidate, so this is a strict
    improvement there too.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return None
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception:
        return None

    # The sheet-title cross-check below is ONLY safe to apply when there is
    # more than one DATE-PARSEABLE sheet title -- not just more than one
    # sheet. A real "Engine Month End Report Review" file (one sheet, always
    # literally titled "FEB 2026" no matter the actual month) had a correct,
    # properly-filled "Month - Year" cell reading July 2026 -- exactly
    # matching the filename and every other date on the sheet -- but the
    # stale one-off tab name would have overridden it to February. This is
    # the SAME stale-tab-name pattern already found repeatedly this session
    # (e.g. the Corrosion Maintenance Plan tab that never gets renamed), and
    # it is the common case for a one-sheet-per-submission file -- there is
    # no second DATED sheet to cross-check against, so the tab name here is
    # just an unmaintained label, not independent corroborating evidence.
    #
    # Counting every sheet (the original version of this check) was still
    # wrong: EVERY Weekly Bunker Report workbook has the same 3-sheet
    # skeleton ('ROB', 'Bunker ROB Experience', and one dated sheet like
    # 'ROB DATE 05-07-2026') even when only ONE cycle has ever been
    # submitted -- 3 sheets, but only 1 actually carries a date. A real GCL
    # SARASWATI file hit exactly this: its single dated sheet's own 'Date'
    # cell correctly read 06.09.2026 (matching the filename), but because
    # the file technically had "more than one sheet" the cross-check fired
    # anyway and overrode it with the stale tab name '05-07-2026' -- the
    # exact same failure this check exists to prevent, just from the
    # opposite direction. The cross-check only earns its keep when there are
    # multiple DATED sheets to disambiguate between (a genuine accumulating
    # log, like the 52-sheet Bunker ROB workbook or 43-sheet Boiler Water
    # log this function's docstring describes), never merely multiple
    # sheets.
    dated_sheet_count = sum(1 for ws in wb.worksheets if _to_period(ws.title))
    cross_check_against_title = dated_sheet_count > 1

    day_hit = None    # (period, source, resolved_datetime) from a day-bearing label
    month_hit = None  # (period, source, resolved_datetime) from a month/period-only label
    current_sheet_title_period = None  # this sheet's own tab name, parsed (or None)

    def _record(label_norm, period, source):
        nonlocal day_hit, month_hit
        if cross_check_against_title and current_sheet_title_period is not None:
            # Cross-check against the sheet's OWN tab name -- e.g. a real
            # "Bunker Tank Sounding Report" workbook had a sheet literally
            # titled "ROB DATE 04-01-2026" whose own 'Date' cell nonetheless
            # held '04.12.2026' (a data-entry slip -- December picked
            # instead of January). Scanning every sheet for the LATEST hit
            # (needed for accumulating logs, see this function's docstring)
            # means one erroneous cell like that can otherwise outrank every
            # genuinely correct sheet in the file just by being numerically
            # later. Same "two signals disagree, trust the more deliberate
            # one" pattern already used for PDF form reportmonth-vs-date and
            # xlsx day-label-vs-month-label -- the sheet's own name is the
            # more deliberate signal, so a cell that disagrees with it on
            # the MONTH is corrected to the sheet title's date instead of
            # being trusted as-is.
            st_year, st_month, _ = current_sheet_title_period
            p_year, p_month, p_day = period
            if (st_year, st_month) != (p_year, p_month):
                logger.warning(
                    f"xlsx sheet {label_norm!r} cell disagrees with its own "
                    f"sheet title on period ({source}) -- using the sheet "
                    f"title's date instead."
                )
                period = current_sheet_title_period
                source = f"{source} (overridden by sheet title, disagreed on month)"
        dt = _safe_date(*period)
        if label_norm in _XLSX_DAY_LABELS:
            if day_hit is None or dt > day_hit[2]:
                day_hit = (period, source, dt)
        else:
            if month_hit is None or dt > month_hit[2]:
                month_hit = (period, source, dt)

    try:
        for ws in wb.worksheets:
            current_sheet_title_period = _to_period(ws.title)
            merged_map = _merged_anchor_map(ws)
            anchor_values = {}
            # Column -> row index of the last "Rev"/"Tech Form No" label seen
            # in that column. These report templates print a fixed header
            # stamp block at the top of the sheet:
            #     Tech Form No : OTH - 02
            #     Rev : 2.0
            #     Date : JUNE 2025
            # -- a real "Battery Log" file was found where that "Date" is
            # the TEMPLATE's own stamp (same value on every copy, sometimes
            # a whole year stale) while the file's actual reporting date sat
            # several rows further down as its own labelled "Date" field. A
            # "Weekly Bunker Report" workbook had the identical trap: EVERY
            # vessel's EVERY week carried the exact same
            # "Date : 15.MAY.2025" stamp in its log sheet, so this one stray
            # cell alone made every bunker report in the system resolve to
            # the same wrong date. Same failure mode as the revdate PDF-form
            # field and the "rev no"/"edition" guard in _period_from_pdf_text
            # -- just showing up here as a positional pattern instead of a
            # field name or nearby words, because the label here is a bare
            # "Date" that would otherwise pass every other check. A "Date"
            # label within a few rows of such a stamp, in the same column,
            # is skipped (not recorded) so scanning can continue to the
            # sheet's real, unrelated date field instead of locking onto it.
            header_stamp_row = {}
            HEADER_STAMP_WINDOW = 3
            # Column -> (row index, label_norm) of a _XLSX_COLUMN_HEADER_LABELS header
            # (e.g. "Sample date", "Date"). This is a TABLE COLUMN header, not a
            # same-row "label: value" pair -- a real "Boiler & Cooling Water Test"
            # log has 'DATE' at A2 with its actual values in A3, A7... below it.
            # Every value found in that column within the window below is tried
            # and the latest wins, same rule as everywhere else in this module.
            column_header_row = {}
            COLUMN_HEADER_WINDOW = 20
            for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=60, max_col=200), start=1):
                label_seen_at = None
                label_seen_norm = None
                for i, cell in enumerate(row):
                    v = cell.value
                    # cell.row/.column aren't available on openpyxl's
                    # read-only EmptyCell placeholder (only real cells carry
                    # them), so track position from the enumeration instead
                    # -- min_col defaults to 1, so column = i + 1.
                    coord = (row_idx, i + 1)
                    if v is None:
                        anchor = merged_map.get(coord)
                        if anchor is not None:
                            v = anchor_values.get(anchor)
                    else:
                        anchor_values[coord] = v
                    if v is None:
                        continue
                    if isinstance(v, datetime):
                        header_info = column_header_row.get(coord[1])
                        if header_info is not None:
                            header_row_idx, header_norm = header_info
                            if 0 < row_idx - header_row_idx <= COLUMN_HEADER_WINDOW:
                                _record(header_norm, (v.year, v.month, v.day), f"xlsx:{ws.title}!{header_norm}={v.date()}(column)")

                        if label_seen_at is not None:
                            # Include the actual label AND the resolved value here --
                            # a bare "xlsx:{ws.title}!cell" was found to read as if the
                            # SHEET TITLE were the date used (a real "CMP 01.08.2026"
                            # sheet's own "Report date" cell correctly resolved to
                            # 2026-09-13, but the source string only ever showed the
                            # stale sheet title, making a genuinely-correct answer look
                            # like the sheet-title fallback had fired instead).
                            _record(label_seen_norm, (v.year, v.month, v.day),
                                    f"xlsx:{ws.title}!{label_seen_norm}={v.date()}")
                            label_seen_at = None
                        continue
                    s = str(v).strip()
                    if not s:
                        continue
                    norm = _normalize_label(s)
                    if norm.startswith(_XLSX_IGNORE_LABELS_STARTSWITH) or \
                       any(w in norm for w in _XLSX_IGNORE_LABELS_CONTAINS):
                        header_stamp_row[coord[1]] = row_idx
                        label_seen_at = None
                        continue

                    near_header_stamp = (
                        coord[1] in header_stamp_row and
                        row_idx - header_stamp_row[coord[1]] <= HEADER_STAMP_WINDOW
                    )

                    # A data row sitting below a COLUMN header (see column_header_row)
                    # -- tried unconditionally alongside the normal label logic below,
                    # since a bare '8/16/2026' string wouldn't match any of
                    # that logic (it isn't itself a label, and it isn't in
                    # the same row as one).
                    header_info = column_header_row.get(coord[1])
                    if header_info is not None:
                        header_row_idx, header_norm = header_info
                        if 0 < row_idx - header_row_idx <= COLUMN_HEADER_WINDOW:
                            col_period = _to_period(s, day_first=header_norm not in _XLSX_MONTH_FIRST_LABELS)
                            if col_period:
                                _record(header_norm, col_period, f"xlsx:{ws.title}!{s!r}(column)")

                    # Label and value typed together in ONE cell, e.g.
                    # "Report date : 06/09/2026" as a single string -- the
                    # exact-label-match below only catches label and value
                    # in SEPARATE cells, so this regex fallback catches the
                    # combined-cell case before falling through to the
                    # sheet-title guess.
                    same_cell_match = re.match(
                        r"^(%s)\s*[:\-]\s*(.+)$" % "|".join(re.escape(l) for l in _XLSX_PERIOD_LABELS),
                        s.strip(), re.I
                    )
                    if same_cell_match and not near_header_stamp:
                        label_part = _normalize_label(same_cell_match.group(1))
                        value_part = same_cell_match.group(2).strip()
                        period = _to_period(value_part, day_first=label_part not in _XLSX_MONTH_FIRST_LABELS)
                        if period:
                            _record(label_part, period, f"xlsx:{ws.title}!same_cell:{s!r}")

                    if norm in _XLSX_PERIOD_LABELS:
                        if near_header_stamp:
                            continue
                        if norm in _XLSX_COLUMN_HEADER_LABELS:
                            column_header_row[coord[1]] = (row_idx, norm)
                        label_seen_at = i
                        label_seen_norm = norm
                        continue
                    if label_seen_at is not None:
                        period = _to_period(s, day_first=label_seen_norm not in _XLSX_MONTH_FIRST_LABELS)
                        if period:
                            _record(label_seen_norm, period, f"xlsx:{ws.title}!{s!r}")
                            label_seen_at = None
                # A label followed by its value split across the REMAINING
                # cells in the row (e.g. 'AUGUST' then 2026 as two more
                # cells) -- try them joined once the per-cell pass above
                # found nothing on its own.
                if label_seen_at is not None:
                    rest = []
                    for j, cell in enumerate(row[label_seen_at + 1:], start=label_seen_at + 1):
                        v = cell.value
                        if v is None:
                            anchor = merged_map.get((row_idx, j + 1))
                            if anchor is not None:
                                v = anchor_values.get(anchor)
                        if v is None:
                            continue
                        rest.append(v.strftime("%Y-%m-%d") if isinstance(v, datetime) else str(v).strip())
                    if rest:
                        joined = " ".join(rest)
                        period = _to_period(joined, day_first=label_seen_norm not in _XLSX_MONTH_FIRST_LABELS)
                        if period:
                            _record(label_seen_norm, period, f"xlsx:{ws.title}!{joined!r}")

            # No early exit here: an accumulating-log workbook (see
            # docstring) can have EVERY sheet carry its own day_hit, and
            # only scanning to the end guarantees the latest one was seen.
    finally:
        try:
            wb.close()
        except Exception:
            pass

    if day_hit and month_hit:
        (d_year, d_month, d_day), d_src, _ = day_hit
        (m_year, m_month, _), m_src, _ = month_hit
        if (d_year, d_month) == (m_year, m_month):
            return (d_year, d_month, d_day), d_src
        # Disagree on month -- same completion-lag pattern already handled
        # for PDF forms in _period_from_form: trust the field that means
        # "this report's period", not a loose 'date' cell that could be a
        # signing date from a different month.
        logger.warning(
            f"xlsx labelled fields disagree on period: {d_src} vs {m_src} -- "
            f"using the month field and discarding the date field's day."
        )
        return (m_year, m_month, 1), m_src
    if day_hit:
        period, source, _ = day_hit
        return period, source
    if month_hit:
        period, source, _ = month_hit
        return period, source
    return None


def _period_from_xlsx_latest_date(file_bytes):
    """Last resort for pure log/trend workbooks with no period field at all
    (e.g. 'TECH - 13 Auxiliary Engine Performance Trend.xlsx': 39 rows of
    dated readings spanning a year, no 'Report Month' anywhere) -- use the
    most recent plausible date recorded anywhere in the file. Deliberately
    tried only AFTER the filename, which is a more deliberate signal when
    present: a log that keeps accumulating past the report's nominal month
    can make this overshoot (observed picking Sep-6 out of a daily log for
    a file literally named "... AUGUST 2026.xlsx").
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return None
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception:
        return None

    now_year = datetime.utcnow().year
    latest = None  # (datetime, cell_repr)
    try:
        for ws in wb.worksheets:
            for row in ws.iter_rows(min_row=1, max_row=60, max_col=200):
                for cell in row:
                    v = cell.value
                    if isinstance(v, datetime) and now_year - 3 <= v.year <= now_year + 1:
                        if latest is None or v > latest[0]:
                            latest = (v, f"{ws.title}!{v.date()}")
        if latest:
            v, cell_repr = latest
            return (v.year, v.month, v.day), f"xlsx:latest_date_in_sheet:{cell_repr}"
        return None
    finally:
        try:
            wb.close()
        except Exception:
            pass


# Labels searched for on a flat (non-form) PDF's page text, most specific
# first -- "start time"/"operation date" must be tried before bare "date"
# so a machine-generated BWMS log's real timestamp wins over a coincidental
# later match. Checked as a substring of the page's flattened text (not a
# strict line anchor), because these PDFs are not all laid out the same:
# the weekly work-done reports print a clean "DATE : 31 AUG 2026" line, but
# a BWMS log's text extracts as "StartTime 2026-07-0603:33:56" with no
# space and no colon between the label and its value at all.
#
# "report for" covers a different, system-generated "Waterproof Report" PDF
# (a boiler/cooling-water test export, not a vessel-filled form) whose page
# reads "AM TARANG - IMO 9832913 Report for Aug 2026" -- month name + year,
# unambiguous, no day-first/month-first guessing needed. Deliberately NOT
# using this PDF's "Waterproof report 8/1/2026 - 8/31/2026" range instead:
# that's numeric M/D/YYYY (US format, like _XLSX_MONTH_FIRST_LABELS) and
# reading it under this module's usual day-first rule would misread it. The
# same page also prints "Report created 8/8/2026" -- a print/export
# timestamp, not the period -- but "report for" is specific enough wording
# that it can't accidentally match "report created", so no extra guard
# (unlike the rev/edition trap below) is needed here.

# ---------------------------------------------------------------------------
# Per-report fallback rules
# ---------------------------------------------------------------------------
# Reports whose PDFs show a DATE RANGE (start - end) and whose report_date
# should therefore come from job_end_date (scraped from SmartPAL) rather than
# being parsed out of the PDF.  Add a report here when the user explicitly
# requests this behaviour for a specific report type.
# Match is case-insensitive substring against EITHER report_code OR report_name.
_JOB_END_DATE_FALLBACK_REPORTS: tuple = (
    "BOILER",       # WEEKLY-06-BOILER AND COOLER WATER REPORT / WATERPROOF REPORT
)


def uses_job_end_date_fallback(report_code: str, report_name: str) -> bool:
    """Return True if this report type should use job_end_date when PDF
    extraction returns None (e.g. range-based PDFs like Boiler/Waterproof)."""
    haystack = f"{report_code or ''} {report_name or ''}".upper()
    return any(p.upper() in haystack for p in _JOB_END_DATE_FALLBACK_REPORTS)


# Labels that introduce a DATE RANGE (start - end) rather than a single date.
# For these we want the END of the range (the last day covered), not the start.
_PDF_RANGE_LABELS = {"report for", "report period", "reporting period"}
_PDF_TEXT_LABELS = ("report month", "reporting month", "operation date", "start time", "report period", "report for", "date")


def _find_period_in_flat_text(flat):
    """Search already-flattened page text for a labelled period. Shared by
    the normal path and the garbled-font recovery path below -- both end up
    with a flat string, just decoded differently."""
    for label in _PDF_TEXT_LABELS:
        pattern = re.escape(label).replace(r"\ ", r"\s*")
        for m in re.finditer(pattern, flat, re.I):
            # Every one of these report templates carries a fixed print/
            # edition stamp near a page footer -- e.g. real text found:
            # "Page 1 of 2 Edition No.1 / Rev No.0 Copy:Vessel Date:
            # 01-Jun-21" -- where "Date:" is the TEMPLATE's own edition
            # date, not the report's. Same trap as the PDF form's revdate
            # field and the xlsx "Revision Date" row, just showing up here
            # in plain page text. Skip a match if the ~40 chars immediately
            # before it look like that stamp, and keep searching for a
            # LATER occurrence of the same label instead of taking this one.
            preceding = flat[max(0, m.start() - 40):m.start()].lower()
            if any(w in preceding for w in ("rev no", "rev.", "revision", "edition")):
                continue
            # Same LINE only -- a label with nothing useful right after it
            # (just a newline, e.g. a bare "OperationDate" line immediately
            # followed by an unrelated "EndTime ..." line) must not fall
            # through to whatever date happens to appear next in the
            # document. That was observed to accidentally "work" here
            # (Start/End are same-day for these logs) but the match would be
            # attributing the wrong line's value to the label, which isn't
            # safe to rely on in general.
            line_end = flat.find("\n", m.end())
            window = flat[m.end():line_end if line_end != -1 else len(flat)]
            # For range-bearing labels (e.g. 'report for') the PDF may show a
            # date range like '8/1/2026 - 8/31/2026'. When a range is detected
            # return None so the caller can use job_end_date (scraped from
            # SmartPAL) as the report date instead of guessing from the range.
            if label.lower() in _PDF_RANGE_LABELS:
                next_line_end = flat.find("\n", line_end + 1) if line_end != -1 else -1
                two_line_window = flat[m.end():next_line_end if next_line_end != -1 else len(flat)]
                range_m = re.search(r"(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\s*[-\u2013]\s*(\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})", two_line_window)
                if range_m:
                    return None  # signal caller to use job_end_date

            period = _to_period(window)
            if period:
                return period, label, window.strip()[:24]
    return None


# Words expected to appear literally on these report pages -- used only to
# SCORE candidate decodings of a garbled font (see _degarble_text), never to
# search real (correctly-decoded) text. Needs at least 2 distinct hits
# before a shift is trusted, so a coincidental one-word match on a still-wrong
# shift can't win.
_PDF_SANITY_WORDS = ("date", "vessel", "report", "name", "category", "week", "month", "deck", "engine")


def _degarble_text(text):
    """Recover readable text from a PDF whose font's glyph-to-Unicode
    mapping is broken -- e.g. a real "Deck Weekly Workdone Report" PDF
    (10TH-16TH AUG 2026, MV AM UMANG) where pdfplumber's extract_text()
    returns "'$7(<control-chars>7+<control-chars>$8*<control-chars>",
    control characters and all -- not empty, not an exception, just every
    character consistently offset from its real codepoint (confirmed against
    both pdfplumber and PyMuPDF, which decode it identically wrong, so this
    is the PDF's own broken/missing ToUnicode CMap, not a library bug).
    Manually reversing the offset on that real file recovered
    "DATE = 10TH AUG 2026" -- the exact same label this module already
    searches for -- at a shift of +29.

    The correct shift is a property of that file's specific broken font, not
    a constant to hardcode: a different broken PDF could need a different
    offset. So instead of guessing one number, every plausible shift is
    tried and scored by how many distinct expected words (_PDF_SANITY_WORDS)
    it reveals -- the same brute-force-then-validate approach used nowhere
    else in this module because nowhere else is the alphabet itself in
    question, only the value.

    Returns the best-scoring decoded text, or None if nothing scored highly
    enough to trust (avoids "decoding" already-fine text, or text that is
    genuinely unrecoverable, into a confident-looking wrong answer).
    """
    # A normal extraction has essentially no C0 control characters outside
    # \n\t\r. A meaningful density of them is the actual signal that this
    # text is glyph codes, not characters -- cheap to check before paying
    # for ~120 shift-and-score attempts on every ordinary PDF.
    control = sum(1 for c in text if ord(c) < 32 and c not in "\n\t\r")
    printable = sum(1 for c in text if c not in "\n\t\r")
    if printable == 0 or control / printable < 0.05:
        return None

    best_text, best_score = None, 0
    for shift in range(-60, 61):
        if shift == 0:
            continue
        try:
            candidate = "".join(
                chr(ord(c) + shift) if ord(c) + shift >= 0 else c
                for c in text
            )
        except ValueError:
            continue
        low = candidate.lower()
        score = sum(1 for w in _PDF_SANITY_WORDS if w in low)
        if score > best_score:
            best_score, best_text = score, candidate
    if best_score >= 2:
        return best_text
    return None


def _period_from_pdf_text(pdf_bytes, page_index=0):
    """Flat (non-form) PDFs carry their date as plain page text instead of
    a form field -- e.g. the WEEKLY DAILY WORK DONE bundles (one page per
    day, each headed 'DATE : <that day>') or a BWMS log's 'StartTime
    <timestamp>'. Only `page_index` (default the first page) is read: a
    multi-page weekly bundle spans a date range with one page per day, and
    the report is filed under the START of the period it covers, per the
    same convention as MariApps' own job_start_date -- confirmed against
    real files where the first page's date matches job_start_date and the
    last page's matches job_end_date.

    Landscape / rotated PDFs (e.g. TECH-08A Scavenge Port Inspection
    Template submitted as a flattened/compressed PDF) can confuse
    pdfplumber's extract_text() -- the spatial ordering of glyphs is
    disrupted by the page rotation so the label 'Date:' and its value end
    up in different lines or are interleaved with unrelated columns.  When
    the standard pass finds nothing, a second pass reconstructs the text by
    sorting the page's individual words by their Y-coordinate (row) and
    then X-coordinate (column), which is independent of any page-rotation
    metadata and always produces a reading-order stream.
    """
    try:
        import pdfplumber
    except ImportError:
        return None
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_index >= len(pdf.pages):
                return None
            page = pdf.pages[page_index]
            text = page.extract_text() or ""

            flat = re.sub(r"[ \t]+", " ", text)
            found = _find_period_in_flat_text(flat)
            if not found:
                degarbled = _degarble_text(text)
                if degarbled:
                    found = _find_period_in_flat_text(re.sub(r"[ \t]+", " ", degarbled))
                    if found:
                        period, label, snippet = found
                        return period, f"pdf_text:page{page_index + 1}:degarbled:{label}={snippet!r}"

            if not found:
                # Fallback: reconstruct text from individual word positions.
                # This is robust to landscape/rotated pages where extract_text()
                # loses reading order -- sorting by (top, x0) gives a correct
                # left-to-right, top-to-bottom stream regardless of rotation.
                try:
                    words = page.extract_words(keep_blank_chars=False)
                    if words:
                        # Group words into lines by rounding Y to nearest 10pt bucket
                        lines: dict[int, list] = {}
                        for w in words:
                            bucket = round(w["top"] / 10) * 10
                            lines.setdefault(bucket, []).append(w)
                        reconstructed_lines = []
                        for bucket in sorted(lines):
                            row_words = sorted(lines[bucket], key=lambda w: w["x0"])
                            reconstructed_lines.append(" ".join(w["text"] for w in row_words))
                        spatial_text = "\n".join(reconstructed_lines)
                        flat2 = re.sub(r"[ \t]+", " ", spatial_text)
                        found = _find_period_in_flat_text(flat2)
                        if found:
                            period, label, snippet = found
                            return period, f"pdf_text:page{page_index + 1}:spatial:{label}={snippet!r}"
                except Exception:
                    pass

            if not found:
                return None

            period, label, snippet = found
            return period, f"pdf_text:page{page_index + 1}:{label}={snippet!r}"
    except Exception:
        return None



def _period_from_xlsx_sheet_titles(file_bytes):
    """Last resort within an xlsx: the reporting date sits in the
    WORKSHEET'S OWN TAB NAME rather than any cell -- observed on "3. Hyd
    Corrosion Maintenance Plan...xlsx", whose real content sheet is
    literally titled "CMP 01.08.2026" (its own "Guideline" sheet instructs
    users to encode the date there).

    Every dated sheet is tried and the LATEST one wins, not the first --
    a real "Deck Corrosion Maintenance Plan" workbook was found where the
    vessel appends a new dated sheet every week instead of overwriting the
    old one (CMP 04.01.2026, CMP 11.01.2026, ... CMP 16.08.2026, all in one
    file, oldest first). First-match-wins picked January out of a workbook
    that was actually just submitted for the 16-Aug week, off by over 7
    months. A one-sheet-per-submission file (the common case) still only
    has one candidate to pick from, so this is a strict improvement there.
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return None
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception:
        return None
    try:
        latest = None  # (datetime, period, title)
        for ws in wb.worksheets:
            period = _to_period(ws.title)
            if not period:
                continue
            dt = _safe_date(*period)
            if latest is None or dt > latest[0]:
                latest = (dt, period, ws.title)
        if latest:
            _, period, title = latest
            return period, f"xlsx:sheet_title:{title!r}"
        return None
    finally:
        try:
            wb.close()
        except Exception:
            pass


def extract_report_period(file_bytes, file_name=""):
    """Work out the exact date a report file is dated -- reading only the
    file's own content, never its filename. `file_name` is accepted only so
    every existing call site keeps working unchanged; it is NOT consulted.
    A filename is typed by whoever exports it, unvalidated, and was found
    to give wrong answers (see the module docstring for the specific
    failures this caused before filename lookups were removed).
    see the module docstring).

    Returns (datetime, source_description) or None. `None` means the file
    genuinely has no date recoverable from its content (e.g. a scanned
    image with no extractable text) -- callers/the UI should fall back to
    the job's own due/end date in that case, same as before this module
    existed. The datetime is the EXACT date found -- '31-Aug-26' inside the
    file becomes 2026-08-31, not the 1st of the month. Only when the source
    genuinely has no day (a bare 'Jul-26' month field) does it fall back to
    the 1st, because there is nothing else to store.
    """
    if not file_bytes:
        return None

    if file_bytes[:4] == b"%PDF":
        found = _period_from_form(file_bytes, filename=file_name)
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

        found = None
        for _page_idx in range(3):  # try cover + next 2 pages; some PDFs have
            # a blank/image-only cover (e.g. Vessel Condition Report-Engine
            # whose page 1 is a photo cover and page 2 carries the DATE field)
            found = _period_from_pdf_text(file_bytes, _page_idx)
            if found:
                break
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

    elif file_bytes[:2] == b"PK":
        found = _period_from_xlsx_labelled(file_bytes)
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

        # DIAGNOSTIC: if we reached here, no labelled cell was found at
        # all. Dump every non-empty cell so a future failure can be told
        # apart -- "genuinely a picture/shape, nothing to read" vs "a
        # matching bug in _period_from_xlsx_labelled".
        try:
            from openpyxl import load_workbook as _lw
            _wb = _lw(io.BytesIO(file_bytes), read_only=True, data_only=True)
            _dump = []
            for _ws in _wb.worksheets:
                for _row in _ws.iter_rows(min_row=1, max_row=20, max_col=15):
                    for _cell in _row:
                        if _cell.value is not None:
                            _dump.append(f"{_ws.title}!{_cell.coordinate}={_cell.value!r}")
            _wb.close()
            logger.warning(f"xlsx labelled-date scan found nothing. Cells present: {_dump[:40]}")
        except Exception:
            pass

        found = _period_from_xlsx_sheet_titles(file_bytes)
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

        # Last resort: no labelled period anywhere -- fall back to the
        # latest plausible date recorded inside a log/trend-style workbook.
        # Tried last on purpose: it can overshoot a report's true period
        # (see _period_from_xlsx_latest_date's own docstring), so any
        # labelled field always wins when present.
        found = _period_from_xlsx_latest_date(file_bytes)
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

    return None
