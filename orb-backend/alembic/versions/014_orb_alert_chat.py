"""Chat on alerts: messages, attachments, read markers.

Revision ID: 014
Revises: 013
"""
from alembic import op

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_alert_threads (
            id UUID PRIMARY KEY,
            alert_id UUID NOT NULL REFERENCES orb_alerts(id) ON DELETE CASCADE,
            vessel_id UUID NOT NULL REFERENCES vessels(id),
            author_id UUID NOT NULL,
            author_name VARCHAR(200) NOT NULL,
            author_role VARCHAR(20) NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            is_internal BOOLEAN NOT NULL DEFAULT FALSE,
            tagged_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            client_id UUID UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alert_threads_alert_id ON orb_alert_threads (alert_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alert_threads_vessel_id ON orb_alert_threads (vessel_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alert_threads_is_internal ON orb_alert_threads (is_internal)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_alert_attachments (
            id UUID PRIMARY KEY,
            thread_id UUID NOT NULL REFERENCES orb_alert_threads(id) ON DELETE CASCADE,
            file_name VARCHAR(255) NOT NULL,
            file_size INTEGER NOT NULL,
            content_type VARCHAR(120) NOT NULL,
            storage_path VARCHAR(1000) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alert_attachments_thread_id ON orb_alert_attachments (thread_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_alert_thread_reads (
            alert_id UUID NOT NULL REFERENCES orb_alerts(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (alert_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orb_alert_thread_reads")
    op.execute("DROP TABLE IF EXISTS orb_alert_attachments")
    op.execute("DROP TABLE IF EXISTS orb_alert_threads")
