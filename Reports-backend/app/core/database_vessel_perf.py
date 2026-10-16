# app/core/database_vessel_perf.py
# Read-only connection to the Vessel_Performance database (vessel_perf).
# Used only by the Overview "Events" tab. Inactive when
# VESSEL_PERF_DATABASE_URL is empty.
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

engine_vessel_perf = (
    create_async_engine(
        settings.VESSEL_PERF_DATABASE_URL,
        echo=False,
        future=True,
        pool_size=1,
        max_overflow=1,
        pool_timeout=10,
        pool_recycle=1800,
        pool_pre_ping=True,
    )
    if settings.VESSEL_PERF_DATABASE_URL
    else None
)

VesselPerfSession = (
    sessionmaker(
        bind=engine_vessel_perf,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )
    if engine_vessel_perf is not None
    else None
)


async def get_vessel_perf_db():
    if VesselPerfSession is None:
        yield None
        return
    async with VesselPerfSession() as session:
        try:
            yield session
        finally:
            await session.close()
