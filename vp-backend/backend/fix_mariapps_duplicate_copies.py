# ===========================================================================
# backend/fix_mariapps_duplicate_copies.py
#
# One-off clean-up for MariApps reports stored TWICE under different
# fingerprints (found 2026-11-20: ~720 log numbers on AMNS POLAR, AMNSI
# STALLION, AMNSI MAXIMUS, AM UMANG, GCL NARMADA). A re-scrape inserted a
# second raw row instead of updating the first, and the copy flowed into
# mariapps_reports_data / analysis_data / expanded_mariapps_data, doubling
# distance and fuel sums. The cause is fixed in mariapps_persistence.py
# (natural-key lookup); this script cleans up what was already written.
# fix_duplicate_raw_and_expanded.py does NOT cover this: it groups by
# fingerprint and assumes analysis_data was never affected.
#
# A "copy" = same vessel + log_number + log_date + log_type. A log number
# reused on a different date or type is a genuinely different report and is
# left alone (listed in the report for information).
#
# For each group one raw row is kept (the NEWEST by default - the later
# scrape holds the report's latest state; use --keep oldest to reverse) and
# every other copy is:
#   - raw_mariapps_logs: flagged is_duplicate = true, NOT deleted (the audit
#     trail, and data_quality_logs rows point at it);
#   - expanded_mariapps_data, mariapps_reports_data, analysis_data: deleted
#     (iso19030_results rows go with their analysis_data row via CASCADE).
#
# USAGE (from vp-backend, app venv):
#   python -m backend.fix_mariapps_duplicate_copies                 # dry run, writes nothing
#   python -m backend.fix_mariapps_duplicate_copies --apply --i-have-a-backup
#   python -m backend.fix_mariapps_duplicate_copies --keep oldest   # change which copy is kept
# Take a database backup before --apply. Re-running is safe (idempotent).
# ===========================================================================
import argparse
import logging

from sqlalchemy import text

from .database import SessionLocal

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)

CORE_COLS = ["distance_og", "log_duration", "me_total_cons", "ae_total_cons", "bl_total_cons", "to_port"]


def _q(db, sql, **p):
    return db.execute(text(sql), p).fetchall()


def build_plan(db, keep="newest"):
    """Returns dict(groups=[...], drop_ids=[...], reused=int). Read-only."""
    groups = _q(db, """
        SELECT vessel_imo, log_number, log_date, LOWER(TRIM(log_type)) AS lt,
               ARRAY_AGG(id ORDER BY id) AS ids
        FROM raw_mariapps_logs
        WHERE COALESCE(is_duplicate, false) = false
        GROUP BY 1, 2, 3, 4
        HAVING COUNT(*) > 1
        ORDER BY 1, 2""")
    plan_groups, drop_ids = [], []
    for imo, ln, ld, lt, ids in groups:
        ids = list(ids)
        keep_id = ids[-1] if keep == "newest" else ids[0]
        drops = [i for i in ids if i != keep_id]
        plan_groups.append(dict(imo=imo, log_number=ln, log_date=ld, log_type=lt, keep=keep_id, drop=drops))
        drop_ids.extend(drops)
    reused = _q(db, """
        SELECT COUNT(*) FROM (
            SELECT vessel_imo, log_number FROM raw_mariapps_logs
            WHERE COALESCE(is_duplicate, false) = false
            GROUP BY 1, 2 HAVING COUNT(DISTINCT (log_date, LOWER(TRIM(log_type)))) > 1) t""")[0][0]
    return dict(groups=plan_groups, drop_ids=drop_ids, reused=reused)


def table_counts(db, drop_ids):
    if not drop_ids:
        return {k: 0 for k in ("expanded_mariapps_data", "mariapps_reports_data", "analysis_data", "iso19030_results")}
    p = dict(ids=drop_ids)
    return {
        "expanded_mariapps_data": _q(db, "SELECT COUNT(*) FROM expanded_mariapps_data WHERE raw_log_id = ANY(:ids)", **p)[0][0],
        "mariapps_reports_data": _q(db, "SELECT COUNT(*) FROM mariapps_reports_data WHERE raw_report_id = ANY(:ids)", **p)[0][0],
        "analysis_data": _q(db, "SELECT COUNT(*) FROM analysis_data WHERE raw_mariapps_id = ANY(:ids)", **p)[0][0],
        "iso19030_results": _q(db, """SELECT COUNT(*) FROM iso19030_results i
                                      JOIN analysis_data a ON a.id = i.analysis_id
                                      WHERE a.raw_mariapps_id = ANY(:ids)""", **p)[0][0],
    }


def value_differences(db, groups, limit=40):
    """Groups where the kept and dropped copies differ in a core value."""
    out = []
    sel = ", ".join(CORE_COLS)
    for g in groups:
        rows = {r[0]: r[1:] for r in _q(db, f"SELECT raw_report_id, {sel} FROM mariapps_reports_data "
                                            f"WHERE raw_report_id = ANY(:ids)", ids=[g["keep"]] + g["drop"])}
        kept = rows.get(g["keep"])
        if kept is None:
            continue
        for d in g["drop"]:
            other = rows.get(d)
            if other is None:
                continue
            diffs = [(c, o, k) for c, o, k in zip(CORE_COLS, other, kept) if o != k]
            if diffs:
                out.append((g, d, diffs))
        if len(out) >= limit:
            break
    return out


def apply_plan(db, plan):
    """Writes. Caller commits (or rolls back)."""
    ids = plan["drop_ids"]
    if not ids:
        return 0
    db.execute(text("UPDATE raw_mariapps_logs SET is_duplicate = true WHERE id = ANY(:ids)"), dict(ids=ids))
    db.execute(text("DELETE FROM expanded_mariapps_data WHERE raw_log_id = ANY(:ids)"), dict(ids=ids))
    db.execute(text("DELETE FROM mariapps_reports_data WHERE raw_report_id = ANY(:ids)"), dict(ids=ids))
    db.execute(text("DELETE FROM analysis_data WHERE raw_mariapps_id = ANY(:ids)"), dict(ids=ids))
    return len(ids)


def per_vessel_analysis_rows(db):
    names = {i: n for i, n in _q(db, "SELECT imo_number, vessel_name FROM vessels")}
    return {names.get(i, i): c for i, c in _q(
        db, "SELECT vessel_imo, COUNT(*) FROM analysis_data WHERE source_id='mari_apps' GROUP BY 1 ORDER BY 1")}


def report(db, plan, keep):
    names = {i: n for i, n in _q(db, "SELECT imo_number, vessel_name FROM vessels")}
    log.info(f"Exact duplicate groups (same vessel + log number + date + type): {len(plan['groups'])}")
    per_v = {}
    for g in plan["groups"]:
        per_v[names.get(g["imo"], g["imo"])] = per_v.get(names.get(g["imo"], g["imo"]), 0) + len(g["drop"])
    for v, c in sorted(per_v.items(), key=lambda kv: -kv[1]):
        log.info(f"    {v:16} {c:>5} extra copies")
    log.info(f"Copies to retire (keeping the {keep} of each group): {len(plan['drop_ids'])}")
    log.info(f"Log numbers reused on a different date/type (genuine, left alone): {plan['reused']}")
    log.info("Rows that would be deleted: " + ", ".join(f"{k}={v}" for k, v in table_counts(db, plan["drop_ids"]).items()))
    diffs = value_differences(db, plan["groups"])
    log.info(f"Groups where the copies DIFFER in a core value (review before applying): {len(diffs)}"
             f"{'+' if len(diffs) >= 40 else ''}")
    for g, d, dl in diffs:
        desc = "; ".join(f"{c}: dropped={o} kept={k}" for c, o, k in dl)
        log.info(f"    {names.get(g['imo'], g['imo'])} {g['log_number']} {g['log_date']} "
                 f"(kept raw {g['keep']}, drop {d}) -> {desc}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--i-have-a-backup", action="store_true", help="required together with --apply")
    ap.add_argument("--keep", choices=["newest", "oldest"], default="newest")
    args = ap.parse_args()
    if args.apply and not args.i_have_a_backup:
        ap.error("--apply needs --i-have-a-backup (take a database backup first)")

    db = SessionLocal()
    try:
        plan = build_plan(db, args.keep)
        log.info("analysis_data (mari_apps) rows per vessel BEFORE: " + str(per_vessel_analysis_rows(db)))
        report(db, plan, args.keep)
        if not args.apply:
            log.info("DRY RUN - nothing written. Re-run with --apply --i-have-a-backup to clean up.")
            return
        n = apply_plan(db, plan)
        db.commit()
        log.info(f"APPLIED: {n} duplicate copies retired.")
        log.info("analysis_data (mari_apps) rows per vessel AFTER: " + str(per_vessel_analysis_rows(db)))
        log.info("Re-run audit_noon_data.py / audit_duplicates.py to confirm the duplicates are gone.")
    except Exception:
        db.rollback()
        log.exception("Failed - nothing was committed.")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
