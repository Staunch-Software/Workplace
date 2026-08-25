"""class_conditions.category — COC | MEMORANDA | DISPENSATION | FINDINGS"""

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision = "0004_condition_category"
down_revision = "0003_name_mapping"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("class_conditions", sa.Column("category", sa.Text(), nullable=True))


def downgrade():
    op.drop_column("class_conditions", "category")
