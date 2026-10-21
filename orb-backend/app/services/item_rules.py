"""Item-number rules for ORB Part I blocks (MARPOL Annex I Reg. 17 / MI-332A list of items).

Each row of a block carries its own item number in the Item column and each
number has a fixed meaning, so a block that leaves one out is incomplete even if
the value itself was written. Rules are data, so adding a code is one table row.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class BlockRule:
    code: str                      # ORB code letter the rule applies to
    prefix: str                    # item numbers of this block start with this ("11.", "13", "26.")
    # (item numbers accepted for this line, label, qty types that prove the value was recorded)
    lines: tuple = field(default_factory=tuple)


_RULES = (
    BlockRule("C", "11", (
        (("11.1",), "tank identity", None),
        (("11.2",), "capacity", ("capacity",)),
        (("11.3",), "quantity retained", ("retained",)),
    )),
    BlockRule("D", "13", (
        (("13",), "quantity", ("transferred", "disposed", "evaporated", "incinerated", "retained")),
        (("14",), "time of discharge/transfer", None),
        (("15", "15.1", "15.2", "15.3"), "method / destination", None),
    )),
    BlockRule("H", "26", (
        (("26.1",), "place of bunkering", None),
        (("26.2",), "time of bunkering", None),
        (("26.3", "26.4"), "type, quantity and tank", ("bunkered",)),
    )),
)


def _norm(item: str | None) -> str | None:
    return item.strip().rstrip(".") if item and item.strip() else None


def _applies(rule: BlockRule, orb_code: str, item_number: str | None, written: set[str]) -> bool:
    if orb_code != rule.code:
        return False
    first = _norm(item_number) or ""
    return first.startswith(rule.prefix) or any(w.startswith(rule.prefix) for w in written)


def item_line_problems(orb_code, item_number, item_lines, qty_types) -> list[dict]:
    """Problems with a block's item numbers.

    Returns dicts {"kind": "number_missing" | "value_missing", "items": [...], "labels": [...]}.
    item_lines None means the line transcription is unknown (older upload or a
    merged fragment without lines) -- nothing can be judged, so nothing is returned.
    """
    if item_lines is None:
        return []
    written = {n for n in (_norm(l.get("item")) for l in item_lines) if n}
    types = set(qty_types or [])
    for rule in _RULES:
        if not _applies(rule, orb_code, item_number, written):
            continue
        number_missing, value_missing = [], []
        for accepted, label, proof_types in rule.lines:
            has_number = any(a in written for a in accepted)
            has_value = proof_types is None or bool(types & set(proof_types))
            if not has_value:
                value_missing.append((accepted[0], label))
            elif not has_number:
                number_missing.append((accepted[0], label))
        out = []
        if value_missing:
            out.append({"kind": "value_missing", "items": [i for i, _ in value_missing],
                        "labels": [l for _, l in value_missing]})
        if number_missing:
            out.append({"kind": "number_missing", "items": [i for i, _ in number_missing],
                        "labels": [l for _, l in number_missing]})
        return out
    return []
