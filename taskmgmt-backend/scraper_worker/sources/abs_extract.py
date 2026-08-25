"""ABS Vessel Status Report (For Owner) parser.

Despite having visible row shading, this report is NOT reliably table-gridded from
pdfplumber's perspective (find_tables()/extract_tables() silently drop ungridded rows —
confirmed against the real sample, where it missed the very first survey row). It's also
NOT true that a wrapped cell's overflow always renders before or always after its row's
data line — both happen in the same document (confirmed: "Special Continuous Survey -
Machinery" wraps its prefix BEFORE the data line and its "3" suffix AFTER it). So row
boundaries are detected by vertical gap clustering (cluster_rows) rather than by column
content, then all words in a row-cluster are classified together. Calibrated against a
real sample: Vessel Status Report-GCL SABARMATI.pdf.

In-scope sections: Vessel Survey Summary (6 sub-tables), Vessel Certificates (9 groupings),
Vessel Findings (Condition of Class + Open ISM Non-Conformities - Plan Accepted), and
Facility Comments (Class/Statutory groupings — confirmed real content, category='MEMORANDA'
per the real classification rule: FC-prefixed comment numbers). Engineering Findings is
still genuinely out of scope, not in the original spec.
"""
import re
import pdfplumber

from sources.pdf_layout import group_lines, assign_columns, cluster_rows

SURVEY_COLUMNS = [
    ("survey_name", 0, 206),
    ("due_date", 206, 260),
    ("range_date", 260, 376),
    ("last_survey_date", 376, 412),
    ("last_attending_office", 412, 497),
    ("extended_force_majeure", 497, 549),
    ("status", 549, 999),
]

CERT_COLUMNS = [
    ("certificate_number", 0, 146),
    ("certificate_name", 146, 323),
    ("term", 323, 367),
    ("issue_date", 367, 422),
    ("expiry_date", 422, 471),
    ("last_state", 471, 540),
    ("last_state_date", 540, 999),
]

FINDING_COLUMNS = [
    ("condition_no", 0, 108),
    ("status", 108, 157),
    ("asset", 157, 254),
    ("survey_task", 254, 303),
    ("due_survey_task", 303, 378),
    ("finding_criticality", 378, 462),
    ("finding_type", 462, 512),
    ("date_created", 512, 558),
    ("due_date", 558, 999),
]

SURVEY_SUBSECTIONS = {
    "Class Survey", "Statutory Survey", "Special Service Survey",
    "ISM Audits", "ISPS Audits", "MLC Audits",
}
CERT_SUBSECTIONS = {
    "Class", "Load Line", "SOLAS", "MARPOL", "ISM", "ISPS", "MLC", "Cargo Gear", "Other",
}
FINDING_SUBSECTIONS = {
    "Condition of Class", "Statutory Condition", "Open ISM Non-Conformities - Plan Accepted",
}
# Per the real classification rule: "Condition of Class" and "Statutory Condition" (its
# counterpart for statutory certificates — confirmed real subsection missed on the first
# pass, present in 3 of 5 real samples) are both COC records; "Open ISM Non-Conformities"
# is an audit Finding, not a class condition.
FINDING_CATEGORY_BY_SUBSECTION = {
    "Condition of Class": "COC",
    "Statutory Condition": "COC",
    "Open ISM Non-Conformities - Plan Accepted": "FINDINGS",
}
TOP_SECTIONS = {
    "Vessel Survey Summary": "surveys",
    "Vessel Certificates": "certificates",
    "Vessel Findings": "findings",
    "Facility Comments": "facility_comments",
}
OUT_OF_SCOPE_MARKERS = {"Engineering Findings"}

# Confirmed real content across every sampled vessel — "Class"/"Statutory" comment groupings.
FACILITY_COMMENT_SUBSECTIONS = {"Class", "Statutory"}

# Comment numbers come in two real forms — "FC-2802710328038-2075335" (newer) and a bare
# "365427" (older, no FC- prefix) — confirmed both appear as real Facility Comments data.
COMMENT_NO_RE = re.compile(r"^(FC-[\w-]+|\d{4,})$")

# Calibrated against a real Facility Comments table (confirmed x-positions): "Comment No.
# Survey Task Date of Issue Expiry Date Exam Required" header, data row
# "FC-2802710328038-2075335 08-Mar-2021 - NO" with the Survey Task value ("-") sometimes
# wrapping onto its own line.
FACILITY_COMMENT_COLUMNS = [
    ("comment_no", 0, 165),
    ("survey_task", 165, 355),
    ("date_of_issue", 355, 445),
    ("expiry_date", 445, 505),
    ("exam_required", 505, 999),
]

NARRATIVE_LABELS = {"Found": "Found", "Recommended:": "Recommended", "Plan Acceptance:": "Plan Acceptance"}

CONDITION_NO_RE = re.compile(r"^\d+\.\d+$")

NOISE_PATTERNS = (
    re.compile(r"^VESSEL STATUS REPORT"),
    re.compile(r"^In Operation,"),
    re.compile(r"^Date of Report:"),
    re.compile(r"^CLASS NUMBER:"),
    re.compile(r"^IMO Number:"),
    re.compile(r"^Page \d+ of \d+$"),
    re.compile(r"^Attendance Workorders have not been"),
)


def _is_noise_line(text, vessel_name_hint=None):
    for pat in NOISE_PATTERNS:
        if pat.match(text):
            return True
    if vessel_name_hint and text.strip() == vessel_name_hint:
        return True
    return False


def _clean(record):
    return {k: (v.strip() if isinstance(v, str) and v.strip() else (None if isinstance(v, str) else v))
            for k, v in record.items()}


def _split_range(text):
    m = re.match(r"(\d{2}-\w{3}-\d{4})\s*-\s*(\d{2}-\w{3}-\d{4})", text)
    if m:
        return m.group(1), m.group(2)
    return None, None


_DATE_HEADER_SUFFIX_RE = re.compile(r"^(\d{1,2}-\w{3}-\d{4})\s+(?:State Date|Extended Date|Estimated Date)\s*$")


def _strip_date_header_suffix(text):
    """This report's column headers repeat on later pages (normal for a multi-page table) —
    confirmed live across several vessels' PDFs, a repeated header line ('... State Date',
    '... Extended Date', 'Estimated Date') sometimes clusters onto the same row as a real
    date value in the same column, producing e.g. "13-Jan-2024 State Date". Strip the
    trailing header label when a real date precedes it; a pure header line with no date at
    all (e.g. bare "Estimated Date") has nothing to recover and is returned as-is — the
    downstream date sanitizer (db.py) will correctly null it rather than crash."""
    if not text:
        return text
    m = _DATE_HEADER_SUFFIX_RE.match(text.strip())
    return m.group(1) if m else text


def _tag_lines(path, vessel_name):
    """Phase 1: walk the whole doc once, tag each content line with (section, subsection)."""
    tagged = []
    section = None
    subsection = None

    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            for line in group_lines(words):
                text = line["text"].strip()
                if not text or _is_noise_line(text, vessel_name):
                    continue

                # Check for a real section header BEFORE the out-of-scope short-circuit —
                # "Engineering Findings" (out of scope) genuinely renders BEFORE "Facility
                # Comments" in the real report (confirmed real page order: pages 9/10/11),
                # so an out-of-scope section must still be escapable, or "Facility Comments"
                # would silently never be reached.
                if text in TOP_SECTIONS:
                    section = TOP_SECTIONS[text]
                    subsection = None
                    continue
                if text in OUT_OF_SCOPE_MARKERS:
                    section = "out_of_scope"
                    continue
                if section == "out_of_scope":
                    continue
                if section == "surveys" and text in SURVEY_SUBSECTIONS:
                    subsection = text
                    continue
                if section == "certificates" and text in CERT_SUBSECTIONS:
                    subsection = text
                    continue
                if section == "findings" and text in FINDING_SUBSECTIONS:
                    subsection = text
                    continue
                if section == "facility_comments" and text in FACILITY_COMMENT_SUBSECTIONS:
                    subsection = text
                    continue
                if section == "facility_comments" and text.startswith("Comment No."):
                    continue  # column header row
                if section == "surveys" and (
                    text.startswith("Survey Name") or text.startswith("Last Survey")
                    or ("Force" in text and "Majeure" in text)
                ):
                    continue
                if section == "certificates" and (
                    text.startswith("Certificate Number") or text.startswith("Expiry")
                    or text.startswith("Last Certificate")
                ):
                    continue
                if section == "findings" and text.startswith("Condition") and "Status" not in text and "No." not in text:
                    continue
                if section == "findings" and (text.startswith("No.") or text.startswith("Status Asset")):
                    continue

                tagged.append((section, subsection, text, line))
    return tagged


def _parse_row_tables(tagged, section_name, columns, date_key, build_row):
    """Group a (section, subsection) run of tagged lines into row-clusters by vertical
    gap, then classify each row-cluster's combined words in one pass."""
    rows_out = []
    i = 0
    while i < len(tagged):
        sec, sub, _, _ = tagged[i]
        if sec != section_name:
            i += 1
            continue
        j = i
        run_lines = []
        while j < len(tagged) and tagged[j][0] == sec and tagged[j][1] == sub:
            run_lines.append(tagged[j][3])
            j += 1
        for row_lines in cluster_rows(run_lines, gap_threshold=8.0):
            all_words = [w for l in row_lines for w in l["words"]]
            cols = assign_columns(all_words, columns)
            if cols[date_key]:
                rows_out.append(build_row(cols, sub))
        i = j

    # A subsection header occasionally fails to re-match right after a page break
    # (confirmed against the real sample for one ISPS Audits row) — a None category
    # between two rows of the same real subsection is a page-continuation artifact,
    # not a genuinely uncategorized row, so inherit the previous row's category.
    for idx in range(1, len(rows_out)):
        if rows_out[idx]["category"] is None:
            rows_out[idx]["category"] = rows_out[idx - 1]["category"]

    return rows_out


def _build_survey_row(cols, subsection):
    range_from, range_to = _split_range(cols["range_date"])
    last_survey_date = cols["last_survey_date"]
    return {
        "survey_name": cols["survey_name"] or None,
        "due_date": _strip_date_header_suffix(cols["due_date"]),
        "range_date_from": range_from,
        "range_date_to": range_to,
        "last_survey_date": _strip_date_header_suffix(last_survey_date) if last_survey_date != "-" else None,
        "last_attending_office": cols["last_attending_office"] if cols["last_attending_office"] != "-" else None,
        "extended_force_majeure": cols["extended_force_majeure"] if cols["extended_force_majeure"] != "-" else None,
        "status": cols["status"] or None,
        "category": subsection,
        "code": None,
    }


def _build_cert_row(cols, subsection):
    expiry_date = cols["expiry_date"]
    return {
        "certificate_number": cols["certificate_number"] or None,
        "certificate_name": cols["certificate_name"] or None,
        "term_type": cols["term"] or None,
        "issued_date": _strip_date_header_suffix(cols["issue_date"]),
        "expiry_date": _strip_date_header_suffix(expiry_date) if expiry_date != "-" else None,
        "status": cols["last_state"] or None,
        "status_date": _strip_date_header_suffix(cols["last_state_date"]) or None,
        "category": subsection,
        "doc_type": "CERTIFICATE",
        "place_of_issuance": None,
        "issued_by": None,
        "raw_code": None,
    }


def _fix_split_date(text):
    """Column text sometimes wraps mid-date across lines and rejoins with a stray
    space ('14- Sep-2026' instead of '14-Sep-2026') — confirmed against the real sample."""
    if not text:
        return text
    return re.sub(r"(\d+)-\s+", r"\1-", text).strip()


def _parse_findings(tagged):
    conditions = []
    current = None
    narrative_mode = None
    pending_finding_cols = None
    current_subsection = None

    def flush():
        nonlocal current, narrative_mode
        if current is not None:
            narrative = current.pop("_narrative", {})
            current["description"] = " ".join(
                f"{label}: {' '.join(parts)}" for label, parts in narrative.items()
            ) or None
            current["raised_date"] = _fix_split_date(current["raised_date"])
            current["due_date"] = _fix_split_date(current["due_date"])
            conditions.append(current)
        current = None
        narrative_mode = None

    def merge_pending(cols):
        nonlocal pending_finding_cols
        if pending_finding_cols is None:
            pending_finding_cols = {}
        for key in ("status", "date_created", "due_date"):
            if cols.get(key):
                pending_finding_cols[key] = (
                    (pending_finding_cols.get(key, "") + " " + cols[key]).strip()
                )

    for sec, subsection, text, line in tagged:
        if sec != "findings":
            if current is not None:
                flush()
            pending_finding_cols = None
            current_subsection = None
            continue

        # A subsection change always starts a fresh finding — without this, stray
        # column fragments belonging to the NEXT finding (which can render before its
        # own condition number — confirmed against the real sample) get vacuumed into
        # the PREVIOUS finding's still-open narrative instead.
        if subsection != current_subsection:
            flush()
            pending_finding_cols = None
            current_subsection = subsection

        matched_label = next((lbl for lbl in NARRATIVE_LABELS if text.startswith(lbl)), None)
        if matched_label:
            narrative_mode = NARRATIVE_LABELS[matched_label]
            remainder = text[len(matched_label):].strip()
            if remainder and current is not None:
                current["_narrative"].setdefault(narrative_mode, []).append(remainder)
            continue

        cols = assign_columns(line["words"], FINDING_COLUMNS)
        if cols["condition_no"] and CONDITION_NO_RE.match(cols["condition_no"].strip()):
            flush()
            current_subsection = subsection
            current = {
                "condition_no": cols["condition_no"].strip(),
                "status": cols["status"] or None,
                "raised_date": cols["date_created"] or None,
                "due_date": cols["due_date"] or None,
                "condition_category": subsection,
                "category": FINDING_CATEGORY_BY_SUBSECTION.get(subsection),
                "reference_number": None,
                "_narrative": {},
            }
            if pending_finding_cols:
                for key, colkey in (("status", "status"), ("raised_date", "date_created"), ("due_date", "due_date")):
                    if pending_finding_cols.get(colkey):
                        current[key] = (pending_finding_cols[colkey] + " " + (current[key] or "")).strip()
                pending_finding_cols = None
            continue
        if current is None:
            if not narrative_mode and any(cols[k] for k in ("status", "date_created", "due_date")):
                merge_pending(cols)
            continue
        if narrative_mode:
            current["_narrative"].setdefault(narrative_mode, []).append(text)
        else:
            if cols["status"]:
                current["status"] = ((current["status"] or "") + " " + cols["status"]).strip()
            if cols["date_created"]:
                current["raised_date"] = ((current["raised_date"] or "") + " " + cols["date_created"]).strip()
            if cols["due_date"]:
                current["due_date"] = ((current["due_date"] or "") + " " + cols["due_date"]).strip()

    flush()
    return conditions


def _parse_facility_comments(tagged):
    """Same real layout quirk as _parse_findings above (a comment's Survey Task column
    value sometimes wraps onto its own line, confirmed live — the "-" line right after
    "FC-2802710328038-2075335 08-Mar-2021 - NO" is that column's value, not new data),
    parsed the same way: cluster_rows + assign_columns + accumulate narrative until the
    next comment code. Simpler than findings — one flat Description block, no
    "Found:"/"Recommended:" narrative sub-labels."""
    comments = []
    current = None
    current_subsection = None

    def flush():
        nonlocal current
        if current is not None:
            current["description"] = " ".join(current.pop("_narrative", [])) or None
            comments.append(current)
        current = None

    i = 0
    n = len(tagged)
    while i < n:
        sec, sub, _, _ = tagged[i]
        if sec != "facility_comments":
            i += 1
            continue
        j = i
        run = []
        while j < n and tagged[j][0] == sec and tagged[j][1] == sub:
            run.append(tagged[j][3])
            j += 1
        if sub != current_subsection:
            flush()
            current_subsection = sub
        for cluster in cluster_rows(run, gap_threshold=8.0):
            words = [w for l in cluster for w in l["words"]]
            cols = assign_columns(words, FACILITY_COMMENT_COLUMNS)
            comment_no = (cols.get("comment_no") or "").strip()
            if COMMENT_NO_RE.match(comment_no):
                flush()
                current_subsection = sub
                expiry_date = cols.get("expiry_date")
                current = {
                    "condition_no": comment_no,
                    "condition_category": sub,
                    "category": "MEMORANDA",
                    "reference_number": None,
                    "status": cols.get("exam_required") or None,
                    "raised_date": cols.get("date_of_issue") or None,
                    "due_date": expiry_date if expiry_date not in (None, "-") else None,
                    "_narrative": [],
                }
                continue
            if current is None:
                continue
            combined = " ".join(l["text"].strip() for l in cluster if l["text"].strip())
            if combined and combined != "-":
                current["_narrative"].append(combined)
        i = j

    flush()
    return comments


def parse_abs_pdf(path, vessel_name=None):
    tagged = _tag_lines(path, vessel_name)

    surveys = _parse_row_tables(tagged, "surveys", SURVEY_COLUMNS, "due_date", _build_survey_row)
    certificates = _parse_row_tables(tagged, "certificates", CERT_COLUMNS, "issue_date", _build_cert_row)
    conditions = _parse_findings(tagged)
    conditions += _parse_facility_comments(tagged)

    return {
        "certificates": [_clean(c) for c in certificates],
        "surveys": [_clean(s) for s in surveys],
        "conditions": [_clean(c) for c in conditions],
    }


if __name__ == "__main__":
    import sys
    import json

    path = sys.argv[1] if len(sys.argv) > 1 else (
        r"C:\Users\Seenu Maheshwaran\Downloads\Vessel Status Report-GCL SABARMATI.pdf"
    )
    result = parse_abs_pdf(path, vessel_name="GCL SABARMATI")
    print(f"certificates: {len(result['certificates'])}")
    print(f"surveys: {len(result['surveys'])}")
    print(f"conditions: {len(result['conditions'])}")
    print()
    for s in result["surveys"]:
        print(s["category"], "|", s["survey_name"], "|", s["due_date"])
