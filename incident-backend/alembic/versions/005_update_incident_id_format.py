"""Update incident_no format to OZ-INC/<year>/<seq:04d> and backfill.

Revision ID: 005
Revises: 004
"""
from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Update incidents table where format is old (e.g. INC-2026-0001, INC-2026-0002, OZ-INC-2026-0001)
    # Extracts the 4-digit year and the ending sequence number, formatting as OZ-INC/YYYY/0001
    op.execute("""
        UPDATE incidents
        SET incident_no = 'OZ-INC/' || substring(incident_no from '(\\d{4})') || '/' || lpad(substring(incident_no from '(\\d+)$'), 4, '0')
        WHERE incident_no NOT LIKE 'OZ-INC/%/%'
          AND incident_no ~ '\\d{4}.*\\d+';
    """)

    # 2. Update titles in feed events if they contain old INC- prefix
    op.execute("""
        UPDATE incident_feed_events
        SET title = regexp_replace(title, 'INC-(\\d{4})-(\\d+)', 'OZ-INC/\\1/\\2', 'g')
        WHERE title ~ 'INC-\\d{4}-\\d+';
    """)

    # 3. Update titles in notifications if they contain old INC- prefix
    op.execute("""
        UPDATE incident_notifications
        SET title = regexp_replace(title, 'INC-(\\d{4})-(\\d+)', 'OZ-INC/\\1/\\2', 'g')
        WHERE title ~ 'INC-\\d{4}-\\d+';
    """)


def downgrade() -> None:
    pass
