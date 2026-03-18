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
    f"postgresql+psycopg2://{db_config.USER}:{encoded_password}"
    f"@{db_config.HOST}:{db_config.PORT}/{db_config.NAME}"
)

# ------------------------------------------------------------------------------
# Engine & Session
# ------------------------------------------------------------------------------
engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_size=30,           # Increased from 10
    max_overflow=40,        # Increased from 20
    pool_timeout=10,        # Wait 60 seconds instead of 30 before failing
    pool_recycle=1800,      # Close connections every 30 mins to prevent "stale" leaks
    pool_pre_ping=True,     # Verify connection is alive before using it
    echo=False              # Set to False in production to reduce log noise
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

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
def get_db_session():
    """Simple generator-based DB session (FastAPI compatible)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_db():
    """Direct session getter."""
    return SessionLocal()

@contextmanager
def get_db_session_context():
    """Context manager for sessions with commit/rollback handling."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Database session error: {e}")
        raise
    finally:
        db.close()

# ------------------------------------------------------------------------------
# Utility Functions 
# ------------------------------------------------------------------------------
def test_connection():
    """Test database connection with version check."""
    try:
        with engine.connect() as conn:
            result = conn.execute(
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

def create_all_tables():
    """Create all database tables defined in models."""
    try:
        # Import models here to avoid circular dependency if models import Base
        # --- FIX: ADD MonthlyISOPerformanceData HERE ---
        from app.models import (
            VesselInfo, ShopTrialSession, ShopTrialPerformanceData,
            MonthlyReportHeader, MonthlyReportDetailsJsonb, BaselinePerformanceData,
            MonthlyISOPerformanceData, MECriticalAlert, MEWarningAlert, MENormalStatus
        )
        Base.metadata.create_all(bind=engine)
        logger.info("✅ All tables created successfully!")
        
        # ✅ SEED RBAC DATA - ADD THIS ENTIRE BLOCK
        session = SessionLocal()
        try:
            # Import here to avoid circular dependency
            from app.models import RolePermission, Organization
            
            # Seed role permissions if table is empty
            if session.query(RolePermission).count() == 0:
                roles = [
                    RolePermission(
                        role="admin",
                        can_view_performance=True,
                        can_manage_users=True,
                        can_edit_reports=True,
                        can_access_admin_page=True
                    ),
                    RolePermission(
                        role="technical",
                        can_view_performance=True,
                        can_edit_reports=True,
                        can_manage_users=False,
                        can_access_admin_page=False
                    ),
                    RolePermission(
                        role="user",
                        can_view_performance=False,
                        can_manage_users=False,
                        can_edit_reports=False,
                        can_access_admin_page=False
                    )
                ]
                session.add_all(roles)
                session.commit()
                logger.info("✅ Role permissions seeded successfully")
        
            # 👇 ADD THE ORGANIZATION SEEDING HERE 👇
            if session.query(Organization).count() == 0:
                orgs = [
                    Organization(id=1, name="Staunch Technologies", domain="staunchtec.com"),
                    Organization(id=2, name="Ozellar Marine", domain="ozellar.com"),
                ]
                session.add_all(orgs)
                session.commit()
                logger.info("✅ Organizations seeded successfully")
        
        except Exception as seed_error:
            logger.error(f"Failed to seed data: {seed_error}")
            session.rollback()
        finally:
            session.close()
        
        return True
    except Exception as e:
        logger.error(f"❌ Failed to create tables: {e}")
        return False
# app/database.py (CORRECTED _add_vessel_info_load_diagram_columns function)

def _add_vessel_info_load_diagram_columns(conn: Any) -> None:
    """Adds the CSR power and Barred Speed Range columns to vessel_info if they don't exist."""
    
    # Define columns and their comments for a cleaner loop
    columns_to_add = [
        ('csr_power_kw', 'NUMERIC(8, 2)', "Contracted Service Rating Power (kW) from STR."),
        ('barred_speed_rpm_start', 'NUMERIC(6, 2)', "Start of the main engine barred speed range (rpm) from TVC."),
        ('barred_speed_rpm_end', 'NUMERIC(6, 2)', "End of the main engine barred speed range (rpm) from TVC."),
    ]
    
    try:
        for col_name, col_type, col_comment in columns_to_add:
            # 1. ADD COLUMN (PostgreSQL-compatible syntax: NO COMMENT here)
            conn.execute(text(
                f"ALTER TABLE vessel_info ADD COLUMN IF NOT EXISTS {col_name} {col_type} NULL"
            ))
            logger.info(f"✅ Migration applied: added column {col_name} to vessel_info")

            # 2. ADD COMMENT (Separate PostgreSQL command)
            # This will fail gracefully if the column did not need to be added but the comment is already there, 
            # though usually it just overwrites.
            try:
                conn.execute(text(
                    f"COMMENT ON COLUMN vessel_info.{col_name} IS '{col_comment}'"
                ))
                logger.info(f"✅ Migration applied: added comment for {col_name}")
            except Exception as comment_e:
                logger.warning(f"Warning: Could not add comment for {col_name}: {comment_e}")
                # Don't fail the whole block for a comment
        
        conn.commit()
    except Exception as e:
        logger.error(f"❌ Failed to add vessel_info load diagram columns: {e}")
        conn.rollback() 
        raise # Re-raise to alert the calling function of a problem

def create_superuser_if_not_exists(db: Session):
    """Create default superuser if not exists."""
    from app.models import User, RolePermission
    
    # Check if superuser exists
    superuser = db.query(User).filter_by(email="software@staunchtec.com").first()
    
    if not superuser:
        print("✅ Creating superuser: software@staunchtec.com")
        superuser = User(
            name="Staunch Development Team",
            email="software@staunchtec.com",
            role="superuser",
            organization_id=1,  # Changed from organization="Staunch"
            is_active=True,
            auth_type="microsoft"
        )
        db.add(superuser)
        db.commit()
        print("✅ Superuser created successfully")
    else:
        print("✅ Superuser already exists")
    
    # Create role permissions if not exists
    roles = ["superuser", "admin", "technical", "user"]
    for role in roles:
        perm = db.query(RolePermission).filter_by(role=role).first()
        if not perm:
            if role == "superuser":
                perm = RolePermission(
                    role=role,
                    can_view_performance=True,
                    can_manage_users=True,
                    can_edit_reports=True,
                    can_access_admin_page=True
                )
            elif role == "admin":
                perm = RolePermission(
                    role=role,
                    can_view_performance=True,
                    can_manage_users=True,
                    can_edit_reports=False,
                    can_access_admin_page=True
                )
            elif role == "technical":
                perm = RolePermission(
                    role=role,
                    can_view_performance=True,
                    can_manage_users=False,
                    can_edit_reports=True,
                    can_access_admin_page=False
                )
            else:  # user
                perm = RolePermission(
                    role=role,
                    can_view_performance=True,
                    can_manage_users=False,
                    can_edit_reports=False,
                    can_access_admin_page=False
                )
            db.add(perm)
        # Commit for each role permission creation
        db.commit() 
    print("✅ Role permissions configured")

def run_startup_migrations():
    """
    Lightweight, idempotent migrations executed at app startup.
    Ensures recent columns exist and adjusts types where needed.
    """
    
    try:
        with engine.connect() as conn:
            _add_vessel_info_load_diagram_columns(conn)
            # Try ALTER; ignore if already applied
            try:
                conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ALTER COLUMN barometric_pressure_mmh2o TYPE numeric(8,3)"
                ))
                conn.commit()
                logger.info("✅ Migration applied: widened barometric_pressure_mmh2o to numeric(8,3)")
            except Exception as alter_exc:
                logger.info(f"Migration notice (barometric_pressure_mmh2o): {alter_exc}")

            # Ensure new monthly_report_header columns exist (idempotent)
            try:
                conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS fo_consumption_mt_hr numeric(6,3) NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added fo_consumption_mt_hr to monthly_report_header")
            except Exception as e_new:
                logger.info(f"Migration notice (fo_consumption_mt_hr): {e_new}")

            try:
                conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS fuel_injection_pump_index_mm numeric(6,1) NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added fuel_injection_pump_index_mm to monthly_report_header")
            except Exception as e_new2:
                logger.info(f"Migration notice (fuel_injection_pump_index_mm): {e_new2}")

            try:
                conn.execute(text(
                    "ALTER TABLE monthly_report_header "
                    "ADD COLUMN IF NOT EXISTS exh_temp_cylinder_outlet_ave_c numeric(5,1) NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added exh_temp_cylinder_outlet_ave_c to monthly_report_header")
            except Exception as e_new3:
                logger.info(f"Migration notice (exh_temp_cylinder_outlet_ave_c): {e_new3}")

            # Make vessel_info.vessel_id nullable to support IMO as primary key
            try:
                conn.execute(text(
                    "ALTER TABLE vessel_info ALTER COLUMN vessel_id DROP NOT NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: vessel_info.vessel_id set to NULLABLE")
            except Exception as e2:
                logger.info(f"Migration notice (vessel_id nullable): {e2}")
            # Add user management columns
            try:
                conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS permissions JSONB NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added permissions column to users")
            except Exception as e_user1:
                logger.info(f"Migration notice (user permissions): {e_user1}")

            try:
                conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS password_hash VARCHAR NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added password_hash column to users")
            except Exception as e_user2:
                logger.info(f"Migration notice (user password_hash): {e_user2}")
            try:
                conn.execute(text(
                    "ALTER TABLE users "
                    "ADD COLUMN IF NOT EXISTS created_by VARCHAR NULL"
                ))
                conn.commit()
                logger.info("✅ Migration applied: added created_by column to users")
            except Exception as e_user3:
                logger.info(f"Migration notice (user created_by): {e_user3}")  
    except Exception as e:
        logger.error(f"Startup migrations failed: {e}")
        return False
    return True

def drop_all_tables():
    """Drop all tables (⚠️ dangerous)."""
    try:
        # FIX: Ensure all models are imported here too if you ever plan to use this.
        from app.models import (
            VesselInfo, ShopTrialSession, ShopTrialPerformanceData,
            MonthlyReportHeader, MonthlyReportDetailsJsonb, BaselinePerformanceData,
            MonthlyISOPerformanceData ,User, RolePermission, Organization
        )
        Base.metadata.drop_all(bind=engine)
        logger.warning("⚠️  All tables dropped!")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to drop tables: {e}")
        return False

def get_table_info():
    """Get row counts for all existing tables."""
    try:
        metadata = MetaData()
        metadata.reflect(bind=engine)
        
        table_info = {}
        with SessionLocal() as db:
            for table_name in metadata.tables.keys():
                result = db.execute(text(f"SELECT COUNT(*) FROM {table_name}"))
                count = result.scalar()
                table_info[table_name] = count
        return table_info
    except Exception as e:
        logger.error(f"Failed to get table info: {e}")
        return {}

def init_database(create_tables: bool = True):
    """Initialize DB, optionally create tables, and log status."""
    try:
        # 1. Always check connection first
        if not test_connection():
            return False
        
        # --- CRITICAL CHANGE START ---
        # If we are running from the API (Data Sync), create_tables will be False.
        # We must SKIP all heavy operations (creating tables, migrations, counting rows).
        if not create_tables:
            logger.info("Skipping table creation and migrations (API Mode - assuming DB is ready).")
            return True
        # --- CRITICAL CHANGE END ---

        # 2. Only run these if create_tables is TRUE (Command Line mode)
        if not create_all_tables():
            return False
        
        # Run migrations after tables are created/checked
        if not run_startup_migrations():
            logger.warning("Startup migrations encountered issues.")
        
        table_info = get_table_info()
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
    f"postgresql+psycopg2://{db_config.USER}:****"
    f"@{db_config.HOST}:{db_config.PORT}/{db_config.NAME}"
)
logger.info(f"SQLAlchemy engine configured for: {debug_db_url}")

# ------------------------------------------------------------------------------
# Run Test Directly
# ------------------------------------------------------------------------------
if __name__ == "__main__":
    print("🚀 Testing AEPMS SQLAlchemy Database Connection")
    print("=" * 50)
    if init_database():
        print("✅ Database initialized successfully!")
    else:
        print("❌ Database initialization failed! Check logs.")