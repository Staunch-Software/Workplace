"""
One-off backfill: set report_date = job_end_date for every Half-Yearly and
Yearly report (Cargo Hold / Water Ballast Tank).

The Overview shows the date the job was actually completed for these two
frequencies, and files the report under the period of that date. Rows saved
earlier used the SmartPAL due date as a fallback (due_date:fallback), which
can sit in the wrong half-year / year (e.g. due 03-Feb-2027, done 11-Aug-2026).

Only touches report_date / report_date_source. No SmartPAL, no Playwright,
no blob access.

Usage:
    python backfill_halfyearly_yearly_dates.py              # DRY RUN: list what would change
    python backfill_halfyearly_yearly_dates.py --apply      # write the changes
    python backfill_halfyearly_yearly_dates.py --vessel="AM KIRTI" [--apply]
"""
import asyncio
import sys
from collections import Counter

from sqlalchemy.future import select

from app.core.database import SessionLocal
from app.models.report import Report

SOURCE = "job_end_date:backfill"
FREQS = ("half-yearly", "half_yearly", "half yearly", "yearly")


def _arg_value(flag):
    prefix = f"{flag}="
    for a in sys.argv[1:]:
        if a.startswith(prefix):
            return a[len(prefix):]
    return None


async def main():
    apply = "--apply" in sys.argv
    vessel = _arg_value("--vessel")
    async with SessionLocal() as db:
        rows = (await db.execute(select(Report))).scalars().all()
        rows = [r for r in rows if (r.frequency or "").strip().lower() in FREQS]
        if vessel:
            rows = [r for r in rows if vessel.lower() in (r.vessel_name or "").lower()]

        changed, skipped_no_end, already = [], 0, 0
        for r in rows:
            if r.job_end_date is None:
                skipped_no_end += 1
            elif r.report_date is not None and r.report_date.date() == r.job_end_date.date():
                already += 1
            else:
                changed.append(r)

        print(f"{len(rows)} half-yearly/yearly reports checked: {already} already correct, "
              f"{len(changed)} to change, {skipped_no_end} skipped (no job_end_date).")
        print("Current report_date_source of rows to change:", dict(Counter(r.report_date_source for r in changed)))
        for r in sorted(changed, key=lambda x: (x.vessel_name or "", x.report_code or "", x.job_order_no or ""))[:60]:
            old = r.report_date.date() if r.report_date else None
            print(f"  {r.vessel_name} {r.report_code} {r.job_order_no} {r.frequency}: {old} -> {r.job_end_date.date()}")
        if len(changed) > 60:
            print(f"  ... and {len(changed) - 60} more")

        if not apply:
            print("DRY RUN -- nothing written. Re-run with --apply to save.")
            return
        for r in changed:
            r.report_date = r.job_end_date
            r.report_date_source = SOURCE
        await db.commit()
        print(f"Updated {len(changed)} reports.")


if __name__ == "__main__":
    asyncio.run(main())
