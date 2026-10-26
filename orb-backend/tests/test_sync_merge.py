"""Merge rules of the vessel/VM sync (app/services/sync_service.py, registry.py).

Plain script like the other tests here. These need a real Postgres (the sync uses its types), so point
ORB_TEST_DATABASE_URL at a throwaway database migrated with `alembic upgrade head`, e.g.

    set ORB_TEST_DATABASE_URL=postgresql+asyncpg://postgres:PASSWORD@localhost:5432/orb_vessel_test
    venv/Scripts/python.exe tests/test_sync_merge.py

Every test runs in a transaction that is rolled back, so the database is left as it was. Without the
variable the DB tests are skipped and only the pure ones run.
"""
import asyncio
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATABASE_URL", os.environ.get("ORB_TEST_DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x"))
os.environ.setdefault("CONTROL_DATABASE_URL", "postgresql+asyncpg://x:x@localhost/x")
os.environ.setdefault("SECRET_KEY", "test")

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine  # noqa: E402

from app.models.orb_alert import OrbAlert  # noqa: E402
from app.models.orb_alert_thread import OrbAlertThread, OrbAlertThreadRead  # noqa: E402
from app.models.orb_entry import OrbEntry  # noqa: E402
from app.models.orb_notification import OrbFeedEvent, OrbFeedRead, OrbNotification  # noqa: E402
from app.models.vessel import Vessel  # noqa: E402
from app.models.sync import SyncConflict  # noqa: E402
from app.services.sync_registry import SPECS, prepare, row_to_dict  # noqa: E402
from app.services.sync_service import INSERTED, SKIPPED, UPDATED, apply_row, apply_tombstones  # noqa: E402

T0 = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
URL = os.environ.get("ORB_TEST_DATABASE_URL")


def iso(dt):
    return dt.isoformat()


# ── Pure ─────────────────────────────────────────────────────────────────────

def test_prepare_parses_dates_uuids_and_drops_unknown_columns():
    vid = uuid.uuid4()
    out = prepare(OrbEntry, {"id": str(vid), "entry_date": "2026-09-07", "created_at": "2026-09-07T01:02:03+00:00", "bogus": 1})
    assert out["id"] == vid and out["entry_date"] == date(2026, 9, 7) and out["created_at"].tzinfo is not None
    assert "bogus" not in out


def test_clock_offset_is_applied_and_ist_is_plus_0530():
    from app.services import clock
    try:
        clock.set_offset(-10840.0)                      # a PC whose clock is 3 h 0 m 40 s fast
        gap = (clock.utc_now() - datetime.now(timezone.utc)).total_seconds()
        assert abs(gap + 10840.0) < 1.0
        noon = datetime(2026, 10, 1, 12, 0, tzinfo=timezone.utc)
        assert noon.astimezone(clock.IST).strftime("%H:%M") == "17:30"
    finally:
        clock.set_offset(0.0)


# ── Database ─────────────────────────────────────────────────────────────────

async def _session():
    engine = create_async_engine(URL)
    session = AsyncSession(engine, expire_on_commit=False)
    await session.begin()
    return engine, session


async def _vessel_and_alert(db, **alert):
    v = Vessel(id=uuid.uuid4(), name="TEST", imo_number=str(uuid.uuid4().int)[:12])
    db.add(v)
    await db.flush()
    a = OrbAlert(id=uuid.uuid4(), vessel_id=v.id, alert_type="x", severity="minor", message="m", **alert)
    db.add(a)
    await db.flush()
    return v, a


async def alert_higher_version_replaces_equal_keeps_local(db):
    v, a = await _vessel_and_alert(db, status="PENDING_APPROVAL", version=1)     # the vessel's own offline request
    incoming = row_to_dict(a) | {"status": "OPEN", "version": 1}
    assert await apply_row(db, SPECS["alert"], incoming, on_vessel=True) == SKIPPED          # same version: local request stays
    assert a.status == "PENDING_APPROVAL"
    incoming = row_to_dict(a) | {"status": "RESOLVED", "is_resolved": True, "version": 2}
    assert await apply_row(db, SPECS["alert"], incoming, on_vessel=True) == UPDATED          # shore took a step: it wins
    assert a.status == "RESOLVED" and a.version == 2
    incoming = row_to_dict(a) | {"status": "OPEN", "version": 1}
    assert await apply_row(db, SPECS["alert"], incoming, on_vessel=True) == SKIPPED          # an older row never wins
    assert a.status == "RESOLVED"


async def shore_owned_row_applies_only_if_newer(db):
    v, a = await _vessel_and_alert(db)
    vessel = row_to_dict(v)
    stale = vessel | {"name": "OLD", "updated_at": iso(T0 - timedelta(days=400))}
    assert await apply_row(db, SPECS["vessel"], stale, on_vessel=True) == SKIPPED
    fresh = vessel | {"name": "NEW", "updated_at": iso(datetime.now(timezone.utc) + timedelta(days=1))}
    assert await apply_row(db, SPECS["vessel"], fresh, on_vessel=True) == UPDATED and v.name == "NEW"


async def thread_is_insert_only_and_client_id_dedupes(db):
    v, a = await _vessel_and_alert(db)
    cid = uuid.uuid4()
    base = dict(alert_id=str(a.id), vessel_id=str(v.id), author_id=str(uuid.uuid4()), author_name="A", author_role="VESSEL",
                body="hello", is_internal=False, is_system=False, tagged_user_ids=[], created_at=iso(T0), updated_at=iso(T0))
    first = base | {"id": str(uuid.uuid4()), "client_id": str(cid)}
    assert await apply_row(db, SPECS["thread"], first, on_vessel=False) == INSERTED
    await db.flush()
    assert await apply_row(db, SPECS["thread"], first | {"body": "edited"}, on_vessel=False) == SKIPPED          # same id
    assert await apply_row(db, SPECS["thread"], base | {"id": str(uuid.uuid4()), "client_id": str(cid)}, on_vessel=False) == SKIPPED   # same client_id


async def thread_read_keeps_the_later_time(db):
    v, a = await _vessel_and_alert(db)
    uid = uuid.uuid4()
    row = {"alert_id": str(a.id), "user_id": str(uid), "last_read_at": iso(T0), "updated_at": iso(T0)}
    assert await apply_row(db, SPECS["thread_read"], row, on_vessel=False) == INSERTED
    await db.flush()
    assert await apply_row(db, SPECS["thread_read"], row | {"last_read_at": iso(T0 - timedelta(hours=1))}, on_vessel=False) == SKIPPED
    assert await apply_row(db, SPECS["thread_read"], row | {"last_read_at": iso(T0 + timedelta(hours=1))}, on_vessel=False) == UPDATED


async def notification_read_stays_read_and_shore_never_creates(db):
    v, a = await _vessel_and_alert(db)
    nid = uuid.uuid4()
    row = dict(id=str(nid), user_id=str(uuid.uuid4()), type="MESSAGE", title="t", message="m", vessel_id=str(v.id),
               alert_id=str(a.id), is_read=False, created_at=iso(T0), updated_at=iso(T0))
    assert await apply_row(db, SPECS["notification"], row, on_vessel=False) == SKIPPED          # the VM ignores unknown ones
    assert await apply_row(db, SPECS["notification"], row, on_vessel=True) == INSERTED         # the vessel receives it
    await db.flush()
    assert await apply_row(db, SPECS["notification"], {"id": str(nid), "is_read": True}, on_vessel=False) == UPDATED
    n = await db.get(OrbNotification, nid)
    assert n.is_read is True
    assert await apply_row(db, SPECS["notification"], row, on_vessel=True) == SKIPPED          # an old unread copy does not undo it
    assert n.is_read is True


async def feed_read_last_write_wins(db):
    v, a = await _vessel_and_alert(db)
    ev = OrbFeedEvent(id=uuid.uuid4(), event_type="MESSAGE", vessel_id=v.id, title="t", message="m")
    db.add(ev)
    await db.flush()
    uid = uuid.uuid4()
    row = {"event_id": str(ev.id), "user_id": str(uid), "is_read": True, "read_at": iso(T0), "updated_at": iso(T0)}
    assert await apply_row(db, SPECS["feed_read"], row, on_vessel=False) == INSERTED
    await db.flush()
    unread_later = row | {"is_read": False, "updated_at": iso(T0 + timedelta(minutes=5))}
    assert await apply_row(db, SPECS["feed_read"], unread_later, on_vessel=False) == UPDATED       # "mark unread" later wins
    rec = await db.get(OrbFeedRead, (ev.id, uid))
    assert rec.is_read is False
    assert await apply_row(db, SPECS["feed_read"], row, on_vessel=False) == SKIPPED                 # older "read" does not undo it


async def tombstone_keeps_an_alert_the_vessel_chatted_on(db):
    v, a = await _vessel_and_alert(db)
    _, plain = await _vessel_and_alert(db)
    db.add(OrbAlertThread(id=uuid.uuid4(), alert_id=a.id, vessel_id=v.id, author_id=uuid.uuid4(), author_name="A",
                          author_role="VESSEL", body="x", is_internal=False, tagged_user_ids=[]))
    await db.flush()
    removed = await apply_tombstones(db, [{"entity_type": "alert", "entity_id": str(a.id)},
                                          {"entity_type": "alert", "entity_id": str(plain.id)}])
    assert removed == 1
    assert await db.get(OrbAlert, a.id) is not None and await db.get(OrbAlert, plain.id) is None


DB_TESTS = [
    alert_higher_version_replaces_equal_keeps_local, shore_owned_row_applies_only_if_newer,
    thread_is_insert_only_and_client_id_dedupes, thread_read_keeps_the_later_time,
    notification_read_stays_read_and_shore_never_creates, feed_read_last_write_wins,
    tombstone_keeps_an_alert_the_vessel_chatted_on,
]


async def _run_db_test(fn):
    engine, db = await _session()
    try:
        await fn(db)
    finally:
        await db.rollback()
        await db.close()
        await engine.dispose()


def main() -> int:
    failures = []
    try:
        test_prepare_parses_dates_uuids_and_drops_unknown_columns()
        print("ok   prepare_parses_dates_uuids_and_drops_unknown_columns")
    except AssertionError as e:
        failures.append(("prepare", e))
    try:
        test_clock_offset_is_applied_and_ist_is_plus_0530()
        print("ok   clock_offset_is_applied_and_ist_is_plus_0530")
    except AssertionError as e:
        failures.append(("clock", e))
    if URL:
        for fn in DB_TESTS:
            try:
                asyncio.run(_run_db_test(fn))
                print("ok  ", fn.__name__)
            except Exception as e:                       # noqa: BLE001
                failures.append((fn.__name__, e))
                print("FAIL", fn.__name__, "->", repr(e))
    else:
        print("skipped: set ORB_TEST_DATABASE_URL to run the", len(DB_TESTS), "database tests")
    print(f"\n{len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
