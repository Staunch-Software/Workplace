"""Alert and threshold configuration, equipment register, tank/vessel master data, upload link on batch alerts.

Revision ID: 017
Revises: 016
"""
from alembic import op

from app.services.alert_catalog import CATALOG, BUILT, PARAMS

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def _q(value):
    return "NULL" if value is None else "'" + str(value).replace("'", "''") + "'"


def upgrade() -> None:
    # ── Alert configuration: one row per alert of the register, withdrawn ones disabled not deleted ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_alert_config (
            alert_code VARCHAR(50) PRIMARY KEY,
            alert_no INTEGER NOT NULL,
            name VARCHAR(200) NOT NULL,
            category VARCHAR(60) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            scope VARCHAR(30) NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT TRUE,
            in_alerts_filter BOOLEAN NOT NULL DEFAULT TRUE,
            built BOOLEAN NOT NULL DEFAULT FALSE,
            updated_by UUID,
            updated_by_name VARCHAR(200),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    for no, code, name, category, severity, scope, enabled, in_filter in CATALOG:
        op.execute(
            "INSERT INTO orb_alert_config (alert_code, alert_no, name, category, severity, scope, enabled, in_alerts_filter, built) "
            f"VALUES ({_q(code)}, {no}, {_q(name)}, {_q(category)}, {_q(severity)}, {_q(scope)}, "
            f"{str(enabled).upper()}, {str(in_filter).upper()}, {str(code in BUILT).upper()}) "
            "ON CONFLICT (alert_code) DO NOTHING"
        )

    # ── Threshold parameters: a row with vessel_id NULL is the default, a row with a vessel is its override ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_threshold_params (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            param_code VARCHAR(60) NOT NULL,
            alert_code VARCHAR(50) NOT NULL REFERENCES orb_alert_config(alert_code),
            label VARCHAR(300) NOT NULL,
            comparator VARCHAR(4) NOT NULL,
            value DOUBLE PRECISION NOT NULL,
            unit VARCHAR(10) NOT NULL DEFAULT '',
            vessel_id UUID REFERENCES vessels(id) ON DELETE CASCADE,
            effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
            approved_by UUID,
            approved_by_name VARCHAR(200),
            note TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_threshold_default ON orb_threshold_params (param_code) WHERE vessel_id IS NULL")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_threshold_override ON orb_threshold_params (param_code, vessel_id) WHERE vessel_id IS NOT NULL")
    for code, alert_code, label, comparator, value, unit, note in PARAMS:
        op.execute(
            "INSERT INTO orb_threshold_params (param_code, alert_code, label, comparator, value, unit, approved_by_name, note) "
            f"VALUES ({_q(code)}, {_q(alert_code)}, {_q(label)}, {_q(comparator)}, {value}, {_q(unit)}, "
            f"'ORB alert review', {_q(note)}) ON CONFLICT DO NOTHING"
        )
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_threshold_history (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            param_code VARCHAR(60) NOT NULL,
            vessel_id UUID,
            old_value DOUBLE PRECISION,
            new_value DOUBLE PRECISION,
            changed_by UUID,
            changed_by_name VARCHAR(200),
            note TEXT,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_threshold_history_param ON orb_threshold_history (param_code, changed_at DESC)")

    # ── Equipment register (pumps, OWS, 15 ppm OCM) ──
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_equipment (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            vessel_id UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
            equipment_type VARCHAR(20) NOT NULL,
            name VARCHAR(200) NOT NULL,
            make_model VARCHAR(200),
            serial_no VARCHAR(100),
            rated_capacity_m3_hr DOUBLE PRECISION,
            linked_tank_id UUID REFERENCES vessel_tanks(id) ON DELETE SET NULL,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_equipment_vessel ON orb_equipment (vessel_id)")
    # Pump rates that were typed into a tank carry over: one pump per tank that had a rate.
    op.execute("""
        INSERT INTO orb_equipment (vessel_id, equipment_type, name, rated_capacity_m3_hr, linked_tank_id)
        SELECT t.vessel_id, 'BILGE_PUMP', 'Pump of ' || t.tank_name, t.bilge_pump_capacity_m3_per_hr, t.id
        FROM vessel_tanks t
        WHERE t.bilge_pump_capacity_m3_per_hr IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM orb_equipment e WHERE e.linked_tank_id = t.id)
    """)

    # ── Master data on the tank register and the vessel ──
    op.execute("ALTER TABLE vessel_tanks ADD COLUMN IF NOT EXISTS tank_name_iopp VARCHAR(200)")
    op.execute("ALTER TABLE vessel_tanks ADD COLUMN IF NOT EXISTS iopp_section_ref VARCHAR(30)")
    op.execute("ALTER TABLE vessel_tanks ADD COLUMN IF NOT EXISTS effective_from DATE")
    op.execute("ALTER TABLE vessel_tanks ADD COLUMN IF NOT EXISTS effective_to DATE")
    op.execute("ALTER TABLE vessels ADD COLUMN IF NOT EXISTS flag_state VARCHAR(100)")
    op.execute("ALTER TABLE vessels ADD COLUMN IF NOT EXISTS flag_official_language VARCHAR(50)")
    op.execute("ALTER TABLE vessels ADD COLUMN IF NOT EXISTS fuel_grades JSONB")

    # ── Batch alerts belong to the upload that raised them, so a later upload can raise them again ──
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS upload_id UUID REFERENCES orb_uploads(id) ON DELETE SET NULL")
    op.execute("CREATE INDEX IF NOT EXISTS ix_orb_alerts_upload_id ON orb_alerts (upload_id)")
    op.execute("""
        UPDATE orb_alerts a SET upload_id = u.id
        FROM orb_uploads u
        WHERE a.entry_id IS NULL AND a.upload_id IS NULL AND a.vessel_id = u.vessel_id
          AND a.created_at >= u.created_at
          AND a.created_at <= COALESCE(u.updated_at, u.created_at) + interval '10 minutes'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_orb_alerts_upload_id")
    op.execute("ALTER TABLE orb_alerts DROP COLUMN IF EXISTS upload_id")
    for col in ("fuel_grades", "flag_official_language", "flag_state"):
        op.execute(f"ALTER TABLE vessels DROP COLUMN IF EXISTS {col}")
    for col in ("effective_to", "effective_from", "iopp_section_ref", "tank_name_iopp"):
        op.execute(f"ALTER TABLE vessel_tanks DROP COLUMN IF EXISTS {col}")
    op.execute("DROP TABLE IF EXISTS orb_equipment")
    op.execute("DROP TABLE IF EXISTS orb_threshold_history")
    op.execute("DROP TABLE IF EXISTS orb_threshold_params")
    op.execute("DROP TABLE IF EXISTS orb_alert_config")
