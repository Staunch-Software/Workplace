"""
Copy AMNS POLAR's Wartsila FOS reports from noon_report_data + analysis_data into
expanded_wni_data (what the Logbook page reads). Safe to re-run.

    venv/bin/python -m scripts.sync_polar_wartsila_expanded
"""
from backend.database import SessionLocal
from backend.pipeline.polar_wartsila_sync import (
    POLAR_IMO,
    polar_wartsila_rows_exist,
    sync_polar_wartsila,
)


def main():
    db = SessionLocal()
    try:
        before = polar_wartsila_rows_exist(db)
        count = sync_polar_wartsila(db)
        db.commit()
        print(f"AMNS POLAR ({POLAR_IMO}): synced {count} Wartsila row(s) "
              f"(expanded_wni_data had Polar Wartsila rows before: {before}).")
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
