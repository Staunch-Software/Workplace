"""Row-per-item-line view of an ORB entry, shared by the Excel and PDF exports."""
import re

BLANK_ITEM = "(blank)"

_QTY_IN_TEXT = re.compile(r"(\d+(?:[.,]\d+)?)\s*(M3|M³|MT|M\s*T|TONNES?|T|L|LTRS?)\b", re.IGNORECASE)


# A row that is itself a numbered item (capacity / retained reading) but has no
# number in the Item column is a real omission; a wrapped continuation row is not.
_NUMBERED_ROW = re.compile(r"^\s*(CAPACITY|CAP\b|RETAINED|RETD\b)", re.IGNORECASE)


def _qty_from_text(text: str) -> str:
    m = _QTY_IN_TEXT.search(text or "")
    if not m:
        return ""
    unit = m.group(2).upper().replace("M³", "m3").replace(" ", "")
    unit = {"M3": "m3", "MT": "MT", "T": "MT", "TONNE": "MT", "TONNES": "MT"}.get(unit, unit)
    return f"{m.group(1).replace(',', '.')} {unit}"


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
    rows = []
    for l in lines:
        item = l.get("item")
        text = l.get("text") or ""
        blank = not item and bool(_NUMBERED_ROW.match(text))
        rows.append({
            "item": item or (BLANK_ITEM if blank else ""),
            "text": text,
            "qty": _qty_from_text(text),
            "blank_item": blank,
        })
    return rows
