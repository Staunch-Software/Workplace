"""SmartPAL extraction CLI.

Usage:
    python smartpal_extract.py --vessel_imo=9832925
    python smartpal_extract.py --all
    python smartpal_extract.py --vessel_imo=9832925 --force-resolve

Pulls certificates, surveys, and DAE/COC/Memoranda items for the given vessel(s) and
writes them to smartpal_certificates / smartpal_surveys / smartpal_items (upsert by the
source's own row id — see db.upsert_by_pk).
"""
import argparse
import logging
import sys
import zlib
from datetime import datetime, timezone

from sources import smartpal_auth, smartpal_client
from vessel_resolution import get_our_vessels, resolve_smartpal
from db import (
    taskmgmt_engine, smartpal_certificates, smartpal_surveys, smartpal_items,
    upsert_by_pk, report_unmapped_names,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SOURCE = "SMARTPAL"


def _parse_date(s):
    if not s:
        return None
    return s.split("T")[0]  # SmartPAL dates are ISO datetimes; we only need the date part


def _stable_id_for_placeholder(vessel_id, secondary_key):
    """SmartPAL uses id=-1 (or a falsy id) as a shared "never recorded" sentinel across many
    distinct certificates/surveys/items for the same vessel (confirmed live: 3+ distinct
    surveys for one vessel all came back with id=-1) — upserting them as-is collides multiple
    rows onto the same PK within a single INSERT, which Postgres rejects outright ("ON
    CONFLICT DO UPDATE command cannot affect row a second time"). Fabricate a stable
    per-(vessel, secondary_key) negative id instead of the literal -1, so a re-run
    consistently updates the same fabricated row rather than colliding — real SmartPAL ids
    are always positive, so negative is a safe, unambiguous placeholder range."""
    composite = f"{vessel_id}:{secondary_key}".encode()
    return -(zlib.crc32(composite) & 0x7FFFFFFF)


def _dedupe_by_id(rows):
    """Safety net beyond _stable_id_for_placeholder — belt-and-suspenders against any other
    source of duplicate ids within one batch, which would otherwise blow up the same way."""
    by_id = {}
    for row in rows:
        by_id[row["id"]] = row
    return list(by_id.values())


def _map_certificate(row):
    raw_id = row.get("id")
    return {
        "id": raw_id if raw_id not in (None, -1) else _stable_id_for_placeholder(
            row["vesseld"], row.get("certificateId") or row.get("certificateName")),
        "vessel_id": row["vesseld"],
        "certificate_id": row.get("certificateId"),
        "certificate_name": row.get("certificateName"),
        "type": row.get("type"),
        "sub_type": row.get("subType"),
        "term_type": row.get("termType"),
        "issued_date": _parse_date(row.get("issuedDate")),
        "due_date": _parse_date(row.get("dueDate")),
        "validity_months": int(row["validity"]) if row.get("validity") and row["validity"].isdigit() else None,
        "attachment_files": row.get("attachmentFiles"),
        "synced_at": datetime.now(timezone.utc),
    }


def _map_survey(row):
    raw_id = row.get("id")
    return {
        "id": raw_id if raw_id not in (None, -1) else _stable_id_for_placeholder(
            row["vesseld"], row.get("surveyId") or row.get("surveyName")),
        "vessel_id": row["vesseld"],
        "survey_id": row.get("surveyId"),
        "survey_name": row.get("surveyName"),
        "type": row.get("type"),
        "date_last_done": _parse_date(row.get("dateLastDone")),
        "date_due": _parse_date(row.get("dateDue")),
        "due_range_from": _parse_date(row.get("dueRangeFrom")),
        "due_range_to": _parse_date(row.get("dueRangeTo")),
        "validity_months": int(row["validity"]) if row.get("validity") and row["validity"].isdigit() else None,
        "synced_at": datetime.now(timezone.utc),
    }


def _map_item(row, doc_type):
    raw_id = row.get("id")
    return {
        "id": raw_id if raw_id not in (None, -1) else _stable_id_for_placeholder(
            row["vesselId"], row.get("parentId") or row.get("narrative") or doc_type),
        "vessel_id": row["vesselId"],
        "doc_type": doc_type,
        "item_status": row.get("itemStatus"),
        "item_classification": str(row["itemClassificationId"]) if row.get("itemClassificationId") is not None else None,
        "narrative": row.get("narrative"),
        "remarks": row.get("remarks"),
        "date_issued": _parse_date(row.get("dateIssued")),
        "date_due": _parse_date(row.get("dateDue")),
        "extension_date": _parse_date(row.get("extensionDate")),
        "rectification_date": _parse_date(row.get("rectificationDate")),
        "deletion_date": _parse_date(row.get("deletionDate")),
        "risk_assessment": row.get("riskAssessment"),
        "parent_type": row.get("parentType"),
        "parent_id": row.get("parentId"),
        "synced_at": datetime.now(timezone.utc),
    }


def extract_for_vessel(session, all_vessels_payload, imo_number, force_resolve):
    source_vessel_id, resolved_by = resolve_smartpal(imo_number, all_vessels_payload, force=force_resolve)
    if not source_vessel_id:
        logger.warning("IMO %s: could not resolve a SmartPAL vessel — skipping extraction", imo_number)
        return
    logger.info("IMO %s -> SmartPAL vessel_id=%s (%s)", imo_number, source_vessel_id, resolved_by)

    vessel = next(v for v in all_vessels_payload if str(v["id"]) == source_vessel_id)

    cer_headers = session.enter_app("CER")

    certs = smartpal_client.get_certificates(session, cer_headers, vessel)
    n = upsert_by_pk(taskmgmt_engine, smartpal_certificates, _dedupe_by_id([_map_certificate(r) for r in certs]))
    logger.info("  certificates: %d rows", n)

    surveys = smartpal_client.get_surveys(session, cer_headers, vessel)
    n = upsert_by_pk(taskmgmt_engine, smartpal_surveys, _dedupe_by_id([_map_survey(r) for r in surveys]))
    logger.info("  surveys: %d rows", n)

    for doc_type in ("DAE", "COC", "MEMORANDA"):
        items = smartpal_client.get_items(session, cer_headers, vessel, doc_type)
        n = upsert_by_pk(taskmgmt_engine, smartpal_items, _dedupe_by_id([_map_item(r, doc_type) for r in items]))
        logger.info("  %s items: %d rows", doc_type, n)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--vessel_imo", help="IMO number of a single vessel to extract")
    parser.add_argument("--all", action="store_true", help="extract every active vessel in the control DB")
    parser.add_argument("--force-resolve", action="store_true", help="ignore any cached vessel_source_ids row")
    parser.add_argument("--headed", action="store_true", help="show the browser window (useful for debugging login selectors)")
    args = parser.parse_args()

    if not args.vessel_imo and not args.all:
        parser.error("pass --vessel_imo=<IMO> or --all")

    imos = [imo for imo, _name in get_our_vessels()] if args.all else [args.vessel_imo]

    session = smartpal_auth.login(headless=not args.headed)
    mdm_headers = session.enter_app("MDM")
    all_vessels_payload = smartpal_client.get_all_vessels(session, mdm_headers)

    failures = []
    for imo in imos:
        try:
            extract_for_vessel(session, all_vessels_payload, imo, args.force_resolve)
        except Exception:
            logger.exception("IMO %s: extraction failed, continuing with the rest of the fleet", imo)
            failures.append(imo)
    if failures:
        logger.warning("Completed with %d failed vessel(s): %s", len(failures), failures)

    report_unmapped_names(taskmgmt_engine, SOURCE, logger)


if __name__ == "__main__":
    sys.exit(main())
