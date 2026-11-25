from dotenv import load_dotenv; load_dotenv("D:/Workplace/vp-backend/.env")
"""
Read-only audit: for the "blank / contradictory field" codes of the Fleet Noon Records
Issues Log (2026-11-19), is the value really missing AT THE SOURCE (vessel / MariApps),
or is it present in the stored raw MariApps JSON and dropped by OUR mapping?

For every blank in our tables it looks inside raw_mariapps_logs.raw_json (every section)
for keys that look like that field and holds a value:
    raw has a value  -> probably OUR mapping gap (fix our code, re-derive, no mail)
    raw also blank   -> genuinely missing at the source (goes to the daily mail)
The candidate keys found are printed with a sample value, so a human can judge each
one (a loose keyword can match an unrelated key - read the key names).

Covers: M07 M08 M09 M11 M13 M15 (blank fields), E07 (zero total fuel), E10 (laden /
ballast vs cargo) and M10 (CP warranted values - these come from OUR cp_sea_warranty
table, not from MariApps). Writes nothing.

    python audit_blank_source.py > blank_source.txt

Run from vp-backend with the app's venv. Retired duplicate copies are excluded.
"""
from collections import Counter, defaultdict

from sqlalchemy import text

from backend.database import SessionLocal

db = SessionLocal()
names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
NUM = r"^[-+]?[0-9]+(\.[0-9]+)?$"
SEA = "(x.log_type ILIKE 'noon at sea%' OR x.log_type = 'NOON')"


def blank(col):
    return f'NULLIF(TRIM(x."{col}"::text), \'\') IS NULL'


def xnum(col):
    return f"(CASE WHEN x.\"{col}\"::text ~ '{NUM}' THEN x.\"{col}\"::double precision ELSE 0 END)"


def rnum(col):
    return f"(CASE WHEN r.{col}::text ~ '{NUM}' THEN r.{col}::double precision ELSE 0 END)"


BASE = ("FROM expanded_mariapps_data x "
        "JOIN raw_mariapps_logs l ON l.id = x.raw_log_id "
        "LEFT JOIN mariapps_reports_data r ON r.raw_report_id = x.raw_log_id "
        "LEFT JOIN analysis_data a ON a.raw_mariapps_id = x.raw_log_id "
        "WHERE COALESCE(l.is_duplicate, false) = false AND ")


def has_all(*terms):
    return lambda k: all(t in k for t in terms)


def any_of(*preds):
    return lambda k: any(p(k) for p in preds)


def not_any(pred, *bad):
    return lambda k: pred(k) and not any(b in k for b in bad)


# code, label, SQL blank condition, raw-key predicate (on lower-cased key), numeric value?
FIELDS = [
    ("M07", "Composite boiler total blank", blank("CompositeBoiler_mFOCComBL_dCnt_operational_LF"),
     has_all("composite", "boiler", "total cons"), True),
    ("M08a", "Distance blank", blank("Vessel_DOG_dCnt_operational_LF"),
     not_any(has_all("distance"), "to go", "eosp", "remaining", "next", "planned", "per distance", "through water"), True),
    ("M08b", "Log duration blank", blank("VoyageMeta_log_durationh_operational_LF"),
     any_of(has_all("duration"), has_all("steaming time")), True),
    ("M09", "Cargo onboard blank", blank("Vessel_Cargo_onboard_operational_LF"),
     not_any(has_all("cargo"), "consumption", "operation", "heating", "pump", "discharg", "load"), True),
    ("M11", "ME running hours blank", blank("ME_RHME_dCnt_operational_LF"),
     has_all("me running hours"), True),
    ("M13a", "Wind blank on Noon at sea", f"{SEA} AND a.\"BF_Wind\" IS NULL",
     any_of(has_all("wind", "speed"), has_all("wind", "force"), has_all("beaufort")), True),
    ("M13b", "Swell/wave height blank on Noon at sea", f"{SEA} AND a.\"Sig_Wave_Ht_m\" IS NULL",
     any_of(has_all("swell height"), has_all("wave height")), True),
    ("M15a", "Latitude blank on Noon at sea", f"{SEA} AND {blank('VoyageMeta_latitude_operational_LF')}",
     any_of(has_all("latitude"), has_all("lat deg"), has_all("lat min")), False),
    ("M15b", "Longitude blank on Noon at sea", f"{SEA} AND {blank('VoyageMeta_longitude_operational_LF')}",
     any_of(has_all("longitude"), has_all("lon deg"), has_all("lon min")), False),
]

E07_COND = (f"COALESCE({xnum('emissionx_grand_total_mt')}, 0) = 0 "
            f"AND {xnum('VoyageMeta_log_durationh_operational_LF')} >= 2")
E10_LADEN = f"x.loading_condition = 'Laden' AND {rnum('cargo_on_board')} = 0"
E10_BALLAST = f"x.loading_condition = 'Ballast' AND {rnum('cargo_on_board')} > 0"


def isnum(v):
    try:
        float(str(v).replace(",", "").strip())
        return True
    except ValueError:
        return False


def nonempty(v):
    return v is not None and str(v).strip().lower() not in ("", "null", "none", "-", "n/a", "na", "nan")


def flat(raw):
    """(section, key, value) for every scalar in every dict section of the raw JSON."""
    out = []
    if not isinstance(raw, dict):
        return out
    for sec, body in raw.items():
        if isinstance(body, dict):
            for k, v in body.items():
                if not isinstance(v, (dict, list)):
                    out.append((sec, str(k), v))
        elif not isinstance(body, list):
            out.append(("(top)", str(sec), body))
    return out


def ids_for(cond):
    rows = db.execute(text(f"SELECT x.raw_log_id, x.vessel_imo {BASE} {cond}")).fetchall()
    return {r[0]: r[1] for r in rows}


def load_raw(ids):
    ids = list(ids)
    out = {}
    for i in range(0, len(ids), 300):
        chunk = ids[i:i + 300]
        for rid, j in db.execute(text("SELECT id, raw_json FROM raw_mariapps_logs WHERE id = ANY(:ids)"), {"ids": chunk}):
            out[rid] = flat(j)
    return out


def report(code, label, blanks, raws, pred, numeric):
    ours_gap, genuine = defaultdict(int), defaultdict(int)
    keys = Counter()
    sample = {}
    for rid, imo in blanks.items():
        hit = False
        for sec, k, v in raws.get(rid, []):
            if pred(k.lower()) and nonempty(v) and (not numeric or isnum(v)):
                keys[f"{sec}::{k}"] += 1
                sample.setdefault(f"{sec}::{k}", v)
                hit = True
        (ours_gap if hit else genuine)[imo] += 1
    g, o = sum(genuine.values()), sum(ours_gap.values())
    print(f"\n{code}  {label}")
    print(f"   blank in our table: {len(blanks):>6}   genuinely blank at source: {g:>6}   RAW HAS A VALUE (likely our mapping gap): {o:>6}")
    if o:
        print("   our-gap per vessel: " + ", ".join(f"{names.get(i, i)} {c}" for i, c in sorted(ours_gap.items(), key=lambda t: -t[1])))
        for k, c in keys.most_common(6):
            print(f"      raw key  {k!r}  in {c} reports, e.g. {str(sample[k])[:30]!r}")
    if g:
        print("   genuine per vessel: " + ", ".join(f"{names.get(i, i)} {c}" for i, c in sorted(genuine.items(), key=lambda t: -t[1])[:8]))


def section_e07():
    blanks = ids_for(E07_COND)
    raws = load_raw(blanks)
    pred = lambda k: "consumption" in k and "(mt)" in k and "cargo operation" not in k   # noqa: E731
    print("\n" + "-" * 70)
    report("E07", "Zero total fuel on a report with duration >= 2 h (raw: any fuel consumption key with a positive MT)",
           {rid: imo for rid, imo in blanks.items()
            if any(pred(k.lower()) and isnum(v) and float(str(v).replace(',', '')) > 0 for _, k, v in raws.get(rid, []))},
           raws, pred, True)
    n_with = sum(1 for rid in blanks if any(pred(k.lower()) and isnum(v) and float(str(v).replace(',', '')) > 0
                                           for _, k, v in raws.get(rid, [])))
    print(f"   (E07 reports in our data: {len(blanks)}; of them raw JSON holds a positive fuel figure: {n_with}; "
          f"raw also zero/blank: {len(blanks) - n_with})")


def section_e10():
    print("\n" + "-" * 70)
    for label, cond, want_positive in (("Laden but cargo = 0 in our data", E10_LADEN, True),
                                       ("Ballast but cargo > 0 in our data", E10_BALLAST, None)):
        blanks = ids_for(cond)
        raws = load_raw(blanks)
        cargo_pred = not_any(has_all("cargo"), "consumption", "operation", "heating", "pump", "discharg", "load")
        lc_pred = has_all("loading condition")
        lc_pairs = Counter()
        raw_cargo_positive = 0
        for rid in blanks:
            rows = raws.get(rid, [])
            if want_positive and any(cargo_pred(k.lower()) and isnum(v) and float(str(v).replace(',', '')) > 0 for _, k, v in rows):
                raw_cargo_positive += 1
            lcs = sorted({str(v).strip() for _, k, v in rows if lc_pred(k.lower()) and nonempty(v)})
            lc_pairs[", ".join(lcs)[:40] or "(no raw loading-condition key)"] += 1
        print(f"\nE10  {label}: {len(blanks)} reports")
        if want_positive:
            print(f"   raw cargo key holds a positive figure although our cargo is 0: {raw_cargo_positive} "
                  f"(these are OUR mapping gap); raw cargo also 0/blank: {len(blanks) - raw_cargo_positive}")
        print("   raw loading-condition text on these reports: " + ", ".join(f"{k} x{c}" for k, c in lc_pairs.most_common(6)))
        per_v = Counter(blanks.values())
        print("   per vessel: " + ", ".join(f"{names.get(i, i)} {c}" for i, c in per_v.most_common(8)))


def section_m10():
    print("\n" + "-" * 70)
    print("\nM10  CP warranted values blank - these come from OUR cp_sea_warranty table (Active CP per vessel)")
    cp_blank = " OR ".join(blank(c) for c in ("mariappsx_cp_warranted_speed_kn", "mariappsx_cp_warranted_consumption_mtday"))
    rows = db.execute(text(f"SELECT x.vessel_imo, COALESCE(x.loading_condition, '(none)'), COUNT(*) {BASE} ({cp_blank}) "
                           "GROUP BY 1, 2 ORDER BY 1, 2")).fetchall()
    war = {(i, lc): n for i, lc, n in db.execute(text(
        "SELECT d.vessel_imo, w.loading_condition, COUNT(*) FROM cp_sea_warranty w "
        "JOIN cp_vessel_description d ON d.id = w.cp_id WHERE d.doc_status = 'Active' GROUP BY 1, 2")).fetchall()}
    by_v = defaultdict(list)
    for imo, lc, n in rows:
        by_v[imo].append((lc, n))
    for imo, items in sorted(by_v.items(), key=lambda kv: -sum(n for _, n in kv[1])):
        has_cp = sorted(lc for (i, lc) in war if i == imo)
        print(f"   {names.get(imo, imo):16} blank reports {sum(n for _, n in items):>5}  "
              f"by loading condition: {', '.join(f'{lc} {n}' for lc, n in items)}  |  Active CP warranty rows for: "
              f"{', '.join(has_cp) if has_cp else 'NONE (no Active CP on file)'}")
    print("   Reading: a vessel with NONE needs its CP loaded (our side). A blank for a loading condition the vessel "
          "has warranty rows for is a matching gap (our side). Only a blank loading condition is a MariApps blank.")


def main():
    print(f"expanded_mariapps_data rows (non-duplicate): {db.execute(text(f'SELECT COUNT(*) {BASE} TRUE')).scalar()}")
    for code, label, cond, pred, numeric in FIELDS:
        blanks = ids_for(cond)
        report(code, label, blanks, load_raw(blanks), pred, numeric)
    section_e07()
    section_e10()
    section_m10()
    db.close()
    print("\nDone. Read-only: nothing was written.")


if __name__ == "__main__":
    main()
