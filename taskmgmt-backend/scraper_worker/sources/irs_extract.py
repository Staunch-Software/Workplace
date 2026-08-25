"""IRS (Indian Register of Shipping) Ship Survey Status report parser.

Uses PyMuPDF (fitz) per the original spec — coordinate-based, since IRS's layout isn't
fixed-position/tabular like DNV/ABS: Section D's column set genuinely changes between its
"Classification Surveys" sub-table and its "Statutory Surveys"/"Statutory Audits /
Inspections" sub-tables (confirmed against a real sample). Reuses the same row-clustering
approach as ABS (group_lines/cluster_rows/assign_columns) via a small word-shape adapter,
since the "wrapped cell overflows before or after its data line" problem found in ABS is
present here too.

In-scope sections only, matching the report's own TOC: C (certificates), D (surveys/
audits/inspections), E (Condition of Class), F (Statutory Condition), G (Memoranda).
Calibrated against: ship survey status report70903 (4).pdf.
"""
import re
import fitz

from sources.pdf_layout import group_lines, assign_columns, cluster_rows

CERT_COLUMNS = [
    ("certificate_name", 0, 280),
    ("issued_date", 280, 360),
    ("place_of_issuance", 360, 420),
    ("issued_by", 420, 470),
    ("expiry_date", 470, 530),
    ("cert_type", 530, 570),
    ("cert_issued_mode", 570, 999),
]

CLASS_SURVEY_COLUMNS = [
    ("survey_name", 0, 270),
    ("assigned_date", 270, 345),
    ("due_date", 345, 405),
    ("range_date", 405, 550),
    ("due_overdue", 550, 999),
]

DATE_RE = re.compile(r"\d{2}/\d{2}/\d{4}")

STATUTORY_SURVEY_COLUMNS = [
    ("survey_name", 0, 340),
    ("last_survey_date", 340, 400),
    ("carried_out_by", 400, 450),
    ("range_dates", 450, 555),
    ("due_overdue", 555, 999),
]

CONDITION_COLUMNS = [
    ("code", 0, 110),
    ("reference_number", 110, 260),
    ("due_date", 260, 999),
]

CERT_GROUPS = {"Class Certificate", "Statutory Certificate", "Statutory Audits / Inspections"}
SURVEY_GROUPS = {"Classification Surveys", "Statutory Surveys", "Statutory Audits / Inspections"}
COND_SECTIONS = {
    "E. Condition of Class": "Condition of Class",
    "F. Statutory Condition": "Statutory Condition",
    "G. Memoranda": "Memoranda",
}
TOP_SECTIONS = {
    "C. Details of Certificates : Class, Statutory and Audits / Inspections": "certificates",
    "D. Surveys / Audits / Inspections Status": "surveys",
}
OUT_OF_SCOPE_MARKERS = {"H. Additional Information"}


def _normalize_heading(text):
    """Confirmed real example: the same real "C. Details of Certificates..." heading
    renders as "...Audits / Inspections" (with a space before the slash) in some vessels'
    reports and "...Audits/ Inspections" (no space) in others (AMNSI STALLION) — a real
    PDF-generation inconsistency, not something our own code introduced. That single missing
    space made the exact-string-equality check below silently never enter "certificates"
    mode at all for that vessel (certificates: 0). Normalize spacing around "/" before every
    comparison instead of relying on brittle exact equality."""
    return re.sub(r"\s*/\s*", "/", text.strip())


def _normalize_set(items):
    return {_normalize_heading(x) for x in items}


def _normalize_dict(d):
    return {_normalize_heading(k): v for k, v in d.items()}


CERT_GROUPS_NORM = _normalize_set(CERT_GROUPS)
SURVEY_GROUPS_NORM = _normalize_set(SURVEY_GROUPS)
COND_SECTIONS_NORM = _normalize_dict(COND_SECTIONS)
TOP_SECTIONS_NORM = _normalize_dict(TOP_SECTIONS)
OUT_OF_SCOPE_MARKERS_NORM = _normalize_set(OUT_OF_SCOPE_MARKERS)

CODE_RE = re.compile(r"^[A-Z]{1,4}\d{3,6}\.$")
NONE_MARKERS = {"*** No Statutory Condition Recommended ***", "None", "NIL", "N/A"}

NOISE_PATTERNS = (
    re.compile(r"^IR CLASS$"),
    re.compile(r"^SHIP SURVEY STATUS$"),
    re.compile(r"^Name\s*:"),
    re.compile(r"^Status\s*:"),
    re.compile(r"^IR Number"),
    re.compile(r"^IMO Number"),
    re.compile(r"^Survey Status Report$"),
    re.compile(r"^Printed On"),
    re.compile(r"^Page \d+\s*/\s*\d+$"),
    re.compile(r"^Note\s*:"),
    re.compile(r"^Cert\. (Issued Mode|Type) -"),
    re.compile(r"^The Class / Statutory"),
    re.compile(r"^This may not indicate"),
    re.compile(r"^Certificate name"),
    re.compile(r"^Issuance Type Issued Mode$"),
    re.compile(r"^Survey Name Assigned Date"),
    re.compile(r"^Statutory Certificates Status"),
    re.compile(r"^Date Out By$"),
    re.compile(r"^Code Reference Number"),
)


def _fitz_words_to_lines(page):
    """Adapt fitz's (x0,y0,x1,y1,text,...) tuples to the pdfplumber-shaped dicts
    group_lines/assign_columns expect."""
    raw = page.get_text("words")
    words = [{"x0": w[0], "x1": w[2], "top": w[1], "text": w[4]} for w in raw]
    return group_lines(words)


def _is_noise(text):
    for pat in NOISE_PATTERNS:
        if pat.match(text):
            return True
    return False


def _clean(record):
    return {k: (v.strip() if isinstance(v, str) and v.strip() else (None if isinstance(v, str) else v))
            for k, v in record.items()}


def _split_range(text, sep_words=("To", "-")):
    """Split a compound date-range string into (from, to). IRS's dates are DD/MM/YYYY (no
    dashes at all in the date itself, unlike DNV/ABS's DD-Mon-YYYY), and its actual range
    separator is the literal word "To" (e.g. "15/12/2026 To 15/03/2027") — confirmed live,
    this was previously being missed entirely because the function ignored its own
    sep_words parameter and hardcoded a "-" split, which never matches here."""
    if not text:
        return None, None
    for sep in sep_words:
        pattern = rf"\s+{re.escape(sep)}\s+" if sep.isalpha() else rf"\s*{re.escape(sep)}\s*"
        parts = [p.strip() for p in re.split(pattern, text, flags=re.IGNORECASE) if p.strip()]
        if len(parts) >= 2:
            return parts[0], parts[-1]
    text = text.strip()
    return (None, text) if text else (None, None)


def _tag_lines(path):
    tagged = []
    section = None
    subsection = None

    doc = fitz.open(path)
    for page_index, page in enumerate(doc):
        if page_index < 2:
            # page 1 = cover, page 2 = Table of Contents — both list every section title
            # as plain text (page 2's listing of Section D is even worded differently
            # from the real heading later: "Survey / Audit / Inspection Status" vs
            # "Surveys / Audits / Inspections Status"), which false-triggers section
            # detection below. Real content starts at page 3 ("A. Ship Particulars").
            continue
        for line in _fitz_words_to_lines(page):
            text = line["text"].strip()
            if not text or _is_noise(text):
                continue
            norm = _normalize_heading(text)

            if norm in OUT_OF_SCOPE_MARKERS_NORM:
                section = "out_of_scope"
                continue
            if section == "out_of_scope":
                continue
            if norm in TOP_SECTIONS_NORM:
                section = TOP_SECTIONS_NORM[norm]
                # "Class Certificate" / "Classification Surveys" have no explicit group
                # header of their own in this report — they're the implicit first group.
                subsection = "Class Certificate" if section == "certificates" else "Classification Surveys"
                continue
            if norm in COND_SECTIONS_NORM:
                section = "conditions"
                subsection = COND_SECTIONS_NORM[norm]
                continue
            if section == "certificates" and norm in CERT_GROUPS_NORM:
                subsection = text
                continue
            if section == "surveys" and norm in SURVEY_GROUPS_NORM:
                subsection = text
                continue
            if section == "conditions" and text in NONE_MARKERS:
                continue

            tagged.append((section, subsection, text, line))
    return tagged


def _parse_cert_table(tagged):
    rows = []
    i = 0
    while i < len(tagged):
        sec, sub, _, _ = tagged[i]
        if sec != "certificates":
            i += 1
            continue
        j = i
        run = []
        while j < len(tagged) and tagged[j][0] == sec and tagged[j][1] == sub:
            run.append(tagged[j][3])
            j += 1
        for row_lines in cluster_rows(run, gap_threshold=6.0):
            words = [w for l in row_lines for w in l["words"]]
            cols = assign_columns(words, CERT_COLUMNS)
            if cols["issued_date"] and DATE_RE.search(cols["issued_date"]):
                rows.append({
                    "certificate_name": cols["certificate_name"] or None,
                    "issued_date": cols["issued_date"],
                    "place_of_issuance": cols["place_of_issuance"] or None,
                    "issued_by": cols["issued_by"] or None,
                    "expiry_date": cols["expiry_date"] or None,
                    "term_type": cols["cert_type"] or None,
                    "raw_code": cols["cert_issued_mode"] or None,
                    "category": sub,
                    "doc_type": "CERTIFICATE",
                    "certificate_number": None,
                })
        i = j

    for idx in range(1, len(rows)):
        if rows[idx]["category"] is None:
            rows[idx]["category"] = rows[idx - 1]["category"]
    return rows


def _parse_survey_table(tagged):
    rows = []
    i = 0
    while i < len(tagged):
        sec, sub, _, _ = tagged[i]
        if sec != "surveys":
            i += 1
            continue
        j = i
        run = []
        while j < len(tagged) and tagged[j][0] == sec and tagged[j][1] == sub:
            run.append(tagged[j][3])
            j += 1

        is_classification = sub == "Classification Surveys"
        columns = CLASS_SURVEY_COLUMNS if is_classification else STATUTORY_SURVEY_COLUMNS
        date_key = "due_date" if is_classification else "last_survey_date"

        for row_lines in cluster_rows(run, gap_threshold=6.0):
            words = [w for l in row_lines for w in l["words"]]
            cols = assign_columns(words, columns)
            if not cols.get(date_key) or not DATE_RE.search(cols[date_key]):
                continue  # label-only entry with no data (e.g. a bare "Intermediate
                          # Survey" heading whose real data lives in a separate row) — skip
            if is_classification:
                range_from, range_to = _split_range(cols["range_date"])
                rows.append({
                    "survey_name": cols["survey_name"] or None,
                    "code": None,
                    "category": sub,
                    "due_date": cols["due_date"] or None,
                    "range_date_from": range_from,
                    "range_date_to": range_to,
                    "last_survey_date": None,
                    "last_attending_office": None,
                    "extended_force_majeure": None,
                    "status": cols["due_overdue"] or None,
                })
            else:
                range_from, range_to = _split_range(cols["range_dates"])
                rows.append({
                    "survey_name": cols["survey_name"] or None,
                    "code": None,
                    "category": sub,
                    "due_date": range_to,
                    "range_date_from": range_from,
                    "range_date_to": range_to,
                    "last_survey_date": cols["last_survey_date"] or None,
                    "last_attending_office": cols["carried_out_by"] or None,
                    "extended_force_majeure": None,
                    "status": cols["due_overdue"] or None,
                })
        i = j

    for idx in range(1, len(rows)):
        if rows[idx]["category"] is None:
            rows[idx]["category"] = rows[idx - 1]["category"]
    return rows


def _irs_category_for_code(condition_no):
    """Per the real classification rule (confirmed via a working reference implementation,
    not the section title a code happens to render under): HM prefix -> Memoranda, bare H
    or M prefix -> COC, bare G prefix -> Dispensation. Every code prefix seen in our real
    samples so far (H0301, M0306, HM0301) happened to agree with section-based tagging too
    (H/M only ever appeared under "Condition of Class", HM only under "Memoranda") — but no
    real sample has ever had a bare G-prefixed code, so the Dispensation path below is
    unverified against real data (flagged here rather than claimed as tested)."""
    if condition_no.startswith("HM"):
        return "MEMORANDA"
    if condition_no.startswith("G"):
        return "DISPENSATION"  # UNVERIFIED — no real sample has hit this path
    if condition_no.startswith("H") or condition_no.startswith("M"):
        return "COC"
    return "FINDINGS"  # also unverified — no real sample code has fallen through to here


def _parse_conditions(tagged):
    conditions = []
    current = None

    def flush():
        nonlocal current
        if current is not None:
            current["description"] = " ".join(current.pop("_narrative", [])) or None
            conditions.append(current)
        current = None

    for sec, subsection, text, line in tagged:
        if sec != "conditions":
            if current is not None:
                flush()
            continue

        cols = assign_columns(line["words"], CONDITION_COLUMNS)
        first_word = text.split(" ", 1)[0]
        if CODE_RE.match(first_word):
            flush()
            code = first_word.rstrip(".")
            current = {
                "condition_no": code,
                "reference_number": cols["reference_number"] or None,
                "due_date": cols["due_date"] or None,
                "condition_category": subsection,
                "category": _irs_category_for_code(code),
                "status": None,
                "raised_date": None,
                "_narrative": [],
            }
            continue
        if current is None:
            continue
        current["_narrative"].append(text)

    flush()
    return conditions


def parse_irs_pdf(path):
    tagged = _tag_lines(path)
    certificates = _parse_cert_table(tagged)
    surveys = _parse_survey_table(tagged)
    conditions = _parse_conditions(tagged)
    return {
        "certificates": [_clean(c) for c in certificates],
        "surveys": [_clean(s) for s in surveys],
        "conditions": [_clean(c) for c in conditions],
    }


if __name__ == "__main__":
    import sys
    import json

    path = sys.argv[1] if len(sys.argv) > 1 else (
        r"C:\Users\Seenu Maheshwaran\Downloads\ship survey status report70903 (4).pdf"
    )
    result = parse_irs_pdf(path)
    print(f"certificates: {len(result['certificates'])}")
    print(f"surveys: {len(result['surveys'])}")
    print(f"conditions: {len(result['conditions'])}")
    print()
    for c in result["certificates"]:
        print(c["category"], "|", c["certificate_name"], "|", c["issued_date"])
    print()
    for s in result["surveys"]:
        print(s["category"], "|", s["survey_name"], "|", s["due_date"])
    print()
    print(json.dumps(result["conditions"], indent=2))
