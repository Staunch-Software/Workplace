import asyncio, sys, os, logging
sys.path.insert(0, '.')
from dotenv import load_dotenv
load_dotenv('.env')
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-8s %(message)s')

from app.core.database import SessionLocal
from app.models.report import ReportConfig, Report
from app.scraper.smartpal_scraper import _next_cycle_expected_from_report_date
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from datetime import datetime

async def dry_run():
    print()
    print('=== CRON DRY-RUN: Checking which reports are due today ===')
    async with SessionLocal() as db:
        result = await db.execute(select(ReportConfig))
        configs = result.scalars().all()
        print(f'Total configs in DB : {len(configs)}')

        now_date = datetime.utcnow().date()
        print(f'Today (UTC)         : {now_date}')
        print()

        would_scrape = []
        would_skip   = []
        missing_attachment_count = 0
        early_by_report_date_count = 0

        for c in configs:
            r2 = await db.execute(
                select(Report)
                .where(Report.vessel_imo == c.vessel_imo, Report.report_code == c.report_code, Report.job_order_no != 'N/A')
                .order_by(Report.created_at.desc())
                .options(selectinload(Report.attachments))
            )
            latest = r2.scalars().first()

            if not latest:
                reason = 'Never scraped'
                would_scrape.append((c.vessel_name, c.report_code, reason))
            elif latest.job_status == 'PENDING':
                due_str = str(latest.due_date.date()) if latest.due_date else '?'
                reason = 'Still PENDING (due ' + due_str + ')'
                would_scrape.append((c.vessel_name, c.report_code, reason))
            elif latest.job_status == 'COMPLETED' and not latest.attachments:
                retries = getattr(latest, "attachment_retry_count", 0) or 0
                if retries < 2:
                    reason = 'COMPLETED but missing attachments (job ' + str(latest.job_order_no) + ', retry ' + str(retries + 1) + '/2)'
                    would_scrape.append((c.vessel_name, c.report_code, reason))
                    missing_attachment_count += 1
                else:
                    would_skip.append((c.vessel_name, c.report_code, 'Max attachment retries reached (' + str(retries) + '/2)'))
            elif not latest.next_due_date:
                reason = 'No next_due_date set (fallback)'
                would_scrape.append((c.vessel_name, c.report_code, reason))
            elif latest.next_due_date.date() <= now_date:
                reason = 'Overdue since ' + str(latest.next_due_date.date())
                would_scrape.append((c.vessel_name, c.report_code, reason))
            else:
                expected_next = _next_cycle_expected_from_report_date(latest.report_date, c.frequency)
                if expected_next and expected_next <= now_date:
                    reason = ('Early via report_date ' + str(latest.report_date.date()) +
                               ' + ' + c.frequency + ' (next_due_date not yet reached: ' +
                               str(latest.next_due_date.date()) + ')')
                    would_scrape.append((c.vessel_name, c.report_code, reason))
                    early_by_report_date_count += 1
                else:
                    would_skip.append((c.vessel_name, c.report_code, latest.next_due_date.date()))

        print('WILL SCRAPE: ' + str(len(would_scrape)) + ' reports (' + str(missing_attachment_count) +
              ' due to missing attachments, ' + str(early_by_report_date_count) + ' due early via report_date)')
        for v, r, reason in would_scrape[:15]:
            print('  [' + v + '] ' + r[:45].ljust(45) + ' <- ' + reason)
        if len(would_scrape) > 15:
            print('  ... and ' + str(len(would_scrape) - 15) + ' more')

        print()
        print('WILL SKIP: ' + str(len(would_skip)) + ' reports (not yet due)')
        for v, r, nd in would_skip[:5]:
            print('  [' + v + '] ' + r[:45].ljust(45) + ' next due: ' + str(nd))
        if len(would_skip) > 5:
            print('  ... and ' + str(len(would_skip) - 5) + ' more')

        print()
        print('=== Cron logic check COMPLETE ===')

asyncio.run(dry_run())
