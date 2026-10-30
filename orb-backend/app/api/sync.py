"""The VM side of sync: what a vessel pulls, and what it may push. Authenticated with X-Sync-API-Key.

  GET  /api/sync/pull/{entity}?vessel_imo=&since=&limit=   rows of that vessel changed at/after `since`
  GET  /api/sync/pull/tombstone?vessel_imo=&since=         rows deleted here (reprocess / recalculate)
  POST /api/sync/push/{entity}                             one change from a vessel's outbox
  POST /api/sync/heartbeat                                 the vessel's health, without any data

The vessel is only ever served its own vessel's rows. It may only write the PUSH_ENTITIES.
"""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security import APIKeyHeader
from pydantic import BaseModel
from sqlalchemy import Boolean, Integer, JSON, String, DateTime, column, select, table, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.control_database import get_control_db
from app.database import get_db
from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertThread
from app.models.orb_entry import OrbEntry
from app.models.orb_notification import OrbFeedEvent, OrbNotification
from app.models.vessel import Vessel
from app.models.sync import SyncState, SyncTombstone
from app.services.sync_registry import PUSH_ENTITIES, SPECS, Spec, pk_of, prepare, row_to_dict
from app.services.sync_service import INSERTED, apply_row, log_conflict

settings = get_settings()
logger = logging.getLogger("orb.sync")
router = APIRouter(prefix="/sync", tags=["sync"])

MODULE_KEY = "orb"
KEEP_DAYS = 60            # notifications / feed older than this are not sent to a vessel
_key_header = APIKeyHeader(name="X-Sync-API-Key", auto_error=True)


async def verify_sync_key(api_key: str = Security(_key_header)):
    if not settings.SYNC_API_KEY or api_key != settings.SYNC_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid sync key")
    if settings.is_offline_vessel:
        raise HTTPException(status_code=403, detail="This is a vessel install; it does not serve sync requests")


class PushPayload(BaseModel):
    entity_id: Optional[str] = None
    vessel_imo: str
    data: dict[str, Any]
    vessel_telemetry: Optional[dict[str, Any]] = None


class Heartbeat(BaseModel):
    vessel_imo: str
    vessel_telemetry: Optional[dict[str, Any]] = None


# ── Helpers ──────────────────────────────────────────────────────────────────

async def _vessel(db: AsyncSession, imo: str) -> Vessel:
    v = (await db.execute(select(Vessel).where(Vessel.imo_number == imo))).scalar_one_or_none()
    if v is None:
        raise HTTPException(status_code=404, detail=f"Vessel {imo} is not known on the VM")
    return v


async def vessel_user_ids(control_db: AsyncSession, imo: str) -> list[uuid.UUID]:
    """The vessel's own users (role VESSEL, assigned to it, with ORB access): their read marks and notifications go down."""
    rows = await control_db.execute(text("""
        SELECT u.id FROM users u JOIN user_vessel_link l ON l.user_id = u.id
        WHERE l.vessel_imo = :imo AND u.is_active AND u.role = 'VESSEL'
          AND COALESCE(u.permissions ->> 'orb', 'false') = 'true'
    """), {"imo": str(imo)})
    return [r[0] for r in rows.fetchall()]


def _conditions(spec: Spec, vessel: Vessel, users: list[uuid.UUID]):
    """SQL conditions limiting a table to what this vessel may receive."""
    from app.models.orb_alert_thread import OrbAlertAttachment, OrbAlertThreadRead
    from app.models.orb_entry_quantity import OrbEntryQuantity
    from app.models.orb_notification import OrbFeedRead
    v = vessel.id
    keep = datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)
    k = spec.key
    if k == "vessel":
        return [Vessel.id == v]
    if k in ("vessel_tank", "upload", "entry", "alert", "equipment"):
        return [spec.model.vessel_id == v]
    if k == "entry_quantity":
        return [OrbEntryQuantity.entry_id.in_(select(OrbEntry.id).where(OrbEntry.vessel_id == v))]
    if k == "thread":
        return [OrbAlertThread.vessel_id == v, OrbAlertThread.is_internal == False]  # noqa: E712
    if k == "attachment":
        return [OrbAlertAttachment.thread_id.in_(select(OrbAlertThread.id).where(OrbAlertThread.vessel_id == v, OrbAlertThread.is_internal == False))]  # noqa: E712
    if k == "thread_read":
        return [OrbAlertThreadRead.alert_id.in_(select(OrbAlert.id).where(OrbAlert.vessel_id == v)), OrbAlertThreadRead.user_id.in_(users)]
    if k == "notification":
        return [OrbNotification.vessel_id == v, OrbNotification.user_id.in_(users), OrbNotification.created_at >= keep]
    if k == "feed_event":
        return [OrbFeedEvent.vessel_id == v, OrbFeedEvent.shore_only == False, OrbFeedEvent.created_at >= keep]  # noqa: E712
    if k == "feed_read":
        return [OrbFeedRead.event_id.in_(select(OrbFeedEvent.id).where(OrbFeedEvent.vessel_id == v, OrbFeedEvent.shore_only == False)),  # noqa: E712
                OrbFeedRead.user_id.in_(users)]
    raise HTTPException(status_code=404, detail=f"Unknown entity {k}")


def _parse_since(since: Optional[str]) -> datetime:
    if not since:
        return datetime(2000, 1, 1, tzinfo=timezone.utc)
    try:
        d = datetime.fromisoformat(since.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="since must be an ISO timestamp")
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


# ── Pull ─────────────────────────────────────────────────────────────────────

@router.get("/pull/tombstone", dependencies=[Depends(verify_sync_key)])
async def pull_tombstones(
    vessel_imo: str, since: Optional[str] = None, limit: int = Query(1000, ge=1, le=5000),
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
):
    vessel = await _vessel(db, vessel_imo)
    rows = (await db.execute(
        select(SyncTombstone).where(SyncTombstone.vessel_id == vessel.id, SyncTombstone.deleted_at >= _parse_since(since))
        .order_by(SyncTombstone.deleted_at, SyncTombstone.id).limit(limit)
    )).scalars().all()
    await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False, db=db)
    return {"server_time": datetime.now(timezone.utc).isoformat(), "limit": limit,
            "items": [{"entity_type": r.entity_type, "entity_id": str(r.entity_id), "ts": r.deleted_at.isoformat()} for r in rows]}


@router.get("/pull/{entity}", dependencies=[Depends(verify_sync_key)])
async def pull(
    entity: str, vessel_imo: str, since: Optional[str] = None, limit: int = Query(500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
):
    spec = SPECS.get(entity)
    if spec is None:
        raise HTTPException(status_code=404, detail=f"Unknown entity {entity}")
    vessel = await _vessel(db, vessel_imo)
    users = await vessel_user_ids(control_db, vessel_imo) if entity in ("thread_read", "notification", "feed_read") else []
    ts = getattr(spec.model, spec.ts_col)
    pk_cols = list(spec.model.__table__.primary_key.columns)
    rows = (await db.execute(
        select(spec.model).where(ts >= _parse_since(since), *_conditions(spec, vessel, users))
        .order_by(ts, *pk_cols).limit(limit)
    )).scalars().all()
    items = [row_to_dict(r) for r in rows]
    await record_vessel_sync_time(control_db, vessel_imo, is_vessel_pushing=False, db=db)
    return {"server_time": datetime.now(timezone.utc).isoformat(), "limit": limit, "items": items}


# ── Push ─────────────────────────────────────────────────────────────────────

_TIME_KEYS = ("created_at", "updated_at", "last_read_at", "read_at", "requested_at")


def _clamp_future(data: dict) -> dict:
    """A time from a vessel that is later than the VM's own clock cannot be true (its PC clock was ahead, and the
    offset was not measured yet when the item was written). Stamp it with the VM's time instead."""
    limit = datetime.now(timezone.utc) + timedelta(minutes=5)
    fixed = dict(data)
    for k in _TIME_KEYS:
        v = fixed.get(k)
        if not v:
            continue
        try:
            t = datetime.fromisoformat(str(v).replace("Z", "+00:00"))
        except ValueError:
            continue
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
        if t > limit:
            fixed[k] = datetime.now(timezone.utc).isoformat()
    return fixed


def _uid(v) -> uuid.UUID:
    try:
        return uuid.UUID(str(v))
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad id")


@router.post("/push/{entity}", dependencies=[Depends(verify_sync_key)])
async def push(
    entity: str, body: PushPayload,
    db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db),
):
    if entity not in PUSH_ENTITIES:
        raise HTTPException(status_code=403, detail=f"A vessel may not push {entity}")
    vessel = await _vessel(db, body.vessel_imo)
    data = _clamp_future(body.data)
    result = "applied"
    try:
        if entity == "alert_resolution_request":
            result = await _resolution_request(db, control_db, vessel, data)
        else:
            spec = SPECS[entity]
            await _check_ownership(db, vessel, entity, data)
            outcome = await apply_row(db, spec, data, on_vessel=False)
            await db.commit()
            result = outcome
            if entity == "thread" and outcome == INSERTED:
                await _notify_thread(db, control_db, vessel, data)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        logger.exception("Sync push %s failed", entity)
        await log_conflict(db, entity, _safe_uuid(data.get("id") or body.entity_id), f"{type(exc).__name__}: {exc}", incoming=data, vessel_imo=body.vessel_imo)
        raise HTTPException(status_code=500, detail=f"Could not apply {entity}: {exc}")
    await record_vessel_sync_time(control_db, body.vessel_imo, is_vessel_pushing=True, db=db, telemetry=body.vessel_telemetry)
    return {"status": "ok", "result": result}


def _safe_uuid(v):
    try:
        return uuid.UUID(str(v)) if v else None
    except ValueError:
        return None


async def _check_ownership(db: AsyncSession, vessel: Vessel, entity: str, data: dict) -> None:
    """A vessel may only write rows that belong to its own vessel."""
    from app.models.orb_alert_thread import OrbAlertThread as T
    if entity == "thread":
        if str(data.get("vessel_id")) != str(vessel.id):
            raise HTTPException(status_code=403, detail="Thread belongs to another vessel")
        alert = await db.get(OrbAlert, _uid(data["alert_id"]))
        if alert is None or alert.vessel_id != vessel.id:
            raise HTTPException(status_code=409, detail="Alert is not on the VM yet")      # the vessel retries later
        if data.get("is_internal"):
            raise HTTPException(status_code=403, detail="Vessels do not write internal notes")
    elif entity == "attachment":
        t = await db.get(T, _uid(data["thread_id"]))
        if t is None or t.vessel_id != vessel.id:
            raise HTTPException(status_code=409, detail="Thread is not on the VM yet")
    elif entity == "thread_read":
        alert = await db.get(OrbAlert, _uid(data["alert_id"]))
        if alert is None:
            return {"status": "skipped", "detail": "Alert already deleted on Shore"}
        if alert.vessel_id != vessel.id:
            raise HTTPException(status_code=403, detail="Alert belongs to another vessel")
    elif entity == "notification":
        n = await db.get(OrbNotification, _uid(data["id"]))
        if n is not None and n.vessel_id != vessel.id:
            raise HTTPException(status_code=403, detail="Notification belongs to another vessel")
    elif entity == "feed_read":
        ev = await db.get(OrbFeedEvent, _uid(data["event_id"]))
        if ev is None or ev.vessel_id != vessel.id:
            raise HTTPException(status_code=404, detail="Feed event not found")


async def _notify_thread(db: AsyncSession, control_db: AsyncSession, vessel: Vessel, data: dict) -> None:
    """A vessel message just arrived: tell the people on the VM, exactly as if it had been written here."""
    from app.services import orb_notify
    thread = await db.get(OrbAlertThread, _uid(data["id"]))
    alert = await db.get(OrbAlert, thread.alert_id) if thread else None
    if thread is None or alert is None or thread.is_system:
        return
    author = SimpleNamespace(id=thread.author_id, full_name=thread.author_name, role=thread.author_role)
    await orb_notify.on_message_posted(db, control_db, alert=alert, vessel=vessel, thread=thread, author=author,
                                       tagged=[str(t) for t in (thread.tagged_user_ids or [])],
                                       has_files=bool(data.get("has_files")))


async def _resolution_request(db: AsyncSession, control_db: AsyncSession, vessel: Vessel, p: dict) -> str:
    """The vessel asked, offline, for an alert to be resolved. Apply it only if the alert is still open here."""
    from app.api import orb_alert_resolution as res
    from app.services import orb_notify
    alert = await db.get(OrbAlert, _uid(p["alert_id"]))
    if alert is None or alert.vessel_id != vessel.id:
        raise HTTPException(status_code=404, detail="Alert not found for this vessel")
    line_id = _uid(p["system_thread_id"])
    if await db.get(OrbAlertThread, line_id) is not None:
        return "duplicate"                                    # replay of a request already applied
    if alert.status != res.OPEN:
        await log_conflict(db, "alert_resolution_request", alert.id,
                           f"Resolution request arrived while the alert is {alert.status}; not applied. The vessel will pull the current state.",
                           incoming=p, vessel_imo=vessel.imo_number)
        return "stale"
    requester = SimpleNamespace(id=_uid(p["requester_id"]), full_name=p.get("requester_name") or "Vessel user", role=p.get("requester_role") or "VESSEL")
    when = datetime.fromisoformat(str(p["requested_at"]).replace("Z", "+00:00"))
    notes = p.get("notes") or ""
    res.apply_request(alert, requester, notes, when, bump=True)
    db.add(res.system_line(alert, requester, f"Resolution requested by {requester.full_name}: {notes}", thread_id=line_id, created_at=when))
    await db.commit()
    await db.refresh(alert)
    await orb_notify.on_resolution_event(db, control_db, kind="REQUESTED", alert=alert, vessel=vessel, actor=requester, notes=notes)
    return "applied"


# ── Heartbeat and vessel status ──────────────────────────────────────────────

@router.post("/heartbeat", dependencies=[Depends(verify_sync_key)])
async def heartbeat(body: Heartbeat, db: AsyncSession = Depends(get_db), control_db: AsyncSession = Depends(get_control_db)):
    await record_vessel_sync_time(control_db, body.vessel_imo, is_vessel_pushing=True, db=db, telemetry=body.vessel_telemetry)
    return {"status": "ok", "server_time": datetime.now(timezone.utc).isoformat()}


async def record_vessel_sync_time(control_db: AsyncSession, imo: str, is_vessel_pushing: bool, db: AsyncSession,
                                  telemetry: Optional[dict] = None) -> None:
    """Note that this vessel just pushed / pulled, and keep its error list, for the Vessel Status page. Never raises."""
    if not imo:
        return
    now = datetime.now(timezone.utc)
    try:
        values: dict = {"updated_at": now, ("last_push_at" if is_vessel_pushing else "last_pull_at"): now}
        if telemetry is not None:
            values["active_errors"] = telemetry.get("active_errors", [])
        await db.execute(
            pg_insert(SyncState).values(vessel_imo=imo, sync_scope="vessel", **values)
            .on_conflict_do_update(index_elements=["vessel_imo", "sync_scope"], set_=values)
        )
        await db.commit()
    except Exception:
        logger.exception("Could not record sync state for %s", imo)
        await db.rollback()

    try:
        vessels_t = table("vessels", column("imo", String), column("updated_at", DateTime), column("last_push_at", DateTime(timezone=True)),
                          column("last_pull_at", DateTime(timezone=True)), column("module_status", JSON), column("module_error_counts", JSON),
                          column("total_error_count", Integer), column("last_sync_success", Boolean), column("last_sync_error", String))
        row = (await control_db.execute(select(vessels_t).where(vessels_t.c.imo == imo))).mappings().fetchone()
        if not row:
            return
        status = dict(row["module_status"] or {})
        status.setdefault(MODULE_KEY, True)
        upd: dict = {"updated_at": now.replace(tzinfo=None), "module_status": status, ("last_push_at" if is_vessel_pushing else "last_pull_at"): now}
        if telemetry is not None:
            counts = dict(row["module_error_counts"] or {})
            counts[MODULE_KEY] = telemetry.get("failed_items_count", 0)
            upd["module_error_counts"] = counts
            upd["total_error_count"] = sum(counts.values())
            upd["last_sync_success"] = sum(counts.values()) == 0
            errors = telemetry.get("active_errors") or []
            if errors:
                history = json.loads(row["last_sync_error"]) if row["last_sync_error"] else []
                msg = errors[0].get("msg", "")
                if not history or history[0].get("msg") != msg:
                    history.insert(0, {"module": MODULE_KEY.upper(), "type": "vessel_error", "msg": msg, "ts": now.isoformat()})
                    upd["last_sync_error"] = json.dumps(history[:50])
        await control_db.execute(update(vessels_t).where(vessels_t.c.imo == imo).values(upd))
        await control_db.commit()
    except Exception:
        logger.exception("Could not update the control-DB vessel row for %s", imo)
        await control_db.rollback()
