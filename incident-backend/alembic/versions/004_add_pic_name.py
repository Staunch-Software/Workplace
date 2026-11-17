"""Add pic_name (Person In Charge) to incidents and backfill.

Revision ID: 004
Revises: 003
"""
from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE incidents ADD COLUMN IF NOT EXISTS pic_name VARCHAR(200) NOT NULL DEFAULT ''")
    # Backfill: populate existing records with created_by_name if pic_name is blank
    op.execute("UPDATE incidents SET pic_name = created_by_name WHERE pic_name = '' OR pic_name IS NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE incidents DROP COLUMN IF EXISTS pic_name")
