"""Add aepms_sync_state table

Revision ID: 985e0d6f86fc
Revises: 0250a4405bf8
Create Date: 2026-09-01 00:00:00.000000

Module-scoped sync state for ENGINE_PERFORMANCE, mirroring the
reports_sync_state / drs sync state / luboil sync state pattern already
used by the other modules. The Vessel Status dashboard's Engine Perf
column should read last_push_at/last_pull_at from here instead of the
shared vessels table (which every module writes to and therefore cannot
be trusted as AEPMS-specific).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '985e0d6f86fc'
down_revision: Union[str, Sequence[str], None] = '0250a4405bf8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'aepms_sync_state',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('vessel_imo', sa.String(length=20), nullable=False),
        sa.Column('sync_scope', sa.String(length=20), nullable=False, server_default='ENGINE_PERFORMANCE'),
        sa.Column('last_push_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_pull_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('active_errors', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('vessel_imo', 'sync_scope', name='uq_aepms_vessel_sync_scope'),
    )
    op.create_index(op.f('ix_aepms_sync_state_vessel_imo'), 'aepms_sync_state', ['vessel_imo'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_aepms_sync_state_vessel_imo'), table_name='aepms_sync_state')
    op.drop_table('aepms_sync_state')
