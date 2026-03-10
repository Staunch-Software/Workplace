import asyncio
from app.core.database_control import engine_control, ControlBase
import app.models.control

async def main():
    async with engine_control.begin() as conn:
        await conn.run_sync(ControlBase.metadata.create_all)
    print("Tables created.")

asyncio.run(main())