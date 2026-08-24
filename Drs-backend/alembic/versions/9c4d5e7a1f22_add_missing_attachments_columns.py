"""Add missing version/origin/updated_at columns to attachments

The Attachment ORM model (app/models/defect.py) has carried
`version`, `origin`, and `updated_at` columns for a while — the same
columns exist on `threads`, `defects`, etc. — but `attachments` never
got them; the initial migration only created id/thread_id/file_name/
file_size/content_type/blob_path/created_at, and nothing since
migrated it forward. Any SELECT that loads Attachment rows (e.g.
GET /defects/{id}/threads, which eager-loads Thread.attachments)
fails with `UndefinedColumnError: column attachments.version does
not exist`.

Revision ID: 9c4d5e7a1f22
Revises: 7b3c1a9f2e10
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '9c4d5e7a1f22'
down_revision: Union[str, Sequence[str], None] = '7b3c1a9f2e10'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'attachments',
        sa.Column('version', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column(
        'attachments',
        sa.Column('origin', sa.String(length=20), nullable=False, server_default='VESSEL'),
    )
    op.add_column(
        'attachments',
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
    )
    op.create_check_constraint(
        'attachment_version_positive', 'attachments', 'version >= 1',
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('attachment_version_positive', 'attachments', type_='check')
    op.drop_column('attachments', 'updated_at')
    op.drop_column('attachments', 'origin')
    op.drop_column('attachments', 'version')
