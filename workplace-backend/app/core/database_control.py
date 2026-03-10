from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine_control = create_async_engine(
    settings.CONTROL_DATABASE_URL,
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


# ✅ ADD THIS FUNCTION
async def init_control_db():
    async with engine_control.begin() as conn:
        await conn.run_sync(ControlBase.metadata.create_all)