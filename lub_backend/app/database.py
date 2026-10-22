# app/database.py
import logging
from sqlalchemy import text
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

async def run_startup_migrations():
    """
    Lightweight, idempotent migrations executed at app startup.
    Ensures recent columns exist and defaults are initialized.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "ALTER TABLE luboil_sample ADD COLUMN IF NOT EXISTS is_action_required BOOLEAN DEFAULT FALSE"
            ))
            await conn.execute(text(
                "UPDATE luboil_sample SET is_action_required = FALSE WHERE is_action_required IS NULL"
            ))
            await conn.execute(text(
                "ALTER TABLE luboil_sample ADD COLUMN IF NOT EXISTS report_date DATE"
            ))
            await conn.execute(text(
                "ALTER TABLE luboil_report ADD COLUMN IF NOT EXISTS overdue_remarks TEXT"
            ))
            await conn.execute(text(
                "ALTER TABLE luboil_report ADD COLUMN IF NOT EXISTS is_overdue_accepted BOOLEAN"
            ))
        logger.info("✅ Startup schema migrations applied successfully.")
        return True
    except Exception as e:
        logger.error(f"❌ Startup schema migrations failed: {e}", exc_info=True)
        return False

def create_superuser_if_not_exists(db):
    logger.info("ℹ️ Superuser creation skipped")