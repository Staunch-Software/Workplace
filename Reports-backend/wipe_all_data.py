# wipe_all_data.py
#
# DESTRUCTIVE. Deletes every row from every Report Tracker table:
#   reports, report_attachments, report_threads, report_thread_attachments,
#   report_configs, report_events, report_notifications
#
# This does NOT touch Azure Blob Storage -- already-uploaded PDF/Excel files
# stay in the container even after their DB rows are gone.
#
# Requires typing the target database name to confirm, so it can't be run
# by accident (e.g. from a shell history re-run or a stray double-click).
#
# Usage:
#   python wipe_all_data.py

import asyncio
import sys

from sqlalchemy import text

from app.core.database import engine
from app.core.config import settings

TABLES = [
    "report_notifications",
    "report_events",
    "report_thread_attachments",
    "report_threads",
    "report_attachments",
    "reports",
    "report_configs",
]


async def wipe():
    print("=" * 60)
    print("  DESTRUCTIVE OPERATION")
    print(f"  Target database: {settings.DB_NAME} @ {settings.DB_HOST}:{settings.DB_PORT}")
    print(f"  Tables to be wiped: {', '.join(TABLES)}")
    print("  This cannot be undone. Blob storage files are NOT deleted.")
    print("=" * 60)

    typed = input(f"\nType the database name ('{settings.DB_NAME}') to confirm: ").strip()
    if typed != settings.DB_NAME:
        print("Confirmation did not match. Aborting -- nothing was deleted.")
        sys.exit(1)

    async with engine.begin() as conn:
        # TRUNCATE ... CASCADE handles FK dependency order automatically,
        # so the exact order of TABLES above doesn't matter.
        await conn.execute(text(f"TRUNCATE TABLE {', '.join(TABLES)} CASCADE"))

    await engine.dispose()
    print("\nAll Report Tracker tables have been wiped.")


if __name__ == "__main__":
    asyncio.run(wipe())
