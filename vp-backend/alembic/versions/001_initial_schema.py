"""Initial schema and CDC triggers baseline

Revision ID: 001
Revises: 
Create Date: 2026-11-20 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from backend.models import Base

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Create all model tables if they do not exist
    Base.metadata.create_all(bind=bind)

    # 2. Schema compatibility adjustments for existing tables
    op.execute(
        sa.text(
            "ALTER TABLE cp_vessel_description ADD COLUMN IF NOT EXISTS requires_cp_remarks_check BOOLEAN DEFAULT FALSE;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE vessel_notification_recipients ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE biofuel_bunker_stems ADD COLUMN IF NOT EXISTS pos_id INTEGER REFERENCES biofuel_pos(id) ON DELETE SET NULL;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE biofuel_bunker_stems ADD COLUMN IF NOT EXISTS pos_allocated_mt DOUBLE PRECISION;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE user_column_preferences ADD COLUMN IF NOT EXISTS user_uuid UUID;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE user_column_preferences ALTER COLUMN user_id DROP NOT NULL;"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE data_quality_threads ADD COLUMN IF NOT EXISTS author_uuid UUID;"
        )
    )
    op.execute(
        sa.text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_user_col_pref_uuid_source_vessel "
            "ON user_column_preferences (user_uuid, source, COALESCE(vessel_imo, ''));"
        )
    )
    op.execute(
        sa.text(
            "ALTER TABLE vessel_column_defaults ALTER COLUMN vessel_imo DROP NOT NULL;"
        )
    )

    # 3. Ensure updated_at CDC columns and indexes exist on key synced tables
    cdc_tables = [
        "analysis_data",
        "vessels",
        "vessel_particulars",
        "fleet_status_data",
        "mariapps_bunker_reports",
    ]
    for table_name in cdc_tables:
        op.execute(
            sa.text(
                f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();"
            )
        )
        op.execute(
            sa.text(
                f"CREATE INDEX IF NOT EXISTS ix_{table_name}_updated_at ON {table_name} (updated_at);"
            )
        )

    # 4. Create or replace the auto-updating trigger function
    op.execute(
        sa.text(
            """
        CREATE OR REPLACE FUNCTION set_updated_at_timestamp()
        RETURNS TRIGGER AS '
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        ' LANGUAGE plpgsql;
    """
        )
    )

    # 5. Attach trigger to each CDC table
    for table_name in cdc_tables:
        op.execute(
            sa.text(f"DROP TRIGGER IF EXISTS trg_{table_name}_updated_at ON {table_name};")
        )
        op.execute(
            sa.text(
                f"CREATE TRIGGER trg_{table_name}_updated_at BEFORE UPDATE ON {table_name} "
                f"FOR EACH ROW EXECUTE FUNCTION set_updated_at_timestamp();"
            )
        )

    # 6. Seed default data sources
    op.execute(
        sa.text(
            """
        INSERT INTO data_sources (source_id, source_name, description) VALUES
            ('wni', 'Weathernews', 'Weathernews Inc. raw report pipeline'),
            ('read_at_sea', 'Read at Sea', 'Read at Sea sensor and Noon report platform'),
            ('mari_apps', 'Mari Apps Native', 'MariApps smartpal native reports'),
            ('old_data', 'Legacy Data', 'Historical data imported from legacy Excel files')
        ON CONFLICT (source_id) DO NOTHING;
    """
        )
    )


def downgrade() -> None:
    cdc_tables = [
        "analysis_data",
        "vessels",
        "vessel_particulars",
        "fleet_status_data",
        "mariapps_bunker_reports",
    ]
    for table_name in cdc_tables:
        op.execute(
            sa.text(f"DROP TRIGGER IF EXISTS trg_{table_name}_updated_at ON {table_name};")
        )
