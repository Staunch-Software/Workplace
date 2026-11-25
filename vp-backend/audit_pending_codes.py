"""
Read-only audit of the issues-log codes still pending after the first rounds:
E05, C05, E09, M05, M06, M12, C02, C03 - counted against OUR MariApps tables, with
each finding split into "ours / benign / real, at the source" wherever the data allows.
Retired duplicate copies are excluded. Writes nothing.

    python audit_pending_codes.py > pending_codes.txt

Reading guide (printed per section):
  E05  grand total vs its parts; how many differences are explained by a consumer
       whose own total does not equal its fuel grades (source inconsistency, = E04)
  C05  negative values in consumption / distance / hours / cargo columns
  E09  where, if anywhere, our raw reports carry a per-grade fuel ROB
  M05  AE / boiler totals blank;  M06  ME total blank: idle (benign) vs real
  M12  SOG and STW both blank on a moving ship, with a raw-key check for our gap
  C02  position jump between consecutive positions vs the distance reported
  C03  distance / duration vs SOG, and which raw SOG key agrees
"""
import math
from collections import Counter, defaultdict

from sqlalchemy import text

from backend.database import SessionLocal

db = SessionLocal()
names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
NUM = r"^[-+]?[0-9]+(\.[0-9]+)?$"
BASE = ("FROM expanded_mariapps_data x JOIN raw_mariapps_logs l ON l.id = x.raw_log_id "
        "LEFT JOIN mariapps_reports_data r ON r.raw_report_id = x.raw_log_id "
        "WHERE COALESCE(l.is_duplicate, false) = false AND ")
GRADES = ("hfo", "lfo", "mdo", "bio_fuel")
CONSUMERS = ("me", "ae", "bl", "combl", "inc", "eg", "aeb", "blfo")


def n(expr):
    """numeric value of a text/number SQL expression, 0 when blank or not a number"""
    return f"(CASE WHEN ({expr})::text ~ '{NUM}' THEN ({expr})::text::double precision ELSE 0 END)"


def blank(expr):
    return f"NULLIF(TRIM(({expr})::text), '') IS NULL"


def by_vessel(rows, top=8):
    c = Counter()
    for imo, k in rows:
        c[names.get(imo, imo)] += k
    return ", ".join(f"{v} {k}" for v, k in c.most_common(top))


def head(title):
    print("\n" + "=" * 78 + f"\n{title}\n" + "=" * 78)


# ----------------------------------------------------------------------------- E05
def e05():
    head("E05  Grand total vs its parts (our Emission Log columns)")
    sum4 = " + ".join(n(f"x.emissionx_total_{g}_mt") for g in ("hfo", "lfo", "mdo", "biofuel"))
    sumb = " + ".join(n(f"x.emissionx_{c}_{g}_mt") for c in ("me", "ae", "bl") for g in ("hfo", "lfo", "mdo", "biofuel")) \
        + " + " + n("x.emissionx_ig_other_mt")
    grand = n("x.emissionx_grand_total_mt")
    total = db.execute(text(f"SELECT COUNT(*) {BASE} TRUE")).scalar()
    print(f"reports: {total}")
    for label, parts in (("A  grand total vs the 4 fuel-grade totals (HFO+LFO+MDO+Biofuel)", sum4),
                         ("B  grand total vs ME + AE + Boiler per grade + IG/Other", sumb)):
        rows = db.execute(text(f"SELECT x.vessel_imo, COUNT(*) {BASE} ABS({grand} - ({parts})) > 0.05 GROUP BY 1")).fetchall()
        print(f"\n  {label}: {sum(c for _, c in rows)} reports differ by > 0.05 t")
        if rows:
            print("     per vessel: " + by_vessel(rows))
    # explanation for A: a consumer whose own total differs from the sum of its grades
    mism = " OR ".join(
        f"ABS({n(f'r.{c}_total_cons')} - ({' + '.join(n(f'r.{c}_{g}') for g in GRADES)})) > 0.05" for c in CONSUMERS)
    a_cond = f"ABS({grand} - ({sum4})) > 0.05"
    tot_a = db.execute(text(f"SELECT COUNT(*) {BASE} {a_cond}")).scalar()
    expl = db.execute(text(f"SELECT COUNT(*) {BASE} {a_cond} AND ({mism})")).scalar()
    print(f"\n  Of the {tot_a} reports in A: {expl} have a consumer whose own total differs from its grades "
          f"(source inconsistency, same cause as E04 / other grades such as LNG); {tot_a - expl} have none (investigate: ours).")
    ex = db.execute(text(f"SELECT x.vessel_imo, x.log_number, {grand}, ({sum4}) {BASE} {a_cond} "
                         f"ORDER BY ABS({grand} - ({sum4})) DESC LIMIT 5")).fetchall()
    for imo, ln, g, s in ex:
        print(f"     e.g. {names.get(imo, imo)} {ln}: grand {g:.2f} vs grades {s:.2f}")


# ----------------------------------------------------------------------------- C05
def c05():
    head("C05  Negative values in consumption / distance / hours / cargo columns (mapped table)")
    cols = [r[0] for r in db.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'mariapps_reports_data' "
        "AND column_name ~ '(cons|distance|duration|hours|cargo|ballast|_mt|rob)' "
        "AND column_name !~ '(id|date|speed|kpi|dev|loss)$'"))]
    found = []
    for col in cols:
        rows = db.execute(text(
            f"SELECT l.vessel_imo, COUNT(*) FROM mariapps_reports_data r JOIN raw_mariapps_logs l ON l.id = r.raw_report_id "
            f"WHERE COALESCE(l.is_duplicate, false) = false AND r.{col}::text ~ '^-[0-9.]+$' GROUP BY 1")).fetchall()
        if rows:
            found.append((col, sum(c for _, c in rows), rows))
    if not found:
        print(f"  none of the {len(cols)} columns checked holds a negative value")
    for col, t, rows in sorted(found, key=lambda f: -f[1]):
        print(f"  {col:30} {t:>5}   {by_vessel(rows, 5)}")
        ex = db.execute(text(
            f"SELECT l.vessel_imo, l.log_number, r.{col} FROM mariapps_reports_data r JOIN raw_mariapps_logs l ON l.id = r.raw_report_id "
            f"WHERE COALESCE(l.is_duplicate, false) = false AND r.{col}::text ~ '^-[0-9.]+$' LIMIT 2")).fetchall()
        for imo, ln, v in ex:
            print(f"        e.g. {names.get(imo, imo)} {ln}: {v}")
    print(f"  ({len(cols)} columns checked; the value is copied as entered, so a negative here is a source value)")


# ----------------------------------------------------------------------------- E09
def e09():
    head("E09  ROB drops by more than the consumption reported (> 1 MT unaccounted), per fuel grade")
    import re
    pat = re.compile(r"^Fuel ROB::(.+)::(ROB Before|ROB After|Consumed) \(MT\)$")
    rows = db.execute(text(
        "SELECT l.vessel_imo, l.log_number, r.log_date_utc, l.raw_json->'Consumption_Data' "
        "FROM raw_mariapps_logs l JOIN mariapps_reports_data r ON r.raw_report_id = l.id "
        "WHERE COALESCE(l.is_duplicate, false) = false AND r.log_date_utc IS NOT NULL "
        "ORDER BY l.vessel_imo, r.log_date_utc")).fetchall()
    grades, n_reports = Counter(), 0
    within, between, ex_w, ex_b = Counter(), Counter(), [], []
    prev = {}
    for imo, ln, ts, cons in rows:
        if not isinstance(cons, dict):
            prev[imo] = (ts, {})
            continue
        per = defaultdict(dict)
        for k, v in cons.items():
            m = pat.match(str(k))
            if m and _isnum(v):
                per[m.group(1)][m.group(2)] = float(str(v).replace(",", ""))
        if not per:
            prev[imo] = (ts, {})          # a report without any ROB table still counts as the adjacent one
            continue
        n_reports += 1
        for g, d in per.items():
            grades[g] += 1
            if all(x in d for x in ("ROB Before", "ROB After", "Consumed")):
                lost = d["ROB Before"] - d["ROB After"] - d["Consumed"]
                if lost > 1:
                    within[(imo, g)] += 1
                    ex_w.append((lost, names.get(imo, imo), ln, g, d))
            # compare with the IMMEDIATELY preceding report only: a report in between that
            # carries no table for this grade may have consumed it (a false drop otherwise)
            pv = prev.get(imo)
            if pv is not None and g in pv[1] and "ROB Before" in d and "ROB After" in pv[1][g]:
                gap = (ts - pv[0]).total_seconds() / 3600.0
                after = pv[1][g]["ROB After"]
                if 0 < gap <= 48 and after - d["ROB Before"] > 1:
                    between[(imo, g)] += 1
                    ex_b.append((after - d["ROB Before"], names.get(imo, imo), ln, g, after, d["ROB Before"]))
        prev[imo] = (ts, per)
    print(f"  reports carrying a per-grade fuel ROB table: {n_reports}   grades seen: "
          + ", ".join(f"{g} {c}" for g, c in grades.most_common(6)))
    for label, cnt, ex, fmt in (
            ("Within one report: ROB Before - ROB After - Consumed > 1 t (fuel left the tank without being consumed)",
             within, ex_w, lambda e: f"{e[1]} {e[2]} {e[3]}: before {e[4]['ROB Before']:.1f}, after {e[4]['ROB After']:.1f}, consumed {e[4]['Consumed']:.1f} -> {e[0]:.1f} t unaccounted"),
            ("Between ADJACENT reports (<= 48 h): previous ROB After - this ROB Before > 1 t (stock fell between reports)",
             between, ex_b, lambda e: f"{e[1]} {e[2]} {e[3]}: previous after {e[4]:.1f}, this before {e[5]:.1f} -> {e[0]:.1f} t lost")):
        print(f"\n  {label}: {sum(cnt.values())}")
        if cnt:
            print("     per vessel: " + by_vessel([(i, c) for (i, _), c in cnt.items()]))
            for e in sorted(ex, key=lambda t: -t[0])[:5]:
                print("     e.g. " + fmt(e))
    print("\n  These come straight from the vessel's ROB table in the raw report (Consumption_Data 'Fuel ROB'), so a "
          "hit is a source figure, not our mapping.")


# ----------------------------------------------------------------------------- M05 / M06
def m05_m06():
    head("M05 / M06  Fuel totals blank - idle (benign) vs real")
    dist = n("r.distance_og")
    mehrs = n('x."ME_RHME_dCnt_operational_LF"')
    me_blank = blank("r.me_total_cons")
    total = db.execute(text(f"SELECT COUNT(*) {BASE} TRUE")).scalar()
    print(f"reports: {total}")
    idle = f"({dist} <= 5 AND {mehrs} = 0)"
    for label, cond in (
            ("M06 ME total blank, ship idle (distance <= 5 nm and ME hours 0/blank): blank stands for 0 - benign", f"{me_blank} AND {idle}"),
            ("M06 ME total blank while the ship moved or ME ran - REAL gap", f"{me_blank} AND NOT {idle}"),
            ("M05 AE total blank - REAL (the auxiliary engine always burns fuel)", blank("r.ae_total_cons")),
            ("M05 Boiler AND composite boiler totals both blank - mostly benign (no boiler fuel)",
             f"{blank('r.bl_total_cons')} AND {blank('r.combl_total_cons')}")):
        rows = db.execute(text(f"SELECT x.vessel_imo, COUNT(*) {BASE} {cond} GROUP BY 1")).fetchall()
        print(f"\n  {label}: {sum(c for _, c in rows)}")
        if rows:
            print("     per vessel: " + by_vessel(rows))
    real = db.execute(text(f"SELECT x.log_type, COUNT(*) {BASE} {me_blank} AND NOT {idle} GROUP BY 1 ORDER BY 2 DESC LIMIT 6")).fetchall()
    print("\n  M06 real gaps by report type: " + ", ".join(f"{t} {c}" for t, c in real))
    # is the real-gap value in the raw ME key?
    ids = [r[0] for r in db.execute(text(f"SELECT x.raw_log_id {BASE} {me_blank} AND NOT {idle}"))]
    hit = 0
    for i in range(0, len(ids), 300):
        for (j,) in db.execute(text("SELECT raw_json FROM raw_mariapps_logs WHERE id = ANY(:i)"), {"i": ids[i:i + 300]}):
            if isinstance(j, dict) and any(
                    str(k).lower().startswith("me consumption") and "total" in str(k).lower()
                    and str(v).strip() not in ("", "None") for body in j.values() if isinstance(body, dict)
                    for k, v in body.items()):
                hit += 1
    print(f"  Of {len(ids)} real M06 gaps, the raw report holds an ME total in {hit} (those are OUR mapping gap) "
          f"and is also blank in {len(ids) - hit} (source).")


# ----------------------------------------------------------------------------- M12
def m12():
    head("M12  SOG and STW both blank on a report where the ship moved")
    dog = n('x."Vessel_DOG_dCnt_operational_LF"')
    moved = f"{dog} > 0"
    sp = ("Vessel_SOG_operational_LF", "Vessel_SOG_avg_operational_LF", "Vessel_STW_operational_LF", "Vessel_STW_avg_operational_LF")
    cond = f"{moved} AND " + " AND ".join(blank(f'x."{c}"') for c in sp)
    ids = {r[0]: r[1] for r in db.execute(text(f"SELECT x.raw_log_id, x.vessel_imo {BASE} {cond}"))}
    print(f"  blank in our table: {len(ids)}")
    ours, keys = 0, Counter()
    idl = list(ids)
    for i in range(0, len(idl), 300):
        for rid, j in db.execute(text("SELECT id, raw_json FROM raw_mariapps_logs WHERE id = ANY(:i)"), {"i": idl[i:i + 300]}):
            got = False
            for sec, body in (j or {}).items():
                if isinstance(body, dict):
                    for k, v in body.items():
                        kl = str(k).lower()
                        if ("speed over ground" in kl or "speed through water" in kl or "(sog)" in kl or "(stw)" in kl) \
                                and str(v).strip() not in ("", "None") and _isnum(v):
                            keys[f"{sec}::{k}"] += 1
                            got = True
            ours += got
    print(f"  raw has a speed value although ours is blank (OUR mapping gap): {ours}; also blank at source: {len(ids) - ours}")
    for k, c in keys.most_common(6):
        print(f"      raw key {k!r} in {c} reports")
    if ids:
        print("  per vessel: " + by_vessel(Counter(ids.values()).items()))


def _isnum(v):
    try:
        float(str(v).replace(",", ""))
        return True
    except ValueError:
        return False


# ----------------------------------------------------------------------------- C02
def _dec(deg, mn, d, plus, minus):
    try:
        v = float(deg) + float(mn or 0) / 60.0
    except (TypeError, ValueError):
        return None
    d = (d or "").strip().upper()[:1]
    if d == plus:
        return v
    if d == minus:
        return -v
    return None


def _gc(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    dl = math.radians(lo2 - lo1)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(a))


def c02():
    head("C02  Position jump: distance between consecutive positions far exceeds the distance reported")
    rows = db.execute(text(
        "SELECT l.vessel_imo, l.log_number, r.log_date_utc, r.lat_degree::text, r.lat_minutes::text, r.lat_direction, "
        "r.lon_degree::text, r.lon_minutes::text, r.lon_direction, r.distance_og::text "
        "FROM mariapps_reports_data r JOIN raw_mariapps_logs l ON l.id = r.raw_report_id "
        "WHERE COALESCE(l.is_duplicate, false) = false AND r.log_date_utc IS NOT NULL "
        "ORDER BY l.vessel_imo, r.log_date_utc")).fetchall()
    prev, tested, skipped, flagged, ex = {}, 0, 0, [], []
    for imo, ln, ts, la, lam, lad, lo, lom, lod, dist in rows:
        lat, lon = _dec(la, lam, lad, "N", "S"), _dec(lo, lom, lod, "E", "W")
        cur = (ts, lat, lon, ln)
        p = prev.get(imo)
        prev[imo] = cur
        if p is None:
            continue
        gap = (ts - p[0]).total_seconds() / 3600.0
        if gap < 1 or gap > 48:
            continue
        if None in (lat, lon, p[1], p[2]):
            skipped += 1
            continue
        tested += 1
        gc = _gc(p[1], p[2], lat, lon)
        rep = float(dist) if _isnum(dist) else 0.0
        if gc > 50 and gc > 1.3 * rep + 20:
            flagged.append((imo, ln, gc, rep, gap))
    print(f"  consecutive position pairs tested: {tested}   skipped (a position or direction blank): {skipped}")
    print(f"  flagged (great-circle > 1.3 x reported + 20 nm and > 50 nm): {len(flagged)}")
    if flagged:
        print("  per vessel: " + by_vessel([(i, 1) for i, *_ in flagged]))
        for imo, ln, gc, rep, gap in sorted(flagged, key=lambda f: -(f[2] - f[3]))[:8]:
            print(f"     {names.get(imo, imo)} {ln}: positions {gc:.0f} nm apart, reported {rep:.0f} nm, gap {gap:.0f} h")


# ----------------------------------------------------------------------------- C03
def c03():
    head("C03  Distance / duration vs SOG")
    dist, dur, sog = n("r.distance_og"), n("r.log_duration"), n("r.speed_og")
    conds = (("distance > 0 but duration 0/blank", f"{dist} > 0 AND {dur} = 0"),
             ("implied speed (distance / duration) > 20 kn", f"{dur} > 0 AND {dist} / {dur} > 20"),
             ("implied speed differs from the stored SOG by > 1 kn",
              f"{dur} > 0 AND {sog} > 0 AND ABS({dist} / {dur} - {sog}) > 1"))
    for label, c in conds:
        rows = db.execute(text(f"SELECT x.vessel_imo, COUNT(*) {BASE} {c} GROUP BY 1")).fetchall()
        print(f"  {label}: {sum(k for _, k in rows)}   {by_vessel(rows, 5)}")
    # which raw SOG key agrees with distance / duration on the third group?
    flagged = db.execute(text(f"SELECT x.raw_log_id, {dist}, {dur} {BASE} {conds[2][1]}")).fetchall()
    agree, seen = Counter(), 0
    ids = {r[0]: (r[1], r[2]) for r in flagged}
    idl = list(ids)
    for i in range(0, len(idl), 300):
        for rid, j in db.execute(text("SELECT id, raw_json FROM raw_mariapps_logs WHERE id = ANY(:i)"), {"i": idl[i:i + 300]}):
            d, h = ids[rid]
            seen += 1
            for sec, body in (j or {}).items():
                if isinstance(body, dict):
                    for k, v in body.items():
                        kl = str(k).lower()
                        if ("speed over ground" in kl or kl in ("sog", "speed (og)")) and _isnum(v) and abs(d / h - float(str(v).replace(',', ''))) <= 1:
                            agree[f"{sec}::{k}"] += 1
    print(f"\n  Of the {seen} SOG-mismatch reports, a raw SOG key that DOES agree with distance / duration within 1 kn:")
    for k, c in agree.most_common(5):
        print(f"      {k!r}: {c} reports  (if large, we compare against the wrong SOG column - our side)")
    if not agree:
        print("      none - the mismatch is in the entered data")


def main():
    for fn in (e05, c05, e09, m05_m06, m12, c02, c03):
        try:
            fn()
        except Exception as ex:
            db.rollback()
            print(f"\n!! {fn.__name__} could not run: {type(ex).__name__}: {str(ex)[:200]}")
    db.close()
    print("\nDone. Read-only: nothing was written.")


if __name__ == "__main__":
    main()
