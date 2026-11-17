"""Renumber all incidents sequentially from 0001 based on creation order (created_at ASC),
and reset the incident_no_seq database sequence accordingly.

Run on the VM with:
    python backfill_incident_ids.py
"""
import sys
import psycopg2
from app.config import get_settings


def run_renumber():
    settings = get_settings()
    db_url = settings.DATABASE_URL.replace("+asyncpg", "")
    print("Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    try:
        # Fetch all incidents ordered by creation timestamp
        cur.execute("""
            SELECT id, incident_no, vessel_name, incident_date, created_at
            FROM incidents
            ORDER BY created_at ASC, incident_date ASC, incident_no ASC
        """)
        rows = cur.fetchall()
        total = len(rows)
        print(f"Found {total} incident(s) in database.\n")

        if total == 0:
            print("No incidents to renumber. Resetting sequence to 1...")
            cur.execute("SELECT setval('incident_no_seq', 1, false)")
            conn.commit()
            return

        # Prepare mapping of old_no -> new_no
        mapping = []
        for idx, (inc_id, old_no, vessel_name, inc_date, created_at) in enumerate(rows, start=1):
            year = inc_date.year if inc_date else (created_at.year if created_at else 2026)
            new_no = f"OZ-INC/{year}/{idx:04d}"
            mapping.append((inc_id, old_no, new_no, vessel_name))

        # Pass 1: Set temporary IDs to avoid PostgreSQL UNIQUE constraint collision (within VARCHAR(30))
        print("Step 1: Setting temporary IDs to prevent unique constraint conflicts...")
        for idx, (inc_id, old_no, new_no, vessel_name) in enumerate(mapping, start=1):
            temp_no = f"TMP/{idx:04d}"
            cur.execute("UPDATE incidents SET incident_no = %s WHERE id = %s", (temp_no, inc_id))

        # Pass 2: Assign sequential numbers based on creation order
        print("Step 2: Assigning clean sequential IDs (1, 2, 3, 4, ...)...")
        for inc_id, old_no, new_no, vessel_name in mapping:
            cur.execute("UPDATE incidents SET incident_no = %s WHERE id = %s", (new_no, inc_id))
            print(f"  [RENUMBER] {old_no} -> {new_no} ({vessel_name})")

            # Update feed event & notification titles that reference old_no
            if old_no != new_no:
                cur.execute(
                    "UPDATE incident_feed_events SET title = REPLACE(title, %s, %s) WHERE title LIKE %s",
                    (old_no, new_no, f"%{old_no}%"),
                )
                cur.execute(
                    "UPDATE incident_notifications SET title = REPLACE(title, %s, %s) WHERE title LIKE %s",
                    (old_no, new_no, f"%{old_no}%"),
                )

        # Step 3: Reset database sequence so next created incident gets (total + 1)
        print(f"\nStep 3: Resetting sequence incident_no_seq to {total}...")
        cur.execute("SELECT setval('incident_no_seq', %s, true)", (total,))
        conn.commit()

        print("\nAll incidents successfully renumbered!")
        print("-" * 65)
        print(f"{'Incident ID':<20} | {'Vessel Name':<20} | {'PIC Name'}")
        print("-" * 65)
        cur.execute("SELECT incident_no, vessel_name, pic_name FROM incidents ORDER BY incident_no ASC")
        for inc_no, vessel, pic in cur.fetchall():
            print(f"{inc_no:<20} | {vessel:<20} | {pic}")
        print("-" * 65)
        print(f"Next created incident will be assigned: OZ-INC/2026/{total + 1:04d}\n")

    except Exception as e:
        conn.rollback()
        print(f"Error during renumbering: {e}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_renumber()
