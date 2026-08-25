"""DNV Class Status Report (form CLA 401) parser.

Position-based (no table gridlines). Calibrated against two real samples:
41195 - AM KIRTI - Class status report.pdf (Memorandum to owner section, no populated
Conditions) and dnv_87130 - GCL SARASWATI (a real populated Condition row). In-scope
sections: Vessel certificates (Class/Statutory), Vessel surveys (Class/Statutory),
Conditions, Memorandum to owner. Everything after (Recordings, machinery/hull item lists)
is out of scope and ignored.

Conditions and Memorandum to owner both use the same real-world layout quirk already
solved for ABS/IRS: a row's own data can wrap onto a line rendered BEFORE its code (e.g.
"Qingdao FiS" renders on the line above "MO 4 2023-07-14", confirmed against a real
sample) — so both are parsed via the same cluster_rows (vertical-gap) + assign_columns
(x-position) approach as ABS/IRS's row-tables, not simple per-line state machines like
certs/surveys above use.
"""
import re
import pdfplumber

from sources.pdf_layout import group_lines, assign_columns, cluster_rows

CERT_COLUMNS = [
    ("description", 0, 200),
    ("code", 200, 250),
    ("issued", 250, 300),
    ("location", 300, 385),
    ("valid_until", 385, 438),
    ("type", 438, 485),
    ("status", 485, 999),
]

SURVEY_COLUMNS = [
    ("description", 0, 218),
    ("code", 218, 283),
    ("last_survey", 283, 333),
    ("location", 333, 397),
    ("next_survey", 397, 489),
    ("status", 489, 999),
]

# Calibrated against a real populated Condition row (GCL SARASWATI, condition CA 600):
# "No. Issued date Issued at Due date Postponed Status" header, data row
# "CA 600 2026-08-05 France FIS 2026-10-05 Due" — confirmed via real word x-positions.
COND_COLUMNS = [
    ("condition_no", 0, 95),
    ("issued_date", 95, 205),
    ("issued_at", 205, 330),
    ("due_date", 330, 405),
    ("postponed", 405, 475),
    ("status", 475, 999),
]

# Memorandum to owner's table is narrower — only 3 real columns ("No. Issued date Issued
# at", confirmed real header text, no Due date/Postponed/Status here at all). The reference
# number (e.g. "Ref 294b") renders as extra wrapped text in the SAME x-range as the code,
# not its own column — confirmed against the real AM KIRTI sample.
MEMO_COLUMNS = [
    ("no_col", 0, 100),
    ("issued_date", 100, 205),
    ("issued_at", 205, 999),
]

COND_CODE_RE = re.compile(r"^([A-Z]{1,4}\s?\d+)\b")
MEMO_CODE_RE = re.compile(r"^(MO\s*\d+)\b", re.IGNORECASE)

SECTION_HEADERS = {"Vessel certificates": "certificates", "Vessel surveys": "surveys",
                    "Conditions": "conditions", "Memorandum to owner": "memoranda"}
SUBSECTION_HEADERS_CERT = {"Class certificates", "Statutory certificates"}
SUBSECTION_HEADERS_SURVEY = {"Class surveys", "Statutory surveys"}
SUBSECTION_HEADERS_COND = {
    "Conditions related to class",
    "Conditions related to statutory certificates",
}
SUBSECTION_HEADERS_MEMO = {
    "Memoranda related to class certificate",
    "Memoranda related to statutory certificates",
}
OUT_OF_SCOPE_MARKERS = {"Recordings", "Surveys of machinery items", "Surveyed hull items"}

# Both the Conditions and Memorandum tables repeat this style of column-header row — always
# starts with the literal "No." label. Confirmed real examples:
#   "No. Issued date Issued at Due date Postponed Status"  (Conditions)
#   "No. Issued date Issued at"                             (Memorandum to owner)
_TABLE_HEADER_RE = re.compile(r"^No\.\s")

FOOTER_PATTERNS = (
    re.compile(r"^Form code:"),
    re.compile(r"^DNV$"),
    # "DNV" and "ID no.: <n>" sometimes render as one merged line ("DNV ID no.: 87130") on a
    # page break rather than two separate lines — confirmed real example leaking into a
    # Condition's narrative once conditions started accumulating text across pages. Matching
    # "ID no.:" anywhere in the line (not just at the start) catches both cases.
    re.compile(r"ID no\.:"),
    re.compile(r"^Date of issue:"),
)


def _is_noise_line(text):
    if not text.strip():
        return True
    for pat in FOOTER_PATTERNS:
        # search, not match — .match() anchors at position 0 regardless of whether the
        # pattern itself has a leading ^, so the "ID no.:" mid-string pattern above needs
        # this to actually work (all the ^-anchored patterns behave identically either way).
        if pat.search(text.strip()):
            return True
    if text.strip() in ("IMPORTANT",):
        return True
    if text.startswith("The vessel's class will be automatically"):
        return True
    if text.startswith("RELEVANT INTERNATIONAL"):
        return True
    return False


def _clean(record):
    return {k: (v if v not in ("", None) else None) for k, v in record.items()}


def _split_next_survey(text):
    """'2029-03-27, 2029-06-27' -> ('2029-03-27', '2029-06-27')"""
    parts = [p.strip().rstrip(",") for p in text.split(",") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return None, parts[0]
    return None, None


def _parse_cond_or_memo_rows(lines_by_subsection, columns, code_re, code_col, category, is_memo):
    """Shared by Conditions ('CA 600' style codes) and Memorandum to owner ('MO 2' style
    codes) — same real layout problem ABS/IRS already solve: a row's location/date can wrap
    onto the line BEFORE its code line (confirmed real example: "Qingdao FiS" renders above
    "MO 4 2023-07-14"), so cluster_rows + assign_columns handles it correctly regardless of
    line order, rather than a per-line state machine.

    is_memo=True additionally splits an inline "Ref <number>" out of the code column into
    reference_number (confirmed real example: "MO 2 Ref 294b") — Conditions rows never had
    this pattern in the real sample, so it's memo-specific."""
    rows = []
    for subsection, lines in lines_by_subsection.items():
        current = None

        def flush():
            nonlocal current
            if current is not None:
                issued_at = current.pop("_issued_at", None)
                narrative = current.pop("_narrative", [])
                parts = ([f"Issued at: {issued_at}."] if issued_at else []) + narrative
                current["description"] = " ".join(parts) or None
                rows.append(current)
            current = None

        for cluster in cluster_rows(lines, gap_threshold=8.0):
            words = [w for l in cluster for w in l["words"]]
            cols = assign_columns(words, columns)
            code_text = (cols.get(code_col) or "").strip()
            m = code_re.match(code_text)
            if m:
                flush()
                code = m.group(1).strip()
                reference_number = None
                if is_memo:
                    remainder = code_text[m.end():].strip()
                    reference_number = re.sub(r"(?i)^Ref\s*", "", remainder).strip() or None
                current = {
                    "condition_no": code,
                    "condition_category": subsection,
                    "category": category,
                    "reference_number": reference_number,
                    "status": (cols.get("status") or None) if not is_memo else None,
                    "raised_date": cols.get("issued_date") or None,
                    "due_date": (cols.get("due_date") or None) if not is_memo else None,
                    "_issued_at": cols.get("issued_at") or None,
                    "_narrative": [],
                }
                continue
            if current is None:
                continue
            combined = " ".join(l["text"].strip() for l in cluster if l["text"].strip())
            if combined:
                current["_narrative"].append(combined)
        flush()
    return rows


def parse_dnv_pdf(path):
    certificates = []
    surveys = []

    section = None       # 'certificates' | 'surveys' | 'conditions' | 'memoranda'
    subsection = None    # e.g. 'Class certificates'
    current_cert = None
    current_survey = None
    cond_lines = {}   # subsection -> [line, ...], post-processed after the main loop
    memo_lines = {}

    def flush_cert():
        nonlocal current_cert
        if current_cert:
            certificates.append(current_cert)
        current_cert = None

    def flush_survey():
        nonlocal current_survey
        if current_survey:
            surveys.append(current_survey)
        current_survey = None

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            for line in group_lines(words):
                text = line["text"].strip()
                if _is_noise_line(text):
                    continue

                # Check for a real section header BEFORE the out-of-scope short-circuit —
                # "Recordings" (out of scope) genuinely renders BEFORE "Memorandum to owner"
                # in the real report (confirmed real page order), so an out-of-scope section
                # must still be escapable by hitting one of our recognized section headers,
                # or "Memorandum to owner" itself would silently never be reached.
                if text in SECTION_HEADERS:
                    flush_cert()
                    flush_survey()
                    section = SECTION_HEADERS[text]
                    subsection = None
                    continue
                if text in OUT_OF_SCOPE_MARKERS:
                    flush_cert()
                    flush_survey()
                    section = "out_of_scope"
                    continue
                if section == "out_of_scope":
                    continue
                if text in SUBSECTION_HEADERS_CERT and section == "certificates":
                    flush_cert()
                    subsection = text
                    continue
                if text in SUBSECTION_HEADERS_SURVEY and section == "surveys":
                    flush_survey()
                    subsection = text
                    continue
                if text in SUBSECTION_HEADERS_COND and section == "conditions":
                    subsection = text
                    continue
                if text in SUBSECTION_HEADERS_MEMO and section == "memoranda":
                    subsection = text
                    continue

                if section in ("conditions", "memoranda"):
                    if text == "None" or _TABLE_HEADER_RE.match(text):
                        continue  # empty subsection marker, or the repeated column-header
                                  # row — confirmed real header text always starts "No. ...";
                                  # letting this through would glue header words onto the
                                  # next real row via cluster_rows.
                    target = cond_lines if section == "conditions" else memo_lines
                    target.setdefault(subsection, []).append(line)
                    continue

                if section == "certificates":
                    if text.startswith("Description") and "Code" in text:
                        continue  # column header row
                    cols = assign_columns(line["words"], CERT_COLUMNS)
                    if cols["code"]:
                        flush_cert()
                        current_cert = {
                            "certificate_name": cols["description"],
                            "raw_code": cols["code"],
                            "issued_date": cols["issued"] or None,
                            "place_of_issuance": cols["location"],
                            "expiry_date": cols["valid_until"] or None,
                            "term_type": cols["type"],
                            "status": cols["status"] or None,
                            "category": subsection,
                            "doc_type": "CERTIFICATE",
                            "certificate_number": None,
                            "issued_by": None,
                        }
                    elif current_cert:
                        for key, col in (("certificate_name", "description"), ("place_of_issuance", "location")):
                            if cols[col]:
                                current_cert[key] = (current_cert[key] + " " + cols[col]).strip()

                elif section == "surveys":
                    if text.startswith("Description") and "Code" in text:
                        continue
                    cols = assign_columns(line["words"], SURVEY_COLUMNS)
                    if cols["code"]:
                        flush_survey()
                        range_from, range_to = _split_next_survey(cols["next_survey"])
                        current_survey = {
                            "survey_name": cols["description"],
                            "code": cols["code"],
                            "last_survey_date": cols["last_survey"] or None,
                            "last_attending_office": cols["location"],
                            "range_date_from": range_from,
                            "range_date_to": range_to,
                            "due_date": range_to,
                            "status": cols["status"] or None,
                            "category": subsection,
                            "extended_force_majeure": None,
                        }
                    elif current_survey:
                        for key, col in (("survey_name", "description"), ("last_attending_office", "location")):
                            if cols[col]:
                                current_survey[key] = (current_survey[key] + " " + cols[col]).strip()

    flush_cert()
    flush_survey()

    conditions = _parse_cond_or_memo_rows(
        cond_lines, COND_COLUMNS, COND_CODE_RE, "condition_no", "COC", is_memo=False,
    )
    conditions += _parse_cond_or_memo_rows(
        memo_lines, MEMO_COLUMNS, MEMO_CODE_RE, "no_col", "MEMORANDA", is_memo=True,
    )

    return {
        "certificates": [_clean(c) for c in certificates],
        "surveys": [_clean(s) for s in surveys],
        "conditions": [_clean(c) for c in conditions],
    }


if __name__ == "__main__":
    import sys
    import json

    path = sys.argv[1] if len(sys.argv) > 1 else (
        r"C:\Users\Seenu Maheshwaran\Downloads\41195 - AM KIRTI - Class status report.pdf"
    )
    result = parse_dnv_pdf(path)
    print(f"certificates: {len(result['certificates'])}")
    print(f"surveys: {len(result['surveys'])}")
    print(f"conditions: {len(result['conditions'])}")
    print()
    print(json.dumps(result["certificates"][:2], indent=2))
    print(json.dumps(result["surveys"][:2], indent=2))
