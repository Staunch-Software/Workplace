# ===========================================================================
# backend/fix_mariapps_coord_directions.py
#
# One-off repair of MariApps latitude / longitude DIRECTIONS (found 2026-11-20).
# The MariApps Excel export's "Lon Direction" column holds the longitude
# DEGREES (e.g. '87') instead of E/W, and the old mapping stored it as-is, so
# every MariApps position lost its E/W (the UI then showed all of them as East).
# The detail page's Position tab carries the real value. The mapping is fixed
# in backend/mapping.py (hemisphere()); this script re-derives the direction
# for rows already stored, using the same mapping on the stored raw JSON.
#
# Updates only text columns, and only where the stored value differs from the
# re-derived one and the re-derived one is a real hemisphere:
#   mariapps_reports_data.lon_direction / lat_direction
#   expanded_mariapps_data."VoyageMeta_longitude_lon_direction_operational_LF"
#   expanded_mariapps_data."VoyageMeta_latitude_lat_direction_operational_LF"
# Where the report gives no direction, a junk stored value (a number) is cleared
# to NULL - a number is never a valid direction; a blank stays blank. Idempotent.
#
# USAGE (from vp-backend, app venv):
#   python -m backend.fix_mariapps_coord_directions            # dry run, writes nothing
#   python -m backend.fix_mariapps_coord_directions --apply
# ===========================================================================
import argparse
import logging
from collections import Counter

from sqlalchemy import text

from .database import SessionLocal
from .mapping import map_mariapps_to_160, hemisphere

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)

EXP_LON = "VoyageMeta_longitude_lon_direction_operational_LF"
EXP_LAT = "VoyageMeta_latitude_lat_direction_operational_LF"


def derive(raw_json):
    j = raw_json or {}
    m = map_mariapps_to_160(j, excel_data=j.get("Excel_Data"), header_data=j.get("Header_Data"))
    return m.get("lat_direction"), m.get("lon_direction")


def build_changes(db):
    names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
    rows = db.execute(text("""
        SELECT r.id, r.vessel_imo, r.raw_json, m.lat_direction, m.lon_direction
        FROM raw_mariapps_logs r
        JOIN mariapps_reports_data m ON m.raw_report_id = r.id
        WHERE COALESCE(r.is_duplicate, false) = false""")).fetchall()
    changes, west_by_vessel, lon_from = [], Counter(), Counter()
    for rid, imo, raw_json, old_lat, old_lon in rows:
        new_lat, new_lon = derive(raw_json)
        # new value differs -> set it; no new value but the stored one is junk -> clear it
        upd_lat = (new_lat is not None and new_lat != old_lat) or                   (new_lat is None and old_lat not in (None, "") and hemisphere(old_lat, "NS") is None)
        upd_lon = (new_lon is not None and new_lon != old_lon) or                   (new_lon is None and old_lon not in (None, "") and hemisphere(old_lon, "EW") is None)
        if not (upd_lat or upd_lon):
            continue
        changes.append(dict(id=rid, set_lat=upd_lat, lat=new_lat, set_lon=upd_lon, lon=new_lon))
        if upd_lon and new_lon is None:
            lon_from[("numeric", "cleared")] += 1
        elif upd_lon:
            lon_from[(str(old_lon) if old_lon is None or not str(old_lon).replace('.', '').isdigit() else "numeric", new_lon)] += 1
            if new_lon == "W":
                west_by_vessel[names.get(imo, imo)] += 1
    return changes, west_by_vessel, lon_from


def apply_changes(db, changes):
    n_lon = n_lat = 0
    for c in changes:
        if c["set_lon"]:
            db.execute(text("UPDATE mariapps_reports_data SET lon_direction = :d WHERE raw_report_id = :i"), dict(d=c["lon"], i=c["id"]))
            db.execute(text(f'UPDATE expanded_mariapps_data SET "{EXP_LON}" = :d WHERE raw_log_id = :i'), dict(d=c["lon"], i=c["id"]))
            n_lon += 1
        if c["set_lat"]:
            db.execute(text("UPDATE mariapps_reports_data SET lat_direction = :d WHERE raw_report_id = :i"), dict(d=c["lat"], i=c["id"]))
            db.execute(text(f'UPDATE expanded_mariapps_data SET "{EXP_LAT}" = :d WHERE raw_log_id = :i'), dict(d=c["lat"], i=c["id"]))
            n_lat += 1
    return n_lon, n_lat


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        changes, west_by_vessel, lon_from = build_changes(db)
        log.info(f"Reports whose direction will change: {len(changes)}")
        log.info(f"Longitude direction changes (old -> new): {dict(lon_from)}")
        log.info("West longitudes recovered per vessel: " + (str(dict(west_by_vessel)) if west_by_vessel else "none"))
        if not args.apply:
            log.info("DRY RUN - nothing written. Re-run with --apply to fix the stored rows.")
            return
        n_lon, n_lat = apply_changes(db, changes)
        db.commit()
        log.info(f"APPLIED: longitude direction set on {n_lon} reports, latitude direction on {n_lat}.")
        log.info("Re-run audit_noon_data.py: section 4 should now show E / W instead of numbers.")
    except Exception:
        db.rollback()
        log.exception("Failed - nothing was committed.")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
