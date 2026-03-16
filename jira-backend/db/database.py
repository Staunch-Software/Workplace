from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from core.config import settings

# ── JIRA DB ────────────────────────────────────────────────
engine = create_async_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=False,
    future=True,
    pool_size=10,
    max_overflow=20,
)

SessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


# ── CONTROL PLANE DB ───────────────────────────────────────
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


async def get_control_db() -> AsyncSession:
    async with AsyncSessionControl() as session:
        yield session


async def init_models():
    from models.schema import Ticket, Comment  # noqa
    from models.sync import SyncQueue, SyncState, SyncConflict  # noqa — register sync tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Database tables ready.")