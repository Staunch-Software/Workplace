"""Row-per-item-line view of an ORB entry, shared by the Excel and PDF exports."""
import re

BLANK_ITEM = "(blank)"

_QTY_IN_TEXT = re.compile(r"(\d+(?:[.,]\d+)?)\s*(M3|M\u00b3|MT|M\s*T|TONNES?|T|L|LTRS?)\b", re.IGNORECASE)
_LABEL_BEFORE = re.compile(r"(RETD|RETAINED|CAPACITY|CAP)\.?\s*[:=\-]?\s*$", re.IGNORECASE)

# A row that is itself a numbered item (capacity / retained reading) but has no number in the Item
# column is an omission ONLY inside a Code C 11.x sounding, where 11.2 and 11.3 are required.
# Elsewhere ("CAP.: 89.2 m3 RETD.: 7.4 m3" under 15.3, "RETD. 0.0 m3, TRANSFERRED TO ...") such a
# row just continues the line above it.
_NUMBERED_ROW = re.compile(r"^\s*(CAPACITY|CAP\b|RETAINED|RETD\b)", re.IGNORECASE)

# Notes the pipeline appends to an entry's description (re-read corrections, doubtful readings).
_NOTE_RE = re.compile(r"\[(?:Capacity auto-corrected|auto-corrected|re-read corrected|reading uncertain)[^\]]*\]", re.IGNORECASE)


def _qty_from_text(text: str) -> str:
    """Every "<number> <unit>" in the row, labelled when the text names it (RETD / CAP)."""
    out = []
    for m in _QTY_IN_TEXT.finditer(text or ""):
        unit = m.group(2).upper().replace("M\u00b3", "m3").replace(" ", "")
        unit = {"M3": "m3", "MT": "MT", "T": "MT", "TONNE": "MT", "TONNES": "MT"}.get(unit, unit)
        label = ""
        lm = _LABEL_BEFORE.search(text[max(0, m.start() - 14):m.start()])
        if lm:
            label = " (retained)" if lm.group(1).upper() in ("RETD", "RETAINED") else " (capacity)"
        out.append(f"{m.group(1).replace(',', '.')} {unit}{label}")
    return " / ".join(out)


def entry_line_rows(entry, quantities) -> list[dict]:
    """One dict per physical row of the block: {"item", "text", "qty", "blank_item"}.

    Entries extracted before item_lines existed (or whose lines are unknown) come
    back as a single row built from the entry itself, exactly as before.
    """
    lines = getattr(entry, "item_lines", None)
    if not lines:
        qty_str = " / ".join(f"{q.qty_value} {q.qty_unit} ({q.qty_type})" for q in quantities)
        return [{"item": entry.item_number or "", "text": entry.operation_description or "",
                 "qty": qty_str, "blank_item": False}]
    is_sounding = entry.orb_code == "C" and (entry.item_number or "").startswith("11")
    rows = []
    for l in lines:
        item = l.get("item")
        text = l.get("text") or ""
        blank = is_sounding and not item and bool(_NUMBERED_ROW.match(text))
        rows.append({
            "item": item or (BLANK_ITEM if blank else ""),
            "text": text,
            "qty": _qty_from_text(text),
            "blank_item": blank,
        })
    if len(rows) == 1 and quantities:
        rows[0]["qty"] = " / ".join(f"{q.qty_value} {q.qty_unit} ({q.qty_type})" for q in quantities)
    for m in _NOTE_RE.finditer(entry.operation_description or ""):
        rows.append({"item": "", "text": m.group(0), "qty": "", "blank_item": False})
    return rows
