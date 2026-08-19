import asyncio
import logging
import sys
import os

# Ensure the parent directory is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import SessionLocal           # FIX: was AsyncSessionLocal (does not exist)
from app.scraper.smartpal_scraper import run_scraper

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger(__name__)

# This script is meant to be invoked by an OS-level cron/Task Scheduler
# entry, e.g. twice a day. If a previous run is still in progress when the
# next one is due to fire (scraping many vessels/reports can take a while),
# a second run must NOT start -- two Playwright sessions logging into
# SmartPAL at the same time will invalidate each other's session and both
# runs will fail partway through. This lock file makes overlapping
# invocations a clean no-op instead.
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
    logger.info("Starting Smart Scrape Cron Job...")
    async with SessionLocal() as db:
        # run_scraper with smart_cron=True handles querying latest rows and filtering them.
        await run_scraper(db, smart_cron=True)
    logger.info("Smart Scrape Cron Job COMPLETE.")

if __name__ == "__main__":
    # NOTE: Do NOT use WindowsSelectorEventLoopPolicy here --
    # it breaks Playwright subprocess launch on Windows.
    if not _acquire_lock():
        logger.warning("Another smart scrape run is already in progress (lock file present). Skipping this run.")
        sys.exit(0)
    try:
        asyncio.run(main())
    finally:
        _release_lock()
