"""ABS extraction CLI.

Usage:
    python abs_extract.py --vessel_imo=9481661
    python abs_extract.py --all
    python abs_extract.py --vessel_imo=9481661 --force-resolve

This account's B2C policy is genuinely MFA-gated — see sources/abs_login.py's docstring.
The FIRST run must use --headed so a human can complete the MFA challenge once; after that,
the persisted trusted-device state lets headless runs skip it.
"""
import argparse
import logging
import sys
from datetime import datetime, timezone

from decouple import config

from sources import abs_login
from sources.abs_extract import parse_abs_pdf
from vessel_resolution import get_our_vessels, resolve_abs
from db import (
    taskmgmt_engine, class_certificates, class_surveys, class_conditions,
    replace_for_vessel_source, report_unmapped_names,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DOWNLOAD_DIR = config("DOWNLOAD_DIR", default="./downloads")
SOURCE = "ABS"


def extract_for_vessel(session, fleet, imo_number, vessel_name, force_resolve):
    assetnum, resolved_by = resolve_abs(imo_number, fleet, force=force_resolve)
    if not assetnum:
        logger.warning("IMO %s: could not resolve an ABS vessel — skipping extraction", imo_number)
        return
    logger.info("IMO %s -> ABS assetnum=%s (%s)", imo_number, assetnum, resolved_by)

    pdf_path = abs_login.download_vessel_status_report(session, assetnum, DOWNLOAD_DIR)
    result = parse_abs_pdf(pdf_path, vessel_name=vessel_name)

    now = datetime.now(timezone.utc)
    # vessel_id = our canonical IMO, not ABS's own assetnum (e.g. "V0206955", which isn't
    # even numeric and can't fit the INT column) — see dnv_extract.py for why this must be
    # IMO-keyed rather than source-native across the shared class_* tables.
    vessel_id = int(imo_number)

    for row in result["certificates"]:
        row.update(vessel_id=vessel_id, source=SOURCE, synced_at=now)
    for row in result["surveys"]:
        row.update(vessel_id=vessel_id, source=SOURCE, synced_at=now)
    for row in result["conditions"]:
        row.update(vessel_id=vessel_id, source=SOURCE, synced_at=now)

    n1 = replace_for_vessel_source(taskmgmt_engine, class_certificates, vessel_id, SOURCE, result["certificates"])
    n2 = replace_for_vessel_source(taskmgmt_engine, class_surveys, vessel_id, SOURCE, result["surveys"])
    n3 = replace_for_vessel_source(taskmgmt_engine, class_conditions, vessel_id, SOURCE, result["conditions"])
    logger.info("  certificates: %d, surveys: %d, conditions: %d", n1, n2, n3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vessel_imo")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--force-resolve", action="store_true")
    parser.add_argument("--headed", action="store_true", help="show the browser window (useful for debugging login selectors)")
    args = parser.parse_args()

    if not args.vessel_imo and not args.all:
        parser.error("pass --vessel_imo=<IMO> or --all")

    our_vessels = get_our_vessels()
    targets = our_vessels if args.all else [(imo, name) for imo, name in our_vessels if imo == args.vessel_imo]

    session = abs_login.login(headless=not args.headed)
    fleet = abs_login.get_fleet(session)
    logger.info("ABS fleet list: %d vessels", len(fleet))
    failures = []
    for imo, name in targets:
        try:
            extract_for_vessel(session, fleet, imo, name, args.force_resolve)
        except Exception:
            logger.exception("IMO %s: extraction failed, continuing with the rest of the fleet", imo)
            failures.append(imo)
    if failures:
        logger.warning("Completed with %d failed vessel(s): %s", len(failures), failures)

    report_unmapped_names(taskmgmt_engine, SOURCE, logger)


if __name__ == "__main__":
    sys.exit(main())
