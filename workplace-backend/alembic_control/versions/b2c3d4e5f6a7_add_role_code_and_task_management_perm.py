"""add role_code column and task_management permission key"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("role_code", sa.String(), nullable=True))
    op.execute(
        "ALTER TABLE users ALTER COLUMN permissions SET DEFAULT "
        "'{\"drs\": false, \"jira\": false, \"voyage\": false, \"lubeoil\": false, "
        "\"engine_performance\": false, \"task_management\": false}'"
    )
    op.execute(
        "UPDATE users SET permissions = permissions || '{\"task_management\": false}'::jsonb "
        "WHERE NOT (permissions ? 'task_management')"
    )


def downgrade():
    op.execute("UPDATE users SET permissions = permissions - 'task_management'")
    op.execute(
        "ALTER TABLE users ALTER COLUMN permissions SET DEFAULT "
        "'{\"drs\": false, \"jira\": false, \"voyage\": false, \"lubeoil\": false, "
        "\"engine_performance\": false}'"
    )
    op.drop_column("users", "role_code")
