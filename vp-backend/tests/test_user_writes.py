"""Rows written on behalf of a workplace user carry the workplace id (uuid), not the old integer id.

Run from vp-backend/:  python -m pytest tests/test_user_writes.py
Writes throwaway rows to the local database from .env and removes them.
"""
import os
import sys
import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import auth                       # noqa: E402
from backend.config import config              # noqa: E402


def _engine():
    try:
        e = create_engine(config.DATABASE_URL)
        with e.connect() as c:
            c.execute(text("SELECT user_uuid FROM user_column_preferences LIMIT 1"))
            c.execute(text("SELECT author_uuid FROM data_quality_threads LIMIT 1"))
        return e
    except Exception:
        return None


ENGINE = _engine()
pytestmark = pytest.mark.skipif(ENGINE is None, reason="local database not available")


@pytest.fixture
def client():
    from app.main import app
    me = auth.User(id=uuid.uuid4(), full_name="Writer Test", email="w@example.com", role="ADMIN")
    app.dependency_overrides[auth.get_current_user] = lambda: me
    yield TestClient(app), me
    app.dependency_overrides.clear()
    with ENGINE.begin() as c:
        c.execute(text("DELETE FROM user_column_preferences WHERE user_uuid = :u"), {"u": str(me.id)})
        c.execute(text("DELETE FROM data_quality_threads WHERE author_uuid = :u"), {"u": str(me.id)})


def test_column_preferences_are_saved_per_workplace_user(client):
    c, me = client
    prefs = {"visible": ["a", "b"], "order": ["b", "a"]}
    assert c.put("/api/v1/column-prefs", json={"source": "wni", "vessel_imo": None, "column_prefs": prefs}).status_code == 200
    assert c.get("/api/v1/column-prefs", params={"source": "wni"}).json() == prefs
    # saving again updates the same row (the unique key is (user_uuid, source, vessel))
    prefs2 = {"visible": ["a"], "order": ["a"]}
    c.put("/api/v1/column-prefs", json={"source": "wni", "vessel_imo": None, "column_prefs": prefs2})
    with ENGINE.connect() as db:
        rows = db.execute(text("SELECT user_id, column_prefs FROM user_column_preferences WHERE user_uuid = :u"), {"u": str(me.id)}).all()
    assert len(rows) == 1 and rows[0][0] is None and rows[0][1] == prefs2


def test_discussion_posts_record_the_workplace_user(client):
    c, me = client
    with ENGINE.begin() as db:
        imo = db.execute(text("SELECT imo_number FROM vessels LIMIT 1")).scalar()
        fid = db.execute(text("""INSERT INTO data_quality_findings (vessel_imo, source_id, report_date, rule_key, status, notify_count)
                                 VALUES (:i, 'wni', :d, :r, 'open', 0) RETURNING id"""),
                         {"i": imo, "d": date(2020, 1, 1), "r": "zz_test_" + uuid.uuid4().hex[:6]}).scalar()
    try:
        r = c.post(f"/api/v1/data-quality/findings/{fid}/threads", json={"body": "hello", "is_internal": True})
        assert r.status_code == 200 and r.json()["author_name"] == "Writer Test"
        with ENGINE.connect() as db:
            row = db.execute(text("SELECT author_user_id, author_uuid FROM data_quality_threads WHERE finding_id = :f"), {"f": fid}).first()
        assert row[0] is None and str(row[1]) == str(me.id)
    finally:
        with ENGINE.begin() as db:
            db.execute(text("DELETE FROM data_quality_findings WHERE id = :f"), {"f": fid})
