"""Notification bell and activity feed.

Revision ID: 002
Revises: 001
"""
from alembic import op

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_notifications (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL,
            type VARCHAR(20) NOT NULL,
            title VARCHAR(300) NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            link VARCHAR(300),
            incident_id UUID,
            sender_name VARCHAR(200),
            is_read BOOLEAN NOT NULL DEFAULT FALSE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_notifications_user_id ON incident_notifications (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_notifications_created_at ON incident_notifications (created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_feed_events (
            id UUID PRIMARY KEY,
            event_type VARCHAR(30) NOT NULL,
            incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
            title VARCHAR(300) NOT NULL,
            message TEXT NOT NULL DEFAULT '',
            link VARCHAR(300),
            actor_name VARCHAR(200),
            actor_id UUID,
            meta JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_feed_events_incident_id ON incident_feed_events (incident_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_feed_events_created_at ON incident_feed_events (created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_feed_reads (
            event_id UUID NOT NULL REFERENCES incident_feed_events(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            is_read BOOLEAN NOT NULL DEFAULT TRUE,
            PRIMARY KEY (event_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS incident_feed_reads")
    op.execute("DROP TABLE IF EXISTS incident_feed_events")
    op.execute("DROP TABLE IF EXISTS incident_notifications")
