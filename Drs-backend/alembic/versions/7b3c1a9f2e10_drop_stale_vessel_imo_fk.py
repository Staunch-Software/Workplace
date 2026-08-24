"""Drop stale defects.vessel_imo -> vessels.imo FK

Vessel management moved to the shared control-plane database
(workplace_control) a while ago; the local `vessels` table in this
module's own database is no longer kept in sync when new vessels are
added there. The leftover FK constraint from the initial schema then
rejects defect creation for any vessel not present in the stale local
mirror (e.g. "FK violation ... Key (vessel_imo)=(...) is not present
in table vessels"), even though the vessel is valid and visible in the
UI (which reads from the control DB).

This migration removes the now-incorrect constraint. The local
`vessels` table itself is left in place (some other code may still
reference it) but is no longer enforced against `defects.vessel_imo`.

Revision ID: 7b3c1a9f2e10
Revises: 4a8f003a6574
Create Date: 2026-08-24
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '7b3c1a9f2e10'
down_revision: Union[str, Sequence[str], None] = '4a8f003a6574'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint('defects_vessel_imo_fkey', 'defects', type_='foreignkey')


def downgrade() -> None:
    """Downgrade schema."""
    op.create_foreign_key(
        'defects_vessel_imo_fkey',
        'defects', 'vessels',
        ['vessel_imo'], ['imo'],
        ondelete='CASCADE',
    )
