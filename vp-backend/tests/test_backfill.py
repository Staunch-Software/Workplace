"""Linking old Vessel Performance users to workplace accounts.

Run from vp-backend/:  python -m pytest tests/test_backfill.py
The database test needs the local databases from .env; it writes throwaway rows and removes them.
"""
import os
import re
import subprocess
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from backend.config import config            # noqa: E402
from backfill_user_uuids import plan_matches  # noqa: E402


def test_match_by_email_ignores_case():
    old = [{"id": 1, "username": "bob", "email": "Bob@Example.com"}]
    new = [{"id": uuid.uuid4(), "email": "bob@example.COM", "full_name": "Bob B"}]
    m = plan_matches(old, new)[0]
    assert m.new_id == str(new[0]["id"]) and m.how == "email"


def test_unknown_user_stays_unmatched():
    m = plan_matches([{"id": 2, "username": "ghost", "email": "ghost@example.com"}],
                     [{"id": uuid.uuid4(), "email": "other@example.com", "full_name": "O"}])[0]
    assert m.new_id is None


def test_username_fallback_only_when_unambiguous():
    new = [{"id": uuid.uuid4(), "email": "sam@a.com", "full_name": "Sam A"},
           {"id": uuid.uuid4(), "email": "sam@b.com", "full_name": "Sam B"}]
    assert plan_matches([{"id": 3, "username": "sam", "email": "x@y.com"}], new)[0].new_id is None
    one = [{"id": uuid.uuid4(), "email": "kim@a.com", "full_name": "Kim"}]
    m = plan_matches([{"id": 4, "username": "kim", "email": "x@y.com"}], one)[0]
    assert m.new_id == str(one[0]["id"]) and m.how == "username"


# ── against the local databases ────────────────────────────────────────────
def _engines():
    try:
        vp = create_engine(config.DATABASE_URL)
        ctl = create_engine(re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql+psycopg2://", config.CONTROL_DATABASE_URL))
        with vp.connect() as c:
            c.execute(text("SELECT user_uuid FROM user_column_preferences LIMIT 1"))
        with ctl.connect() as c:
            c.execute(text("SELECT 1"))
        return vp, ctl
    except Exception:
        return None


def run_script(*args):
    return subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "backfill_user_uuids.py"), *args],
                          capture_output=True, text=True, cwd=ROOT)


@pytest.mark.skipif(_engines() is None, reason="local databases not available")
def test_backfill_links_rows_and_keeps_the_old_columns():
    vp, ctl = _engines()
    with ctl.connect() as c:
        email, name = c.execute(text("SELECT email, full_name FROM users WHERE is_active ORDER BY created_at LIMIT 1")).first()
        control_id = str(c.execute(text("SELECT id FROM users WHERE email = :e"), {"e": email}).scalar())
    tag = uuid.uuid4().hex[:6]
    ids = {}
    with vp.begin() as c:
        ids["match"] = c.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES (:u, :e, 'x', 'user', true) RETURNING id"),
                                 {"u": f"zz_match_{tag}", "e": email.upper()}).scalar()
        ids["ghost"] = c.execute(text("INSERT INTO users (username, email, hashed_password, role, is_active) VALUES (:u, :e, 'x', 'user', true) RETURNING id"),
                                 {"u": f"zz_ghost_{tag}", "e": f"zz_ghost_{tag}@nowhere.invalid"}).scalar()
        imo = c.execute(text("SELECT imo_number FROM vessels LIMIT 1")).scalar()
        for who, src, v in [("match", "wni", None), ("match", "mari_apps", imo), ("ghost", "wni", None)]:
            c.execute(text("INSERT INTO user_column_preferences (user_id, source, vessel_imo, column_prefs) VALUES (:i, :s, :v, '{}')"),
                      {"i": ids[who], "s": src, "v": v})
        finding = c.execute(text("SELECT id FROM data_quality_findings LIMIT 1")).scalar()
        if finding:
            c.execute(text("INSERT INTO data_quality_threads (finding_id, author_user_id, author_name, is_internal, body) VALUES (:f, :i, 'old', true, 'zz test')"),
                      {"f": finding, "i": ids["match"]})
    try:
        def counts():
            with vp.connect() as c:
                return (
                    c.execute(text("SELECT count(*) FROM user_column_preferences WHERE user_id = :i"), {"i": ids["match"]}).scalar(),
                    c.execute(text("SELECT count(*) FROM user_column_preferences WHERE user_uuid = :u"), {"u": control_id}).scalar(),
                    c.execute(text("SELECT count(*) FROM user_column_preferences WHERE user_id = :i AND user_uuid IS NULL"), {"i": ids["ghost"]}).scalar(),
                    c.execute(text("SELECT count(*) FROM data_quality_threads WHERE author_uuid = :u AND body = 'zz test'"), {"u": control_id}).scalar(),
                )

        before = counts()
        dry = run_script()
        assert dry.returncode == 0 and "Dry run" in dry.stdout, dry.stdout + dry.stderr
        assert counts() == before, "a dry run must not write"
        assert f"zz_ghost_{tag}" in dry.stdout.split("not matched")[-1]

        applied = run_script("--apply")
        assert applied.returncode == 0 and "Applied" in applied.stdout, applied.stdout + applied.stderr
        after = counts()
        assert after[0] == 2, "old integer user_id is kept"
        assert after[1] >= 2, "both preference rows now carry the workplace user"
        assert after[2] == 1, "the unmatched user's row is untouched"
        if finding:
            assert after[3] == 1

        again = run_script("--apply")
        assert "Applied: 0 column preference row(s), 0 discussion post(s)" in again.stdout, again.stdout
        assert counts() == after, "running twice changes nothing"
    finally:
        with vp.begin() as c:
            c.execute(text("DELETE FROM data_quality_threads WHERE body = 'zz test'"))
            c.execute(text("DELETE FROM user_column_preferences WHERE user_id IN (:a, :b)"), {"a": ids["match"], "b": ids["ghost"]})
            c.execute(text("DELETE FROM users WHERE id IN (:a, :b)"), {"a": ids["match"], "b": ids["ghost"]})


@pytest.mark.skipif(_engines() is None, reason="local databases not available")
def test_init_db_is_repeatable():
    from backend.database import init_db
    init_db()
    init_db()


def test_manual_map_links_a_shared_login_to_a_named_account():
    from backfill_user_uuids import apply_manual_maps
    old = [{"id": 1, "username": "admin", "email": "admin@vesselpref.com"}]
    new = [{"id": uuid.uuid4(), "email": "Kunal@Example.com", "full_name": "Kunal C"}]
    ms = plan_matches(old, new)
    assert ms[0].new_id is None
    assert apply_manual_maps(ms, new, ["admin=kunal@example.com"]) == []
    assert ms[0].new_id == str(new[0]["id"]) and ms[0].how == "manual"
    assert apply_manual_maps(ms, new, ["nobody=kunal@example.com"])      # unknown old user is reported
    assert apply_manual_maps(ms, new, ["admin=nobody@example.com"])      # unknown email is reported
