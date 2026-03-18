"""Add propeller_margin_percent to monthly_iso_performance_data

Revision ID: add_propeller_margin
Revises: <previous_revision> # <-- You MUST update this
Create Date: 2025-01-XX XX:XX:XX.XXXXXX

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_propeller_margin'
down_revision = '193ddde9b102'  # Replace with your latest revision
branch_labels = None
depends_on = None


def upgrade():
    # Add propeller_margin_percent column to monthly_iso_performance_data table
    op.add_column('monthly_iso_performance_data', 
        sa.Column('propeller_margin_percent', 
                  sa.DECIMAL(precision=6, scale=2), # Note: Decimal(6, 2) allows up to 9999.99%
                  nullable=True,
                  comment='Propeller Margin Percentage: (Actual Power / Service Power) * 100')
    )


def downgrade():
    # Remove propeller_margin_percent column
    op.drop_column('monthly_iso_performance_data', 'propeller_margin_percent')