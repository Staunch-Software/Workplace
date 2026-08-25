"""cert/survey name mapping tables — standing unmapped-name detection across sources"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0003_name_mapping"
down_revision = "0002_extraction_layer"
branch_labels = None
depends_on = None


def _create_mapping_table(name):
    op.create_table(
        name,
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("smartpal_name", sa.Text(), nullable=True),
        sa.Column("dnv_name", sa.Text(), nullable=True),
        sa.Column("abs_name", sa.Text(), nullable=True),
        sa.Column("irs_name", sa.Text(), nullable=True),
        # 'MAPPED' | 'PARTIAL' | 'UNMAPPED' | 'NEEDS_REVIEW' — new rows always start
        # NEEDS_REVIEW; matching across sources is a manual decision, never auto-fuzzy-matched.
        sa.Column("status", sa.Text(), nullable=False, server_default="NEEDS_REVIEW"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def upgrade():
    _create_mapping_table("cert_name_mapping")
    _create_mapping_table("survey_name_mapping")


def downgrade():
    op.drop_table("survey_name_mapping")
    op.drop_table("cert_name_mapping")
