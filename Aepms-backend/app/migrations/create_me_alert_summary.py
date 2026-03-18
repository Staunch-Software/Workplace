"""
Database Migration: Create MEAlertSummary table and backfill data
Run once using:  python app/migrations/create_me_alert_summary.py
"""

from app.database import engine, Base, SessionLocal
from app.models import MEAlertSummary, MonthlyReportHeader
from app.report_processor import update_me_alert_summary

def create_me_alert_summary_table():
    """Create MEAlertSummary table if not exists."""
    try:
        Base.metadata.create_all(bind=engine, tables=[MEAlertSummary.__table__])
        print("✅ MEAlertSummary table created or already exists.")
    except Exception as e:
        print(f"❌ Failed to create MEAlertSummary table: {e}")

def backfill_me_alert_summaries():
    """Backfill ME alert summary data for all existing reports."""
    db = SessionLocal()
    try:
        all_reports = db.query(MonthlyReportHeader).all()
        print(f"📄 Found {len(all_reports)} existing reports.")
        for report in all_reports:
            update_me_alert_summary(
                db=db,
                report_id=report.report_id,
                vessel_name=getattr(report.vessel, "vessel_name", None),
                imo_number=report.imo_number,
                report_date=report.report_date,
                report_month=report.report_month,
            )
        db.commit()
        print(f"✅ Backfilled {len(all_reports)} MEAlertSummary records.")
    except Exception as e:
        db.rollback()
        print(f"❌ Backfill error: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    print("🚀 Starting MEAlertSummary migration...")
    create_me_alert_summary_table()
    backfill_me_alert_summaries()
    print("🏁 Migration completed.")
