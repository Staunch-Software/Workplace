# app/database.py
import logging
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.config import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(
    settings.LUBOIL_DATABASE_URL,
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=False
)

AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise

def create_all_tables():
    logger.info("ℹ️ create_all_tables() called — skipped in async mode")

def run_startup_migrations():
    logger.info("ℹ️ run_startup_migrations() skipped")
    return True

def create_superuser_if_not_exists(db):
    logger.info("ℹ️ Superuser creation skipped")