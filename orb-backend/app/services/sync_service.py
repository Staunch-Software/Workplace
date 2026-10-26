"""Applying one synced row, the same way on the VM and on a vessel. See registry.py for the strategies."""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Iterable, Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.orb_alert_thread import OrbAlertThread
from app.models.sync import SyncConflict
from app.services.sync_registry import SPECS, TOMBSTONE_MODELS, TOMBSTONE_ORDER, Spec, pk_of, prepare, row_to_dict

settings = get_settings()
logger = logging.getLogger("orb.sync")

INSERTED, UPDATED, SKIPPED = "inserted", "updated", "skipped"


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def log_conflict(db: AsyncSession, entity_type: str, entity_id, reason: str, *, incoming=None, existing=None,
                       vessel_imo: Optional[str] = None) -> None:
    """Keep a note of something sync did not apply. Uses its own commit so it survives a rolled-back row."""
    try:
        db.add(SyncConflict(entity_type=entity_type, entity_id=entity_id, vessel_imo=vessel_imo or None, reason=reason[:2000],
                            incoming=incoming, existing=existing))
        await db.commit()
    except Exception:
        logger.exception("Could not record a sync conflict for %s %s", entity_type, entity_id)
        await db.rollback()


def _localize(spec: Spec, vals: dict) -> None:
    """The shore's file paths mean nothing on a vessel: point an upload at where its PDF would live here.
    (The PDF itself is read from the local blob store when this path does not exist.)"""
    if spec.key == "upload" and vals.get("storage_path"):
        name = f"{vals['id']}_{vals.get('original_filename') or 'upload.pdf'}"
        vals["storage_path"] = os.path.join(settings.UPLOAD_DIR, str(vals["vessel_id"]), name)


async def apply_row(db: AsyncSession, spec: Spec, data: dict, *, on_vessel: bool) -> str:
    """Merge one incoming row into the database. Does not commit."""
    vals = prepare(spec.model, data)
    pk = pk_of(spec, vals)
    existing = await db.get(spec.model, pk)
    strategy = spec.strategy

    if strategy == "shore_owned":
        if on_vessel:
            _localize(spec, vals)
        if existing is None:
            db.add(spec.model(**vals))
            return INSERTED
        if spec.key == "alert":
            # The vessel's own offline request does not bump the version, so only a real shore step replaces it.
            if int(vals.get("version") or 1) <= int(existing.version or 1):
                return SKIPPED
        elif _aware(vals.get("updated_at")) is not None and _aware(existing.updated_at) is not None \
                and _aware(vals["updated_at"]) <= _aware(existing.updated_at):
            return SKIPPED
        for k, v in vals.items():
            setattr(existing, k, v)
        return UPDATED

    if strategy == "insert_only":
        if existing is not None:
            return SKIPPED
        if spec.key == "thread" and vals.get("client_id") is not None:
            clash = (await db.execute(select(OrbAlertThread.id).where(OrbAlertThread.client_id == vals["client_id"]))).scalar_one_or_none()
            if clash is not None:
                return SKIPPED          # the same message arrived under another id: keep the first
        db.add(spec.model(**vals))
        return INSERTED

    if strategy == "thread_read":
        if existing is None:
            db.add(spec.model(**vals))
            return INSERTED
        if _aware(vals["last_read_at"]) > _aware(existing.last_read_at):
            existing.last_read_at = vals["last_read_at"]
            return UPDATED
        return SKIPPED

    if strategy == "notification":
        if existing is None:
            if not on_vessel:
                return SKIPPED          # the VM never learns of a notification from a vessel
            db.add(spec.model(**vals))
            return INSERTED
        if vals.get("is_read") and not existing.is_read:
            existing.is_read = True     # read stays read, from either side
            return UPDATED
        return SKIPPED

    if strategy == "feed_read":
        if existing is None:
            db.add(spec.model(**vals))
            return INSERTED
        if _aware(vals["updated_at"]) > _aware(existing.updated_at):
            existing.is_read = bool(vals.get("is_read", True))
            existing.read_at = vals.get("read_at") or existing.read_at
            existing.updated_at = vals["updated_at"]
            return UPDATED
        return SKIPPED

    raise ValueError(f"Unknown sync strategy {strategy!r}")


async def apply_row_safely(db: AsyncSession, spec: Spec, data: dict, *, on_vessel: bool, vessel_imo: str = "") -> Optional[str]:
    """apply_row inside a savepoint: a bad row is logged as a conflict and the rest of the batch carries on."""
    try:
        async with db.begin_nested():
            return await apply_row(db, spec, data, on_vessel=on_vessel)
    except Exception as exc:
        logger.warning("Sync could not apply %s %s: %s", spec.key, data.get("id"), exc)
        eid = data.get("id")
        try:
            eid = uuid.UUID(str(eid)) if eid else None
        except ValueError:
            eid = None
        await log_conflict(db, spec.key, eid, f"{type(exc).__name__}: {exc}", incoming=data, vessel_imo=vessel_imo)
        return None


# ── Deletes ──────────────────────────────────────────────────────────────────

async def apply_tombstones(db: AsyncSession, items: Iterable[dict], *, vessel_imo: str = "") -> int:
    """Vessel: delete what the VM deleted. An alert the vessel has chatted on is kept (and logged)."""
    by_type: dict[str, list[uuid.UUID]] = {}
    for it in items:
        by_type.setdefault(it["entity_type"], []).append(uuid.UUID(str(it["entity_id"])))
    removed = 0
    for etype in TOMBSTONE_ORDER:
        ids = by_type.get(etype)
        if not ids:
            continue
        model = TOMBSTONE_MODELS[etype]
        if etype == "alert":
            chatted = set((await db.execute(select(OrbAlertThread.alert_id).where(OrbAlertThread.alert_id.in_(ids)).distinct())).scalars())
            for aid in chatted:
                await log_conflict(db, "alert", aid, "Shore deleted this alert but the vessel has messages on it; kept", vessel_imo=vessel_imo)
            ids = [i for i in ids if i not in chatted]
        if not ids:
            continue
        try:
            async with db.begin_nested():
                res = await db.execute(delete(model).where(model.id.in_(ids)))
                removed += res.rowcount or 0
        except Exception as exc:
            await log_conflict(db, etype, None, f"Could not delete {len(ids)} row(s): {exc}", incoming={"ids": [str(i) for i in ids]}, vessel_imo=vessel_imo)
    return removed


class SyncService:
    """Same entry points as DRS / Report Tracker's SyncService, over the ORB merge rules in this module."""
    apply_snapshot = staticmethod(apply_row)
    apply_snapshot_safely = staticmethod(apply_row_safely)
    apply_tombstones = staticmethod(apply_tombstones)
