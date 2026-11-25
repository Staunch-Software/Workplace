"""
Read-only audit for C02 (position jump): which reports carry a position in the WRONG
HEMISPHERE (East entered as West, North as South), and which jumps are something else.

A single pair of positions cannot say which of the two is wrong (flipping either one
makes the pair consistent), so each vessel's reports are read as a sequence:
  - ONE bad report i  : jump into i AND jump out of i, and flipping i's hemisphere
                        makes both pairs consistent  -> i is the report to correct
  - BLOCK shift at i  : jump into i but the reports after i agree with each other
                        (the hemisphere changed and stayed changed: either the
                        reports before or the ones after are wrong) -> listed apart
  - LATEST report     : jump into the vessel's newest report, nothing after it yet:
                        cannot be confirmed until the next report arrives
  - OTHER             : the flip does not explain it
Writes nothing.

    python audit_position_jumps.py > position_jumps.txt
    python audit_position_jumps.py --csv position_jumps.csv     # also save the culprit list

Positions come from our mapped table (hemisphere read from the report's Position tab).
Pairs with a blank hemisphere are skipped, not guessed. Retired duplicates are excluded.
A jump = great-circle distance > 50 nm and > 1.3 x reported distance + 20 nm, for
reports 1-48 h apart.
"""
import csv
import math
import sys
from collections import Counter

from sqlalchemy import text

R_NM = 3440.065
FLIPS = (("E/W", (1, -1)), ("N/S", (-1, 1)), ("both", (-1, -1)))


def dec(deg, mn, d, plus, minus):
    try:
        v = float(deg) + float(mn or 0) / 60.0
    except (TypeError, ValueError):
        return None
    d = (d or "").strip().upper()[:1]
    return v if d == plus else (-v if d == minus else None)


def gc(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    x = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * R_NM * math.asin(min(1.0, math.sqrt(x)))


def jump(a, b, rep):
    d = gc(a, b)
    return d > 50 and d > 1.3 * rep + 20


def fmt(p):
    return f"{abs(p[0]):.2f}{'N' if p[0] >= 0 else 'S'} {abs(p[1]):.2f}{'E' if p[1] >= 0 else 'W'}"


def analyse(seq):
    """seq: list of dicts with pos (lat, lon) or None, rep (distance reported for the pair with the
    previous report, or None when the pair is not testable), ln, ts. Returns (culprits, blocks, latest, other)
    as lists of (index, fix_or_None)."""
    n = len(seq)
    J = [None] * n                   # None = pair not testable
    for i in range(1, n):
        if seq[i]["rep"] is not None and seq[i]["pos"] and seq[i - 1]["pos"]:
            J[i] = jump(seq[i - 1]["pos"], seq[i]["pos"], seq[i]["rep"])
    culprits, blocks, latest, other = [], [], [], []
    handled = set()                  # the jump OUT of an identified bad report is not a second finding
    for i in range(1, n):
        if not J[i] or i in handled:
            continue
        nxt = J[i + 1] if i + 1 < n else None
        if i + 1 >= n:
            latest.append((i, None))
        elif nxt:                    # jump in and jump out: test a flip of report i
            fix = None
            for name, (fl, fo) in FLIPS:
                p = (seq[i]["pos"][0] * fl, seq[i]["pos"][1] * fo)
                if not jump(seq[i - 1]["pos"], p, seq[i]["rep"]) and not jump(p, seq[i + 1]["pos"], seq[i + 1]["rep"]):
                    fix = name
                    break
            (culprits if fix else other).append((i, fix))
            if fix:
                handled.add(i + 1)
        elif nxt is False:           # hemisphere changed and stayed changed
            blocks.append((i, None))
        else:
            other.append((i, None))
    return culprits, blocks, latest, other


def self_test():
    def s(pos, rep=285):
        return {"pos": pos, "rep": rep, "ln": "x", "ts": None}
    base = [(18.9, 72.8), (18.9, 67.8), (18.9, 62.8), (18.9, 57.8)]
    ok = [s(p) for p in base]
    assert analyse(ok) == ([], [], [], [])
    bad = [s(p) for p in base]
    bad[2]["pos"] = (18.9, -62.8)                       # one report with the wrong hemisphere
    assert analyse(bad) == ([(2, "E/W")], [], [], [])
    block = [s(p) for p in base]
    block[2]["pos"], block[3]["pos"] = (18.9, -62.8), (18.9, -57.8)   # changed and stayed changed
    assert analyse(block) == ([], [(2, None)], [], [])
    last = [s(p) for p in base]
    last[3]["pos"] = (18.9, -57.8)
    assert analyse(last) == ([], [], [(3, None)], [])


def main():
    self_test()
    csv_path = sys.argv[sys.argv.index("--csv") + 1] if "--csv" in sys.argv else None
    from backend.database import SessionLocal
    db = SessionLocal()
    names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
    rows = db.execute(text(
        "SELECT l.vessel_imo, l.log_number, r.log_date_utc, r.lat_degree::text, r.lat_minutes::text, r.lat_direction, "
        "r.lon_degree::text, r.lon_minutes::text, r.lon_direction, r.distance_og::text "
        "FROM mariapps_reports_data r JOIN raw_mariapps_logs l ON l.id = r.raw_report_id "
        "WHERE COALESCE(l.is_duplicate, false) = false AND r.log_date_utc IS NOT NULL "
        "ORDER BY l.vessel_imo, r.log_date_utc")).fetchall()
    by_v = {}
    skipped = 0
    for imo, ln, ts, la, lam, lad, lo, lom, lod, dist in rows:
        lat, lon = dec(la, lam, lad, "N", "S"), dec(lo, lom, lod, "E", "W")
        pos = (lat, lon) if lat is not None and lon is not None else None
        try:
            rep = float(dist)
        except (TypeError, ValueError):
            rep = 0.0
        by_v.setdefault(imo, []).append({"pos": pos, "rep": rep, "ln": ln, "ts": ts})
    tot = {"culprits": [], "blocks": [], "latest": [], "other": []}
    tested = 0
    for imo, seq in by_v.items():
        for i in range(1, len(seq)):
            gap = (seq[i]["ts"] - seq[i - 1]["ts"]).total_seconds() / 3600.0
            if not (1 <= gap <= 48):
                seq[i]["rep"] = None                 # not comparable (missing days / same minute)
            elif seq[i]["pos"] is None or seq[i - 1]["pos"] is None:
                skipped += 1
            else:
                tested += 1
        c, b, la_, o = analyse(seq)
        for key, lst in (("culprits", c), ("blocks", b), ("latest", la_), ("other", o)):
            tot[key] += [(imo, seq, i, fix) for i, fix in lst]

    print(f"consecutive position pairs tested: {tested}   skipped (a hemisphere is blank): {skipped}")
    for key, title in (("culprits", "ONE report in the wrong hemisphere (jump in and out, a flip fixes both)"),
                       ("blocks", "BLOCK shift (hemisphere changed and stayed changed)"),
                       ("latest", "LATEST report jumps (cannot be confirmed until the next report)"),
                       ("other", "OTHER jumps (a flip does not explain them)")):
        items = tot[key]
        print(f"\n{title}: {len(items)}")
        if items:
            print("   per vessel: " + ", ".join(f"{v} {k}" for v, k in Counter(names.get(i, i) for i, *_ in items).most_common()))
    print("\nReports to correct (one report in the wrong hemisphere), newest first:")
    for imo, seq, i, fix in sorted(tot["culprits"], key=lambda t: t[1][t[2]]["ts"], reverse=True)[:60]:
        r = seq[i]
        print(f"   {names.get(imo, imo):16} {r['ln']:22} {str(r['ts'])[:10]}  recorded {fmt(r['pos']):18} -> flip {fix}")
    for key, title in (("blocks", "Block shifts"), ("latest", "Latest-report jumps"), ("other", "Other jumps")):
        if tot[key]:
            print(f"\n{title} (first 12):")
            for imo, seq, i, _ in tot[key][:12]:
                r, p = seq[i], seq[i - 1]
                print(f"   {names.get(imo, imo):16} {r['ln']:22} {str(r['ts'])[:10]}  {fmt(p['pos'])} -> {fmt(r['pos'])} "
                      f"({gc(p['pos'], r['pos']):,.0f} nm apart, reported {r['rep']:.0f} nm)")
    if csv_path:
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["vessel", "log_number", "date", "recorded_position", "flip_needed"])
            for imo, seq, i, fix in tot["culprits"]:
                r = seq[i]
                w.writerow([names.get(imo, imo), r["ln"], str(r["ts"])[:10], fmt(r["pos"]), fix])
        print(f"\nCulprit list written to {csv_path}")
    db.close()
    print("\nDone. Read-only: nothing was written.")


if __name__ == "__main__":
    main()
