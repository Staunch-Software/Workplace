import asyncio
import os
import sys

sys.path.append(os.path.abspath("."))
from sqlalchemy import text
from app.core.database import engine

async def patch():
    print("Patching missing columns on VM...")
    async with engine.begin() as conn:
        tables_needing_updated_at = [
            "report_threads",
            "report_thread_attachments",
            "report_attachments",
            "report_events",
            "report_notifications"
        ]
        for table in tables_needing_updated_at:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();"))
                print(f"Added updated_at to {table}")
            except Exception as e:
                print(f"Failed on {table}: {e}")

        # AEPMS fields
        try:
            await conn.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS aepms_push_status VARCHAR(30);"))
            await conn.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS aepms_pushed_at TIMESTAMP;"))
            print("Added AEPMS fields to reports")
        except Exception as e:
            print(f"Failed on AEPMS fields: {e}")

    await engine.dispose()
    print("Patch completed successfully!")

if __name__ == "__main__":
    asyncio.run(patch())
