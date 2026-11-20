"""
Read-only diagnostic: why does our MariApps data hold the same log number twice,
do the copies differ, and how much do they inflate distance / fuel totals?
Writes nothing. Run from vp-backend with the app's venv:

    python audit_duplicates.py > dup.txt
"""
from collections import Counter

from sqlalchemy import text

from backend.database import SessionLocal

db = SessionLocal()


def q(sql, **p):
    return db.execute(text(sql), p).fetchall()


def title(t):
    print("\n" + "=" * 78 + f"\n{t}\n" + "=" * 78)


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


names = {i: n for i, n in q("SELECT imo_number, vessel_name FROM vessels")}

# --------------------------------------------------------------------------
title("1. Duplicated log numbers (raw_mariapps_logs): how do the copies differ?")
groups = q("""
    SELECT vessel_imo, log_number, COUNT(*) c,
           COUNT(DISTINCT fingerprint) fps,
           COUNT(DISTINCT log_date) dates,
           COUNT(DISTINCT log_type) types,
           COUNT(DISTINCT leg_number) legs
    FROM raw_mariapps_logs
    GROUP BY 1, 2 HAVING COUNT(*) > 1
    ORDER BY 1, 2""")
print(f"  duplicated log numbers: {len(groups)}")
by_vessel = Counter(names.get(g[0], g[0]) for g in groups)
for v, c in by_vessel.most_common():
    print(f"    {v:16} {c:>5} log numbers appear more than once")
if groups:
    print(f"  copies share the same fingerprint : {sum(1 for g in groups if g[3] == 1)} of {len(groups)}")
    print(f"  copies have different log_date    : {sum(1 for g in groups if g[4] > 1)} of {len(groups)}")
    print(f"  copies have different log_type    : {sum(1 for g in groups if g[5] > 1)} of {len(groups)}")
    print(f"  copies have different leg_number  : {sum(1 for g in groups if g[6] > 1)} of {len(groups)}")
    print(f"  group sizes: {dict(Counter(g[2] for g in groups))}")

# --------------------------------------------------------------------------
title("2. Sample pairs (first 6): ids, dates, fingerprint, when each was stored")
for vi, ln, *_ in groups[:6]:
    print(f"  {names.get(vi, vi)}  log {ln}")
    for r in q("""SELECT id, log_date, log_type, leg_number, LEFT(fingerprint, 10), extracted_at, is_duplicate
                  FROM raw_mariapps_logs WHERE vessel_imo=:v AND log_number=:l ORDER BY id""", v=vi, l=ln):
        print(f"    raw id {r[0]:>6} | date {r[1]} | {r[2]} | leg {r[3]} | fp {r[4]} | stored {r[5]} | is_duplicate={r[6]}")

# --------------------------------------------------------------------------
title("3. Do the copies carry different VALUES? (mariapps_reports_data columns)")
cols = [r[0] for r in q("""SELECT column_name FROM information_schema.columns
                           WHERE table_name='mariapps_reports_data' ORDER BY ordinal_position""")]
skip = {"id", "raw_report_id", "created_at", "log_number"}
cmp_cols = [c for c in cols if c not in skip]
rows = q("""
    SELECT m.vessel_imo, m.log_number, m.* FROM mariapps_reports_data m
    WHERE (m.vessel_imo, m.log_number) IN (
        SELECT vessel_imo, log_number FROM mariapps_reports_data
        GROUP BY 1, 2 HAVING COUNT(*) > 1)
    ORDER BY m.vessel_imo, m.log_number, m.id""")
pairs = {}
for r in rows:
    d = r._mapping
    pairs.setdefault((d["vessel_imo"], d["log_number"]), []).append(d)
diff_cols = Counter()
identical_core = 0
core = ["distance_og", "log_duration", "me_total_cons", "ae_total_cons", "bl_total_cons"]
for key, copies in pairs.items():
    a, b = copies[0], copies[1]
    for c in cmp_cols:
        if a.get(c) != b.get(c):
            diff_cols[c] += 1
    if all(a.get(c) == b.get(c) for c in core):
        identical_core += 1
print(f"  duplicated groups compared: {len(pairs)}")
print(f"  groups whose distance / duration / ME / AE / boiler totals are IDENTICAL: {identical_core}")
print("  columns that differ between copies (column: groups differing):")
for c, k in diff_cols.most_common(25):
    print(f"    {c:40} {k}")
if not diff_cols and pairs:
    print("    (none - the copies are fully identical)")

# --------------------------------------------------------------------------
title("4. Impact: distance and fuel with and without the extra copies")
print(f"  {'vessel':16} {'rows':>6} {'extra':>6} {'dist all':>10} {'dist unique':>12} {'ME fuel all':>12} {'ME fuel unique':>15}")
rows = q("""
    SELECT m.vessel_imo, m.log_number, m.id, m.distance_og, m.me_total_cons
    FROM mariapps_reports_data m ORDER BY m.vessel_imo, m.log_number, m.id""")
agg = {}
seen = set()
for vi, ln, _id, dist, me in rows:
    a = agg.setdefault(vi, dict(rows=0, extra=0, d_all=0.0, d_uni=0.0, f_all=0.0, f_uni=0.0))
    a["rows"] += 1
    a["d_all"] += num(dist)
    a["f_all"] += num(me)
    if (vi, ln) in seen:
        a["extra"] += 1
    else:
        seen.add((vi, ln))
        a["d_uni"] += num(dist)
        a["f_uni"] += num(me)
for vi, a in sorted(agg.items(), key=lambda kv: -kv[1]["extra"]):
    if a["extra"]:
        print(f"  {names.get(vi, vi):16} {a['rows']:>6} {a['extra']:>6} {a['d_all']:>10.0f} {a['d_uni']:>12.0f} "
              f"{a['f_all']:>12.1f} {a['f_uni']:>15.1f}")

# --------------------------------------------------------------------------
title("5. Are the copies also in analysis_data (what the app reads)?")
for r in q("""
    SELECT a.vessel_imo, COUNT(*) total, COUNT(DISTINCT m.log_number) distinct_logs
    FROM analysis_data a
    JOIN mariapps_reports_data m ON m.raw_report_id = a.raw_mariapps_id
    WHERE a.source_id = 'mari_apps'
    GROUP BY 1 HAVING COUNT(*) <> COUNT(DISTINCT m.log_number) ORDER BY 1"""):
    print(f"  {names.get(r[0], r[0]):16} analysis rows {r[1]:>5}  distinct log numbers {r[2]:>5}  -> {r[1]-r[2]} extra")

db.close()
print("\nDone. Read-only: nothing was written.")
