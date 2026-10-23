import asyncio
import logging
import sys
import os

# Ensure the parent directory is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import SessionLocal
from app.scraper.smartpal_scraper import run_halfyearly_scraper
from app.services.mail_service import process_and_email_pending_attachments

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger(__name__)

# Cron entry for the half-yearly Cargo Hold (301.01-09) / Water Ballast Tank
# (305.03.03-20) reports -- separate from cron_smart_scrape so the existing job
# is untouched. smart_cron=True: a config with no report yet gets ALL its
# completed jobs scraped (first run); after that it only runs on the next due
# date taken from the pending row.
#
# SHARES cron_smart_scrape's lock file on purpose: two Playwright sessions
# logged into SmartPAL at once invalidate each other, so if the standard
# smart-scrape is still running this run is a clean no-op (the half-yearly
# reports are rarely due, and a skipped run is simply retried next time).
LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cron_smart_scrape.lock")


def _acquire_lock() -> bool:
    try:
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False


def _release_lock():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


async def main():
    logger.info("Starting Half-Yearly Smart Scrape...")
    async with SessionLocal() as db:
        await run_halfyearly_scraper(db, smart_cron=True)
    logger.info("Half-Yearly Smart Scrape COMPLETE.")

    # Same follow-up the standard cron does, so new attachments get emailed
    # like every other report. Isolated: a mail failure must not fail the run.
    logger.info("Starting batch email processing for new attachments...")
    try:
        async with SessionLocal() as db:
            await process_and_email_pending_attachments(db)
    except Exception as e:
        logger.error(f"Batch email processing failed: {e}")
    logger.info("Batch email processing COMPLETE.")


if __name__ == "__main__":
    # NOTE: Do NOT use WindowsSelectorEventLoopPolicy here --
    # it breaks Playwright subprocess launch on Windows.
    if not _acquire_lock():
        logger.warning("Another SmartPAL scrape run is in progress (lock file present). Skipping this run.")
        sys.exit(0)
    try:
        asyncio.run(main())
    finally:
        _release_lock()
