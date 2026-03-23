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


async def start_background_sync():
    logger.info("Jira Sync Worker started. Handling TICKET scope only.")

    while True:
        try:
            await run_ticket_sync_cycle()
        except Exception as e:
            logger.error(f"Sync Worker loop error prevented crash: {e}")

        await asyncio.sleep(60)