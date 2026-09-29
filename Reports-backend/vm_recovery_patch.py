import asyncio
import os
import sys

sys.path.append(os.path.abspath("."))
from sqlalchemy import text
from app.core.database import engine

async def patch():
    print("Patching ALL missing columns on VM...")
    async with engine.begin() as conn:
        tables_needing_updated_at = [
            "report_threads",
            "report_thread_attachments",
            "report_attachments",
            "report_events",
            "report_notifications",
            "report_configs"
        ]
        for table in tables_needing_updated_at:
            try:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();"))
                print(f"Added updated_at to {table}")
            except Exception as e:
                print(f"Failed on {table}: {e}")

        # Email Status
        try:
            await conn.execute(text("ALTER TABLE report_attachments ADD COLUMN IF NOT EXISTS email_status VARCHAR(20) DEFAULT 'NOT_REQUIRED';"))
            print("Added email_status to report_attachments")
        except Exception as e:
            print(f"Failed on email_status: {e}")
            
        # Report Dates
        try:
            await conn.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_date TIMESTAMP;"))
            await conn.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_date_source VARCHAR(255);"))
            print("Added report_date fields")
        except Exception as e:
            print(f"Failed on report_date: {e}")

        # Scrape error
        try:
            await conn.execute(text("ALTER TABLE reports ADD COLUMN IF NOT EXISTS scrape_error TEXT;"))
            print("Added scrape_error")
        except Exception as e:
            print(f"Failed on scrape_error: {e}")

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
