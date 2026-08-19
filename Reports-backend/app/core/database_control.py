# app/core/database_control.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

engine_control = create_async_engine(
    settings.CONTROL_DATABASE_URL,
    echo=False,
    future=True,
    pool_size=3,
    max_overflow=3,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
)

ControlSession = sessionmaker(
    bind=engine_control,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

async def get_control_db():
    async with ControlSession() as session:
        try:
            yield session
        finally:
            await session.close()
