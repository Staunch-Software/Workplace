# =============================================================================
# app/scraper/pr_scheduler.py
#
# Schedules the Mariapps PR scrape + sync job every 6 hours.
#
# HOW IT WORKS:
#   - Playwright is sync → runs in a ThreadPoolExecutor (won't block event loop)
#   - DB sync is async   → runs directly in the FastAPI event loop
#   - APScheduler AsyncIOScheduler ties both together
#
# USAGE (in main.py lifespan):
#   from app.scraper.pr_scheduler import start_pr_scheduler, stop_pr_scheduler
#
#   @asynccontextmanager
#   async def lifespan(app: FastAPI):
#       start_pr_scheduler()
#       yield
#       stop_pr_scheduler()
# =============================================================================

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.scraper.pr_scraper import run_pr_scraper
from app.scraper.pr_sync_service import upsert_to_cache, sync_to_pr_entries

log = logging.getLogger(__name__)

# Single thread is enough — one browser at a time
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="pr_scraper")
_scheduler = AsyncIOScheduler()


# ---------------------------------------------------------------------------
# COMBINED JOB
# ---------------------------------------------------------------------------

async def run_pr_pipeline():
    """
    Full pipeline:
      1. Run Playwright scraper in thread (sync)
      2. Upsert results into cache (async)
      3. Sync cache → pr_entries (async)
    """
    log.info("[PR PIPELINE] Starting scheduled PR scrape + sync...")

    try:
        # Step 1: Scrape in background thread (Playwright is sync)
        loop = asyncio.get_event_loop()
        scraped_rows = await loop.run_in_executor(_executor, run_pr_scraper)

        if not scraped_rows:
            log.warning("[PR PIPELINE] No rows scraped — skipping sync.")
            return

        log.info(f"[PR PIPELINE] Scraped {len(scraped_rows)} PR rows.")

        # Step 2: Upsert into cache
        cache_summary = await upsert_to_cache(scraped_rows)
        log.info(f"[PR PIPELINE] Cache upsert: {cache_summary}")

        # Step 3: Sync to pr_entries
        sync_summary = await sync_to_pr_entries()
        log.info(f"[PR PIPELINE] Sync result: {sync_summary}")

        log.info("[PR PIPELINE] Pipeline complete.")

    except Exception as e:
        log.error(f"[PR PIPELINE] Pipeline failed: {e}")


# ---------------------------------------------------------------------------
# SCHEDULER LIFECYCLE
# ---------------------------------------------------------------------------

def start_pr_scheduler():
    """
    Starts the APScheduler with a 6-hour interval.
    Also triggers an immediate first run on startup.
    """
    _scheduler.add_job(
        run_pr_pipeline,
        trigger=IntervalTrigger(hours=6),
        id="mariapps_pr_sync",
        name="Mariapps PR Scrape + Sync",
        replace_existing=True,
        max_instances=1,          # prevent overlap if a run takes too long
        misfire_grace_time=300,   # 5 min grace if job misfires
    )
    _scheduler.start()
    log.info("[PR SCHEDULER] Started — interval: every 6 hours.")

    # Fire immediately on startup so we don't wait 6 hours for first data
    # asyncio.get_event_loop().create_task(run_pr_pipeline())
    log.info("[PR SCHEDULER] Initial run triggered.")


def stop_pr_scheduler():
    """Graceful shutdown — called in lifespan cleanup."""
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        log.info("[PR SCHEDULER] Stopped.")
    _executor.shutdown(wait=False)