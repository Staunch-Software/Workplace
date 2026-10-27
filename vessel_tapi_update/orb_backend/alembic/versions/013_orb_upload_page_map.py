"""Remember how raw PDF pages were split for extraction.

Revision ID: 013
Revises: 012
"""
from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # [{"raw_page": 7, "path": "single_page" | "landscape_split" | "stacked_split", "outputs": 2}, ...]
    # Lets an entry's page_number (the post-split page) be traced back to the raw PDF page.
    op.execute("ALTER TABLE orb_uploads ADD COLUMN IF NOT EXISTS page_map JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE orb_uploads DROP COLUMN IF EXISTS page_map")
