"""Drop foreign keys to ORB's own users table.

Users now live in the workplace control database, so these columns hold
workplace user ids. ORB's `users` table is kept untouched as history for old
rows; nothing is deleted or rewritten.

Revision ID: 010
Revises: 5e7ea2a43b6f
"""
from alembic import op

revision = "010"
down_revision = "5e7ea2a43b6f"
branch_labels = None
depends_on = None

_FKS = [
    ("orb_uploads", "orb_uploads_uploaded_by_fkey"),
    ("orb_alerts", "orb_alerts_resolved_by_fkey"),
    ("vessels", "vessels_created_by_fkey"),
]


def upgrade() -> None:
    for table, constraint in _FKS:
        op.execute(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{constraint}"')


def downgrade() -> None:
    # Re-adding the keys would fail for any row written with a workplace user
    # id, so the downgrade intentionally does nothing.
    pass
