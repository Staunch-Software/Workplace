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
    python backfill_report_dates.py            # re-evaluate ALL reports (recommended)
    python backfill_report_dates.py --dry-run  # report what WOULD change, no writes
    python backfill_report_dates.py --null-only  # only process reports with no date yet
    python backfill_report_dates.py --report=BUNKER      # only reports whose report_code
                                                           # or report_name contains this
                                                           # (case-insensitive) -- e.g. to
                                                           # re-run just one report type
                                                           # after a targeted extraction fix
    python backfill_report_dates.py --vessel="GCL SARASWATI"  # only this vessel
    # Filters combine: --report and --vessel can both be given at once, and
    # either combines with --dry-run/--null-only too.
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


def _arg_value(flag: str):
    """Pull '--flag=value' out of sys.argv, or None if not given."""
    prefix = f"{flag}="
    for a in sys.argv[1:]:
        if a.startswith(prefix):
            return a[len(prefix):]
    return None


async def _find_candidates(null_only: bool = False, report_filter: str = None, vessel_filter: str = None):
    """Reports that have at least one real (non-MISSING) attachment.

    By default returns ALL such reports so that reports which previously
    received a wrong date (e.g. a template stamp like '2025-05-15') also
    get corrected. Pass null_only=True to only process rows where
    report_date IS NULL (the old behaviour).

    report_filter/vessel_filter narrow this down to a specific report type
    or vessel -- e.g. to re-run just the Weekly Bunker Report after a fix
    scoped to that report's extraction logic, without touching every other
    report's already-correct dates.
    """
    async with SessionLocal() as db:
        stmt = select(Report).options(selectinload(Report.attachments))
        if null_only:
            stmt = stmt.where(Report.report_date.is_(None))
        if report_filter:
            # Normalize: 'TECH-57' must also match 'TECH_-_57_-_ONBOARD...' in the DB.
            # The DB stores codes with underscores where the user types hyphens.
            # Replace any run of hyphens/underscores/spaces in the search term with a
            # SQL wildcard '%' so the match is flexible.
            import re as _re
            needle_flexible = "%" + _re.sub(r"[-_\s]+", "%", report_filter) + "%"
            needle_original = f"%{report_filter}%"
            stmt = stmt.where(
                Report.report_code.ilike(needle_flexible)
                | Report.report_code.ilike(needle_original)
                | Report.report_name.ilike(needle_flexible)
                | Report.report_name.ilike(needle_original)
            )
        if vessel_filter:
            stmt = stmt.where(Report.vessel_name.ilike(f"%{vessel_filter}%"))
        result = await db.execute(stmt)
        reports = result.scalars().all()

    candidates = []
    for r in reports:
        real_attachments = [a for a in r.attachments if not a.blob_path.startswith("MISSING:")]
        if real_attachments:
            candidates.append((r, real_attachments))
    return candidates


async def _extract_for_report(real_attachments, report_code=""):
    """Evaluate ALL attachments and pick the LATEST date found ONLY for
    accumulating logs (TECH-57, TECH-06). This ensures that if an un-updated
    PDF form is attached alongside an accumulating Excel log that was genuinely
    updated, the newer actual date wins over the stale PDF field.
    For all other reports, the first attachment to yield a date wins."""
    best_date = None
    best_source = None
    is_accumulating_log = any(code in report_code for code in ["TECH-57", "TECH_-_57", "TECH-06", "TECH_-_06", "TECH-48", "TECH_-_48", "TECH-49", "TECH_-_49", "TECH-04", "TECH_-_04"])
    
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
            f_date, f_src = found
            if not is_accumulating_log:
                return found
            if best_date is None or f_date > best_date:
                best_date = f_date
                best_source = f_src
                
    if best_date:
        return (best_date, best_source)
    return None


async def main():
    dry_run = "--dry-run" in sys.argv
    null_only = "--null-only" in sys.argv
    report_filter = _arg_value("--report")
    vessel_filter = _arg_value("--vessel")

    if null_only:
        logger.info("Mode: NULL-ONLY -- only processing reports with no date yet.")
    else:
        logger.info("Mode: ALL -- re-evaluating every report (including those with existing dates).")
    if report_filter:
        logger.info(f"Filter: report_code/report_name contains {report_filter!r}")
    if vessel_filter:
        logger.info(f"Filter: vessel_name contains {vessel_filter!r}")

    candidates = await _find_candidates(null_only=null_only, report_filter=report_filter, vessel_filter=vessel_filter)
    logger.info(f"Found {len(candidates)} report(s) with at least one real attachment.")
    if not candidates:
        return

    updated, skipped_same, unresolved, failed = 0, 0, 0, 0

    for idx, (r, real_attachments) in enumerate(candidates):
        label = f"{r.vessel_name}/{r.report_code}/{r.job_order_no}"
        logger.info(f"[{idx+1}/{len(candidates)}] {label}: reading {len(real_attachments)} attachment(s)...")

        try:
            found = await _extract_for_report(real_attachments, str(r.report_code))
        except Exception as e:
            logger.error(f"  Error processing {label}: {e}")
            failed += 1
            continue

        if not found:
            from app.utils.report_date import uses_job_end_date_fallback
            if uses_job_end_date_fallback(r.report_code, r.report_name) and r.job_end_date:
                found = (r.job_end_date, "job_end_date:fallback")
                logger.info(f"  No date in attachment -- falling back to job_end_date={r.job_end_date.date()} for {r.report_code}")
            elif r.due_date:
                found = (r.due_date, "due_date:fallback")
                logger.info(f"  No date in attachment -- falling back to due_date={r.due_date.date()} as general fallback")
            else:
                logger.info(f"  No recoverable date and no fallback date for {label} -- leaving as-is.")
                unresolved += 1
                continue

        report_date, report_date_source = found

        # Skip write if date is already correct
        if r.report_date == report_date:
            logger.info(f"  -> Already correct: {report_date.date()} -- skipping.")
            skipped_same += 1
            continue

        logger.info(f"  -> report_date: {r.report_date} => {report_date.date()} (source: {report_date_source})")

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
    logger.info(
        f"{'[DRY RUN] ' if dry_run else ''}Done. "
        f"Updated: {updated}, already-correct: {skipped_same}, "
        f"unresolved: {unresolved}, failed: {failed}, total: {len(candidates)}"
    )


if __name__ == "__main__":
    asyncio.run(main())
