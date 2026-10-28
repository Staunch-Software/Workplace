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
from app.scraper.mail_graph_fetcher import run_mail_fetcher

logger = logging.getLogger("scheduler")

scheduler = AsyncIOScheduler()


async def _scraper_job():
    """
    Wrapper called by APScheduler.
    Opens a DB session, runs the scraper, then closes the session.
    """
    logger.info("[CRON] SmartPAL + Mail scraper job triggered.")
    async with SessionLocal() as db:
        try:
            await run_mail_fetcher(db, days_back=7, create_events=True)
        except Exception as e:
            logger.error(f"[CRON] Mail fetcher job failed: {e}")
        try:
            # smart_cron=True: only scrapes configs that are actually due
            # (new / pending / next_due_date reached) instead of all configs
            # every night, and is required for ReportEvent rows to be created
            # -- the Activity/Live Feed reads only events written this way.
            await run_scraper(db, smart_cron=True)
            logger.info("[CRON] Scraper job completed successfully.")
        except Exception as e:
            logger.error(f"[CRON] Scraper job failed: {e}")


async def _events_mail_job():
    """Daily mail: each owner's vessels, last N logbook events (see events_mail_service)."""
    from app.services.events_mail_service import send_daily_events_mail
    try:
        res = await send_daily_events_mail()
        logger.info(f"[CRON] Events mail done: {res.get('sent')} sent.")
    except Exception as e:
        logger.error(f"[CRON] Events mail job failed: {e}")


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
    if settings.EVENTS_MAIL_ENABLED:
        scheduler.add_job(
            _events_mail_job,
            trigger=CronTrigger(hour=settings.EVENTS_MAIL_HOUR, minute=settings.EVENTS_MAIL_MINUTE, timezone="UTC"),
            id="events_mail",
            name="Daily vessel events mail",
            replace_existing=True,
        )
        logger.info(
            f"[SCHEDULER] Events mail scheduled daily at "
            f"{settings.EVENTS_MAIL_HOUR:02d}:{settings.EVENTS_MAIL_MINUTE:02d} UTC."
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
