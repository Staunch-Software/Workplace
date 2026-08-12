from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from decouple import config

CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

# Note: CONTROL_DATABASE_URL in .env must use asyncpg driver
# Example: postgresql+asyncpg://user:pass@host:port/dbname

engine_control = create_async_engine(
    CONTROL_DATABASE_URL,
    echo=False,
    pool_size=3,        # ← ADD: max 3 permanent connections in the pool
    max_overflow=2,     # ← ADD: allow 2 extra temporary connections under burst load (total max = 5)
    pool_timeout=10,    # ← ADD: if all 5 slots are busy, wait max 10s then raise error (not hang forever)
    pool_recycle=1800,  # ← ADD: replace connections older than 30 min to avoid stale/dead connections
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