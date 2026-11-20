# ===========================================================================
# backend/fix_retired_copy_leftovers.py
#
# Removes the derived rows (expanded_mariapps_data, mariapps_reports_data,
# analysis_data; iso19030_results goes with analysis_data via CASCADE) that still
# exist for MariApps raw reports already retired as duplicates (is_duplicate = true).
# Found 2026-11-20: after the duplicate clean-up, 10 retired copies (AMNSI MAXIMUS 5,
# AMNSI STALLION 5) still had derived rows, so those reports were counted twice.
#
# Safety: only retired copies that have a LIVE twin (same vessel + log number, not
# retired) are touched. A retired copy without a live twin is only reported, never
# deleted. raw_mariapps_logs is never modified.
#
# USAGE (from vp-backend, app venv; not in the first minute after a service restart):
#   python -m backend.fix_retired_copy_leftovers            # dry run
#   python -m backend.fix_retired_copy_leftovers --apply
# Idempotent.
# ===========================================================================
import argparse
import logging

from sqlalchemy import text

from .database import SessionLocal

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)

CANDIDATES = """
    SELECT r.id, v.vessel_name, r.log_number,
           EXISTS (SELECT 1 FROM raw_mariapps_logs t
                   WHERE t.vessel_imo = r.vessel_imo AND t.log_number = r.log_number
                     AND COALESCE(t.is_duplicate, false) = false) AS has_twin
    FROM raw_mariapps_logs r
    LEFT JOIN vessels v ON v.imo_number = r.vessel_imo
    WHERE COALESCE(r.is_duplicate, false) = true
      AND (EXISTS (SELECT 1 FROM expanded_mariapps_data e WHERE e.raw_log_id = r.id)
        OR EXISTS (SELECT 1 FROM mariapps_reports_data m WHERE m.raw_report_id = r.id)
        OR EXISTS (SELECT 1 FROM analysis_data a WHERE a.raw_mariapps_id = r.id))
    ORDER BY 2, 3"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually delete (default is a dry run)")
    args = ap.parse_args()
    db = SessionLocal()
    try:
        rows = db.execute(text(CANDIDATES)).fetchall()
        safe = [r[0] for r in rows if r[3]]
        orphans = [r for r in rows if not r[3]]
        log.info(f"Retired copies that still have derived rows: {len(rows)} (with a live twin: {len(safe)})")
        for r in rows:
            log.info(f"    raw {r[0]:>7}  {r[1]}  {r[2]}  live twin: {'yes' if r[3] else 'NO - left alone'}")
        if orphans:
            log.warning(f"{len(orphans)} retired copies have NO live twin - not touched, review them.")
        if not args.apply:
            log.info("DRY RUN - nothing written. Re-run with --apply.")
            return
        if safe:
            p = dict(ids=safe)
            db.execute(text("DELETE FROM expanded_mariapps_data WHERE raw_log_id = ANY(:ids)"), p)
            db.execute(text("DELETE FROM mariapps_reports_data WHERE raw_report_id = ANY(:ids)"), p)
            db.execute(text("DELETE FROM analysis_data WHERE raw_mariapps_id = ANY(:ids)"), p)
        db.commit()
        log.info(f"APPLIED: derived rows removed for {len(safe)} retired copies.")
    except Exception:
        db.rollback()
        log.exception("Failed - nothing was committed.")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
