"""Alert resolution workflow: vessel requests, shore accepts or rejects (or resolves directly).

Revision ID: 016
Revises: 015
"""
from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # OPEN -> PENDING_APPROVAL (vessel asked) -> RESOLVED, or back to OPEN when shore rejects.
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'OPEN'")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS resolution_notes TEXT")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS resolution_requested_by UUID")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS resolution_requested_by_name VARCHAR(200)")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS resolution_requested_at TIMESTAMPTZ")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS resolved_by_name VARCHAR(200)")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS rejection_reason TEXT")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS rejected_by_name VARCHAR(200)")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ")
    op.execute("UPDATE orb_alerts SET status = 'RESOLVED' WHERE is_resolved")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alerts_status ON orb_alerts (status)")
    # System lines in the conversation ("Resolution requested by ...", "accepted", "rejected").
    op.execute("ALTER TABLE orb_alert_threads ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT FALSE")


def downgrade() -> None:
    op.execute("ALTER TABLE orb_alert_threads DROP COLUMN IF EXISTS is_system")
    op.execute("DROP INDEX IF EXISTS ix_orb_alerts_status")
    for col in ("rejected_at", "rejected_by_name", "rejection_reason", "resolved_by_name", "resolution_requested_at",
                "resolution_requested_by_name", "resolution_requested_by", "resolution_notes", "status"):
        op.execute(f"ALTER TABLE orb_alerts DROP COLUMN IF EXISTS {col}")
