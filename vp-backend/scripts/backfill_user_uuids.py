"""Link the old Vessel Performance users to their workplace accounts, keeping all their data.

Column layouts (user_column_preferences) and data-quality discussion posts (data_quality_threads) were
stored against the integer id of the old `users` table. The workplace login uses UUIDs from the control
database, so each old user is matched to a workplace user by EMAIL (case-insensitive) and the new
user_uuid / author_uuid columns are filled. The old integer columns and the old users table are not
changed or removed, so nothing is lost and the step can be repeated.

Run from vp-backend/ (dry run by default; nothing is written without --apply):

    python scripts/backfill_user_uuids.py
    python scripts/backfill_user_uuids.py --apply

    --username-fallback   also match old users whose username equals the part of a workplace email before
                          the "@" when that is unambiguous (shown in the table; only applied with this flag)
    --map OLD=EMAIL       link an old user to a named workplace account when the two have different emails
                          (repeatable), e.g. --map admin=kunalchandra@ozellar.com; used for a shared login
    --rewrite-created-by  also rewrite cp_manual_overrides.created_by from the old username to the
                          workplace full name for matched users

Old users that stay unmatched are listed at the end: create their workplace account (with the
vessel_performance permission) and run the script again. Their rows are never deleted or reassigned.
"""
import argparse
import os
import re
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from backend.config import config  # noqa: E402


@dataclass
class Match:
    old_id: int
    username: str
    email: str
    new_id: str | None
    new_name: str | None
    how: str            # 'email' | 'username' | ''
    prefs: int = 0
    threads: int = 0
    overrides: int = 0


def plan_matches(old_users: list[dict], control_users: list[dict]) -> list[Match]:
    """Pure matching step: old users (id, username, email) -> workplace users (id, email, full_name)."""
    by_email = {}
    for u in control_users:
        by_email.setdefault((u["email"] or "").strip().lower(), []).append(u)
    by_local: dict[str, list[dict]] = {}
    for u in control_users:
        local = (u["email"] or "").split("@")[0].strip().lower()
        by_local.setdefault(local, []).append(u)

    out = []
    for o in old_users:
        email = (o.get("email") or "").strip().lower()
        hit = by_email.get(email, [])
        how = "email"
        if len(hit) != 1:
            hit = by_local.get((o.get("username") or "").strip().lower(), [])
            how = "username"
        if len(hit) == 1:
            out.append(Match(o["id"], o["username"], o["email"], str(hit[0]["id"]), hit[0]["full_name"], how))
        else:
            out.append(Match(o["id"], o["username"], o["email"], None, None, ""))
    return out


def apply_manual_maps(matches: list[Match], control_users: list[dict], maps: list[str]) -> list[str]:
    """--map OLD_USERNAME=workplace-email overrides. Returns problems (unknown old user / unknown email)."""
    by_email = {(u["email"] or "").strip().lower(): u for u in control_users}
    problems = []
    for spec in maps:
        old_name, _, email = spec.partition("=")
        m = next((x for x in matches if x.username.strip().lower() == old_name.strip().lower()), None)
        target = by_email.get(email.strip().lower())
        if m is None:
            problems.append(f"--map {spec}: no old user named '{old_name}'")
        elif target is None:
            problems.append(f"--map {spec}: no active workplace user with email '{email}'")
        else:
            m.new_id, m.new_name, m.how = str(target["id"]), target["full_name"], "manual"
    return problems


def _engine(url: str):
    return create_engine(re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql+psycopg2://", url))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--username-fallback", action="store_true")
    ap.add_argument("--map", action="append", default=[], metavar="OLD=EMAIL")
    ap.add_argument("--rewrite-created-by", action="store_true")
    args = ap.parse_args()

    if not config.CONTROL_DATABASE_URL:
        print("CONTROL_DATABASE_URL is not set in .env")
        return 1
    vp = create_engine(config.DATABASE_URL)
    control = _engine(config.CONTROL_DATABASE_URL)

    with vp.connect() as c:
        try:
            old_users = [dict(r._mapping) for r in c.execute(text("SELECT id, username, email FROM users ORDER BY id"))]
        except Exception as e:
            print(f"No old users table to read ({str(e).splitlines()[0]}). Nothing to do.")
            return 0
    with control.connect() as c:
        control_users = [dict(r._mapping) for r in c.execute(text("SELECT id, email, full_name FROM users WHERE is_active"))]

    matches = plan_matches(old_users, control_users)
    for m in matches:
        if m.how == "username" and not args.username_fallback:
            m.new_id = m.new_name = None
    problems = apply_manual_maps(matches, control_users, args.map)
    if problems:
        print("\n".join(problems))
        return 1
    with vp.connect() as c:
        for m in matches:
            m.prefs = c.execute(text("SELECT count(*) FROM user_column_preferences WHERE user_id = :i"), {"i": m.old_id}).scalar()
            m.threads = c.execute(text("SELECT count(*) FROM data_quality_threads WHERE author_user_id = :i"), {"i": m.old_id}).scalar()
            m.overrides = c.execute(text("SELECT count(*) FROM cp_manual_overrides WHERE created_by = :u"), {"u": m.username}).scalar()

    print(f"{'old user':24}{'email':32}{'-> workplace user':34}{'by':9}{'prefs':>6}{'posts':>6}{'overr.':>7}")
    for m in matches:
        target = f"{m.new_name} ({m.new_id[:8]})" if m.new_id else "-- NOT MATCHED --"
        print(f"{m.username[:23]:24}{(m.email or '')[:31]:32}{target[:33]:34}{m.how:9}{m.prefs:>6}{m.threads:>6}{m.overrides:>7}")

    unmatched = [m for m in matches if not m.new_id]
    if not args.apply:
        print("\nDry run: nothing written. Add --apply to link the matched users.")
    else:
        done_prefs = done_threads = done_over = 0
        with vp.begin() as c:
            for m in matches:
                if not m.new_id:
                    continue
                # a preference row is skipped if the workplace user already has the same (source, vessel) row
                done_prefs += c.execute(text("""
                    UPDATE user_column_preferences p SET user_uuid = :u
                    WHERE p.user_id = :i AND p.user_uuid IS NULL
                      AND NOT EXISTS (SELECT 1 FROM user_column_preferences q
                                      WHERE q.user_uuid = :u AND q.source = p.source
                                        AND COALESCE(q.vessel_imo, '') = COALESCE(p.vessel_imo, ''))"""),
                    {"u": m.new_id, "i": m.old_id}).rowcount
                done_threads += c.execute(text(
                    "UPDATE data_quality_threads SET author_uuid = :u WHERE author_user_id = :i AND author_uuid IS NULL"),
                    {"u": m.new_id, "i": m.old_id}).rowcount
                if args.rewrite_created_by and m.new_name:
                    done_over += c.execute(text("UPDATE cp_manual_overrides SET created_by = :n WHERE created_by = :o"),
                                           {"n": m.new_name, "o": m.username}).rowcount
        print(f"\nApplied: {done_prefs} column preference row(s), {done_threads} discussion post(s)"
              + (f", {done_over} override row(s)" if args.rewrite_created_by else "") + " linked.")

    if unmatched:
        print(f"\n{len(unmatched)} old user(s) not matched (their data is untouched):")
        for m in unmatched:
            print(f"  - {m.username} <{m.email}>  ({m.prefs} preference rows, {m.threads} posts)")
        print("Create their workplace account with the vessel_performance permission, then run this again.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
