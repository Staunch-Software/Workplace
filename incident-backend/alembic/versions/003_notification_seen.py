"""Notification bell: seen vs read, like DRS.

Revision ID: 003
Revises: 002
"""
from alembic import op

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE incident_notifications ADD COLUMN IF NOT EXISTS is_seen BOOLEAN NOT NULL DEFAULT FALSE")
    # Anything already dismissed was obviously seen.
    op.execute("UPDATE incident_notifications SET is_seen = TRUE WHERE is_read")


def downgrade() -> None:
    op.execute("ALTER TABLE incident_notifications DROP COLUMN IF EXISTS is_seen")
