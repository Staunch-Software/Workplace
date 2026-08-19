# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

engine = create_async_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=False,
    future=True,
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=1800,
)

SessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

Base = declarative_base()

async def get_db():
    async with SessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()

async def init_models():
    async with engine.begin() as conn:
        from app.models.report import Report, ReportThread, ReportThreadAttachment, ReportAttachment, ReportConfig
        from app.models.notification import Notification  # ensures table is created
        await conn.run_sync(Base.metadata.create_all)
        print("Report Tracker DB tables created.")

