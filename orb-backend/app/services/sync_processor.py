"""The vessel side of sync: push the outbox to the VM, then pull what changed there.

Push is oldest first, in batches; a failed item backs off (1, 2, 4 ... up to 60 minutes) and is marked FAILED
after MAX_SYNC_RETRIES. Pull runs one cursor per entity, parents before children, so a vessel never holds a
child whose parent it has not seen. Files move separately (blob_download items and attachment uploads).
"""
import asyncio
import logging
import traceback
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.services import azure_storage, clock
from app.models.sync import SyncQueue, SyncState
from app.services.sync_registry import BLOB_DOWNLOAD, PULL_SPECS, Spec
from app.services.sync_service import INSERTED, UPDATED, apply_row_safely, apply_tombstones, log_conflict

settings = get_settings()
logger = logging.getLogger("orb.sync")

OVERLAP = timedelta(minutes=2)          # re-read this much before the last cursor; applying a row twice is harmless
STALE_PROCESSING = timedelta(minutes=10)
BLOBS_PER_BATCH = 3


def _utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _parse(v: str) -> datetime:
    return _utc(datetime.fromisoformat(str(v).replace("Z", "+00:00")))


class SyncProcessor:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.base = settings.CLOUD_BASE_URL.rstrip("/") + "/api/sync"
        self.headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}

    def _client(self) -> httpx.AsyncClient:
        transport = httpx.AsyncHTTPTransport(retries=3, verify=settings.SYNC_VERIFY_TLS)
        return httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(120.0, connect=30.0), headers=self.headers)

    # ── Push ─────────────────────────────────────────────────────────────────

    async def recover_stale(self, everything: bool = False) -> int:
        """Items claimed by a run that died (power cut, restart) go back to PENDING."""
        cutoff = clock.utc_now() - STALE_PROCESSING
        cond = SyncQueue.status == "PROCESSING"
        if not everything:
            # a claim time in the future means the PC clock moved back since: that claim is stale too
            cond = cond & ((SyncQueue.processed_at < cutoff) | (SyncQueue.processed_at > clock.utc_now() + timedelta(hours=1)))
        res = await self.db.execute(update(SyncQueue).where(cond).values(status="PENDING"))
        await self.db.commit()
        return res.rowcount or 0

    async def purge_completed(self, days: int = 7) -> int:
        res = await self.db.execute(delete(SyncQueue).where(
            SyncQueue.status == "COMPLETED", SyncQueue.processed_at < clock.utc_now() - timedelta(days=days)))
        await self.db.commit()
        return res.rowcount or 0

    async def push_pending(self) -> int:
        """Send one batch from the outbox. Returns how many items were handled."""
        now = clock.utc_now()
        rows = (await self.db.execute(
            select(SyncQueue).where(
                SyncQueue.status == "PENDING",
                # a retry time more than 2 h away can only come from a clock that jumped: do not wait on it
                (SyncQueue.next_retry_at.is_(None)) | (SyncQueue.next_retry_at <= now) | (SyncQueue.next_retry_at > now + timedelta(hours=2)))
            .order_by(SyncQueue.entity_type == BLOB_DOWNLOAD, SyncQueue.created_at, SyncQueue.entity_type != "thread")      # data before files; a thread before its files
            .limit(settings.SYNC_BATCH_SIZE).with_for_update(skip_locked=True)
        )).scalars().all()
        blobs = 0
        batch = []
        for r in rows:
            if r.entity_type == BLOB_DOWNLOAD:
                if blobs >= BLOBS_PER_BATCH:
                    continue
                blobs += 1
            r.status = "PROCESSING"
            r.processed_at = now
            batch.append(r)
        await self.db.commit()
        if not batch:
            return 0
        async with self._client() as client:
            for r in batch:
                try:
                    await self._handle(client, r)
                except Exception as exc:        # never lose the rest of the batch to one item
                    await self._failed(r, f"{type(exc).__name__}: {exc}", permanent=False)
        await self.db.commit()
        return len(batch)

    async def _handle(self, client: httpx.AsyncClient, r: SyncQueue) -> None:
        if r.entity_type == BLOB_DOWNLOAD:
            await asyncio.to_thread(azure_storage.copy_blob_to_local, r.payload["url"])
            return self._done(r)

        data = dict(r.payload)
        if r.entity_type == "attachment":
            local_url = data.get("storage_path", "")
            if local_url.startswith("http") and not data.get("_cloud_url"):
                data["_cloud_url"] = await asyncio.to_thread(azure_storage.copy_blob_to_cloud, local_url)
                r.payload = {**r.payload, "_cloud_url": data["_cloud_url"]}       # a retry must not upload again
            if data.get("_cloud_url"):
                data["storage_path"] = data.pop("_cloud_url")
        data.pop("_cloud_url", None)

        resp = None
        for attempt in range(3):
            try:
                resp = await client.post(f"{self.base}/push/{r.entity_type}", json={
                    "entity_id": str(r.entity_id), "vessel_imo": settings.VESSEL_IMO, "data": data})
                break
            except (httpx.RemoteProtocolError, httpx.ReadTimeout, httpx.ConnectError) as exc:
                if attempt == 2:
                    raise
                logger.warning("Push %s attempt %d/3 dropped (%s: %s). Reconnecting...", r.entity_type, attempt + 1, type(exc).__name__, exc)
                await asyncio.sleep(1.0)

        if resp.status_code == 200:
            return self._done(r)
        detail = resp.text[:300]
        # 4xx other than "parent not there yet" will never succeed: stop retrying and surface it.
        permanent = resp.status_code in (400, 401, 403, 404, 422)
        await self._failed(r, f"HTTP {resp.status_code}: {detail}", permanent=permanent)

    def _done(self, r: SyncQueue) -> None:
        r.status = "COMPLETED"
        r.processed_at = clock.utc_now()
        r.error_message = None

    async def _failed(self, r: SyncQueue, message: str, permanent: bool) -> None:
        r.retry_count = (r.retry_count or 0) + 1
        r.error_message = message[:1000]
        if permanent or r.retry_count >= settings.MAX_SYNC_RETRIES:
            r.status = "FAILED"
        else:
            r.status = "PENDING"
            r.next_retry_at = clock.utc_now() + timedelta(seconds=min(60 * 2 ** r.retry_count, 3600))
        logger.warning("Sync %s %s: %s", r.entity_type, r.entity_id, message)

    # ── Pull ─────────────────────────────────────────────────────────────────

    async def _cursor(self, scope: str) -> datetime:
        st = await self.db.get(SyncState, (settings.VESSEL_IMO, scope))
        return _utc(st.last_pull_at) if st and st.last_pull_at else datetime(2000, 1, 1, tzinfo=timezone.utc)

    async def _save_cursor(self, scope: str, when: datetime) -> None:
        st = await self.db.get(SyncState, (settings.VESSEL_IMO, scope))
        if st is None:
            self.db.add(SyncState(vessel_imo=settings.VESSEL_IMO, sync_scope=scope, last_pull_at=when))
        else:
            st.last_pull_at = when
        await self.db.commit()

    async def pull_all(self) -> int:
        """Deletes first, then every entity in parent-before-child order. Returns rows received."""
        total = 0
        async with self._client() as client:
            total += await self._pull_pages(client, "tombstone", None)
            for spec in PULL_SPECS:
                total += await self._pull_pages(client, spec.key, spec)
        return total

    async def _pull_pages(self, client: httpx.AsyncClient, key: str, spec: Optional[Spec]) -> int:
        scope = f"pull:{key}"
        cursor = await self._cursor(scope)
        limit = settings.SYNC_PULL_PAGE_SIZE
        received = 0
        while True:
            resp = None
            for attempt in range(3):
                try:
                    resp = await client.get(f"{self.base}/pull/{key}", params={
                        "vessel_imo": settings.VESSEL_IMO, "since": cursor.isoformat(), "limit": limit})
                    break
                except (httpx.RemoteProtocolError, httpx.ReadTimeout, httpx.ConnectError) as exc:
                    if attempt == 2:
                        raise
                    logger.warning("Pull %s attempt %d/3 dropped (%s: %s). Reconnecting...", key, attempt + 1, type(exc).__name__, exc)
                    await asyncio.sleep(1.0)

            if resp.status_code != 200:
                raise RuntimeError(f"Pull {key} failed: HTTP {resp.status_code} {resp.text[:200]}")
            body = resp.json()
            items = body["items"]
            server_time = _parse(body["server_time"])
            received += len(items)

            if key == "tombstone":
                if items:
                    await apply_tombstones(self.db, items, vessel_imo=settings.VESSEL_IMO)
                    await self.db.commit()
                stamps = [_parse(i["ts"]) for i in items]
            else:
                for item in items:
                    outcome = await apply_row_safely(self.db, spec, item, on_vessel=True, vessel_imo=settings.VESSEL_IMO)
                    if outcome in (INSERTED, UPDATED):
                        await self._queue_blobs(spec, item)
                await self.db.commit()
                stamps = [_parse(i[spec.ts_col]) for i in items if i.get(spec.ts_col)]

            if len(items) >= limit and stamps:
                newest = max(stamps)
                if newest > cursor:
                    cursor = newest
                    await self._save_cursor(scope, cursor)
                    continue
                if limit < 5000:                 # a whole page with one timestamp (a bulk insert): widen the page
                    limit = min(limit * 2, 5000)
                    continue
                cursor = newest + timedelta(microseconds=1)
                await self._save_cursor(scope, cursor)
                continue
            # Caught up: nothing newer than the VM's clock minus the overlap can still be missing.
            await self._save_cursor(scope, max(cursor, server_time - OVERLAP))
            return received

    async def _queue_blobs(self, spec: Spec, item: dict) -> None:
        for col in spec.blob_cols:
            url = item.get(col)
            if not url or not str(url).startswith("http"):
                continue
            bid = uuid.uuid5(uuid.NAMESPACE_URL, url)
            known = (await self.db.execute(select(SyncQueue.id).where(
                SyncQueue.entity_type == BLOB_DOWNLOAD, SyncQueue.entity_id == bid,
                SyncQueue.status.in_(("PENDING", "PROCESSING", "COMPLETED"))).limit(1))).scalar_one_or_none()
            if known is None:
                self.db.add(SyncQueue(id=uuid.uuid4(), entity_type=BLOB_DOWNLOAD, entity_id=bid, operation="DOWNLOAD", payload={"url": url}))

    # ── Health ───────────────────────────────────────────────────────────────

    async def telemetry(self) -> dict:
        failed = (await self.db.execute(
            select(SyncQueue).where(SyncQueue.status == "FAILED").order_by(SyncQueue.created_at.desc()).limit(20)
        )).scalars().all()
        pending = (await self.db.execute(select(SyncQueue.id).where(SyncQueue.status.in_(("PENDING", "PROCESSING"))))).scalars().all()
        errors, seen = [], set()
        for r in failed:
            if r.error_message not in seen:
                seen.add(r.error_message)
                errors.append({"entity": r.entity_type, "entity_id": str(r.entity_id), "msg": r.error_message,
                               "ts": r.created_at.isoformat() if r.created_at else None})
        return {"vessel_imo": settings.VESSEL_IMO, "scope": "orb", "vessel_utc_time": clock.utc_now().isoformat(), "clock_offset_seconds": clock.get_offset(),
                "failed_items_count": len(failed), "pending_items_count": len(pending), "active_errors": errors}

    async def heartbeat(self, extra_error: Optional[str] = None) -> None:
        telemetry = await self.telemetry()
        if extra_error:
            telemetry["active_errors"].insert(0, {"entity": "sync-worker", "msg": extra_error[:500], "ts": clock.utc_now().isoformat()})
        try:
            async with self._client() as client:
                await client.post(f"{self.base}/heartbeat", json={"vessel_imo": settings.VESSEL_IMO, "vessel_telemetry": telemetry})
        except Exception:
            logger.debug("Heartbeat not delivered (offline)", exc_info=True)

    @staticmethod
    def format_error(exc: BaseException) -> str:
        return "".join(traceback.format_exception_only(type(exc), exc)).strip()
