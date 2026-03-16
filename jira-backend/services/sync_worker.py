import asyncio
import logging
from services.network_service import network_service
from services.sync_processor import SyncProcessor
from db.database import SessionLocal
from core.config import settings

logger = logging.getLogger("jira.sync")


async def run_ticket_sync_cycle():
    """PUSH vessel tickets + PULL shore tickets. Runs every 60s."""
    if await network_service.get_network_status() == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Ticket sync deferred.")
        return

    logger.info("Starting TICKET sync cycle...")
    async with SessionLocal() as db:
        try:
            processor = SyncProcessor(db)
            await processor.process_pending_queue()
            await processor.pull_tickets_from_cloud()
            logger.info("Ticket sync cycle complete.")
        except Exception as e:
            logger.error(f"Ticket sync cycle error: {e}")
        finally:
            await db.close()


async def run_config_sync_cycle():
    """PULL users + vessels from workplace-backend. Runs every 24h + startup."""
    if await network_service.get_network_status() == "OFFLINE":
        logger.debug("Vessel is OFFLINE. Config sync deferred.")
        return

    logger.info("Starting CONFIG sync cycle...")
    async with SessionLocal() as db:
        try:
            processor = SyncProcessor(db)
            await processor.pull_config_from_cloud()
            logger.info("Config sync cycle complete.")
        except Exception as e:
            logger.error(f"Config sync cycle error: {e}")
        finally:
            await db.close()


async def start_background_sync():
    logger.info("Jira Sync Worker started.")

    # Config sync on startup
    try:
        await run_config_sync_cycle()
    except Exception as e:
        logger.error(f"Startup config sync failed: {e}")

    last_config_sync = asyncio.get_event_loop().time()

    while True:
        try:
            await run_ticket_sync_cycle()

            now = asyncio.get_event_loop().time()
            if now - last_config_sync >= settings.CONFIG_SYNC_INTERVAL:
                await run_config_sync_cycle()
                last_config_sync = now

        except Exception as e:
            logger.error(f"Sync Worker loop error prevented crash: {e}")

        await asyncio.sleep(60)