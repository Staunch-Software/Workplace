"""
Database Migration: Create MEAlertSummary table and backfill data
Run once using:  python app/migrations/create_me_alert_summary.py
"""

from app.database import Base, AsyncSessionLocal
from app.config import get_sync_database_url
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import asyncio
from app.models import MEAlertSummary, MonthlyReportHeader
from app.report_processor import update_me_alert_summary

def create_me_alert_summary_table():
    sync_engine = create_engine(get_sync_database_url())
    """Create MEAlertSummary table if not exists."""
    try:
        Base.metadata.create_all(bind=sync_engine, tables=[MEAlertSummary.__table__])
        print("✅ MEAlertSummary table created or already exists.")
    except Exception as e:
        print(f"❌ Failed to create MEAlertSummary table: {e}")

async def backfill_me_alert_summaries():
    async with AsyncSessionLocal() as db:
        try:
            from sqlalchemy import select
            result = await db.execute(select(MonthlyReportHeader))
            all_reports = result.scalars().all()
            print(f"📄 Found {len(all_reports)} existing reports.")
            for report in all_reports:
                await update_me_alert_summary(
                    db=db,
                    report_id=report.report_id,
                    vessel_name=getattr(report.vessel, "vessel_name", None),
                    imo_number=report.imo_number,
                    report_date=report.report_date,
                    report_month=report.report_month,
                )
            await db.commit()
            print(f"✅ Backfilled {len(all_reports)} MEAlertSummary records.")
        except Exception as e:
            await db.rollback()
            print(f"❌ Backfill error: {e}")

if __name__ == "__main__":
    print("🚀 Starting MEAlertSummary migration...")
    create_me_alert_summary_table()
    asyncio.run(backfill_me_alert_summaries())
    print("🏁 Migration completed.")
