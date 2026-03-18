from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os
import sys

# Add path to find app modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

# ✅ CRITICAL: Import ALL models before Base.metadata
from app.config import get_database_url

# Import Base FIRST
from app.database import Base

# ✅ Then import ALL your models to register them with Base.metadata
from app.models import (
    VesselInfo,
    ShopTrialSession,
    ShopTrialPerformanceData,
    MonthlyReportHeader,
    MonthlyReportDetailsJsonb,
    BaselinePerformanceData,
    MonthlyISOPerformanceData,
    User,              # ✅ NEW
    RolePermission     # ✅ NEW
)

# Alembic Config object
config = context.config

# Setup loggers
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Fix password encoding for ConfigParser
db_url = get_database_url()
config.file_config.set('alembic', 'sqlalchemy.url', db_url.replace('%', '%%'))

# ✅ CRITICAL: This tells Alembic what tables exist
target_metadata = Base.metadata

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    url = config.get_main_option("sqlalchemy.url")
    print(f"🔗 [Alembic Offline] Using DB URL: {url}")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        print(f"🔗 [Alembic Online] Connected to: {connection.engine.url}")
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()