# app/services/sync_worker.py
# Background loop that pushes queued vessel changes to shore and pulls shore
# changes down, every 60s. Only started when STORAGE_MODE=offline (see
# app/main.py) -- has zero effect on the shore deployment.
import asyncio
import logging
from datetime import datetime

from app.services.network_service import network_service
from app.services.sync_processor import SyncProcessor
from app.core.database import SessionLocal

logger = logging.getLogger("reports.sync")


async def run_reports_sync_cycle():
    """PUSH vessel report/thread/attachment changes + PULL shore changes."""
    status = await network_service.get_network_status()
    if status == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Reports sync deferred.")
        return

    logger.info("Starting REPORTS sync cycle...")
    async with SessionLocal() as db:
        try:
            processor = SyncProcessor(db)
            await processor.process_pending_queue()
            await processor.pull_changes_from_cloud()
            logger.info("Reports sync cycle complete.")
        except Exception as e:
            logger.error(f"Reports sync cycle error: {e}")
        finally:
            await db.close()


async def start_background_sync():
    logger.info("Report Tracker Sync Worker started.")
    while True:
        print(f"Reports sync loop tick: {datetime.utcnow().isoformat()}")
        try:
            await run_reports_sync_cycle()
        except Exception as e:
            logger.error(f"Reports Sync Worker loop crash prevented: {e}")
        await asyncio.sleep(60)
