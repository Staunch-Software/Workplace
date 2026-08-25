"""DNV extraction CLI.

Usage:
    python dnv_extract.py --vessel_imo=9832925
    python dnv_extract.py --all
    python dnv_extract.py --vessel_imo=9832925 --force-resolve

Login + fleet-list/download are all confirmed against real captured traffic and a working
reference implementation — see sources/dnv_login.py's docstring for details.
"""
import argparse
import logging
import sys
from datetime import datetime, timezone

from decouple import config

from sources import dnv_login
from sources.dnv_extract import parse_dnv_pdf
from vessel_resolution import get_our_vessels, resolve_dnv
from db import (
    taskmgmt_engine, class_certificates, class_surveys, class_conditions,
    replace_for_vessel_source, report_unmapped_names,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DOWNLOAD_DIR = config("DOWNLOAD_DIR", default="./downloads")
SOURCE = "DNV"


def extract_for_vessel(session, fleet, imo_number, force_resolve):
    dnv_vessel_id, resolved_by = resolve_dnv(imo_number, fleet, force=force_resolve)
    if not dnv_vessel_id:
        logger.warning("IMO %s: could not resolve a DNV vessel — skipping extraction", imo_number)
        return
    logger.info("IMO %s -> DNV vessel_id=%s (%s)", imo_number, dnv_vessel_id, resolved_by)

    pdf_path = dnv_login.download_class_status_report(session, dnv_vessel_id, DOWNLOAD_DIR)
    result = parse_dnv_pdf(pdf_path)

    now = datetime.now(timezone.utc)
    # vessel_id here is OUR canonical identifier (the IMO, which is always numeric),
    # not DNV's own native id — class_certificates/surveys/conditions are shared across
    # all 3 sources via `source`, so the same real ship must use the same vessel_id
    # regardless of which source the row came from. This also sidesteps ABS's own
    # native id (assetnum, e.g. "V0206955") not fitting the INT column at all.
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

    our_vessels = get_our_vessels()  # [(imo, name), ...]
    imos = [imo for imo, _ in our_vessels] if args.all else [args.vessel_imo]

    session = dnv_login.login(headless=not args.headed)
    fleet = dnv_login.get_fleet(session)
    logger.info("DNV fleet list: %d vessels", len(fleet))
    failures = []
    for imo in imos:
        try:
            extract_for_vessel(session, fleet, imo, args.force_resolve)
        except Exception:
            logger.exception("IMO %s: extraction failed, continuing with the rest of the fleet", imo)
            failures.append(imo)
    if failures:
        logger.warning("Completed with %d failed vessel(s): %s", len(failures), failures)

    report_unmapped_names(taskmgmt_engine, SOURCE, logger)


if __name__ == "__main__":
    sys.exit(main())
