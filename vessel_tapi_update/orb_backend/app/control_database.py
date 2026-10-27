from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base

from app.config import get_settings

settings = get_settings()

if not settings.CONTROL_DATABASE_URL or not settings.SECRET_KEY:
    raise RuntimeError(
        "CONTROL_DATABASE_URL and SECRET_KEY must be set in .env (same values as workplace-backend)."
    )

# Separate declarative base: the control tables belong to workplace-backend and
# must never be picked up by this service's Alembic metadata.
ControlBase = declarative_base()

engine_control = create_async_engine(
    settings.CONTROL_DATABASE_URL,
    echo=False,
    pool_size=2,
    max_overflow=2,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
)

ControlSessionLocal = async_sessionmaker(engine_control, class_=AsyncSession, expire_on_commit=False)


async def get_control_db():
    async with ControlSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()
