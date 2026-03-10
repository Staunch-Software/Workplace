# app/core/database.py
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

# 1. Create the Async Engine
engine = create_async_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=True, 
    future=True
)

# 2. Create the Session Factory
SessionLocal = sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)

# 3. Base Class for Models
Base = declarative_base()

# 4. Dependency for API Routes
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

# 5. Table Initialization
async def init_models():
    """
    Creates tables in the database if they don't exist.
    """
    async with engine.begin() as conn:
        # Import ONLY the models you want
        from app.models.vessel import Vessel
        from app.models.user import User
        from app.models.defect import Defect
        
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
        print("✅ DRS Database Tables Created Successfully (No Comments Table)!")