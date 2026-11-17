"""Standalone backfill script: Updates incident IDs to new format OZ-INC/<year>/<seq:04d>.

Run on the VM or locally with:
    python backfill_incident_ids.py
"""
import re
import sys
import psycopg2

from app.config import get_settings


def run_backfill():
    settings = get_settings()
    # Convert asyncpg connection string if needed for psycopg2
    db_url = settings.DATABASE_URL.replace("+asyncpg", "")
    print(f"Connecting to database...")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()

    try:
        cur.execute("SELECT id, incident_no, vessel_name, incident_date FROM incidents ORDER BY created_at ASC")
        rows = cur.fetchall()
        print(f"Found {len(rows)} incidents in database.")

        updated_count = 0
        for inc_id, old_no, vessel_name, inc_date in rows:
            # Check if it already matches the target format OZ-INC/YYYY/XXXX
            if re.match(r"^OZ-INC/\d{4}/\d{4}$", old_no):
                print(f"  [OK] {old_no} ({vessel_name}) already in new format.")
                continue

            # Extract year and sequence number
            # Examples handled: INC-2026-0001, OZ-INC-2026-0001, OZ-INC/2026-0001, INC-2026-1
            match = re.search(r"(\d{4})[-/](\d+)", old_no)
            if match:
                year = match.group(1)
                seq = int(match.group(2))
                new_no = f"OZ-INC/{year}/{seq:04d}"
            else:
                # Fallback to incident_date year
                year = inc_date.year if inc_date else 2026
                # Extract any number at the end
                num_match = re.search(r"(\d+)$", old_no)
                seq = int(num_match.group(1)) if num_match else (updated_count + 1)
                new_no = f"OZ-INC/{year}/{seq:04d}"

            print(f"  [UPDATE] {old_no} -> {new_no} ({vessel_name})")
            cur.execute("UPDATE incidents SET incident_no = %s WHERE id = %s", (new_no, inc_id))

            # Update feed events and notifications that may reference old_no in their title
            cur.execute("UPDATE incident_feed_events SET title = REPLACE(title, %s, %s) WHERE title LIKE %s",
                        (old_no, new_no, f"%{old_no}%"))
            cur.execute("UPDATE incident_notifications SET title = REPLACE(title, %s, %s) WHERE title LIKE %s",
                        (old_no, new_no, f"%{old_no}%"))
            updated_count += 1

        conn.commit()
        print(f"\nSuccessfully updated {updated_count} incident IDs to the new format OZ-INC/YYYY/XXXX.")

        cur.execute("SELECT incident_no, vessel_name, pic_name FROM incidents ORDER BY incident_no ASC")
        print("\nCurrent Incidents:")
        for row in cur.fetchall():
            print(f"  {row[0]} | Vessel: {row[1]} | PIC: {row[2]}")

    except Exception as e:
        conn.rollback()
        print(f"Error during backfill: {e}", file=sys.stderr)
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run_backfill()
