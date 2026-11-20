"""
Read-only audit: how often do blank port / EU-flag fields leave an EU MRV / ETS /
FuelEU voyage leg unclassified, and would using the leg's first filled departure
flag and last filled destination flag (instead of only the first and last row)
fix it? Uses the app's own leg grouping and classification, so the numbers match
what the Emission screens compute. Writes nothing. Run from vp-backend:

    python audit_eu_legs.py > eu_legs.txt

"current"  = classify_eu_voyage(first_row.from_eu, last_row.to_eu)   (today)
"improved" = first NON-BLANK from_eu in the leg, last NON-BLANK to_eu in the leg
At-berth EU fuel (Art. 10(k)) today counts only NUW rows whose own to_eu is 'Y';
the audit also counts NUW rows with a BLANK to_eu in legs that end at an EU port.
"""
from collections import Counter

from sqlalchemy import text

from api.routes import emission_routes as er
from backend.database import SessionLocal
from backend.emission.eu_mrv_calculator import classify_eu_voyage

db = SessionLocal()
names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}


def first_filled(rows, key):
    for r in rows:
        if r.get(key) in ("Y", "N"):
            return r[key]
    return None


def last_filled(rows, key):
    for r in reversed(rows):
        if r.get(key) in ("Y", "N"):
            return r[key]
    return None


def legs_for(imo, source):
    raw = er._eu_mrv_leg_source_rows(db, imo, source)
    rows = [{
        "date": r["dt"], "voyage_no": r["voyage_no"], "loading_condition": r["loading_condition"],
        "op_status": r["op_status"], "from_port": r["from_port"], "to_port": r["to_port"],
        "from_eu": r["from_eu"], "to_eu": r["to_eu"],
        "distance_nm": float(r["distance_nm"] or 0), "duration_h": float(r["duration_h"] or 0),
        "fuel_by_grade": {g: float(r[g] or 0) for g in er._LEG_GRADES},
    } for r in raw]
    return er.group_into_legs(rows) if rows else []


def audit_source(source):
    table = er._EXPANDED_TABLE[source]
    imos = [r[0] for r in db.execute(text(f'SELECT DISTINCT vessel_imo FROM {table} WHERE vessel_imo IS NOT NULL ORDER BY 1'))]
    print("\n" + "=" * 78 + f"\nSource: {source}\n" + "=" * 78)
    cur_all, imp_all = Counter(), Counter()
    changed, examples = 0, []
    miss_rows = miss_legs = 0
    miss_fuel = 0.0
    per_vessel = {}
    for imo in imos:
        v_cur, v_imp = Counter(), Counter()
        for grp in legs_for(imo, source):
            lrows = grp["rows"]
            first_row, last_row = lrows[0], lrows[-1]
            cur = classify_eu_voyage(first_row["from_eu"], last_row["to_eu"])
            f_eu, t_eu = first_filled(lrows, "from_eu"), last_filled(lrows, "to_eu")
            imp = classify_eu_voyage(f_eu, t_eu)
            v_cur[cur] += 1
            v_imp[imp] += 1
            if imp != cur:
                changed += 1
                if len(examples) < 8:
                    examples.append((names.get(imo, imo), grp["key"][0], first_row["from_port"], last_row["to_port"], cur, imp))
            if t_eu == "Y":
                blanks = [r for r in lrows if r["op_status"] == "NUW" and r["to_eu"] not in ("Y", "N")]
                if blanks:
                    miss_legs += 1
                    miss_rows += len(blanks)
                    miss_fuel += sum(sum(r["fuel_by_grade"].values()) for r in blanks)
        cur_all.update(v_cur)
        imp_all.update(v_imp)
        per_vessel[names.get(imo, imo)] = (v_cur, v_imp)

    total = sum(cur_all.values())
    print(f"legs: {total}")
    print(f"{'category':26} {'current':>8} {'improved':>9}")
    for cat in sorted(set(cur_all) | set(imp_all)):
        print(f"{cat:26} {cur_all[cat]:>8} {imp_all[cat]:>9}")
    undeterminable = cur_all["undeterminable"] + cur_all["eu_direction_unknown"]
    print(f"legs left unclassified today (undeterminable + eu_direction_unknown): {undeterminable} "
          f"({100 * undeterminable / total:.0f}%)" if total else "no legs")
    print(f"legs whose category would change with the improved rule: {changed}")
    for ex in examples:
        print(f"    {ex[0]:16} voyage {ex[1]}: {ex[2]} -> {ex[3]}   {ex[4]} => {ex[5]}")
    print("at-berth EU fuel possibly missed (NUW rows with a blank to_eu in legs that end at an EU port):")
    print(f"    {miss_rows} rows in {miss_legs} legs, {miss_fuel:.1f} t fuel")
    print("per vessel, legs unclassified today -> after the improved rule:")
    for v, (c, i) in sorted(per_vessel.items()):
        u_c = c["undeterminable"] + c["eu_direction_unknown"]
        u_i = i["undeterminable"] + i["eu_direction_unknown"]
        if u_c or u_i:
            print(f"    {v:16} {u_c:>4} -> {u_i:>4}   (of {sum(c.values())} legs)")


for src in ("mari_apps", "wni"):
    try:
        audit_source(src)
    except Exception as ex:
        db.rollback()
        print(f"\n!! {src} failed: {type(ex).__name__}: {str(ex)[:200]}")
db.close()
print("\nDone. Read-only: nothing was written.")
