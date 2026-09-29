import asyncio
import os
import sys

sys.path.append(os.path.abspath("."))
from sqlalchemy import text
from app.core.database import SessionLocal

async def migrate():
    print("Starting migration...")
    async with SessionLocal() as db:
        try:
            await db.execute(text("ALTER TABLE report_attachments ADD COLUMN email_status VARCHAR(20) DEFAULT 'NOT_REQUIRED';"))
            await db.commit()
            print("Successfully added email_status column.")
        except Exception as e:
            await db.rollback()
            print(f"Migration failed (maybe it already exists?): {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
