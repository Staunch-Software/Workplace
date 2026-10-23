"""One UTC clock for stored and synced times, corrected for a vessel PC with a wrong clock.

orb_utc_now() is now() plus the offset the sync measured against the VM (sync_clock, empty = 0 on the VM).
Column defaults and the updated_at trigger use it instead of now().

Revision ID: 018
Revises: 017
"""
from alembic import op

revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None

_DEFAULTS = {
    "created_at": ["vessels", "vessel_tanks", "users", "orb_uploads", "orb_upload_raw", "orb_entries", "orb_entry_quantities",
                   "orb_alerts", "orb_alert_threads", "orb_alert_attachments", "orb_notifications", "orb_feed_events",
                   "sync_queue", "sync_tombstones"],
    "updated_at": ["vessels", "vessel_tanks", "users", "orb_uploads", "orb_entries", "orb_entry_quantities", "orb_alerts",
                   "orb_alert_threads", "orb_alert_attachments", "orb_alert_thread_reads", "orb_notifications",
                   "orb_feed_events", "orb_feed_reads", "sync_state"],
    "last_read_at": ["orb_alert_thread_reads"],
    "read_at": ["orb_feed_reads"],
    "detected_at": ["orb_sync_conflicts"],
    "deleted_at": ["sync_tombstones"],
}


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS sync_clock (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            offset_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
            measured_at TIMESTAMPTZ
        )""")
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_utc_now() RETURNS timestamptz AS $$
            SELECT now() + make_interval(secs => COALESCE((SELECT offset_seconds FROM sync_clock WHERE id = 1), 0))
        $$ LANGUAGE sql STABLE""")
    for col, tables in _DEFAULTS.items():
        for t in tables:
            op.execute(f"""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '{t}' AND column_name = '{col}') THEN
                        ALTER TABLE {t} ALTER COLUMN {col} SET DEFAULT orb_utc_now();
                    END IF;
                END $$""")
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_touch_updated_at() RETURNS trigger AS $$
        BEGIN
            IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
                NEW.updated_at = orb_utc_now();
            END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql""")
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_record_tombstone() RETURNS trigger AS $$
        DECLARE vid uuid;
        BEGIN
            IF TG_ARGV[0] = 'entry_quantity' THEN
                SELECT vessel_id INTO vid FROM orb_entries WHERE id = OLD.entry_id;
            ELSE
                vid := OLD.vessel_id;
            END IF;
            IF vid IS NOT NULL THEN
                INSERT INTO sync_tombstones (id, entity_type, entity_id, vessel_id)
                VALUES (gen_random_uuid(), TG_ARGV[0], OLD.id, vid)
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET deleted_at = orb_utc_now();
            END IF;
            RETURN OLD;
        END $$ LANGUAGE plpgsql""")


def downgrade() -> None:
    for col, tables in _DEFAULTS.items():
        for t in tables:
            op.execute(f"""
                DO $$ BEGIN
                    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = '{t}' AND column_name = '{col}') THEN
                        ALTER TABLE {t} ALTER COLUMN {col} SET DEFAULT now();
                    END IF;
                END $$""")
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_touch_updated_at() RETURNS trigger AS $$
        BEGIN
            IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN NEW.updated_at = now(); END IF;
            RETURN NEW;
        END $$ LANGUAGE plpgsql""")
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_record_tombstone() RETURNS trigger AS $$
        DECLARE vid uuid;
        BEGIN
            IF TG_ARGV[0] = 'entry_quantity' THEN
                SELECT vessel_id INTO vid FROM orb_entries WHERE id = OLD.entry_id;
            ELSE
                vid := OLD.vessel_id;
            END IF;
            IF vid IS NOT NULL THEN
                INSERT INTO sync_tombstones (id, entity_type, entity_id, vessel_id)
                VALUES (gen_random_uuid(), TG_ARGV[0], OLD.id, vid)
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET deleted_at = now();
            END IF;
            RETURN OLD;
        END $$ LANGUAGE plpgsql""")
    op.execute("DROP FUNCTION IF EXISTS orb_utc_now()")
    op.execute("DROP TABLE IF EXISTS sync_clock")
