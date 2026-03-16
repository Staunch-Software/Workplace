from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
import asyncio

scheduler = AsyncIOScheduler()

async def _run_full_sync():
    """Full sync: PUSH pending tickets, then PULL all updates."""
    from automation.push_service import push_pending_tickets
    from automation.pull_service import pull_jira_updates
    from routers.jira import sync_status
    from datetime import datetime

    if sync_status["running"]:
        print("[Scheduler] Sync already running, skipping")
        return

    sync_status["running"] = True
    print("[Scheduler] Auto-sync started...")
    try:
        push_result = await push_pending_tickets()
        pull_result = await pull_jira_updates()
        sync_status["lastResult"] = {
            "push": push_result,
            "pull": pull_result,
        }
        sync_status["lastSync"] = datetime.utcnow().isoformat()
        print(f"[Scheduler] Auto-sync done: pushed={push_result['pushed']}, updated={pull_result['updated']}, created={pull_result['created']}")
    except Exception as e:
        print(f"[Scheduler] Auto-sync error: {e}")
        sync_status["lastResult"] = {"error": str(e)}
    finally:
        sync_status["running"] = False

def start_scheduler(interval_minutes: int = 30):
    """Start the APScheduler cron — runs sync every N minutes."""
    scheduler.add_job(
        _run_full_sync,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id="jira_sync",
        replace_existing=True,
    )
    scheduler.start()
    print(f"[Scheduler] Started — Jira sync every {interval_minutes} minutes")

def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown()
        print("[Scheduler] Stopped")
