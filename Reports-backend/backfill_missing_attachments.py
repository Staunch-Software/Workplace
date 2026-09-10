"""
One-off backfill: re-scrape every COMPLETED job order currently sitting in
the DB with 0 attachments (the symptom of the Attachments-tab timing race
fixed in app/scraper/smartpal_scraper.py -- see _click_attachments_tab_and_wait).

This does NOT touch the normal smart-cron flow (run_scraper/_scrape_report
in smartpal_scraper.py stay exactly as-is). It reuses their login/navigation
helpers directly and drives its own loop here, because run_scraper only ever
targets the *latest* COMPLETED job per (vessel, report_code) -- if a single
report has TWO separate completed job orders (two different due-date
cycles) both missing attachments, run_scraper would only ever re-visit one
of them. Here each missing Report row is targeted individually by its own
(job_order_no, due_date), so every affected job gets re-scraped, not just
the newest one per report.

One SmartPAL login per vessel (not per job) to keep this reasonably fast.
"""
import asyncio
import logging
import sys
from collections import defaultdict

from playwright.async_api import async_playwright
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.database import SessionLocal
from app.models.report import Report
from app.scraper.smartpal_scraper import _login, _open_job_overview, _scrape_report, _save_report

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("backfill_missing_attachments")


async def _find_missing():
    """Every individual COMPLETED job order (not deduped by report_code) that
    currently has zero attachments in the DB."""
    async with SessionLocal() as db:
        stmt = (
            select(Report)
            .options(selectinload(Report.attachments))
            .where(Report.job_status == "COMPLETED")
        )
        result = await db.execute(stmt)
        reports = result.scalars().all()
    return [r for r in reports if len(r.attachments) == 0]


async def _backfill_vessel(context, overview_page, vessel_imo, vessel_name, jobs):
    """Re-scrape a list of specific job orders for one vessel, one at a
    time, using the SAME logged-in browser session (already positioned on
    Job Overview)."""
    recovered, still_missing = [], []

    for idx, r in enumerate(jobs):
        report_code = r.report_code.strip()
        report_name = (r.report_name or report_code).strip()
        department  = (r.department or "").strip()
        frequency   = r.frequency
        label = f"{vessel_name}/{report_code}/{r.job_order_no}"

        logger.info(f"[{idx+1}/{len(jobs)}] {vessel_name}: re-scraping {report_code} -> job {r.job_order_no} (due {r.due_date})")

        try:
            # target_job_order_no + target_due_date together make
            # _scrape_report's strict cycle-matching lock onto THIS exact
            # completed job, instead of just grabbing whichever completed
            # row happens to be listed first in Job History.
            result = await _scrape_report(
                context, overview_page,
                vessel_imo, vessel_name,
                report_code, report_name, department, frequency,
                target_job_order_no=r.job_order_no,
                target_due_date=r.due_date,
            )

            if result is None:
                logger.warning(f"Could not re-locate {label} on SmartPAL (job order may have moved) -- skipped.")
                still_missing.append(label)
                continue

            attachments = result.get("attachments") or []
            result["is_smart_scrape"] = False

            async with SessionLocal() as db:
                await _save_report(db, result)

            if attachments:
                logger.info(f"Recovered {len(attachments)} attachment(s) for {label}")
                recovered.append(label)
            else:
                logger.warning(f"Re-scraped {label} but SmartPAL still shows 0 attachments for this exact job.")
                still_missing.append(label)

        except Exception as e:
            logger.error(f"Error backfilling {label}: {e}")
            still_missing.append(label)

    return recovered, still_missing


async def main():
    missing = await _find_missing()
    if not missing:
        logger.info("No COMPLETED job orders with 0 attachments found. Nothing to do.")
        return

    by_vessel = defaultdict(list)
    for r in missing:
        by_vessel[(r.vessel_imo, r.vessel_name)].append(r)

    logger.info(f"Found {len(missing)} COMPLETED job order(s) missing attachments across {len(by_vessel)} vessel(s):")
    for (imo, name), jobs in by_vessel.items():
        for r in jobs:
            logger.info(f"  {name} [{imo}]: {r.report_code} -> {r.job_order_no} (due {r.due_date})")

    all_recovered, all_still_missing = [], []

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(accept_downloads=True, ignore_https_errors=True)
        context.set_default_timeout(60000)
        page = await context.new_page()

        logged_in = await _login(page)
        if not logged_in:
            logger.error("Login failed. Aborting attachment backfill.")
            await browser.close()
            return

        # Job Overview is opened ONCE and reused for every vessel/job below --
        # _scrape_report re-selects the vessel from the dropdown on this same
        # page for each call, same as run_scraper's own loop does.
        overview_page = await _open_job_overview(context, page)
        if not overview_page:
            logger.error("Could not open Job Overview. Aborting attachment backfill.")
            await browser.close()
            return

        for (imo, name), jobs in by_vessel.items():
            logger.info(f"--- {name} [{imo}]: {len(jobs)} job(s) to backfill ---")
            recovered, still_missing = await _backfill_vessel(context, overview_page, imo, name, jobs)
            all_recovered.extend(recovered)
            all_still_missing.extend(still_missing)

        await browser.close()

    logger.info("=" * 70)
    logger.info(f"Backfill complete. Recovered: {len(all_recovered)} / {len(missing)}")
    for label in all_recovered:
        logger.info(f"  RECOVERED: {label}")
    if all_still_missing:
        logger.warning(f"Still missing after backfill: {len(all_still_missing)}")
        for label in all_still_missing:
            logger.warning(f"  STILL MISSING: {label}")


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    asyncio.run(main())
