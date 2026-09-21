import asyncio
from sqlalchemy import text
from app.core.database import engine

async def main():
    async with engine.begin() as conn:
        await conn.execute(text("""
            ALTER TABLE defects 
            ADD COLUMN IF NOT EXISTS thread_read_state JSONB NOT NULL DEFAULT '{}';
        """))
        print("Done: thread_read_state column added successfully.")

if __name__ == '__main__':
    asyncio.run(main())
