"""
backend/sync_worker.py
----------------------
Background worker loop for VP offline sync on vessels.
Runs when STORAGE_MODE=offline.
Polls every SYNC_INTERVAL_SECONDS (default 6 hours).
"""
import os
import time
import logging
from backend.sync_processor import VPSyncProcessor

log = logging.getLogger("uvicorn")


def start_vp_sync_worker():
    """Background worker daemon thread."""
    interval_seconds = int(os.getenv("SYNC_INTERVAL_SECONDS", str(6 * 3600)))
    processor = VPSyncProcessor()

    log.info(f"🚢 [VP SYNC WORKER] Started (interval = {interval_seconds}s)")

    # Run initial sync immediately on startup
    try:
        processor.pull_and_sync()
    except Exception as e:
        log.error(f"[VP SYNC WORKER] Initial pull error: {e}")

    while True:
        try:
            time.sleep(interval_seconds)
            processor.pull_and_sync()
        except Exception as e:
            log.error(f"[VP SYNC WORKER] Loop error: {e}")
            time.sleep(60)
