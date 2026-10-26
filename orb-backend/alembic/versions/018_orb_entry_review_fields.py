"""Per-entry officer signature, entry order on the page, page language (alerts 30, 31, 36).

Revision ID: 018
Revises: 017
"""
from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE orb_entries ADD COLUMN IF NOT EXISTS officer_signature_present BOOLEAN")
    op.execute("ALTER TABLE orb_entries ADD COLUMN IF NOT EXISTS entry_seq INTEGER")
    op.execute("ALTER TABLE orb_entries ADD COLUMN IF NOT EXISTS page_language VARCHAR(40)")


def downgrade() -> None:
    op.execute("ALTER TABLE orb_entries DROP COLUMN IF EXISTS page_language")
    op.execute("ALTER TABLE orb_entries DROP COLUMN IF EXISTS entry_seq")
    op.execute("ALTER TABLE orb_entries DROP COLUMN IF EXISTS officer_signature_present")
