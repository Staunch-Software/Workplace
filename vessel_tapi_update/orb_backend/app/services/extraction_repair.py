"""Post-extraction repairs for ORB entries (pure functions + one Gemini-assisted pass).

Everything here works on the plain dicts the extractor produces, before they are
saved, so it can be tested without a database or a Gemini key.

  * reattach_split_blocks  -- rows numbered 11.2/11.3 (etc.) at the top of a page belong
                              to the previous page's open block, not to the next tank.
  * trim_foreign_rows      -- text after the last numbered row of a sounding (a receipt page,
                              a stray signature) is not part of that sounding.
  * find_suspect_readings / apply_reread / verify_suspect_readings
                           -- retained figures that disagree with the running balance by a
                              small amount (or by a factor of 10) are re-read once on the
                              page image before they can raise a false alert.
"""
import asyncio
import logging
import re

from app.services.gemini_config import generate as gemini_generate

logger = logging.getLogger(__name__)

# Items that can only CONTINUE a block (the block's first item is 11.1 / 13 / 26.1).
_CONTINUATION_ITEMS = {
    "C": {"11.2", "11.3", "11.4"},
    "D": {"14", "15", "15.1", "15.2", "15.3"},
    "H": {"26.2", "26.3", "26.4"},
}
_ITEM_QTY_TYPE = {"11.2": "capacity", "11.3": "retained", "11.4": "collected"}

_NUMERIC_ROW = re.compile(r"\b(M3|M³|RETD|RETAINED|CAP|CAPACITY|START|STOP|COLLECTED)\b", re.IGNORECASE)
_NUMBER = re.compile(r"(?<![\d.])(\d+(?:[.,]\d+)?)(?![\d])")

SUSPECT_LIMIT = 25            # re-reads per upload (bounds Gemini cost)
SMALL_CHANGE_MAX = 1.0        # m3: unexplained change up to this is "suspect"
_MOVEMENT_TYPES = {"transferred", "disposed", "incinerated", "evaporated", "collected", "bunkered"}


def _norm_item(item) -> str | None:
    if item is None:
        return None
    s = str(item).strip().rstrip(".")
    return s or None


def _qty_type(q: dict):
    return q.get("qty_type") or q.get("type")


def _qty_value(q: dict):
    for k in ("qty_value", "value", "amount", "quantity"):
        if q.get(k) is not None:
            try:
                return float(q[k])
            except (TypeError, ValueError):
                return None
    return None


def _first_number(text: str) -> float | None:
    m = _NUMBER.search(text or "")
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except ValueError:
        return None


def _tank_key(raw) -> str:
    cleaned = re.sub(r"[#.\-]", " ", raw or "")
    return re.sub(r"\s+", " ", cleaned.upper().strip())


# ── 1. blocks split across a page boundary ───────────────────────────────────

def _leading_continuation_rows(entry: dict) -> list[dict]:
    """Rows at the very top of this entry that only continue a block started elsewhere."""
    lines = entry.get("item_lines")
    allowed = _CONTINUATION_ITEMS.get(entry.get("orb_code"))
    if not lines or not allowed:
        return []
    rows: list[dict] = []
    for l in lines:
        item = _norm_item(l.get("item"))
        if item in allowed:
            rows.append(l)
        elif item is None and rows and _NUMERIC_ROW.search(l.get("text") or ""):
            rows.append(l)      # a wrapped line of the previous numbered row
        else:
            break
    return rows


def _previous_open_entry(entries: list[dict], idx: int, rows: list[dict]) -> dict | None:
    n = entries[idx]
    page = n.get("page_number") or 0
    if not page:
        return None
    p = next((e for e in reversed(entries[:idx]) if (e.get("page_number") or 0) < page), None)
    if p is None or p.get("orb_code") != n.get("orb_code"):
        return None
    first_item = _norm_item(rows[0].get("item"))
    if p.get("item_lines") is not None:
        if first_item in {_norm_item(l.get("item")) for l in p["item_lines"]}:
            return None          # P already has this item: not its continuation
    elif n.get("orb_code") == "C":
        p_types = {_qty_type(q) for q in (p.get("quantities") or [])}
        wanted = {_ITEM_QTY_TYPE[_norm_item(r.get("item"))] for r in rows if _norm_item(r.get("item")) in _ITEM_QTY_TYPE}
        if not (wanted - p_types):
            return None
    else:
        return None
    if n.get("orb_code") == "C" and not (p.get("tank_location") or "").strip():
        return None
    return p


def reattach_split_blocks(entries: list[dict]) -> list[dict]:
    """Move top-of-page continuation rows back onto the previous page's open block.

    Confirmed on AM KIRTI 7-Feb-2026: page 31 ends "11.1 F.O. SLUDGE TANK" and page 32 begins
    "11.2 40.8 m3 / 11.3 8.5 m3" -- the figures were saved against the L.O. DRAIN TANK that
    follows them, giving a false capacity alert and losing that tank's own readings.
    """
    for idx, n in enumerate(entries):
        rows = _leading_continuation_rows(n)
        if not rows:
            continue
        p = _previous_open_entry(entries, idx, rows)
        if p is None:
            continue

        n_qtys = list(n.get("quantities") or [])
        moved: list[dict] = []
        for row in rows:
            item = _norm_item(row.get("item"))
            value = _first_number(row.get("text") or "")
            if value is None:
                continue
            want_type = _ITEM_QTY_TYPE.get(item) if n.get("orb_code") == "C" else None
            match = next(
                (q for q in n_qtys
                 if q not in moved and _qty_value(q) is not None and abs(_qty_value(q) - value) < 0.011
                 and (want_type is None or _qty_type(q) == want_type)),
                None,
            )
            if match is not None:
                moved.append(match)
            elif want_type is not None:
                # the model never produced this figure at all -- build it from the row itself
                moved.append({"qty_type": want_type, "qty_value": value, "qty_unit": "m3"})
        for q in moved:
            if q in n_qtys:
                n_qtys.remove(q)
            q["from_tank"] = p.get("tank_location") if _qty_type(q) in ("capacity", "retained", "collected") and n.get("orb_code") == "C" else q.get("from_tank")
            q["to_tank"] = q.get("to_tank") if _qty_type(q) in ("transferred", "bunkered") else None

        p["quantities"] = (p.get("quantities") or []) + moved
        n["quantities"] = n_qtys
        n_lines = n["item_lines"]
        p["item_lines"] = (p["item_lines"] + rows) if p.get("item_lines") is not None else None
        n["item_lines"] = n_lines[len(rows):]
        own_first = next((_norm_item(l.get("item")) for l in n["item_lines"] if _norm_item(l.get("item"))), None)
        if own_first:
            n["item_number"] = own_first      # the entry now starts at its own first row
        for r in rows:
            t = (r.get("text") or "").strip()
            if not t:
                continue
            p["raw_text"] = ((p.get("raw_text") or "") + "\n" + t).strip()
            p["operation_description"] = ((p.get("operation_description") or "") + " " + t).strip()
            for field in ("raw_text", "operation_description"):
                if t in (n.get(field) or ""):
                    n[field] = n[field].replace(t, "", 1).strip()
        logger.warning(
            "Re-attached %d continuation row(s) (%s) from page %s to the open block of %r on page %s",
            len(rows), ", ".join(str(_norm_item(r.get("item"))) for r in rows),
            n.get("page_number"), p.get("tank_location"), p.get("page_number"),
        )
    return entries


# ── 2. foreign text after a sounding ─────────────────────────────────────────

_KEEP_AFTER_LAST_ITEM = re.compile(r"\b(M3|M³|COLLECT\w*|RETAIN\w*|CAPACITY)\b", re.IGNORECASE)


def trim_foreign_rows(entries: list[dict]) -> list[dict]:
    """Drop rows after the last numbered row of a Code C 11.x sounding.

    Everything a sounding needs is on its numbered rows (11.1 - 11.4); anything after
    them that carries no quantity is not part of it (confirmed: a sludge-receipt page
    ("Received 28-APR-2026 From Incl...") fused onto an L.O. SLUDGE TANK entry).
    """
    for e in entries:
        lines = e.get("item_lines")
        item = _norm_item(e.get("item_number")) or ""
        if not lines or e.get("orb_code") != "C" or not item.startswith("11"):
            continue
        numbered = [i for i, l in enumerate(lines) if _norm_item(l.get("item")) and _norm_item(l["item"]).startswith("11")]
        if not numbered:
            continue
        keep = numbered[-1] + 1
        while keep < len(lines) and _norm_item(lines[keep].get("item")) is None \
                and _KEEP_AFTER_LAST_ITEM.search(lines[keep].get("text") or ""):
            keep += 1
        dropped = lines[keep:]
        if not dropped:
            continue
        logger.warning("Trimmed %d foreign row(s) after the last numbered row of %r: %r",
                       len(dropped), e.get("tank_location"), [d.get("text") for d in dropped])
        kept = lines[:keep]
        e["item_lines"] = kept
        joined = [l.get("text") for l in kept if l.get("text")]
        e["raw_text"] = "\n".join(joined)
        e["operation_description"] = " ".join(joined)
    return entries


# ── 3. suspect readings ──────────────────────────────────────────────────────

def find_suspect_readings(entries: list[dict]) -> list[dict]:
    """Retained readings that disagree with the previous reading of the same tank
    although nothing logged moved liquid in or out of it (or that look like the
    previous reading with the decimal point moved)."""
    last: dict[str, tuple[int, float]] = {}
    suspects: list[dict] = []
    for idx, e in enumerate(entries):
        # Only a sounding (Code C 11.x) or a weekly inventory (Code I) with ONE retained figure can
        # be re-read unambiguously. A transfer entry carries two retained figures (source and
        # destination tank) and the same tank can appear in several entries on one day -- the
        # re-read then picks a neighbour's number (confirmed on AM KIRTI: 6 of 6 flags were false).
        # Such entries still update the running balance below; they just are never second-guessed.
        n_retained = sum(1 for q in e.get("quantities") or [] if _qty_type(q) == "retained")
        item = _norm_item(e.get("item_number")) or ""
        rereadable = n_retained == 1 and ((e.get("orb_code") == "C" and item.startswith("11")) or e.get("orb_code") == "I")
        for q in e.get("quantities") or []:
            if _qty_type(q) != "retained":
                continue
            value = _qty_value(q)
            tank = _tank_key(q.get("from_tank") or e.get("tank_location"))
            if value is None or not tank:
                continue
            prev = last.get(tank)
            if prev is not None:
                prev_idx, prev_val = prev
                moved = False
                for j in range(prev_idx + 1, idx + 1):
                    for mq in entries[j].get("quantities") or []:
                        if _qty_type(mq) in _MOVEMENT_TYPES and tank in (_tank_key(mq.get("from_tank")), _tank_key(mq.get("to_tank"))):
                            moved = True
                if rereadable and not moved and abs(value - prev_val) > 0.004:
                    kind = None
                    if abs(value - prev_val) <= SMALL_CHANGE_MAX:
                        kind = "small_unexplained_change"
                    elif prev_val > 0 and value > 0 and (abs(value / 10 - prev_val) <= 0.06 or abs(value * 10 - prev_val) <= 0.25):
                        kind = "decimal_shift"
                    if kind:
                        suspects.append({"entry_idx": idx, "qty": q, "tank": tank, "value": value,
                                         "expected": prev_val, "kind": kind})
            last[tank] = (idx, value)
    return suspects[:SUSPECT_LIMIT]


def _fmt(v: float) -> str:
    return f"{v:g}"


def apply_reread(entry: dict, qty: dict, original: float, expected: float, reread: dict | None) -> str:
    """Decide what a focused re-read means. Returns 'confirmed' | 'corrected' | 'flagged' | 'unchanged'."""
    if not reread or reread.get("value") is None:
        return "unchanged"
    try:
        value = float(reread["value"])
    except (TypeError, ValueError):
        return "unchanged"
    if abs(value - original) < 0.005:
        return "confirmed"

    alt = reread.get("alt_value")
    try:
        alt = float(alt) if alt is not None else None
    except (TypeError, ValueError):
        alt = None
    candidates = [value] + ([alt] if alt is not None else [])
    page = entry.get("page_number")

    def _rewrite(text: str, old: float, new: float) -> tuple[str, bool]:
        shown = _fmt(old)
        pattern = re.compile(r"(?<![\d.])" + re.escape(shown) + ("0*" if "." in shown else "") + r"(?!\d)")
        out, n = pattern.subn(_fmt(new), text or "", count=1)
        return out, n > 0

    if any(abs(c - expected) < 0.005 for c in candidates):
        qty["qty_value"] = expected
        for field in ("operation_description", "raw_text"):
            entry[field], _ = _rewrite(entry.get(field) or "", original, expected)
        for line in entry.get("item_lines") or []:      # the exports render these rows
            line["text"], _ = _rewrite(line.get("text") or "", original, expected)
        note = (f" [re-read corrected {_fmt(original)} -> {_fmt(expected)}: a second reading of the page "
                f"matches the preceding balance]")
        entry["operation_description"] = (entry.get("operation_description") or "") + note
        conf = entry.get("confidence_score")
        entry["confidence_score"] = min(conf, 0.8) if conf is not None else 0.8
        logger.warning("Re-read corrected %s -> %s on page %s (%r)", original, expected, page, entry.get("tank_location"))
        return "corrected"

    note = (f" [reading uncertain: first read {_fmt(original)}, re-read {_fmt(value)}"
            + (f" -- verify against page {page}" if page else "") + "]")
    entry["operation_description"] = (entry.get("operation_description") or "") + note
    conf = entry.get("confidence_score")
    entry["confidence_score"] = min(conf, 0.7) if conf is not None else 0.7
    return "flagged"


_REREAD_PROMPT = """This image is one page of a ship's handwritten Oil Record Book.
Find {what} dated {date} and read ONLY its RETAINED quantity (the word RETAINED / RETD{item_hint}).
Ignore every other figure on the page, including other tanks and other entries of the same day.
Read it digit by digit and check whether a decimal point is actually drawn between two digits --
whole numbers such as "13" or "24" are written WITHOUT a decimal point.
Return JSON only:
{{"digits": "<the digits you see, in order>", "value": <number or null>,
  "has_decimal_point": <true|false>,
  "alt_value": <the second most plausible reading if any digit or the decimal point is ambiguous, else null>,
  "legible": <true|false>}}"""


def _call_value_reread(client, page_image, tank: str, date_str: str, kind: str = "sounding") -> dict | None:
    import io as _io
    import json as _json
    from google.genai import types

    buf = _io.BytesIO()
    page_image.save(buf, format="PNG")
    try:
        response = gemini_generate(
            client, "value_reread",
            [
                types.Part.from_bytes(data=buf.getvalue(), mime_type="image/png"),
                _REREAD_PROMPT.format(
                    what=(f'the Code I WEEKLY INVENTORY entry of the tank "{tank}"' if kind == "inventory"
                          else f'the Code C item 11.1 sounding block of the tank "{tank}"'),
                    date=date_str,
                    item_hint=("" if kind == "inventory" else ", item 11.3"),
                ),
            ],
            light=True, small_output=500, temperature=0.0, response_mime_type="application/json",
        )
        data = _json.loads(response.text.strip())
        return data if isinstance(data, dict) else None
    except Exception as e:
        logger.warning("Value re-read failed, keeping the original reading: %s", e)
        return None


REREAD_BUDGET_SECONDS = 300   # total time the whole pass may take
REREAD_CONCURRENCY = 3        # calls in flight at once


async def verify_suspect_readings(client, pages: list, entries: list[dict], timeout: float = 120, call_fn=None,
                                  budget_seconds: float = REREAD_BUDGET_SECONDS,
                                  concurrency: int = REREAD_CONCURRENCY) -> dict:
    """Re-read suspect retained figures on the page image. Never raises; returns counts.

    The pass has a total time budget: a slow model must not keep an upload in "processing"
    for tens of minutes at the very end. Suspects not reached in time are left exactly as
    extracted ("skipped") -- the alerts still flag them.
    """
    import time

    call = call_fn or _call_value_reread
    stats = {"suspects": 0, "confirmed": 0, "corrected": 0, "flagged": 0, "unchanged": 0, "skipped": 0}
    deadline = time.monotonic() + budget_seconds
    sem = asyncio.Semaphore(max(1, concurrency))

    async def one(s: dict) -> None:
        entry = entries[s["entry_idx"]]
        page_no = entry.get("page_number") or 0
        async with sem:
            remaining = deadline - time.monotonic()
            if remaining <= 1:
                stats["skipped"] += 1
                return
            try:
                reread = await asyncio.wait_for(
                    asyncio.to_thread(call, client, pages[page_no - 1], entry.get("tank_location") or s["tank"],
                                      str(entry.get("entry_date") or ""),
                                      "inventory" if entry.get("orb_code") == "I" else "sounding"),
                    timeout=min(timeout, remaining),
                )
            except Exception as e:
                logger.warning("Re-read of %r on page %s skipped: %s", s["tank"], page_no, e)
                stats["unchanged"] += 1
                return
        outcome = apply_reread(entry, s["qty"], s["value"], s["expected"], reread)
        stats[outcome] += 1

    todo = []
    for s in find_suspect_readings(entries):
        page_no = entries[s["entry_idx"]].get("page_number") or 0
        if 1 <= page_no <= len(pages):
            stats["suspects"] += 1
            todo.append(s)
    if todo:
        await asyncio.gather(*(one(s) for s in todo), return_exceptions=True)
        logger.warning("Suspect-reading re-read: %s", stats)   # warning: visible at the service's log level
    return stats
