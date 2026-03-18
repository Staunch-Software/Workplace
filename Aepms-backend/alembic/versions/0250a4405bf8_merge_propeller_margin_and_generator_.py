
"""Merge propeller margin and generator refactor branches

Revision ID: 0250a4405bf8
Revises: add_propeller_margin, d25a6c3821f0
Create Date: 2025-11-18 11:18:14.911636

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0250a4405bf8'
down_revision: Union[str, Sequence[str], None] = ('add_propeller_margin', 'd25a6c3821f0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
