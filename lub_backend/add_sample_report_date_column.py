"""
One-off schema migration: adds LuboilSample.report_date.

This project has no Alembic migrations wired up for lub_backend (schema is
managed with plain create-if-missing scripts like create_table.py, which
uses Base.metadata.create_all — that only creates NEW tables, it does not
add columns to a table that already exists). So a new column on an existing
table needs an explicit ALTER TABLE, run once against the live database.

Run manually:
    python add_sample_report_date_column.py

Safe to run more than once — IF NOT EXISTS makes it a no-op after the first
successful run.
"""
import asyncio
from sqlalchemy import text
from app.database import engine


async def add_report_date_column():
    print("Adding luboil_sample.report_date column (if it doesn't already exist)...")
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE luboil_sample ADD COLUMN IF NOT EXISTS report_date DATE"
            ))
        print("Done. luboil_sample.report_date is ready.")
    except Exception as e:
        print(f"Failed: {e}")


if __name__ == "__main__":
    asyncio.run(add_report_date_column())
