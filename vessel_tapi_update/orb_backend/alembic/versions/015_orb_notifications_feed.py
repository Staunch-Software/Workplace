"""Notifications (the bell) and the activity feed.

Revision ID: 015
Revises: 014
"""
from alembic import op

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_notifications (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            type VARCHAR(20) NOT NULL,
            title VARCHAR(300) NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            link VARCHAR(300),
            vessel_id UUID,
            alert_id UUID,
            sender_name VARCHAR(200),
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_notifications_user_id ON orb_notifications (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_notifications_created_at ON orb_notifications (created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_feed_events (
            id UUID PRIMARY KEY,
            event_type VARCHAR(30) NOT NULL,
            vessel_id UUID NOT NULL REFERENCES vessels(id),
            alert_id UUID,
            upload_id UUID,
            title VARCHAR(300) NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            link VARCHAR(300),
            actor_name VARCHAR(200),
            actor_id UUID,
            shore_only BOOLEAN NOT NULL DEFAULT FALSE,
            meta JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_feed_events_vessel_id ON orb_feed_events (vessel_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_feed_events_created_at ON orb_feed_events (created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_feed_reads (
            event_id UUID NOT NULL REFERENCES orb_feed_events(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (event_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orb_feed_reads")
    op.execute("DROP TABLE IF EXISTS orb_feed_events")
    op.execute("DROP TABLE IF EXISTS orb_notifications")
