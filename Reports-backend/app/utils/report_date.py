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


def _to_period(value):
    """Parse a human-typed date into (year, month, day). None if unparseable.

    Returns the EXACT day the vessel typed whenever the value has one --
    '31-Aug-26' -> (2026, 8, 31), not the 1st of the month. Only falls back
    to day=1 when the value genuinely carries no day at all (a bare 'Jul-26'
    / 'JUNE  26' month-only field).

    Handles everything the vessels actually type: 'Jul-26', 'JULY-26',
    'JULY -26', 'JUNE  26', '31-Aug-26', '25 Jul 2026', '31/07/2026',
    '2026-07-31'.
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
    # SmartPAL and these forms are all DD-MMM-YYYY / DD/MM/YYYY throughout.
    m = re.search(r"(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})", text)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
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


def _period_from_form(pdf_bytes):
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

    if month_hit and date_hit:
        m_key, m_val, (m_year, m_month, _) = month_hit
        d_key, d_val, (d_year, d_month, d_day) = date_hit
        if (d_year, d_month) == (m_year, m_month):
            # Both fields agree on the period -- 'date' additionally gives
            # the exact day the vessel typed, so use it.
            return (m_year, m_month, d_day), f"form:{m_key}={m_val!r},{d_key}={d_val!r}"
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
}
_XLSX_MONTH_ONLY_LABELS = {
    "month", "report month", "reporting month", "reportmonth",
    "period", "year month", "month year",
    "report week", "week", "reporting period",
}
_XLSX_PERIOD_LABELS = _XLSX_DAY_LABELS | _XLSX_MONTH_ONLY_LABELS
_XLSX_IGNORE_LABELS_STARTSWITH = ("rev",)
_XLSX_IGNORE_LABELS_CONTAINS = ("revision", "form no")


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
    """
    try:
        from openpyxl import load_workbook
    except ImportError:
        return None
    try:
        wb = load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    except Exception:
        return None

    day_hit = None    # (period, source) from a day-bearing label
    month_hit = None  # (period, source) from a month/period-only label

    def _record(label_norm, period, source):
        nonlocal day_hit, month_hit
        if label_norm in _XLSX_DAY_LABELS:
            if day_hit is None:
                day_hit = (period, source)
        elif month_hit is None:
            month_hit = (period, source)

    try:
        for ws in wb.worksheets:
            merged_map = _merged_anchor_map(ws)
            anchor_values = {}
            for row_idx, row in enumerate(ws.iter_rows(min_row=1, max_row=60, max_col=25), start=1):
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
                        if label_seen_at is not None:
                            _record(label_seen_norm, (v.year, v.month, v.day), f"xlsx:{ws.title}!cell")
                            label_seen_at = None
                        continue
                    s = str(v).strip()
                    if not s:
                        continue
                    norm = _normalize_label(s)
                    if norm.startswith(_XLSX_IGNORE_LABELS_STARTSWITH) or \
                       any(w in norm for w in _XLSX_IGNORE_LABELS_CONTAINS):
                        label_seen_at = None
                        continue

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
                    if same_cell_match:
                        label_part = _normalize_label(same_cell_match.group(1))
                        value_part = same_cell_match.group(2).strip()
                        period = _to_period(value_part)
                        if period:
                            _record(label_part, period, f"xlsx:{ws.title}!same_cell:{s!r}")

                    if norm in _XLSX_PERIOD_LABELS:
                        label_seen_at = i
                        label_seen_norm = norm
                        continue
                    if label_seen_at is not None:
                        period = _to_period(s)
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
                        period = _to_period(joined)
                        if period:
                            _record(label_seen_norm, period, f"xlsx:{ws.title}!{joined!r}")

            # A day-bearing hit is as good as this scan gets -- no need to
            # keep walking further sheets once both kinds have been seen.
            if day_hit and month_hit:
                break
    finally:
        try:
            wb.close()
        except Exception:
            pass

    if day_hit and month_hit:
        (d_year, d_month, d_day), d_src = day_hit
        (m_year, m_month, _), m_src = month_hit
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
        return day_hit
    if month_hit:
        return month_hit
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
            for row in ws.iter_rows(min_row=1, max_row=60, max_col=25):
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
_PDF_TEXT_LABELS = ("report month", "reporting month", "operation date", "start time", "date")


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
    """
    try:
        import pdfplumber
    except ImportError:
        return None
    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            if page_index >= len(pdf.pages):
                return None
            text = pdf.pages[page_index].extract_text() or ""
    except Exception:
        return None
    if not text:
        return None

    flat = re.sub(r"[ \t]+", " ", text)
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
            period = _to_period(window)
            if period:
                return period, f"pdf_text:page{page_index + 1}:{label}={window.strip()[:24]!r}"
    return None


def _period_from_xlsx_sheet_titles(file_bytes):
    """Last resort within an xlsx: the reporting date sits in the
    WORKSHEET'S OWN TAB NAME rather than any cell -- observed on "3. Hyd
    Corrosion Maintenance Plan...xlsx", whose real content sheet is
    literally titled "CMP 01.08.2026" (its own "Guideline" sheet instructs
    users to encode the date there). Tried per-sheet, first match wins.
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
        for ws in wb.worksheets:
            period = _to_period(ws.title)
            if period:
                return period, f"xlsx:sheet_title:{ws.title!r}"
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
        found = _period_from_form(file_bytes)
        if found:
            (year, month, day), source = found
            return _safe_date(year, month, day), source

        found = _period_from_pdf_text(file_bytes)
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
