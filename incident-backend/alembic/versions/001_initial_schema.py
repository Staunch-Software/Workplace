"""Incidents, their files and the internal chat.

Revision ID: 001
Revises:
"""
from alembic import op

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SEQUENCE IF NOT EXISTS incident_no_seq START 1")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id UUID PRIMARY KEY,
            incident_no VARCHAR(30) NOT NULL UNIQUE,
            status VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
            vessel_imo VARCHAR(7) NOT NULL,
            vessel_name VARCHAR(200) NOT NULL,
            incident_date DATE NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category VARCHAR(80) NOT NULL DEFAULT '',
            offhire BOOLEAN NOT NULL DEFAULT FALSE,
            offhire_details TEXT NOT NULL DEFAULT '',
            comments TEXT NOT NULL DEFAULT '',
            sof_notes TEXT NOT NULL DEFAULT '',
            log_notes TEXT NOT NULL DEFAULT '',
            writeup TEXT NOT NULL DEFAULT '',
            created_by UUID NOT NULL,
            created_by_name VARCHAR(200) NOT NULL,
            closed_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incidents_status ON incidents (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incidents_vessel_imo ON incidents (vessel_imo)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incidents_incident_date ON incidents (incident_date)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_files (
            id UUID PRIMARY KEY,
            incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
            kind VARCHAR(10) NOT NULL,
            file_name VARCHAR(255) NOT NULL,
            file_size INTEGER NOT NULL,
            content_type VARCHAR(120) NOT NULL,
            storage_path VARCHAR(1000) NOT NULL,
            caption VARCHAR(500) NOT NULL DEFAULT '',
            uploaded_by UUID NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_files_incident_id ON incident_files (incident_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_files_kind ON incident_files (kind)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_threads (
            id UUID PRIMARY KEY,
            incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
            author_id UUID NOT NULL,
            author_name VARCHAR(200) NOT NULL,
            author_role VARCHAR(20) NOT NULL,
            body TEXT NOT NULL DEFAULT '',
            tagged_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
            client_id UUID UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_threads_incident_id ON incident_threads (incident_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_thread_attachments (
            id UUID PRIMARY KEY,
            thread_id UUID NOT NULL REFERENCES incident_threads(id) ON DELETE CASCADE,
            file_name VARCHAR(255) NOT NULL,
            file_size INTEGER NOT NULL,
            content_type VARCHAR(120) NOT NULL,
            storage_path VARCHAR(1000) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_incident_thread_attachments_thread_id ON incident_thread_attachments (thread_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS incident_thread_reads (
            incident_id UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
            user_id UUID NOT NULL,
            last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (incident_id, user_id)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS incident_thread_reads")
    op.execute("DROP TABLE IF EXISTS incident_thread_attachments")
    op.execute("DROP TABLE IF EXISTS incident_threads")
    op.execute("DROP TABLE IF EXISTS incident_files")
    op.execute("DROP TABLE IF EXISTS incidents")
    op.execute("DROP SEQUENCE IF EXISTS incident_no_seq")
