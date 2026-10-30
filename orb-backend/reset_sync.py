"""Make the vessel pull everything again (or everything since a date). Run from the orb_backend folder:

    python reset_sync.py                 # full re-pull
    python reset_sync.py 2026-09-03      # re-pull what changed since that date

Applying a row twice is harmless, so this is always safe; it only costs bandwidth.
"""
import asyncio
import sys
from datetime import datetime, timezone

from sqlalchemy import update

from app.database import AsyncSessionLocal
from app.models.sync import SyncState


async def reset(since: datetime) -> None:
    async with AsyncSessionLocal() as session:
        res = await session.execute(update(SyncState).where(SyncState.sync_scope.like("pull:%")).values(last_pull_at=since))
        await session.commit()
        print(f"Reset {res.rowcount} pull cursor(s) to {since.isoformat()}")


if __name__ == "__main__":
    when = datetime.fromisoformat(sys.argv[1]).replace(tzinfo=timezone.utc) if len(sys.argv) > 1 else datetime(2000, 1, 1, tzinfo=timezone.utc)
    asyncio.run(reset(when))
