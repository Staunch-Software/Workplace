"""
Read-only audit of our MariApps noon data against the issues in the colleague's
"Fleet Noon Records Issues Log" (2026-11-19). Writes nothing, sends nothing.

Run from the vp-backend folder with the app's venv:
    python audit_noon_data.py

Each section prints what OUR database holds so it can be compared with the
report's numbers (shown as "report:" lines). Sections are independent: one
failing section does not stop the others.
"""
from sqlalchemy import text

from backend.database import SessionLocal

NUM = r"^[-+]?[0-9]+(\.[0-9]+)?$"


def n(col):
    """Text column -> number, 0 when blank/non-numeric (same idea as checks.py)."""
    return f"(CASE WHEN {col} ~ '{NUM}' THEN {col}::double precision ELSE 0 END)"


ME_FUELS = ["hfo", "lfo", "mdo", "lpg_propane", "lpg_butane", "lng", "methanol", "ethanol", "ammonia", "bio_fuel"]
ME_SUM = " + ".join(n(f"r.me_{g}") for g in ME_FUELS)
AE_SUM = " + ".join(n(f"r.ae_{g}") for g in ME_FUELS)

db = SessionLocal()
names = {}


def section(title):
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def run(sql, **params):
    return db.execute(text(sql), params).fetchall()


def vname(imo):
    return names.get(imo, imo)


def safe(fn):
    try:
        fn()
    except Exception as ex:  # keep going if one check cannot run
        db.rollback()
        print(f"  !! section failed: {type(ex).__name__}: {str(ex)[:200]}")


def coverage():
    section("0. Coverage: what our DB holds per vessel (MariApps)")
    print("  report rows: KIRTI 391, TARANG 387, UMANG 435, POLAR 590, TUFMAX 243, MAXIMUS 574,")
    print("               STALLION 510, FOS 294, GANGA 438, NARMADA 427, SABARMATI 418, SARASWATI 379,")
    print("               TAPI 422, YAMUNA 417  (export covers 1 Jan - mid Nov 2026)")
    print(f"  {'vessel':16} {'rows':>6} {'from':>12} {'to':>12}")
    for imo, cnt, d0, d1 in run("""
        SELECT vessel_imo, COUNT(*), MIN(log_date), MAX(log_date)
        FROM expanded_mariapps_data GROUP BY 1 ORDER BY 1"""):
        print(f"  {vname(imo):16} {cnt:>6} {str(d0):>12} {str(d1):>12}")


def duplicates():
    section("1. E03 duplicates: same log number stored twice?")
    print("  report: every AMNSI STALLION row, 222 AMNSI MAXIMUS, 230 AMNS POLAR appear twice in the EXPORT")
    print(f"  {'vessel':16} {'rows':>6} {'distinct logs':>14} {'extra copies':>13}")
    any_dup = False
    for imo, total, distinct in run("""
        SELECT vessel_imo, COUNT(*), COUNT(DISTINCT log_number)
        FROM expanded_mariapps_data GROUP BY 1 ORDER BY 1"""):
        extra = total - distinct
        any_dup |= extra > 0
        print(f"  {vname(imo):16} {total:>6} {distinct:>14} {extra:>13}{'  <-- DUPLICATES' if extra else ''}")
    print("  -> analysis_data (what the app reads): rows vs distinct source report")
    for imo, total, distinct in run("""
        SELECT vessel_imo, COUNT(*), COUNT(DISTINCT raw_mariapps_id)
        FROM analysis_data WHERE source_id = 'mari_apps' GROUP BY 1 ORDER BY 1"""):
        extra = total - distinct
        any_dup |= extra > 0
        print(f"  {vname(imo):16} {total:>6} {distinct:>14} {extra:>13}{'  <-- DOUBLE COUNTED' if extra else ''}")
    print("  VERDICT:", "duplicates exist in OUR data - fix needed" if any_dup else "no duplicates in our data (export-only issue)")


def biofuel():
    section("2. E02 phantom biofuel: boiler biofuel = boiler MDO")
    print("  report: AM TARANG 71, GCL NARMADA 26, GCL YAMUNA 8, GCL TAPI 5, AM UMANG 1")
    print(f"  {'vessel':16} {'bl_bio>0':>9} {'= bl_mdo':>9} {'different':>10}")
    for imo, tot, same, diff in run(f"""
        SELECT x.vessel_imo,
               COUNT(*) FILTER (WHERE {n('r.bl_bio_fuel')} > 0),
               COUNT(*) FILTER (WHERE {n('r.bl_bio_fuel')} > 0 AND {n('r.bl_bio_fuel')} = {n('r.bl_mdo')}),
               COUNT(*) FILTER (WHERE {n('r.bl_bio_fuel')} > 0 AND {n('r.bl_bio_fuel')} <> {n('r.bl_mdo')})
        FROM mariapps_reports_data r
        JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id
        GROUP BY 1 ORDER BY 1"""):
        if tot:
            print(f"  {vname(imo):16} {tot:>9} {same:>9} {diff:>10}")
    print("  (vessels not listed have no boiler biofuel at all)")
    print("  -> biofuel in ME / AE columns (may be real bunkered B24; compare with bunker records)")
    for imo, me, ae in run(f"""
        SELECT x.vessel_imo,
               COUNT(*) FILTER (WHERE {n('r.me_bio_fuel')} > 0),
               COUNT(*) FILTER (WHERE {n('r.ae_bio_fuel')} > 0)
        FROM mariapps_reports_data r
        JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id
        GROUP BY 1 ORDER BY 1"""):
        if me or ae:
            print(f"  {vname(imo):16} ME rows {me:>4}   AE rows {ae:>4}")


def totals():
    section("3. E04 totals: ME / AE total vs sum of its fuel columns (tolerance 0.05)")
    print("  report: ~1,960 ME/AE total mismatches fleet-wide in the EXPORT")
    print(f"  {'vessel':16} {'rows':>6} {'ME mismatch':>12} {'AE mismatch':>12}")
    for imo, tot, me, ae in run(f"""
        SELECT x.vessel_imo, COUNT(*),
               COUNT(*) FILTER (WHERE ABS({n('r.me_total_cons')} - ({ME_SUM})) > 0.05),
               COUNT(*) FILTER (WHERE ABS({n('r.ae_total_cons')} - ({AE_SUM})) > 0.05)
        FROM mariapps_reports_data r
        JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id
        GROUP BY 1 ORDER BY 1"""):
        print(f"  {vname(imo):16} {tot:>6} {me:>12} {ae:>12}")


def longitude():
    section("4. C01 longitude direction: what do we store in lon_direction?")
    print("  report: zero West longitudes fleet-wide in the export (every position ends in E)")
    print("  MariApps raw table (numeric = BROKEN: degrees copied into the direction field):")
    print(f"  {'vessel':16} {'E':>5} {'W':>5} {'numeric':>8} {'blank':>6} {'rows':>6}")
    for imo, e, w, num, blank, tot in run(f"""
        SELECT x.vessel_imo,
               COUNT(*) FILTER (WHERE UPPER(LEFT(r.lon_direction,1)) = 'E'),
               COUNT(*) FILTER (WHERE UPPER(LEFT(r.lon_direction,1)) = 'W'),
               COUNT(*) FILTER (WHERE r.lon_direction ~ '{NUM}'),
               COUNT(*) FILTER (WHERE r.lon_direction IS NULL OR TRIM(r.lon_direction) = ''),
               COUNT(*)
        FROM mariapps_reports_data r
        JOIN expanded_mariapps_data x ON x.raw_log_id = r.raw_report_id
        GROUP BY 1 ORDER BY 1"""):
        print(f"  {vname(imo):16} {e:>5} {w:>5} {num:>8} {blank:>6} {tot:>6}")
    print("  WNI source (for comparison, East/West expected):")
    for d, c in run("SELECT lon_direction, COUNT(*) FROM noon_report_data GROUP BY 1 ORDER BY 2 DESC LIMIT 6"):
        print(f"    {d!s:10} {c}")
    print("  lat_direction in MariApps raw (should be N / S):")
    for d, c in run("SELECT lat_direction, COUNT(*) FROM mariapps_reports_data GROUP BY 1 ORDER BY 2 DESC LIMIT 5"):
        print(f"    {d!s:10} {c}")


def cp_instruction():
    section("5. M14 CP instruction (groundwork for the CP-instruction gap)")
    print("  report: Voyage Remarks blank on ~80% of Noon-at-sea reports (1,877 records)")
    print("  vessels with the CP remarks check turned on (requires_cp_remarks_check):")
    for row in run("SELECT * FROM cp_vessel_description ORDER BY 1"):
        d = row._mapping
        key = next((k for k in d.keys() if "imo" in k.lower()), None)
        print(f"    {vname(d[key]) if key else '?':16} requires_cp_remarks_check = {d.get('requires_cp_remarks_check')}")
    print("  expanded rows flagged dataqualityx_missing_cp_instruction, per vessel:")
    for imo, flagged, tot in run("""
        SELECT vessel_imo,
               COUNT(*) FILTER (WHERE dataqualityx_missing_cp_instruction IS NOT NULL),
               COUNT(*)
        FROM expanded_mariapps_data GROUP BY 1 ORDER BY 1"""):
        print(f"    {vname(imo):16} flagged {flagged:>5} of {tot:>5}")
    print("  data_quality_findings by rule and status:")
    for rule, st, c in run("SELECT rule_key, status, COUNT(*) FROM data_quality_findings GROUP BY 1,2 ORDER BY 1,2"):
        print(f"    {rule:26} {st:13} {c}")


if __name__ == "__main__":
    try:
        names.update({imo: nm for imo, nm in run("SELECT imo_number, vessel_name FROM vessels")})
    except Exception:
        db.rollback()
    for fn in (coverage, duplicates, biofuel, totals, longitude, cp_instruction):
        safe(fn)
    db.close()
    print("\nDone. Read-only: nothing was written.")
