# app/scraper/scheduler.py
#
# APScheduler cronjob that runs the SmartPAL scraper automatically.
# No UI trigger is needed - this runs on a schedule configured in .env.
#
# Default: every day at 2:00 AM UTC.
# Adjust SCRAPER_CRON_HOUR and SCRAPER_CRON_MINUTE in .env to change.

import logging
import asyncio
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from app.core.config import settings
from app.core.database import SessionLocal
from app.scraper.smartpal_scraper import run_scraper

logger = logging.getLogger("scheduler")

scheduler = AsyncIOScheduler()


async def _scraper_job():
    """
    Wrapper called by APScheduler.
    Opens a DB session, runs the scraper, then closes the session.
    """
    logger.info("[CRON] SmartPAL scraper job triggered.")
    async with SessionLocal() as db:
        try:
            # smart_cron=True: only scrapes configs that are actually due
            # (new / pending / next_due_date reached) instead of all configs
            # every night, and is required for ReportEvent rows to be created
            # -- the Activity/Live Feed reads only events written this way.
            await run_scraper(db, smart_cron=True)
            logger.info("[CRON] Scraper job completed successfully.")
        except Exception as e:
            logger.error(f"[CRON] Scraper job failed: {e}")


def start_scheduler():
    """
    Registers the scraper job with APScheduler and starts the scheduler.
    Called once from main.py lifespan.
    """
    trigger = CronTrigger(
        hour=settings.SCRAPER_CRON_HOUR,
        minute=settings.SCRAPER_CRON_MINUTE,
        timezone="UTC",
    )
    scheduler.add_job(
        _scraper_job,
        trigger=trigger,
        id="smartpal_scraper",
        name="SmartPAL PDF Scraper",
        replace_existing=True,
    )
    scheduler.start()
    logger.info(
        f"[SCHEDULER] SmartPAL scraper scheduled daily at "
        f"{settings.SCRAPER_CRON_HOUR:02d}:{settings.SCRAPER_CRON_MINUTE:02d} UTC."
    )


def stop_scheduler():
    """Gracefully shuts down the scheduler on app shutdown."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[SCHEDULER] Scheduler stopped.")
