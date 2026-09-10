
"""Merge propeller margin and generator refactor branches

Revision ID: 0250a4405bf8
Revises: add_propeller_margin
Create Date: 2025-11-18 11:18:14.911636

NOTE: originally a merge of ('add_propeller_margin', 'd25a6c3821f0'). The
'd25a6c3821f0' revision was never committed to this repo (confirmed via
full git history search across all branches) and its upgrade()/downgrade()
here were both no-ops, so dropping it from down_revision loses no schema
changes — it only repairs the broken revision chain (alembic heads/history
were raising KeyError: 'd25a6c3821f0').

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0250a4405bf8'
down_revision: Union[str, Sequence[str], None] = 'add_propeller_margin'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
