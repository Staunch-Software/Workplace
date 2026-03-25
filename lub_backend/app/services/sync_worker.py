import asyncio
import logging
from app.services.network_service import network_service
from app.services.sync_processor import SyncProcessor
from app.database import AsyncSessionLocal
from app.config import settings

logger = logging.getLogger("lub.sync")


async def run_luboil_sync_cycle():
    """PUSH vessel records + PULL cloud changes. Runs every 60s."""
    status = await network_service.get_network_status()
    if status == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Luboil sync deferred.")
        return

    logger.info("Starting LUBOIL sync cycle...")
    async with AsyncSessionLocal() as db:
        try:
            processor = SyncProcessor(db)
            await processor.process_pending_queue()
            await processor.pull_luboil_from_cloud()
            logger.info("Luboil sync cycle complete.")
        except Exception as e:
            logger.error(f"Luboil sync cycle error: {e}")


# async def run_config_sync_cycle():
#     """PULL users + vessels from workplace-backend. Runs every 24h + startup."""
#     status = await network_service.get_network_status()
#     if status == "OFFLINE":
#         logger.debug("Vessel is OFFLINE. Config sync deferred.")
#         return

#     logger.info("Starting CONFIG sync cycle...")
#     async with AsyncSessionLocal() as db, AsyncSessionControl() as control_db:
#         try:
#             processor = SyncProcessor(db, control_db=control_db)
#             await processor.pull_config_from_cloud()
#             logger.info("Config sync cycle complete.")
#         except Exception as e:
#             logger.error(f"Config sync cycle error: {e}")


async def start_background_sync():
    logger.info("Lub Sync Worker Started. Handling LUBOIL scope only.")

    while True:
        try:
            await run_luboil_sync_cycle()
        except Exception as e:
            logger.error(f"Sync Worker loop crash prevented: {e}")

        await asyncio.sleep(60)