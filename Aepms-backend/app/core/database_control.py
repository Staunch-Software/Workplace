from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from decouple import config

CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

# Note: CONTROL_DATABASE_URL in .env must use asyncpg driver
# Example: postgresql+asyncpg://user:pass@host:port/dbname

engine_control = create_async_engine(
    CONTROL_DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
)

AsyncSessionControl = async_sessionmaker(
    engine_control,
    class_=AsyncSession,
    expire_on_commit=False,
)

class ControlBase(DeclarativeBase):
    pass

async def get_control_db() -> AsyncSession:
    async with AsyncSessionControl() as session:
        yield session

async def init_control_db():
    async with engine_control.begin() as conn:
        await conn.run_sync(ControlBase.metadata.create_all)