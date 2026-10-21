"""Add item_lines to orb_entries.

Revision ID: 011
Revises: 010
"""
from alembic import op

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orb_entries ADD COLUMN IF NOT EXISTS item_lines JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE orb_entries DROP COLUMN IF EXISTS item_lines")
