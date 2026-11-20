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
# For each group one raw row is kept - by default the MOST COMPLETE copy (most
# filled columns; newest on a tie), because a copy can have a blank distance
# where the other has the value; --keep newest / --keep oldest are available.
# The report flags copies that would still LOSE a value or CONFLICT, so review
# it before --apply. Every other copy is:
#   - raw_mariapps_logs: flagged is_duplicate = true, NOT deleted (the audit
#     trail, and data_quality_logs rows point at it);
#   - expanded_mariapps_data, mariapps_reports_data, analysis_data: deleted
#     (iso19030_results rows go with their analysis_data row via CASCADE).
#
# USAGE (from vp-backend, app venv):
#   python -m backend.fix_mariapps_duplicate_copies                 # dry run, writes nothing
#   python -m backend.fix_mariapps_duplicate_copies --apply --i-have-a-backup
#   python -m backend.fix_mariapps_duplicate_copies --csv diffs.csv  # also save every difference to a file
#   python -m backend.fix_mariapps_duplicate_copies --keep newest    # change which copy is kept
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


def completeness(db, raw_ids):
    """{raw id: number of filled columns in its mariapps_reports_data row}.
    Counts every column except ids / timestamps; NULL and '' are empty."""
    rows = _q(db, """
        SELECT m.raw_report_id,
               (SELECT COUNT(*) FROM jsonb_each(to_jsonb(m)) e
                WHERE e.key NOT IN ('id', 'raw_report_id', 'created_at')
                  AND e.value <> 'null'::jsonb AND e.value <> '""'::jsonb)
        FROM mariapps_reports_data m
        WHERE m.raw_report_id = ANY(:ids)""", ids=raw_ids)
    return {r[0]: r[1] for r in rows}


def build_plan(db, keep="best"):
    """Returns dict(groups=[...], drop_ids=[...], reused=int). Read-only.
    keep: 'best' = the most complete copy (newest on a tie), 'newest', 'oldest'."""
    groups = _q(db, """
        SELECT vessel_imo, log_number, log_date, LOWER(TRIM(log_type)) AS lt,
               ARRAY_AGG(id ORDER BY id) AS ids
        FROM raw_mariapps_logs
        WHERE COALESCE(is_duplicate, false) = false
        GROUP BY 1, 2, 3, 4
        HAVING COUNT(*) > 1
        ORDER BY 1, 2""")
    scores = {}
    if keep == "best":
        scores = completeness(db, [i for g in groups for i in g[4]])
    plan_groups, drop_ids = [], []
    for imo, ln, ld, lt, ids in groups:
        ids = list(ids)
        if keep == "best":
            keep_id = max(ids, key=lambda i: (scores.get(i, -1), i))
        else:
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


def value_differences(db, groups):
    """Every (group, dropped copy) whose core values differ from the kept copy.
    Returns a list of (group, dropped id, kind, [(column, dropped, kept)]) where
    kind is 'LOSES' (kept copy is blank where the dropped one has a value - data
    would be lost), 'CONFLICT' (both filled but different) or 'MINOR' (only
    blank-vs-filled the other way round, i.e. the kept copy is the fuller one)."""
    out = []
    sel = ", ".join(CORE_COLS)
    all_ids = [i for g in groups for i in [g["keep"]] + g["drop"]]
    rows = {r[0]: r[1:] for r in _q(db, f"SELECT raw_report_id, {sel} FROM mariapps_reports_data "
                                        f"WHERE raw_report_id = ANY(:ids)", ids=all_ids)} if all_ids else {}
    for g in groups:
        kept = rows.get(g["keep"])
        if kept is None:
            continue
        for d in g["drop"]:
            other = rows.get(d)
            if other is None:
                continue
            diffs = [(c, o, k) for c, o, k in zip(CORE_COLS, other, kept) if o != k]
            if not diffs:
                continue
            if any(k is None and o is not None for _, o, k in diffs):
                kind = "LOSES"
            elif any(k is not None and o is not None for _, o, k in diffs):
                kind = "CONFLICT"
            else:
                kind = "MINOR"
            out.append((g, d, kind, diffs))
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


def report(db, plan, keep, csv_path=None):
    names = {i: n for i, n in _q(db, "SELECT imo_number, vessel_name FROM vessels")}
    log.info(f"Exact duplicate groups (same vessel + log number + date + type): {len(plan['groups'])}")
    per_v = {}
    for g in plan["groups"]:
        per_v[names.get(g["imo"], g["imo"])] = per_v.get(names.get(g["imo"], g["imo"]), 0) + len(g["drop"])
    for v, c in sorted(per_v.items(), key=lambda kv: -kv[1]):
        log.info(f"    {v:16} {c:>5} extra copies")
    log.info(f"Copies to retire (keeping the {keep} copy of each group): {len(plan['drop_ids'])}")
    log.info(f"Log numbers reused on a different date/type (genuine, left alone): {plan['reused']}")
    log.info("Rows that would be deleted: " + ", ".join(f"{k}={v}" for k, v in table_counts(db, plan["drop_ids"]).items()))
    diffs = value_differences(db, plan["groups"])
    by_kind = {k: [x for x in diffs if x[2] == k] for k in ("LOSES", "CONFLICT", "MINOR")}
    log.info(f"Copies differing in a core value: {len(diffs)}  ->  "
             f"LOSES a value={len(by_kind['LOSES'])}, CONFLICT={len(by_kind['CONFLICT'])}, "
             f"kept copy is the fuller one={len(by_kind['MINOR'])}")

    def line(g, d, dl):
        desc = "; ".join(f"{c}: dropped={o} kept={k}" for c, o, k in dl)
        return (f"{names.get(g['imo'], g['imo'])} {g['log_number']} {g['log_date']} "
                f"(kept raw {g['keep']}, drop {d}) -> {desc}")

    for kind, title in (("LOSES", "Kept copy is BLANK where the dropped copy has a value (value would be lost)"),
                        ("CONFLICT", "Both copies filled but different (needs a human decision)")):
        if by_kind[kind]:
            log.info(f"{title}: {len(by_kind[kind])}")
            for g, d, _, dl in by_kind[kind]:
                log.info("    " + line(g, d, dl))
    if csv_path:
        import csv
        with open(csv_path, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["kind", "vessel", "log_number", "log_date", "kept_raw_id", "dropped_raw_id", "column", "dropped_value", "kept_value"])
            for g, d, kind, dl in diffs:
                for c, o, k in dl:
                    w.writerow([kind, names.get(g["imo"], g["imo"]), g["log_number"], g["log_date"], g["keep"], d, c, o, k])
        log.info(f"Full list of differences written to {csv_path}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    ap.add_argument("--i-have-a-backup", action="store_true", help="required together with --apply")
    ap.add_argument("--keep", choices=["best", "newest", "oldest"], default="best",
                    help="best = most complete copy, newest on a tie (default)")
    ap.add_argument("--csv", help="write every core-value difference to this CSV file")
    args = ap.parse_args()
    if args.apply and not args.i_have_a_backup:
        ap.error("--apply needs --i-have-a-backup (take a database backup first)")

    db = SessionLocal()
    try:
        plan = build_plan(db, args.keep)
        log.info("analysis_data (mari_apps) rows per vessel BEFORE: " + str(per_vessel_analysis_rows(db)))
        report(db, plan, args.keep, args.csv)
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
