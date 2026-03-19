from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy import create_engine
from decouple import config

CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

# ── Async engine (used by FastAPI route Depends) ──
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

async def get_control_db():
    async with AsyncSessionControl() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

# ── Sync engine (used by api.py inline SessionControl() calls) ──
_sync_url = CONTROL_DATABASE_URL.replace("postgresql+asyncpg", "postgresql+psycopg2")
_sync_engine = create_engine(_sync_url, pool_pre_ping=True)
SessionControl = sessionmaker(bind=_sync_engine, autocommit=False, autoflush=False)