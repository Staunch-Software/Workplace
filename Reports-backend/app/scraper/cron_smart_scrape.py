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

async def main():
    logger.info("Starting Daily Smart Scrape Cron Job...")
    async with SessionLocal() as db:
        # run_scraper with smart_cron=True handles querying latest rows and filtering them.
        await run_scraper(db, smart_cron=True)
    logger.info("Daily Smart Scrape Cron Job COMPLETE.")

if __name__ == "__main__":
    # NOTE: Do NOT use WindowsSelectorEventLoopPolicy here --
    # it breaks Playwright subprocess launch on Windows.
    asyncio.run(main())
