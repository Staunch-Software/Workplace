# test_aepms_push.py
#
# Manual local test runner for the AEPMS auto-push step, without running
# the full SmartPAL scraper. Reset one already-scraped ME/AE report's
# aepms_push_status to NULL (see the SQL in the setup notes), then run:
#
#   python test_aepms_push.py
#
# Watch the console output for PUSHED / PUSHED_UNVERIFIED / MISMATCH /
# FAILED, then check the `reports` table's aepms_push_status column and
# confirm the report shows up under the right vessel in AEPMS.

import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")

from app.core.database import SessionLocal
from app.services.aepms_push import push_pending_reports


async def main():
    async with SessionLocal() as db:
        await push_pending_reports(db)


if __name__ == "__main__":
    asyncio.run(main())
