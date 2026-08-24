import asyncio
from app.core.database import engine
from sqlalchemy import text


async def main():
    async with engine.begin() as conn:
        await conn.execute(text(
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS aepms_push_status VARCHAR(30)"
        ))
        await conn.execute(text(
            "ALTER TABLE reports ADD COLUMN IF NOT EXISTS aepms_pushed_at TIMESTAMP"
        ))
        print("aepms_push_status and aepms_pushed_at added to reports.")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
