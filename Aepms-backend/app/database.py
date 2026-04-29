# app/database.py

import re
from datetime import datetime, date, time
from typing import Any, Dict, Optional, List, BinaryIO
from decimal import Decimal, InvalidOperation
import logging
import json
import os
from pathlib import Path
from sqlalchemy.orm import Session # Keep this import, or remove if only SessionLocal is used
from typing import Any
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession, AsyncConnection
from sqlalchemy import text, MetaData
from sqlalchemy.orm import DeclarativeBase
from contextlib import asynccontextmanager

from sqlalchemy import create_engine, text, MetaData
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from urllib.parse import quote_plus
from .config import app_config, db_config, get_database_url, ensure_data_dir 
# import logging # Already imported above
from contextlib import contextmanager

from sqlalchemy.dialects import postgresql 

# ------------------------------------------------------------------------------
# Logging Setup
# ------------------------------------------------------------------------------
# logging.basicConfig(level=logging.INFO) # Already set up in main.py, avoid re-configuring
logger = logging.getLogger(__name__)

# ------------------------------------------------------------------------------
# Database URL
# ------------------------------------------------------------------------------
encoded_password = quote_plus(db_config.PASSWORD) if db_config.PASSWORD else ""

SQLALCHEMY_DATABASE_URL = (
    f"postgresql+asyncpg://{db_config.USER}:{encoded_password}"
    f"@{db_config.HOST}:{db_config.PORT}/{db_config.NAME}"
)

# ------------------------------------------------------------------------------
# Engine & Session
# ------------------------------------------------------------------------------
engine = create_async_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=5,
    max_overflow=5,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=False
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)
# Keep SessionLocal as alias so other files don't break immediately
SessionLocal = AsyncSessionLocal

# ------------------------------------------------------------------------------
# Declarative Base (SQLAlchemy 2.x)
# ------------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass

# The custom JSON encoder/serializer block was correctly marked for removal previously,
# ensure it's not present if it conflicts with app/models.py's definition.

# ------------------------------------------------------------------------------
# Session Helpers (Remains the same)
# ------------------------------------------------------------------------------
async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with AsyncSessionLocal() as session:
        yield session

# Keep old name as alias for any code still using get_db_session
get_db_session = get_db

@asynccontextmanager
async def get_db_session_context():
    """Async context manager with commit/rollback for internal use."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception as e:
            await session.rollback()
            logger.error(f"Database session error: {e}")
            raise

# ------------------------------------------------------------------------------
# Utility Functions 
# ------------------------------------------------------------------------------
async def test_connection():
    try:
        async with engine.connect() as conn:
            result = await conn.execute(
                text("SELECT version(), current_database(), current_user")
            )
            row = result.fetchone()
            logger.info("✅ Database connection successful!")
            logger.info(f"PostgreSQL version: {row[0]}")
            logger.info(f"Database: {row[1]}")
            logger.info(f"User: {row[2]}")
        return True
    except Exception as e:
        logger.error(f"❌ Database connection failed: {e}")
        return False

async def create_all_tables():
    try:
        from app.models import (
            VesselInfo, ShopTrialSession, ShopTrialPerformanceData,
            MonthlyReportHeader, MonthlyReportDetailsJsonb, BaselinePerformanceData,
            MonthlyISOPerformanceData, MECriticalAlert, MEWarningAlert, MENormalStatus
        )
        # run_sync is required because metadata.create_all is a sync function
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("✅ All tables created successfully!")

        # Seed initial data
        from sqlalchemy import select, func
        from app.models import RolePermission, Organization
        async with AsyncSessionLocal() as session:
            try:
                role_count = (await session.execute(
                    select(func.count()).select_from(RolePermission)
                )).scalar()
                if role_count == 0:
                    session.add_all([
                        RolePermission(role="admin", can_view_performance=True,
                                       can_manage_users=True, can_edit_reports=True,
                                       can_access_admin_page=True),
                        RolePermission(role="technical", can_view_performance=True,
                                       can_edit_reports=True, can_manage_users=False,
                                       can_access_admin_page=False),
                        RolePermission(role="user", can_view_performance=False,
                                       can_manage_users=False, can_edit_reports=False,
                                       can_access_admin_page=False),
                    ])
                    await session.commit()
                    logger.info("✅ Role permissions seeded successfully")

                org_count = (await session.execute(
                    select(func.count()).select_from(Organization)
                )).scalar()
                if org_count == 0:
                    session.add_all([
                        Organization(id=1, name="Staunch Technologies", domain="staunchtec.com"),
                        Organization(id=2, name="Ozellar Marine", domain="ozellar.com"),
                    ])
                    await session.commit()
                    logger.info("✅ Organizations seeded successfully")

            except Exception as seed_error:
                logger.error(f"Failed to seed data: {seed_error}")
                await session.rollback()

        return True
    except Exception as e:
        logger.error(f"❌ Failed to create tables: {e}")
        return False

async def _add_vessel_info_load_diagram_columns(conn: AsyncConnection) -> None:
    columns_to_add = [
        ('csr_power_kw', 'NUMERIC(8, 2)', "Contracted Service Rating Power (kW) from STR."),
        ('barred_speed_rpm_start', 'NUMERIC(6, 2)', "Start of the main engine barred speed range (rpm) from TVC."),
        ('barred_speed_rpm_end', 'NUMERIC(6, 2)', "End of the main engine barred speed range (rpm) from TVC."),
    ]
    for col_name, col_type, col_comment in columns_to_add:
        try:
            await conn.execute(text(
                f"ALTER TABLE vessel_info ADD COLUMN IF NOT EXISTS {col_name} {col_type} NULL"
            ))
            logger.info(f"✅ Migration applied: added column {col_name} to vessel_info")
        except Exception as e:
            logger.warning(f"Migration notice ({col_name}): {e}")
            continue
        try:
            safe_comment = col_comment.replace("'", "''")
            await conn.execute(text(
                f"COMMENT ON COLUMN vessel_info.{col_name} IS '{safe_comment}'"
            ))
            logger.info(f"✅ Comment added for {col_name}")
        except Exception as comment_e:
            logger.warning(f"Warning: Could not add comment for {col_name}: {comment_e}")

async def create_superuser_if_not_exists(db: AsyncSession):
    from app.models import User, RolePermission
    from sqlalchemy import select

    result = await db.execute(select(User).where(User.email == "software@staunchtec.com"))
    superuser = result.scalar_one_or_none()

    if not superuser:
        print("✅ Creating superuser: software@staunchtec.com")
        superuser = User(
            name="Staunch Development Team",
            email="software@staunchtec.com",
            role="superuser",
            organization_id=1,
            is_active=True,
            auth_type="microsoft"
        )
        db.add(superuser)
        await db.commit()
        print("✅ Superuser created successfully")
    else:
        print("✅ Superuser already exists")

    roles = ["superuser", "admin", "technical", "user"]
    for role in roles:
        result = await db.execute(select(RolePermission).where(RolePermission.role == role))
        perm = result.scalar_one_or_none()
        if not perm:
            if role == "superuser":
                perm = RolePermission(role=role, can_view_performance=True,
                                      can_manage_users=True, can_edit_reports=True,
                                      can_access_admin_page=True)
            elif role == "admin":
                perm = RolePermission(role=role, can_view_performance=True,
                                      can_manage_users=True, can_edit_reports=False,
                                      can_access_admin_page=True)
            elif role == "technical":
                perm = RolePermission(role=role, can_view_performance=True,
                                      can_manage_users=False, can_edit_reports=True,
                                      can_access_admin_page=False)
            else:
                perm = RolePermission(role=role, can_view_performance=True,
                                      can_manage_users=False, can_edit_reports=False,
                                      can_access_admin_page=False)
            db.add(perm)
            await db.commit()
    print("✅ Role permissions configured")

async def run_startup_migrations():
    """
    Lightweight, idempotent migrations executed at app startup.
    Ensures recent columns exist and adjusts types where needed.
    """

    try:
        async with engine.begin() as conn:
            await _add_vessel_info_load_diagram_columns(conn)

            # Try ALTER; ignore if already applied
            try:
                await conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ALTER COLUMN barometric_pressure_mmh2o TYPE numeric(8,3)"
                ))
                logger.info("✅ Migration applied: widened barometric_pressure_mmh2o to numeric(8,3)")
            except Exception as alter_exc:
                logger.info(f"Migration notice (barometric_pressure_mmh2o): {alter_exc}")

            # Ensure new monthly_report_header columns exist (idempotent)
            try:
                await conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS fo_consumption_mt_hr numeric(6,3) NULL"
                ))
                logger.info("✅ Migration applied: added fo_consumption_mt_hr to monthly_report_header")
            except Exception as e_new:
                logger.info(f"Migration notice (fo_consumption_mt_hr): {e_new}")

            try:
                await conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS fuel_injection_pump_index_mm numeric(6,1) NULL"
                ))
                logger.info("✅ Migration applied: added fuel_injection_pump_index_mm to monthly_report_header")
            except Exception as e_new2:
                logger.info(f"Migration notice (fuel_injection_pump_index_mm): {e_new2}")

            try:
                await conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS exh_temp_cylinder_outlet_ave_c numeric(5,1) NULL"
                ))
                logger.info("✅ Migration applied: added exh_temp_cylinder_outlet_ave_c to monthly_report_header")
            except Exception as e_new3:
                logger.info(f"Migration notice (exh_temp_cylinder_outlet_ave_c): {e_new3}")

            # Make vessel_info.vessel_id nullable to support IMO as primary key
            try:
                await conn.execute(text(
                    "ALTER TABLE vessel_info ALTER COLUMN vessel_id DROP NOT NULL"
                ))
                logger.info("✅ Migration applied: vessel_info.vessel_id set to NULLABLE")
            except Exception as e2:
                logger.info(f"Migration notice (vessel_id nullable): {e2}")

            # Add user management columns
            try:
                await conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS permissions JSONB NULL"
                ))
                logger.info("✅ Migration applied: added permissions column to users")
            except Exception as e_user1:
                logger.info(f"Migration notice (user permissions): {e_user1}")

            try:
                await conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS password_hash VARCHAR NULL"
                ))
                logger.info("✅ Migration applied: added password_hash column to users")
            except Exception as e_user2:
                logger.info(f"Migration notice (user password_hash): {e_user2}")

            try:
                await conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS created_by VARCHAR NULL"
                ))
                logger.info("✅ Migration applied: added created_by column to users")
            except Exception as e_user3:
                logger.info(f"Migration notice (user created_by): {e_user3}")

    except Exception as e:
        logger.error(f"Startup migrations failed: {e}")
        return False
    return True

async def drop_all_tables():
    try:
        from app.models import (
            VesselInfo, ShopTrialSession, ShopTrialPerformanceData,
            MonthlyReportHeader, MonthlyReportDetailsJsonb, BaselinePerformanceData,
            MonthlyISOPerformanceData, User, RolePermission, Organization
        )
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        logger.warning("⚠️  All tables dropped!")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to drop tables: {e}")
        return False

async def get_table_info():
    try:
        table_info = {}
        async with engine.connect() as conn:
            result = await conn.execute(text(
                "SELECT tablename FROM pg_tables WHERE schemaname='public'"
            ))
            table_names = [row[0] for row in result.fetchall()]
            for table_name in table_names:
                count_result = await conn.execute(
                    text(f"SELECT COUNT(*) FROM {table_name}")
                )
                table_info[table_name] = count_result.scalar()
        return table_info
    except Exception as e:
        logger.error(f"Failed to get table info: {e}")
        return {}

async def init_database(create_tables: bool = True):
    try:
        if not await test_connection():
            return False
        if not create_tables:
            logger.info("Skipping table creation and migrations (API Mode).")
            return True
        if not await create_all_tables():
            return False
        if not await run_startup_migrations():
            logger.warning("Startup migrations encountered issues.")
        table_info = await get_table_info()
        if table_info:
            logger.info("📊 Current table row counts:")
            for table, count in table_info.items():
                logger.info(f"  {table}: {count} rows")
        return True
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")
        return False

# ------------------------------------------------------------------------------
# Debug-safe URL print
# ------------------------------------------------------------------------------
debug_db_url = (
    f"postgresql+asyncpg://{db_config.USER}:****"
    f"@{db_config.HOST}:{db_config.PORT}/{db_config.NAME}"
)
logger.info(f"SQLAlchemy async engine configured for: {debug_db_url}")

# ------------------------------------------------------------------------------
# Run Test Directly
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    import asyncio
    print("🚀 Testing AEPMS SQLAlchemy Database Connection")
    print("=" * 50)
    if asyncio.run(init_database()):
        print("✅ Database initialized successfully!")
    else:
        print("❌ Database initialization failed! Check logs.")