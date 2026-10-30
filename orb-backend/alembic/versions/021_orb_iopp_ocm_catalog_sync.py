"""IOPP capacity on tanks, 15 ppm monitor records (alerts 25, 23), catalog sync for the alerts built since 019.

Revision ID: 021
Revises: 020
"""
from alembic import op

from app.services.alert_catalog import BUILT, PARAMS

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def _q(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def upgrade() -> None:
    op.execute("ALTER TABLE vessel_tanks ADD COLUMN IF NOT EXISTS iopp_capacity_m3 DOUBLE PRECISION")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_ocm_imports (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
            filename VARCHAR(300) NOT NULL,
            row_count INTEGER NOT NULL DEFAULT 0,
            period_from TIMESTAMP,
            period_to TIMESTAMP,
            imported_by UUID,
            imported_by_name VARCHAR(200),
            imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_ocm_imports_vessel ON orb_ocm_imports (vessel_id)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_ocm_records (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
            import_id UUID NOT NULL REFERENCES orb_ocm_imports(id) ON DELETE CASCADE,
            recorded_at TIMESTAMP NOT NULL,
            discharging BOOLEAN NOT NULL,
            ppm DOUBLE PRECISION,
            status_text VARCHAR(200)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_ocm_records_vessel_time ON orb_ocm_records (vessel_id, recorded_at)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_ocm_records_import ON orb_ocm_records (import_id)")

    # alerts built since migration 019 and thresholds added since
    codes = ", ".join(_q(c) for c in sorted(BUILT))
    op.execute(f"UPDATE orb_alert_config SET built = TRUE WHERE alert_code IN ({codes})")
    for code, alert_code, label, comparator, value, unit, note in PARAMS:
        op.execute(
            "INSERT INTO orb_threshold_params (param_code, alert_code, label, comparator, value, unit, approved_by_name, note) "
            f"VALUES ({_q(code)}, {_q(alert_code)}, {_q(label)}, {_q(comparator)}, {value}, {_q(unit)}, "
            f"'ORB alert review', {_q(note)}) ON CONFLICT DO NOTHING"
        )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS orb_ocm_records")
    op.execute("DROP TABLE IF EXISTS orb_ocm_imports")
    op.execute("ALTER TABLE vessel_tanks DROP COLUMN IF EXISTS iopp_capacity_m3")
