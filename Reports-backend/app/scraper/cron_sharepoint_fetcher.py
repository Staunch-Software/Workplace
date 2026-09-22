import asyncio
import logging
import sys
import os

# Ensure the parent directory is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import SessionLocal
from app.scraper.sharepoint_graph_fetcher import run_sharepoint_fetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger(__name__)

# This script is meant to be invoked by an OS-level cron/Task Scheduler entry
LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cron_sharepoint_fetcher.lock")


def _acquire_lock() -> bool:
    try:
        fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return True
    except FileExistsError:
        return False


import argparse

def _release_lock():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


async def main(target_vessels=None, target_month=None, target_year=None, report_types=None):
    logger.info("Starting SharePoint Fetcher Cron Job...")
    async with SessionLocal() as db:
        await run_sharepoint_fetcher(
            db, 
            target_vessels=target_vessels, 
            target_month=target_month, 
            target_year=target_year, 
            target_report_types=report_types
        )
    logger.info("SharePoint Fetcher Cron Job COMPLETE.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="SharePoint Graph API Fetcher")
    parser.add_argument("--vessels", nargs="+", help="Specific vessels to fetch (e.g. tufmax fos)")
    parser.add_argument("--month", type=str, help="Specific month folder (e.g. '07. JUL 2026')")
    parser.add_argument("--year", type=str, help="Specific year folder (e.g. '2026')")
    parser.add_argument("--report-types", nargs="+", help="Specific report types (e.g. '01. Weekly Reports')")
    args = parser.parse_args()

    if not _acquire_lock():
        logger.warning("Another SharePoint fetch run is already in progress. Skipping this run.")
        sys.exit(0)
    try:
        asyncio.run(main(
            target_vessels=args.vessels,
            target_month=args.month,
            target_year=args.year,
            report_types=args.report_types
        ))
    finally:
        _release_lock()
