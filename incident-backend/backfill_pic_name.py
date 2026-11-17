"""Standalone backfill script: Adds pic_name column and populates it.

Run with:
    python backfill_pic_name.py
"""
import sys
import psycopg2

from app.config import get_settings


def run_backfill():
    settings = get_settings()
    # Convert asyncpg connection string if needed for psycopg2
    db_url = settings.DATABASE_URL.replace("+asyncpg", "")
    print(f"Connecting to database: {db_url}")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    try:
        print("Ensuring column 'pic_name' exists in incidents...")
        cur.execute("ALTER TABLE incidents ADD COLUMN IF NOT EXISTS pic_name VARCHAR(200) NOT NULL DEFAULT ''")
        conn.commit()

        print("Backfilling empty pic_name with created_by_name...")
        cur.execute("UPDATE incidents SET pic_name = created_by_name WHERE pic_name = '' OR pic_name IS NULL")
        rows_updated = cur.rowcount
        conn.commit()
        print(f"Successfully backfilled {rows_updated} incidents.")

        cur.execute("SELECT incident_no, vessel_name, pic_name, created_by_name FROM incidents")
        print("\nCurrent incidents status:")
        for row in cur.fetchall():
            print(f"  {row[0]} | Vessel: {row[1]} | PIC: {row[2]} (Created by: {row[3]})")

    except Exception as e:
        conn.rollback()
        print(f"Error during backfill: {e}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_backfill()
