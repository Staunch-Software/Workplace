import asyncio
import logging
from app.services.network_service import network_service
from app.services.sync_processor import SyncProcessor
from app.core.database import SessionLocal # Import your session factory
from app.core.config import settings 
from app.core.database_control import AsyncSessionControl  

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


async def run_config_sync_cycle():
    """PULL users + vessels from workplace_backend. Runs every 24h + startup."""
    status = await network_service.get_network_status()
    if status == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Config sync deferred.")
        return

    logger.info("Starting CONFIG sync cycle...")
    async with SessionLocal() as db, AsyncSessionControl() as control_db:
        try:
            processor = SyncProcessor(db, control_db=control_db)  # ← pass control_db
            await processor.pull_config_from_cloud()
            logger.info("Config sync cycle complete.")
        except Exception as e:
            logger.error(f"Config sync cycle error: {e}")
        finally:
            await db.close()
            await control_db.close()


async def start_background_sync():
    logger.info("Sync Worker Started.")

    # Run config sync once on startup
    try:
        await run_config_sync_cycle()
    except Exception as e:
        logger.error(f"Startup config sync failed: {e}")

    last_config_sync = asyncio.get_event_loop().time()

    while True:
        try:
            await run_defect_sync_cycle()

            now = asyncio.get_event_loop().time()
            if now - last_config_sync >= settings.CONFIG_SYNC_INTERVAL:
                await run_config_sync_cycle()
                last_config_sync = now

        except Exception as e:
            logger.error(f"Sync Worker Loop crash prevented: {e}")

        await asyncio.sleep(60)