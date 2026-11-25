# ===========================================================================
# backend/data_quality/scan_recent.py
#
# Read-only scan: which data-quality check fires on which date, over the last N days
# (default 60). Use it to pick a date that is sure to produce each kind of mail for
# test_send.py. Writes nothing (no findings, no emails).
#
#   python -m backend.data_quality.scan_recent            # last 60 days
#   python -m backend.data_quality.scan_recent 30         # last 30 days
#
# Prints, per rule, the total reports flagged and the 3 dates with the most, and
# ends with ready-to-run test_send commands.
# ===========================================================================
import sys
from collections import Counter, defaultdict
from datetime import date, timedelta

from sqlalchemy import text

from ..database import SessionLocal
from .checks import run_checks_for_date
from .daily_job import RULE_LABELS


def main():
    days = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    since = date.today() - timedelta(days=days)
    db = SessionLocal()
    try:
        names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}
        pairs = db.execute(text(
            "SELECT DISTINCT vessel_imo, log_date::date FROM expanded_mariapps_data "
            "WHERE log_date::date >= :since AND log_date::date < :today"),
            {"since": since, "today": date.today()}).fetchall()
        print(f"Scanning {len(pairs)} vessel-days from {since} to {date.today() - timedelta(days=1)} ...")
        total = Counter()
        by_date = defaultdict(Counter)            # rule -> {date: reports}
        vessels = defaultdict(lambda: defaultdict(set))   # rule -> {date: {vessel names}}
        for imo, d in pairs:
            for (src, rule), detail in run_checks_for_date(db, imo, d).items():
                n = detail.get("count", 1)
                total[rule] += n
                by_date[rule][d] += n
                vessels[rule][d].add(names.get(imo, imo))
        print()
        for rule, n in total.most_common():
            top = by_date[rule].most_common(3)
            print(f"{rule:28} {n:>5} reports   {RULE_LABELS.get(rule, '')}")
            for d, c in top:
                print(f"      {d}  {c:>3}  {', '.join(sorted(vessels[rule][d]))}")
        missing = [r for r in RULE_LABELS if r not in total]
        if missing:
            print("\nNo finding in this window for: " + ", ".join(missing))
        print("\nTest commands (each sends only to the test address):")
        shown = set()
        for rule in total:
            d = by_date[rule].most_common(1)[0][0]
            if d not in shown:
                shown.add(d)
                print(f"  python -m backend.data_quality.test_send techdevops@ozellar.com {d}")
        print("\nDone. Read-only: nothing was written or sent.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
