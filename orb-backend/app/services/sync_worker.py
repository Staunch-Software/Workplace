"""Background loop of a vessel install: every SYNC_INTERVAL_SECONDS, if the VM is reachable, push then pull."""
import asyncio
import logging
import time

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services import clock
from app.services.network_service import network_service
from app.services.sync_processor import SyncProcessor

settings = get_settings()
logger = logging.getLogger("orb.sync")

HEARTBEAT_EVERY = 300
PURGE_EVERY = 3600


CLOCK_RESAVE = 3600      # seconds: re-save an unchanged offset about hourly
CLOCK_JITTER = 1.0       # seconds: smaller changes are measurement noise


async def run_cycle(state: dict) -> None:
    online, offset = await network_service.probe()
    if not online:
        return
    async with AsyncSessionLocal() as db:
        # This PC's clock (or time zone) may be wrong. Measure it against the VM and stamp everything with corrected
        # UTC from now on; times are never taken from the PC as they are.
        if offset is not None:
            now = time.monotonic()
            if abs(offset - clock.get_offset()) > CLOCK_JITTER or now - state["clock_saved"] >= CLOCK_RESAVE:
                await clock.save_offset(db, offset)
                state["clock_saved"] = now
                logger.info("Clock offset to the VM: %+.1f s", offset)
        proc = SyncProcessor(db)
        try:
            await proc.recover_stale()
            while await proc.push_pending():           # drain the whole outbox, one batch at a time
                pass
            await proc.pull_all()
            while await proc.push_pending():           # files queued by the pull
                pass
        except Exception as exc:
            logger.exception("Sync cycle failed")
            await db.rollback()
            await proc.heartbeat(extra_error=SyncProcessor.format_error(exc))
            return
        now = time.monotonic()
        if now - state["heartbeat"] >= HEARTBEAT_EVERY:
            await proc.heartbeat()
            state["heartbeat"] = now
        if now - state["purge"] >= PURGE_EVERY:
            await proc.purge_completed()
            state["purge"] = now


async def start_background_sync() -> None:
    if not settings.VESSEL_IMO:
        logger.error("STORAGE_MODE=offline but VESSEL_IMO is empty: sync is not started")
        return
    logger.info("ORB sync worker started for vessel %s -> %s", settings.VESSEL_IMO, settings.CLOUD_BASE_URL)
    async with AsyncSessionLocal() as db:
        await SyncProcessor(db).recover_stale(everything=True)       # whatever was in flight when the PC stopped
    state = {"heartbeat": 0.0, "purge": time.monotonic(), "clock_saved": 0.0}
    while True:
        try:
            await run_cycle(state)
        except Exception:
            logger.exception("Sync worker error")
        await asyncio.sleep(settings.SYNC_INTERVAL_SECONDS)
