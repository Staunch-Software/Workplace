import asyncio
import logging
from app.services.network_service import network_service
from app.services.sync_processor import SyncProcessor
from app.core.database import SessionLocal # Import your session factory
from app.core.config import settings 
from app.core.database_control import AsyncSessionControl  
from datetime import datetime

logger = logging.getLogger("drs.sync")

async def run_defect_sync_cycle():
    """PUSH vessel defects + PULL shore defects. Runs every 60s."""
    status = await network_service.get_network_status()
    if status == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Defect sync deferred.")
        return

    logger.info("Starting DEFECT sync cycle...")
    async with SessionLocal() as db:
        try:
            processor = SyncProcessor(db)
            await processor.process_pending_queue()
            await processor.pull_defects_from_cloud()
            logger.info("Defect sync cycle complete.")
        except Exception as e:
            logger.error(f"Defect sync cycle error: {e}")
        finally:
            await db.close()


async def start_background_sync():
    logger.info("DRS Sync Worker Started. Handling DEFECT scope only.")

    while True:
        print(f"Sync loop tick: {datetime.utcnow().isoformat()}")
        try:
            await run_defect_sync_cycle()
        except Exception as e:
            logger.error(f"Sync Worker Loop crash prevented: {e}")

        await asyncio.sleep(60)