"""Keep the raw extraction result of each upload.

Revision ID: 012
Revises: 011
"""
from alembic import op

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_upload_raw (
            upload_id UUID PRIMARY KEY REFERENCES orb_uploads(id) ON DELETE CASCADE,
            entries JSONB NOT NULL,
            failed_pages JSONB,
            usage JSONB,
            model VARCHAR(100),
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orb_upload_raw")
