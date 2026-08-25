# app/core/database_control.py — read access to the shared control DB (users, vessels)
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from decouple import config

CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

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
