import argparse
import asyncio
import logging
import os
import sys

# Ensure the parent directory is in the path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import SessionLocal
from app.scraper.mail_graph_fetcher import run_mail_fetcher

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-8s %(message)s")
logger = logging.getLogger("cron_mail_fetcher")

LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "cron_mail_fetcher.lock")


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def _acquire_lock() -> bool:
    for _ in range(2):
        try:
            fd = os.open(LOCK_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            # A crashed/killed run leaves its lock behind and blocks every later
            # cycle; only honour the lock while the owning process is alive.
            try:
                with open(LOCK_PATH) as f:
                    owner = int(f.read().strip() or 0)
            except (OSError, ValueError):
                owner = 0
            if owner and owner != os.getpid() and _pid_alive(owner):
                return False
            logger.warning(f"[MAIL-CRON] Removing stale lock left by pid {owner}.")
            _release_lock()
    return False


def _release_lock():
    try:
        os.remove(LOCK_PATH)
    except OSError:
        pass


async def run_once(days_back: int = 7, target_vessel: str | None = None):
    """Run a single iteration of the Mail Graph fetcher."""
    if not _acquire_lock():
        logger.info("[MAIL-CRON] Another Mail fetch run is already active. Skipping this cycle.")
        return
    try:
        logger.info(f"[MAIL-CRON] Starting Mail Graph API Fetcher cycle (lookback={days_back}d)...")
        async with SessionLocal() as db:
            await run_mail_fetcher(db, days_back=days_back, target_vessel=target_vessel, create_events=True)
        logger.info("[MAIL-CRON] Mail Graph API Fetcher cycle COMPLETE.")
    except Exception as e:
        logger.error(f"[MAIL-CRON] Unexpected error during mail fetch: {e}", exc_info=True)
    finally:
        _release_lock()


async def start_background_mail_fetcher(interval_minutes: int = 30, days_back: int = 7):
    """
    Continuous background worker meant to run all day inside FastAPI or as a daemon task.
    Sleeps for interval_minutes between runs, checking for new emails periodically.
    """
    logger.info(f"[MAIL-CRON] Background Mail Fetcher worker started. Running every {interval_minutes} minutes.")
    # Wait 30 seconds after startup before first check so app can initialize
    await asyncio.sleep(30)
    while True:
        try:
            await run_once(days_back=days_back)
        except Exception as e:
            logger.error(f"[MAIL-CRON] Error in background worker loop: {e}", exc_info=True)
        logger.info(f"[MAIL-CRON] Sleeping for {interval_minutes} minutes until next cycle...")
        await asyncio.sleep(interval_minutes * 60)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mail Graph API Fetcher for Daily Work Done Reports")
    parser.add_argument("--days", type=int, default=7, help="Lookback window in days (default: 7)")
    parser.add_argument("--vessel", type=str, default=None, help="Filter by vessel name or IMO")
    parser.add_argument("--interval", type=int, default=0, help="Run continuously every N minutes (0 = run once and exit)")
    args = parser.parse_args()

    if args.interval > 0:
        logger.info(f"Starting Mail Graph API Fetcher DAEMON (running all day, every {args.interval}m)...")
        try:
            asyncio.run(start_background_mail_fetcher(interval_minutes=args.interval, days_back=args.days))
        except (KeyboardInterrupt, SystemExit):
            logger.info("Daemon stopped by user.")
    else:
        asyncio.run(run_once(days_back=args.days, target_vessel=args.vessel))
