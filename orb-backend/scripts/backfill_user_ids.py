"""One-time backfill: point ORB's user columns at workplace user ids.

Before the integration, ORB rows referenced ORB's own `users` table. After
migration 010 those columns hold workplace (control DB) user ids instead. This
script rewrites the historical rows so they use workplace ids too, matching
each old ORB user to a workplace user by email (case-insensitive).

Columns rewritten:
    orb_uploads.uploaded_by, orb_alerts.resolved_by, vessels.created_by

Safe by design:
  * Dry run by default - prints the mapping and the row counts, changes nothing.
  * Only rows whose current value is an old ORB user id are touched; rows
    already holding a workplace id are left alone, so re-running is harmless.
  * ORB users with no email match are listed and their rows are left unchanged
    (the API still resolves their name from ORB's old `users` table).
  * Refuses to run until migration 010 (which drops the foreign keys to ORB's
    `users` table) has been applied.
  * --apply runs every update in one transaction: all or nothing.

Usage (from orb-backend/, with the same .env the API uses):
    python scripts/backfill_user_ids.py              # dry run
    python scripts/backfill_user_ids.py --apply      # write the changes
    python scripts/backfill_user_ids.py --report mapping.csv

Take a database backup before running with --apply.
"""
import argparse
import asyncio
import csv
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.config import get_settings  # noqa: E402

TARGETS = [
    ("orb_uploads", "uploaded_by"),
    ("orb_alerts", "resolved_by"),
    ("vessels", "created_by"),
]


async def main(apply: bool, report_path: str | None) -> int:
    settings = get_settings()
    orb = create_async_engine(settings.DATABASE_URL)
    ctl = create_async_engine(settings.CONTROL_DATABASE_URL)

    async with orb.connect() as c:
        blocking = (await c.execute(text(
            "SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint "
            "WHERE contype = 'f' AND confrelid = 'users'::regclass AND conrelid::regclass::text <> 'users'"
        ))).all()
        if blocking:
            print("Migration 010 has not been applied: these foreign keys still point at ORB's users table:")
            for tbl, name in blocking:
                print(f"  {tbl}.{name}")
            print("Run `alembic upgrade head` first, then re-run this script.")
            return 1

        orb_users = (await c.execute(text("SELECT id, email, name FROM users ORDER BY email"))).all()

    async with ctl.connect() as c:
        control_users = (await c.execute(text("SELECT id, email, full_name FROM users"))).all()
    control_by_email = {str(r.email).strip().lower(): r for r in control_users}
    control_ids = {r.id for r in control_users}

    mapping = []      # (orb_user, control_user)
    unmatched = []    # orb_user
    for u in orb_users:
        match = control_by_email.get(str(u.email).strip().lower())
        if match is None:
            unmatched.append(u)
        elif match.id == u.id:
            continue  # same id on both sides, nothing to rewrite
        else:
            mapping.append((u, match))

    print(f"ORB users: {len(orb_users)} | workplace users: {len(control_users)}")
    print(f"Matched by email: {len(mapping)} | no match: {len(unmatched)}")

    async with orb.connect() as c:
        rows_for = {}
        for u, m in mapping:
            counts = {}
            for table, col in TARGETS:
                n = (await c.execute(text(f"SELECT count(*) FROM {table} WHERE {col} = :id"), {"id": u.id})).scalar()
                counts[f"{table}.{col}"] = n
            rows_for[u.id] = counts
        unmatched_counts = {}
        for u in unmatched:
            counts = {}
            for table, col in TARGETS:
                n = (await c.execute(text(f"SELECT count(*) FROM {table} WHERE {col} = :id"), {"id": u.id})).scalar()
                counts[f"{table}.{col}"] = n
            unmatched_counts[u.id] = counts

    print("\nWill rewrite:" if apply else "\nWould rewrite (dry run):")
    total = 0
    for u, m in mapping:
        counts = rows_for[u.id]
        subtotal = sum(counts.values())
        total += subtotal
        detail = ", ".join(f"{k}={v}" for k, v in counts.items() if v) or "no rows reference this user"
        print(f"  {u.email}: ORB {u.id} -> workplace {m.id}  [{detail}]")
    print(f"  total rows: {total}")

    if unmatched:
        print("\nNo workplace user with the same email (rows left unchanged):")
        for u in unmatched:
            counts = unmatched_counts[u.id]
            detail = ", ".join(f"{k}={v}" for k, v in counts.items() if v) or "no rows"
            print(f"  {u.email} ({u.name}): {detail}")

    if report_path:
        with open(report_path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["orb_user_id", "email", "name", "workplace_user_id", "status"] + [f"{t}.{c}" for t, c in TARGETS])
            for u, m in mapping:
                w.writerow([u.id, u.email, u.name, m.id, "matched"] + [rows_for[u.id][f"{t}.{c}"] for t, c in TARGETS])
            for u in unmatched:
                w.writerow([u.id, u.email, u.name, "", "no match"] + [unmatched_counts[u.id][f"{t}.{c}"] for t, c in TARGETS])
        print(f"\nReport written to {report_path}")

    if not apply:
        print("\nDry run only. Re-run with --apply to write these changes.")
        return 0
    if not mapping:
        print("\nNothing to apply.")
        return 0

    async with orb.begin() as c:
        updated = 0
        for u, m in mapping:
            if m.id not in control_ids:
                raise RuntimeError("workplace user disappeared during the run")
            for table, col in TARGETS:
                res = await c.execute(
                    text(f"UPDATE {table} SET {col} = :new WHERE {col} = :old"),
                    {"new": m.id, "old": u.id},
                )
                updated += res.rowcount or 0
    print(f"\nApplied: {updated} rows updated in one transaction.")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill ORB user columns with workplace user ids.")
    parser.add_argument("--apply", action="store_true", help="write the changes (default is a dry run)")
    parser.add_argument("--report", metavar="CSV", help="also write the mapping to a CSV file")
    args = parser.parse_args()
    sys.exit(asyncio.run(main(args.apply, args.report)))
