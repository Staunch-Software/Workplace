# app/database.py

import re
from datetime import datetime, date, time
from typing import Any, Dict, Optional, List, BinaryIO
from decimal import Decimal, InvalidOperation
import logging
import json
import os
from pathlib import Path
from sqlalchemy.orm import Session

from sqlalchemy import create_engine, text, MetaData
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from urllib.parse import quote_plus
from .config import app_config, db_config, get_database_url, ensure_data_dir
from contextlib import contextmanager

from sqlalchemy.dialects import postgresql

# ------------------------------------------------------------------------------
# Logging Setup
# ------------------------------------------------------------------------------
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
    pool_size=30,
    max_overflow=40,
    pool_timeout=10,
    pool_recycle=1800,
    pool_pre_ping=True,
    echo=False
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

# ------------------------------------------------------------------------------
# Declarative Base (SQLAlchemy 2.x)
# ------------------------------------------------------------------------------
class Base(DeclarativeBase):
    pass

# ------------------------------------------------------------------------------
# Session Helpers
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
    try:
        # Only import luboil models — users/vessels live in workplace_control
        from app.luboil_model import (
            LuboilVessel, LuboilReport, LuboilSample,
            LuboilEquipmentType, LuboilVesselConfig,
            LuboilNameMapping, Notification,
            LuboilEvent, LuboilEventReadState
        )
        Base.metadata.create_all(bind=engine)
        logger.info("✅ All tables created successfully!")
        return True
    except Exception as e:
        logger.error(f"❌ Failed to create tables: {e}")
        return False


def create_superuser_if_not_exists(db: Session):
    """Skipped — users live in workplace_control DB, not here."""
    logger.info("ℹ️ Superuser creation skipped — users managed by workplace-backend")
    return


def run_startup_migrations():
    """No migrations needed — users/vessels managed by workplace-backend."""
    logger.info("ℹ️ Startup migrations skipped — users/vessels in workplace_control")
    return True


def drop_all_tables():
    try:
        from app.luboil_model import (
            LuboilVessel, LuboilReport, LuboilSample,
            LuboilEquipmentType, LuboilVesselConfig,
            LuboilNameMapping, Notification,
            LuboilEvent, LuboilEventReadState
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