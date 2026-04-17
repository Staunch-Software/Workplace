"""add password reset fields"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "a1b2c3d4e5f6"
down_revision = "bfbca5e62e43"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("password_reset_token", sa.String(), nullable=True))
    op.add_column("users", sa.Column("reset_token_expiry", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("users", "reset_token_expiry")
    op.drop_column("users", "password_reset_token")
