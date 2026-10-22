"""
One-off schema migration: adds LuboilSample.is_action_required.

Safe to run more than once — IF NOT EXISTS makes it a no-op after the first
successful run.
"""
import asyncio
from sqlalchemy import text
from app.database import engine


async def add_action_required_column():
    print("Adding luboil_sample.is_action_required column (if it doesn't already exist)...")
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE luboil_sample ADD COLUMN IF NOT EXISTS is_action_required BOOLEAN DEFAULT FALSE"
            ))
            await conn.execute(text(
                "UPDATE luboil_sample SET is_action_required = FALSE WHERE is_action_required IS NULL"
            ))
        print("Done. luboil_sample.is_action_required is ready.")
    except Exception as e:
        print(f"Failed: {e}")


if __name__ == "__main__":
    asyncio.run(add_action_required_column())
