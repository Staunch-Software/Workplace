# app/services/aepms_push.py
#
# Pushes scraped ME/AE monthly performance report PDFs into AEPMS (the
# Engine Performance module) automatically, replacing the manual
# download-from-Report-Tracker / re-upload-to-AEPMS step.
#
# AEPMS's /upload-monthly-report/ and /aux/upload-auxiliary-report/
# endpoints take only a file -- they derive the vessel entirely from the
# PDF's own IMO/vessel-name fields (see Aepms-backend/app/report_processor.py),
# so there is no vessel_id to select or get wrong here. What CAN go wrong is
# a mismatch between the vessel this Report row says it belongs to and the
# vessel AEPMS actually parsed out of the PDF (e.g. a misfiled SmartPAL
# attachment) -- that's the integrity check below, replacing what the
# AEPMS frontend's manual "wrong vessel" alert does for human uploads.

import logging
from datetime import datetime
from time import time

import httpx
from sqlalchemy import select, and_

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.blob_storage import download_blob_bytes
from app.models.report import Report

logger = logging.getLogger("aepms_push")

# report_code values from data/default_reports_config.json for the ME/AE
# monthly performance reports that feed AEPMS.
ME_REPORT_CODES = {
    "MO-02-TECH-07_ME_PERFORMANCE_SHEET",
    "MO-03-TECH-06_ENGINE_PERFORMANCE_TRE",
}
AE_REPORT_CODES = {
    "MO-06-TECH-12_AE-1_PERFORMANCE_SHEET",
    "MO-07-TECH-12_AE-2_PERFORMANCE_SHEET",
    "MO-08-TECH-12_AE-3_PERFORMANCE_SHEET",
}
# TECH-13 (Auxiliary Engine Performance TREND) is deliberately excluded --
# it's a summary across all AE generators, not a per-generator data sheet.
# AEPMS's AE upload endpoint identifies which generator (AE-1/2/3) a report
# belongs to by reading an "engineselection" field that only exists on the
# per-generator TECH-12 sheet (see ae_report_processor.py). A TECH-13 file
# doesn't have that field, so AEPMS can't identify the generator and
# rejects it with 400 "could not identify Generator or IMO from PDF" --
# confirmed against real upload failures on 2026-08-24. TECH-13 was never
# a valid AEPMS input; don't re-add it without a corresponding TECH-13
# ingestion path actually existing on the AEPMS side.

_UPLOAD_PATH = {
    "ME": "/upload-monthly-report/",
    "AE": "/aux/upload-auxiliary-report/",
}

# Cached service-account JWT so we don't log in to AEPMS once per report.
_token_cache = {"token": None, "expires_at": 0.0}


async def _get_service_token(client: httpx.AsyncClient) -> str:
    now = time()
    if _token_cache["token"] and now < _token_cache["expires_at"] - 60:
        return _token_cache["token"]

    resp = await client.post(
        f"{settings.AEPMS_BASE_URL}/auth/local/login",
        json={
            "email": settings.AEPMS_SERVICE_EMAIL,
            "password": settings.AEPMS_SERVICE_PASSWORD,
        },
        timeout=15.0,
    )
    resp.raise_for_status()
    data = resp.json()
    _token_cache["token"] = data["access_token"]
    _token_cache["expires_at"] = now + data.get("expires_in", 3600)
    return _token_cache["token"]


def _report_kind(report_code: str) -> str | None:
    if report_code in ME_REPORT_CODES:
        return "ME"
    if report_code in AE_REPORT_CODES:
        return "AE"
    return None


async def push_pending_reports(db) -> None:
    """
    Finds scraped ME/AE reports that haven't been pushed to AEPMS yet and
    uploads each one. Called from the scrape cron job right after
    run_scraper() completes. Never raises -- a single bad report must not
    take down the rest of the cron run.
    """
    if not settings.AEPMS_BASE_URL:
        logger.info("[AEPMS PUSH] AEPMS_BASE_URL not configured, skipping.")
        return

    codes = ME_REPORT_CODES | AE_REPORT_CODES
    stmt = select(Report).where(
        and_(
            Report.report_code.in_(codes),
            Report.scrape_status == "SCRAPED",
            # Retry FAILED (e.g. transient network errors) on the next cron
            # run, but never re-push PUSHED / PUSHED_UNVERIFIED (duplicate
            # upload) or MISMATCH (a genuine wrong-vessel PDF -- retrying
            # daily would just re-upload the same wrong file every night;
            # that needs a human to fix in SmartPAL, not an auto-retry).
            Report.aepms_push_status.is_distinct_from("PUSHED"),
            Report.aepms_push_status.is_distinct_from("PUSHED_UNVERIFIED"),
            Report.aepms_push_status.is_distinct_from("MISMATCH"),
            Report.aepms_push_status.is_distinct_from("UNSUPPORTED_FORMAT"),
        )
    )
    reports = (await db.execute(stmt)).scalars().all()
    if not reports:
        logger.info("[AEPMS PUSH] No pending reports to push.")
        return

    logger.info(f"[AEPMS PUSH] {len(reports)} report(s) pending push to AEPMS.")

    async with httpx.AsyncClient(verify=settings.AEPMS_VERIFY_SSL) as client:
        for report in reports:
            await _push_one(db, client, report)


async def _push_one(db, client: httpx.AsyncClient, report: Report) -> None:
    kind = _report_kind(report.report_code)
    if kind is None:
        return

    # Attachments are lazy-loaded; report came from a plain select() so
    # touch them via a fresh query with eager loading instead of relying
    # on the relationship being populated.
    from sqlalchemy.orm import selectinload

    stmt = (
        select(Report)
        .where(Report.id == report.id)
        .options(selectinload(Report.attachments))
    )
    result = await db.execute(stmt)
    report = result.scalars().first()

    if not report.attachments:
        logger.warning(f"[AEPMS PUSH] {report.id} has no attachment, skipping.")
        return

    blob_path = report.attachments[0].blob_path
    file_name = report.attachments[0].file_name or "report.pdf"

    # AEPMS's upload endpoints hard-reject anything not named *.pdf.
    # SmartPAL occasionally serves this report type as .xlsx instead of
    # .pdf for some vessels -- that's a permanent mismatch, not a
    # transient error, so don't let it retry forever every cron run.
    if not file_name.lower().endswith(".pdf"):
        logger.warning(
            f"[AEPMS PUSH] Report {report.id} ({report.vessel_name}/{report.report_code}) "
            f"attachment '{file_name}' is not a PDF -- AEPMS only accepts PDFs. Skipping, "
            f"needs the correct PDF re-uploaded/re-scraped from SmartPAL."
        )
        report.aepms_push_status = "UNSUPPORTED_FORMAT"
        report.aepms_pushed_at = datetime.utcnow()
        await db.commit()
        return

    try:
        pdf_bytes = download_blob_bytes(blob_path)
    except Exception as e:
        logger.error(f"[AEPMS PUSH] Failed to download '{blob_path}': {e}")
        report.aepms_push_status = "FAILED"
        report.aepms_pushed_at = datetime.utcnow()
        await db.commit()
        return

    try:
        token = await _get_service_token(client)
        resp = await client.post(
            f"{settings.AEPMS_BASE_URL}{_UPLOAD_PATH[kind]}",
            headers={"Authorization": f"Bearer {token}"},
            files={"file": (file_name, pdf_bytes, "application/pdf")},
            timeout=60.0,
        )
        resp.raise_for_status()
        payload = resp.json()
    except httpx.HTTPStatusError as e:
        # AEPMS's error responses carry the real reason in a "detail" field
        # (FastAPI's HTTPException body) -- surface that instead of just
        # the generic status code, or every failure looks identical.
        try:
            body = e.response.json()
        except Exception:
            body = e.response.text
        logger.error(
            f"[AEPMS PUSH] Upload failed for report {report.id} "
            f"({report.vessel_name}/{report.report_code}): {e.response.status_code} -- {body}"
        )
        report.aepms_push_status = "FAILED"
        report.aepms_pushed_at = datetime.utcnow()
        await db.commit()
        return
    except Exception as e:
        logger.error(f"[AEPMS PUSH] Upload failed for report {report.id}: {e}")
        report.aepms_push_status = "FAILED"
        report.aepms_pushed_at = datetime.utcnow()
        await db.commit()
        return

    # Integrity check: does the vessel AEPMS parsed out of the PDF match
    # the vessel this Report row is filed under? Mirrors the manual
    # "wrong vessel" check AEPMS's frontend does for human uploads.
    graph_data = payload.get("graph_data")
    aepms_imo = None
    if graph_data:
        aepms_imo = str(graph_data.get("vessel_info", {}).get("imo_number") or "")

    our_imo = str(report.vessel_imo or "").lstrip("0")
    aepms_imo_normalized = aepms_imo.lstrip("0") if aepms_imo else ""

    if not aepms_imo:
        logger.warning(
            f"[AEPMS PUSH] Report {report.id} uploaded (id={payload.get('report_id')}) "
            f"but AEPMS returned no graph_data to verify vessel match against."
        )
        report.aepms_push_status = "PUSHED_UNVERIFIED"
    elif aepms_imo_normalized != our_imo:
        logger.error(
            f"[AEPMS PUSH] VESSEL MISMATCH on report {report.id}: "
            f"Report Tracker says IMO {report.vessel_imo}, AEPMS parsed IMO {aepms_imo} "
            f"from the PDF at '{blob_path}'. Not marking as pushed -- needs investigation."
        )
        report.aepms_push_status = "MISMATCH"
    else:
        logger.info(
            f"[AEPMS PUSH] Report {report.id} pushed to AEPMS as report_id={payload.get('report_id')} "
            f"(IMO {aepms_imo} confirmed)."
        )
        report.aepms_push_status = "PUSHED"

    report.aepms_pushed_at = datetime.utcnow()
    await db.commit()
