# trigger_tech48_tarang.py
#
# One-off: force a real scrape of TECH-48 ICCP LOG for AM TARANG right now,
# regardless of the smart-cron due-date filter. Useful for reproducing/
# confirming a specific report that's showing missing, without waiting for
# the next scheduled cron run or re-scraping every other config too.

import asyncio
import logging
import os
import sys

sys.path.append(os.path.abspath("."))
from app.core.database import SessionLocal
from app.scraper.smartpal_scraper import run_scraper

# Without this, every logger.info(...) call in the scraper (login status,
# search attempts, save results) is silently swallowed -- the script still
# runs, you just can't see what it's doing.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")


async def main():
    async with SessionLocal() as db:
        await run_scraper(
            db,
            smart_cron=False,          # force it to run, ignore due-date filtering
            target_vessel="AM TARANG",
            target_reports="TECH-48",  # matches report_code/report_name containing "tech-48"
        )


if __name__ == "__main__":
    asyncio.run(main())
