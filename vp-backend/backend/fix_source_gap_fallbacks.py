# ===========================================================================
# backend/fix_source_gap_fallbacks.py
#
# One-off repair of expanded_mariapps_data columns that were blank although the raw
# MariApps report carries the value (found 2026-11-25 with audit_blank_source.py):
#   - Cargo Onboard       ("Cargo On Board (MT or m3)" was mapped to the TEU column)
#   - ME Running Hours    (no "ME Running hours - Value": use the per-engine entries)
#   - Latitude / Longitude degrees (a 0 degree is dropped by the Excel export; the
#     Position tab has it)
# The rules live in expander._mariapps_gap_fields (also used by every new ingestion).
# This command applies them to the rows already stored: it fills a column ONLY where it
# is blank today, never overwrites a value, never touches raw_json. Idempotent.
#
# USAGE (from vp-backend, app venv; not in the first minute after a service restart):
#   python -m backend.fix_source_gap_fallbacks            # dry run, writes nothing
#   python -m backend.fix_source_gap_fallbacks --apply
# ===========================================================================
import argparse
import logging
from collections import Counter

from sqlalchemy import text

from .database import engine
from .pipeline.expander import (MARIAPPS_TO_NEWCOL, _apply_stw_fallback, _get_table_cols,
                                _map_flat_to_newcols, _mariapps_gap_fields, flatten_mariapps)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)
BATCH = 200
LABEL = {"Vessel_Cargo_onboard_operational_LF": "Cargo Onboard",
         "ME_RHME_dCnt_operational_LF": "ME Running Hours",
         "VoyageMeta_latitude_operational_LF": "Latitude degrees",
         "VoyageMeta_latitude_lat_minutes_operational_LF": "Latitude minutes",
         "VoyageMeta_longitude_operational_LF": "Longitude degrees",
         "VoyageMeta_longitude_lon_minutes_operational_LF": "Longitude minutes"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    with engine.connect() as conn:
        table_cols = _get_table_cols(conn, "expanded_mariapps_data")
        names = {i: n for i, n in conn.execute(text("SELECT imo_number, vessel_name FROM vessels"))}
        ids = [r[0] for r in conn.execute(text(
            "SELECT id FROM raw_mariapps_logs WHERE COALESCE(is_duplicate, false) = false ORDER BY id"))]
        conn.rollback()
        per_field, per_vessel, written = Counter(), Counter(), 0
        for i in range(0, len(ids), BATCH):
            rows = conn.execute(text(
                "SELECT id, vessel_imo, raw_json FROM raw_mariapps_logs WHERE id = ANY(:ids)"),
                {"ids": ids[i:i + BATCH]}).fetchall()
            for rid, imo, raw in rows:
                flat = flatten_mariapps(raw or {})
                rec = _apply_stw_fallback(_map_flat_to_newcols(flat, MARIAPPS_TO_NEWCOL, table_cols))
                want = _mariapps_gap_fields(rec, flat, table_cols)
                if not want:
                    continue
                cols = list(want)
                cur = conn.execute(text(
                    "SELECT " + ", ".join(f'"{c}"' for c in cols) + " FROM expanded_mariapps_data WHERE raw_log_id = :r"),
                    {"r": rid}).fetchone()
                if cur is None:
                    continue
                todo = {c: want[c] for c, v in zip(cols, cur) if not str(v or "").strip()}
                if not todo:
                    continue
                for c in todo:
                    per_field[LABEL.get(c, c)] += 1
                per_vessel[names.get(imo, imo)] += 1
                if args.apply:
                    conn.execute(text("UPDATE expanded_mariapps_data SET " + ", ".join(f'"{c}" = :{n}' for n, c in enumerate(todo))
                                      + " WHERE raw_log_id = :r"),
                                 {**{str(n): v for n, v in enumerate(todo.values())}, "r": rid})
                    written += 1
            if args.apply:
                conn.commit()
            else:
                conn.rollback()

    log.info("Blank cells that can be filled from the raw report:")
    for k, v in per_field.most_common():
        log.info(f"    {k:20} {v}")
    log.info("Per vessel (reports): " + ", ".join(f"{v} {n}" for v, n in per_vessel.most_common()))
    log.info(f"APPLIED: {written} reports updated." if args.apply
             else "DRY RUN - nothing written. Re-run with --apply to fill them.")


if __name__ == "__main__":
    main()
