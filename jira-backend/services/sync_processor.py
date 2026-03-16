import logging
import httpx
from datetime import datetime, timedelta
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.sync import SyncQueue, SyncState
from models.schema import Ticket, Comment
from models.control import User, Vessel
from services.sync_service import SyncService
from core.config import settings

logger = logging.getLogger("jira.sync_processor")

# Map entity_type strings used in sync_queue → model classes for TICKET scope
TICKET_ENTITY_MAP = {
    "ticket": Ticket,
    "comment": Comment,
}

# CONFIG scope models pulled from workplace-backend
CONFIG_ENTITY_MAP = {
    "users": User,
    "vessels": Vessel,
}


class SyncProcessor:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.cloud_url = settings.CLOUD_BASE_URL
        self.max_retries = settings.MAX_SYNC_RETRIES

    # ── PUSH ──────────────────────────────────────────────────────────────

    async def process_pending_queue(self):
        """Fetch and process a batch of PENDING sync records (vessel → shore push)."""
        stmt = (
            select(SyncQueue)
            .where(SyncQueue.status == "PENDING")
            .where(
                (SyncQueue.next_retry_at == None) |
                (SyncQueue.next_retry_at <= datetime.utcnow())
            )
            .order_by(SyncQueue.created_at.asc())
            .limit(settings.SYNC_BATCH_SIZE)
            .with_for_update(skip_locked=True)
        )
        result = await self.db.execute(stmt)
        records = result.scalars().all()

        # Claim immediately to prevent double-processing
        for record in records:
            record.status = "PROCESSING"
        await self.db.commit()

        if not records:
            return 0

        logger.info(f"Sync: Processing {len(records)} records...")
        for record in records:
            try:
                await self._process_single_item(record)
            except Exception as e:
                logger.error(f"Sync: Critical failure on record {record.id}: {e}")

        await self.db.commit()
        return len(records)

    async def _process_single_item(self, record: SyncQueue):
        success, error_msg = await self._push_to_cloud(record)
        if success:
            record.status = "COMPLETED"
            record.processed_at = datetime.utcnow()
            logger.info(f"Sync: Pushed {record.entity_type} ({record.entity_id})")
        else:
            await self._handle_failure(record, error_msg)

    async def _push_to_cloud(self, record: SyncQueue):
        url = f"{self.cloud_url}/sync/{record.entity_type.lower()}"
        sync_data = {
            "entity_id": str(record.entity_id),
            "operation": record.operation,
            "data": record.payload,
            "version": record.version,
            "origin": "VESSEL",
            "vessel_imo": record.payload.get("vessel_imo") or settings.VESSEL_IMO,
        }
        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    json=sync_data,
                    headers=headers,
                    timeout=settings.NETWORK_TIMEOUT_SECONDS * 2,
                )
                if response.status_code in [200, 201]:
                    return True, None
                return False, f"Cloud returned {response.status_code}: {response.text}"
        except httpx.RequestError as e:
            return False, f"Network error: {e}"

    async def _handle_failure(self, record: SyncQueue, error_msg: str):
        record.retry_count += 1
        record.error_message = error_msg
        if record.retry_count >= self.max_retries:
            record.status = "FAILED"
            logger.error(f"Sync: Record {record.id} permanently failed after {self.max_retries} retries.")
        else:
            record.status = "PENDING"
            backoff_seconds = min(60 * (2 ** record.retry_count), 3600)
            record.next_retry_at = datetime.utcnow() + timedelta(seconds=backoff_seconds)
            logger.warning(
                f"Sync: Record {record.id} failed. "
                f"Retry {record.retry_count}/{self.max_retries}. "
                f"Next attempt in {backoff_seconds}s."
            )

    # ── PULL: TICKET scope ────────────────────────────────────────────────

    async def pull_tickets_from_cloud(self):
        """Pull ticket/comment changes from shore. Runs every 60s."""
        state = await self._get_sync_state("TICKET")
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1)

        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.cloud_url}/sync/changes",
                params={"since": last_pull.isoformat()},
                headers=headers,
                timeout=settings.NETWORK_TIMEOUT_SECONDS * 2,
            )
            if resp.status_code != 200:
                logger.error(f"Ticket pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        for key, items in changes.items():
            model_class = TICKET_ENTITY_MAP.get(key)
            if not model_class:
                logger.warning(f"Ticket Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    await SyncService.apply_snapshot(
                        self.db, model_class, item["id"], item.get("version", 1), item
                    )
                except Exception as e:
                    logger.error(f"Ticket Pull: Failed to apply {key} id={item.get('id')}: {e}")

        await self.db.commit()
        await self._update_sync_state(state, "TICKET")
        logger.info("Ticket Pull complete.")

    # ── PULL: CONFIG scope ────────────────────────────────────────────────

    async def pull_config_from_cloud(self):
        """Pull users/vessels from workplace-backend. Runs every 24h + startup."""
        state = await self._get_sync_state("CONFIG")
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1)

        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.WORKPLACE_BASE_URL}/sync/config/changes",
                params={"since": last_pull.isoformat()},
                headers=headers,
                timeout=settings.NETWORK_TIMEOUT_SECONDS * 2,
            )
            if resp.status_code != 200:
                logger.error(f"Config pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        for key, items in changes.items():
            model_class = CONFIG_ENTITY_MAP.get(key)
            if not model_class:
                logger.warning(f"Config Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    entity_id = item.get("id") or item.get("imo")
                    await SyncService.apply_snapshot(
                        self.db, model_class, entity_id, item.get("version", 1), item
                    )
                except Exception as e:
                    logger.error(f"Config Pull: Failed to apply {key} id={item.get('id')}: {e}")

        await self.db.commit()
        await self._update_sync_state(state, "CONFIG")
        logger.info("Config Pull complete.")

    # ── helpers ───────────────────────────────────────────────────────────

    async def _get_sync_state(self, scope: str):
        stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == scope,
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def _update_sync_state(self, state, scope: str):
        now = datetime.utcnow()
        if not state:
            state = SyncState(
                vessel_imo=settings.VESSEL_IMO,
                last_pull_at=now,
                sync_scope=scope,
            )
            self.db.add(state)
        else:
            state.last_pull_at = now
        await self.db.commit()