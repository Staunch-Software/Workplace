"""
One-off backfill: fill in report_date/report_date_source for Report rows
that already have attachments saved in blob storage but were scraped
BEFORE the report_date extraction feature existed (see
app/utils/report_date.py). extract_report_period only ever runs at
download-time inside the scraper's live scrape loop
(app/scraper/smartpal_scraper.py), so older rows never got it applied.

This does NOT touch SmartPAL or Playwright at all -- it just re-reads each
report's already-downloaded attachment(s) straight out of Azure Blob and
runs the same extract_report_period() over them.

Usage:
    python backfill_report_dates.py            # apply changes
    python backfill_report_dates.py --dry-run  # report what WOULD change, no writes
"""
import asyncio
import logging
import sys

from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import SessionLocal
from app.core.blob_storage import download_blob_bytes
from app.models.report import Report
from app.utils.report_date import extract_report_period

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logging.getLogger("azure").setLevel(logging.WARNING)
logger = logging.getLogger("backfill_report_dates")


async def _find_candidates():
    """Reports with report_date still NULL that have at least one real
    (non-MISSING) attachment to read a date out of."""
    async with SessionLocal() as db:
        stmt = (
            select(Report)
            .options(selectinload(Report.attachments))
            .where(Report.report_date.is_(None))
        )
        result = await db.execute(stmt)
        reports = result.scalars().all()

    candidates = []
    for r in reports:
        real_attachments = [a for a in r.attachments if not a.blob_path.startswith("MISSING:")]
        if real_attachments:
            candidates.append((r, real_attachments))
    return candidates


async def _extract_for_report(real_attachments):
    """First attachment to yield a date wins -- same priority as the live
    scraper (see smartpal_scraper.py's own comment on this)."""
    for att in real_attachments:
        try:
            pdf_bytes = await asyncio.to_thread(download_blob_bytes, att.blob_path)
        except Exception as e:
            logger.warning(f"  Could not download blob '{att.blob_path}': {e}")
            continue
        if not pdf_bytes:
            continue
        try:
            found = await asyncio.to_thread(extract_report_period, pdf_bytes, att.file_name)
        except Exception as e:
            logger.warning(f"  extract_report_period failed for '{att.file_name}': {e}")
            continue
        if found:
            return found
    return None


async def main():
    dry_run = "--dry-run" in sys.argv

    candidates = await _find_candidates()
    logger.info(f"Found {len(candidates)} report(s) with report_date=NULL and at least one real attachment.")
    if not candidates:
        return

    updated, unresolved, failed = 0, 0, 0

    for idx, (r, real_attachments) in enumerate(candidates):
        label = f"{r.vessel_name}/{r.report_code}/{r.job_order_no}"
        logger.info(f"[{idx+1}/{len(candidates)}] {label}: reading {len(real_attachments)} attachment(s)...")

        try:
            found = await _extract_for_report(real_attachments)
        except Exception as e:
            logger.error(f"  Error processing {label}: {e}")
            failed += 1
            continue

        if not found:
            logger.info(f"  No recoverable date in any attachment for {label} -- leaving as-is (falls back to due_date/job_date).")
            unresolved += 1
            continue

        report_date, report_date_source = found
        logger.info(f"  -> report_date={report_date.date()} (source: {report_date_source})")

        if dry_run:
            updated += 1
            continue

        async with SessionLocal() as db:
            db_report = await db.get(Report, r.id)
            if db_report is None:
                logger.warning(f"  Report {r.id} disappeared before write -- skipping.")
                continue
            db_report.report_date = report_date
            db_report.report_date_source = report_date_source
            await db.commit()
        updated += 1

    logger.info("=" * 70)
    logger.info(f"{'[DRY RUN] ' if dry_run else ''}Done. Updated: {updated}, unresolved: {unresolved}, failed: {failed}, total: {len(candidates)}")


if __name__ == "__main__":
    asyncio.run(main())
