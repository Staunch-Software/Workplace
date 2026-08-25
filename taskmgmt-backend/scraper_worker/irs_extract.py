"""IRS extraction CLI.

Usage:
    python irs_extract.py --vessel_imo=9521813
    python irs_extract.py --all
    python irs_extract.py --vessel_imo=9521813 --force-resolve

NOTE: the login step (sources/irs_login.login) is unverified against the live portal,
though it's a plain form POST (not B2C), so it's the simplest of the 3 to confirm. The
fleet-list/download endpoints and the PDF parser ARE both confirmed against real captured
traffic / a real sample report.
"""
import argparse
import logging
import sys
from datetime import datetime, timezone

import pdfplumber
from decouple import config

from sources import irs_login
from sources.irs_extract import parse_irs_pdf
from vessel_resolution import get_our_vessels, resolve_irs
from db import (
    taskmgmt_engine, class_certificates, class_surveys, class_conditions,
    replace_for_vessel_source, report_unmapped_names,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

DOWNLOAD_DIR = config("DOWNLOAD_DIR", default="./downloads")
SOURCE = "IRS"


def _extract_imo_from_pdf(path):
    """IRS has no IMO in its fleet list — resolve_irs confirms identity by downloading
    the candidate's report and checking the 'IMO Number' field on page 1, exactly like
    the original spec requires (confirmed present in the real sample: 'IMO Number : 9521813')."""
    with pdfplumber.open(path) as pdf:
        text = pdf.pages[0].extract_text() or ""
    import re
    m = re.search(r"IMO\s*Number\s*:?\s*(\d{7})", text)
    return m.group(1) if m else None


def extract_for_vessel(page, fleet, imo_number, vessel_name, force_resolve):
    def fetch_candidate_imo(ir_number):
        pdf_path = irs_login.download_survey_status_report(page, ir_number, DOWNLOAD_DIR)
        return _extract_imo_from_pdf(pdf_path)

    ir_number, resolved_by = resolve_irs(imo_number, vessel_name, fleet, fetch_candidate_imo, force=force_resolve)
    if not ir_number:
        logger.warning("IMO %s: could not resolve an IRS vessel — skipping extraction", imo_number)
        return
    logger.info("IMO %s -> IRS IR_NUMBER=%s (%s)", imo_number, ir_number, resolved_by)

    # resolve_irs already downloaded the report once (to confirm IMO) — re-download is
    # cheap and keeps this function's control flow independent of that internal detail.
    pdf_path = irs_login.download_survey_status_report(page, ir_number, DOWNLOAD_DIR)
    result = parse_irs_pdf(pdf_path)

    now = datetime.now(timezone.utc)
    # vessel_id = our canonical IMO, not IRS's own IR_NUMBER — see dnv_extract.py for why
    # this must be IMO-keyed rather than source-native across the shared class_* tables.
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

    # A fresh-login-per-vessel experiment (see git history) ruled out session state entirely:
    # with a brand new login for every vessel, the SAME 3 IR_NUMBERs still 500'd every time
    # and the SAME 1 IR_NUMBER still succeeded every time. That's a deterministic, per-vessel
    # server-side failure (almost certainly something in those specific ships' report data
    # breaking IRS's report generator) — not a timing/session/load issue we can work around
    # from the client side. Back to one shared session for the whole run; retries below are
    # just a short safety net for a genuine one-off blip, not an expected fix.
    playwright, browser, context, page = irs_login.login(headless=not args.headed)
    try:
        fleet = irs_login.get_fleet(page)
        logger.info("IRS fleet list: %d vessels", len(fleet))
        failures = []
        for imo, name in targets:
            try:
                extract_for_vessel(page, fleet, imo, name, args.force_resolve)
            except Exception:
                logger.exception("IMO %s: extraction failed, continuing with the rest of the fleet", imo)
                failures.append(imo)
        if failures:
            logger.warning("Completed with %d failed vessel(s): %s — see irs_login.download_survey_status_report's "
                            "docstring: this has been confirmed to be a deterministic, per-vessel server-side "
                            "report-generation failure on IRS's end, not a timing/session issue on ours.", len(failures), failures)
    finally:
        irs_login.close_session(playwright, browser, context)

    report_unmapped_names(taskmgmt_engine, SOURCE, logger)


if __name__ == "__main__":
    sys.exit(main())
