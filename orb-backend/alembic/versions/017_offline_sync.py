"""Offline (vessel) sync: outbox, cursors, conflict log, tombstones and the columns the sync reads.

Revision ID: 017
Revises: 016
"""
from alembic import op

revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None

# Tables that had no updated_at: the sync cursor needs one. Existing rows start at their creation time.
_NEEDS_UPDATED_AT = {
    "orb_alert_threads": "created_at",
    "orb_alert_attachments": "created_at",
    "orb_notifications": "created_at",
    "orb_feed_events": "created_at",
    "orb_alert_thread_reads": "last_read_at",
    "orb_feed_reads": "read_at",
}


# Rows the vessel receives: their updated_at must move on every change (trigger above).
_SYNCED_TABLES = ["orb_alerts", "orb_uploads", "orb_entries", "orb_entry_quantities", "vessels", "vessel_tanks",
                  "orb_alert_threads", "orb_alert_attachments", "orb_alert_thread_reads", "orb_notifications",
                  "orb_feed_events", "orb_feed_reads"]
# Rows the shore can hard-delete (reprocess, recalculate, a manual cleanup): the vessel must delete them too.
_TOMBSTONED = {"orb_alerts": "alert", "orb_entry_quantities": "entry_quantity", "orb_entries": "entry", "orb_uploads": "upload"}


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS sync_queue (
            id UUID PRIMARY KEY,
            entity_type VARCHAR(40) NOT NULL,
            entity_id UUID NOT NULL,
            operation VARCHAR(20) NOT NULL DEFAULT 'UPSERT',
            payload JSONB NOT NULL DEFAULT '{}'::jsonb,
            status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
            retry_count INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            processed_at TIMESTAMPTZ,
            next_retry_at TIMESTAMPTZ
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sync_queue_status ON sync_queue (status)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sync_queue_created_at ON sync_queue (created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS sync_state (
            vessel_imo VARCHAR(20) NOT NULL,
            sync_scope VARCHAR(60) NOT NULL,
            last_push_at TIMESTAMPTZ,
            last_pull_at TIMESTAMPTZ,
            active_errors JSONB,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (vessel_imo, sync_scope)
        )""")
    op.execute("""
        CREATE TABLE IF NOT EXISTS orb_sync_conflicts (
            id UUID PRIMARY KEY,
            entity_type VARCHAR(40) NOT NULL,
            entity_id UUID,
            vessel_imo VARCHAR(20),
            reason TEXT NOT NULL,
            incoming JSONB,
            existing JSONB,
            detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            resolved BOOLEAN NOT NULL DEFAULT FALSE
        )""")
    op.execute("""
        CREATE TABLE IF NOT EXISTS sync_tombstones (
            id UUID PRIMARY KEY,
            entity_type VARCHAR(40) NOT NULL,
            entity_id UUID NOT NULL,
            vessel_id UUID NOT NULL,
            deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_sync_tombstone UNIQUE (entity_type, entity_id)
        )""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sync_tombstones_vessel_id ON sync_tombstones (vessel_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_sync_tombstones_deleted_at ON sync_tombstones (deleted_at)")

    for table, seed in _NEEDS_UPDATED_AT.items():
        op.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ")
        op.execute(f"UPDATE {table} SET updated_at = {seed} WHERE updated_at IS NULL")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN updated_at SET DEFAULT now()")
        op.execute(f"ALTER TABLE {table} ALTER COLUMN updated_at SET NOT NULL")
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_updated_at ON {table} (updated_at)")

    # The pull cursors of the tables that already had updated_at.
    for table in ("orb_alerts", "orb_uploads", "orb_entries", "orb_entry_quantities", "vessels", "vessel_tanks"):
        op.execute(f"CREATE INDEX IF NOT EXISTS ix_{table}_updated_at ON {table} (updated_at)")

    # The sync cursor is updated_at and deletes need a marker. Do both in the database, so a change made outside
    # the app (pgAdmin, a cleanup script) reaches the vessels too and is not silently skipped.
    op.execute("""
        CREATE OR REPLACE FUNCTION orb_touch_updated_at() RETURNS trigger AS $$
        BEGIN
            IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
                NEW.updated_at = now();
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
                ON CONFLICT (entity_type, entity_id) DO UPDATE SET deleted_at = now();
            END IF;
            RETURN OLD;
        END $$ LANGUAGE plpgsql""")
    for table in _SYNCED_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_touch ON {table}")
        op.execute(f"CREATE TRIGGER trg_{table}_touch BEFORE UPDATE ON {table} FOR EACH ROW EXECUTE FUNCTION orb_touch_updated_at()")
    for table, kind in _TOMBSTONED.items():
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_tombstone ON {table}")
        op.execute(f"CREATE TRIGGER trg_{table}_tombstone AFTER DELETE ON {table} FOR EACH ROW EXECUTE FUNCTION orb_record_tombstone('{kind}')")

    # Feed "read / unread" becomes a state, not the presence of a row.
    op.execute("ALTER TABLE orb_feed_reads ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT TRUE")
    op.execute("ALTER TABLE orb_alerts ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1")


def downgrade() -> None:
    for table in _TOMBSTONED:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_tombstone ON {table}")
    for table in _SYNCED_TABLES:
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table}_touch ON {table}")
    op.execute("DROP FUNCTION IF EXISTS orb_record_tombstone()")
    op.execute("DROP FUNCTION IF EXISTS orb_touch_updated_at()")
    op.execute("ALTER TABLE orb_alerts DROP COLUMN IF EXISTS version")
    op.execute("ALTER TABLE orb_feed_reads DROP COLUMN IF EXISTS is_read")
    for table in ("vessel_tanks", "vessels", "orb_entry_quantities", "orb_entries", "orb_uploads", "orb_alerts"):
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_updated_at")
    for table in _NEEDS_UPDATED_AT:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_updated_at")
        op.execute(f"ALTER TABLE {table} DROP COLUMN IF EXISTS updated_at")
    for t in ("sync_tombstones", "orb_sync_conflicts", "sync_state", "sync_queue"):
        op.execute(f"DROP TABLE IF EXISTS {t}")
