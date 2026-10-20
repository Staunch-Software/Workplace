"""add bilge pump capacity to vessel tanks

Revision ID: 5e7ea2a43b6f

Revises: 009

Create Date: 2026-09-30 11:10:38.028869

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '5e7ea2a43b6f'
down_revision: Union[str, None] = '009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # IF NOT EXISTS: the production database already has this column (it was
    # added by hand before the migration was recorded), so a plain add_column
    # would fail there. Fresh databases still get the column.
    op.execute(
        "ALTER TABLE vessel_tanks "
        "ADD COLUMN IF NOT EXISTS bilge_pump_capacity_m3_per_hr DOUBLE PRECISION"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE vessel_tanks DROP COLUMN IF EXISTS bilge_pump_capacity_m3_per_hr")