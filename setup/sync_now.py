import asyncio
import sys
import os
from datetime import datetime, timezone

sys.path.insert(0, r"C:\WORKPLACE\orb_backend")
os.chdir(r"C:\WORKPLACE\orb_backend")

from sqlalchemy import select, update, func
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.sync_processor import SyncProcessor
from app.models.sync import SyncState
from app.models.orb_entry import OrbEntry
from app.models.orb_alert import OrbAlert
from app.models.orb_notification import OrbFeedEvent

async def main():
    settings = get_settings()
    print(f"\n=== Running ORB Sync for Vessel IMO: {settings.VESSEL_IMO} ===")
    print(f"Cloud URL: {settings.CLOUD_BASE_URL}\n")
    
    async with AsyncSessionLocal() as db:
        # 1. Reset cursors so missing rows are pulled
        print("[1/3] Resetting pull cursors in database...")
        res = await db.execute(
            update(SyncState)
            .where(
                SyncState.vessel_imo == settings.VESSEL_IMO,
                SyncState.sync_scope.in_(["pull:entry", "pull:entry_quantity", "pull:alert", "pull:feed_event", "pull:notification"])
            )
            .values(last_pull_at=datetime(2000, 1, 1, tzinfo=timezone.utc))
        )
        await db.commit()
        print("      Pull cursors reset to 2000-01-01.")
        
        # 2. Run sync pull
        print("[2/3] Pulling latest data from Cloud...")
        proc = SyncProcessor(db)
        try:
            total = await proc.pull_all()
            print(f"      Sync pull finished! Rows processed: {total}")
        except Exception as e:
            print(f"      Sync pull error: {e}")
            import traceback
            traceback.print_exc()
        
        # 3. Verify counts
        print("[3/3] Checking local database totals...")
        entry_cnt = await db.scalar(select(func.count(OrbEntry.id)))
        alert_cnt = await db.scalar(select(func.count(OrbAlert.id)))
        feed_cnt = await db.scalar(select(func.count(OrbFeedEvent.id)))
        print(f"      -> Total Entries in local database: {entry_cnt}")
        print(f"      -> Total Alerts in local database: {alert_cnt}")
        print(f"      -> Total Feed Events in local database: {feed_cnt}")
        print("\n========================================================")
        print("  Sync completed! Refresh your browser (Ctrl + F5).")
        print("========================================================\n")

if __name__ == "__main__":
    asyncio.run(main())
