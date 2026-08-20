import asyncio
from app.core.database import engine
from sqlalchemy import text

TABLES = [
    "report_threads",
    "report_thread_attachments",
    "report_attachments",
    "report_events",
    "report_notifications",
]

async def main():
    async with engine.begin() as conn:
        for table in TABLES:
            await conn.execute(text(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()"
            ))
            print(f"updated_at added to {table}.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
