"""work_order_triggers table — stub for the "trigger work order" button on subtask pages
(first user: 1.W.4's survey cycle review)"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0005_work_order_triggers"
down_revision = "0004_condition_category"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "work_order_triggers",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("task_code", sa.String(), nullable=False),
        sa.Column("vessel_name", sa.String(), nullable=False),
        sa.Column("survey_name", sa.String(), nullable=False),
        sa.Column("source", sa.String(), nullable=False),
        sa.Column("triggered_by", sa.String(), nullable=True),
        sa.Column("triggered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )


def downgrade():
    op.drop_table("work_order_triggers")
