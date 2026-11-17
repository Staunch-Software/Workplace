"""Moving vessels to another IMO across every table (scripts/correct_amns_imos.py).

Run from vp-backend/:  python -m pytest tests/test_correct_imos.py
Uses made-up vessels and IMOs in the database from .env and removes them afterwards.
"""
import os
import sys
import uuid

import pytest
from sqlalchemy import create_engine, text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "scripts"))

from backend.config import config            # noqa: E402
import correct_amns_imos as mod              # noqa: E402


def _engine():
    try:
        e = create_engine(config.DATABASE_URL)
        with e.connect() as c:
            c.execute(text("SELECT 1 FROM vessels LIMIT 1"))
        return e
    except Exception:
        return None


ENGINE = _engine()
pytestmark = pytest.mark.skipif(ENGINE is None, reason="local database not available")

OLD, NEW = "9000001", "9000002"
TAG = "ZZ TEST " + uuid.uuid4().hex[:5]


def cleanup(c):
    for imo in (OLD, NEW):
        for table, col in mod.imo_columns(c):
            c.execute(text(f'DELETE FROM "{table}" WHERE "{col}" = :i'), {"i": imo})
        c.execute(text("DELETE FROM vessels WHERE imo_number = :i"), {"i": imo})


@pytest.fixture
def seeded():
    with ENGINE.begin() as c:
        cleanup(c)
        c.execute(text("INSERT INTO vessels (imo_number, vessel_name, wni_enabled, mari_enabled, owner_group) VALUES (:i, :n, true, false, 'Other')"),
                  {"i": OLD, "n": TAG})
        c.execute(text("INSERT INTO vessel_particulars (vessel_imo) VALUES (:i)"), {"i": OLD})                      # foreign key
        c.execute(text("INSERT INTO vessel_notification_recipients (vessel_imo, notif_type, from_email, to_emails, is_active) "
                       "VALUES (:i, 'zz_test', 'a@example.com', '[\"b@example.com\"]', true)"), {"i": OLD})          # foreign key, cascades
        c.execute(text("INSERT INTO fleet_status_data (imo, vessel_name) VALUES (:i, :n)"), {"i": OLD, "n": TAG})   # no foreign key
        c.execute(text("INSERT INTO user_column_preferences (vessel_imo, source, column_prefs) VALUES (:i, 'wni', '{}')"), {"i": OLD})
    yield
    with ENGINE.begin() as c:
        cleanup(c)


def counts(imo):
    with ENGINE.connect() as c:
        return {f"{t}.{col}": mod.count(c, t, col, imo) for t, col in mod.imo_columns(c) if mod.count(c, t, col, imo)}


def vessel_exists(imo):
    with ENGINE.connect() as c:
        return c.execute(text("SELECT vessel_name FROM vessels WHERE imo_number = :i"), {"i": imo}).scalar()


def test_every_imo_column_is_found_from_the_schema():
    with ENGINE.connect() as c:
        found = {t for t, _ in mod.imo_columns(c)}
    # the ones the earlier script missed, with and without a foreign key
    assert {"expanded_mariapps_data", "expanded_wni_data", "fleet_status_data", "vessel_notification_recipients",
            "data_quality_findings", "cp_manual_overrides", "user_column_preferences"} <= found


def test_dry_run_writes_nothing(seeded):
    before = counts(OLD)
    assert mod.run(ENGINE, {OLD: NEW}, False) == 0
    assert counts(OLD) == before and vessel_exists(OLD) == TAG and vessel_exists(NEW) is None


def test_apply_moves_everything_including_tables_without_a_foreign_key(seeded):
    before = counts(OLD)
    assert len(before) == 4
    assert mod.run(ENGINE, {OLD: NEW}, True) == 0
    assert counts(OLD) == {}, "nothing may keep the old IMO"
    assert counts(NEW) == before, "every row, in every table, moved to the new IMO"
    assert vessel_exists(OLD) is None and vessel_exists(NEW) == TAG
    with ENGINE.connect() as c:
        r = c.execute(text("SELECT wni_enabled, mari_enabled, owner_group FROM vessels WHERE imo_number = :i"), {"i": NEW}).first()
    assert tuple(r) == (True, False, "Other"), "the vessel's other settings are copied"


def test_running_it_again_changes_nothing(seeded):
    mod.run(ENGINE, {OLD: NEW}, True)
    after = counts(NEW)
    assert mod.run(ENGINE, {OLD: NEW}, True) == 0
    assert counts(NEW) == after and counts(OLD) == {}


def test_two_vessels_with_both_imos_are_left_alone(seeded):
    with ENGINE.begin() as c:
        c.execute(text("INSERT INTO vessels (imo_number, vessel_name) VALUES (:i, 'ZZ OTHER')"), {"i": NEW})
    before = counts(OLD)
    assert mod.run(ENGINE, {OLD: NEW}, True) == 1
    assert counts(OLD) == before and vessel_exists(OLD) == TAG


def test_leftover_rows_on_the_old_imo_are_picked_up_after_the_vessel_moved(seeded):
    mod.run(ENGINE, {OLD: NEW}, True)
    with ENGINE.begin() as c:     # e.g. a scraper wrote one more row under the old IMO afterwards
        c.execute(text("INSERT INTO fleet_status_data (imo, vessel_name) VALUES (:i, :n)"), {"i": OLD, "n": TAG})
    assert mod.run(ENGINE, {OLD: NEW}, True) == 0
    assert counts(OLD) == {}
