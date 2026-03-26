import logging
import httpx
from datetime import datetime, timedelta
from sqlalchemy import select, inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync import SyncQueue, SyncState
from app.luboil_model import (
    LuboilReport, LuboilSample, Notification,
    LuboilEvent, LuboilEventReadState, LuboilVesselConfig, LuboilNameMapping, LuboilEquipmentType
)
from app.models.control.user import User
from app.models.control.vessel import Vessel
from app.services.sync_service import SyncService
from app.config import settings

logger = logging.getLogger("lub.sync_processor")


class SyncProcessor:
    def __init__(self, db: AsyncSession, control_db: AsyncSession = None):
        self.db = db
        self.control_db = control_db
        self.cloud_url = settings.CLOUD_BASE_URL
        self.max_retries = settings.MAX_SYNC_RETRIES

    async def process_pending_queue(self):
        """PUSH: send pending luboil records to cloud."""
        stmt = (
            select(SyncQueue)
            .where(SyncQueue.status == "PENDING")
            .where(SyncQueue.sync_scope == "LUBOIL")
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

        for record in records:
            record.status = "PROCESSING"
        await self.db.commit()

        if not records:
            return 0

        logger.info(f"Sync: Processing {len(records)} records...")
        for record in records:
            try:
                await self.process_single_item(record)
            except Exception as e:
                logger.error(f"Sync: Critical failure on record {record.id}: {e}")

        await self.db.commit()
        return len(records)

    async def pull_luboil_from_cloud(self):
        """PULL: fetch luboil changes from cloud since last pull."""
        state_stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == "LUBOIL"
        )
        state = (await self.db.execute(state_stmt)).scalars().first()
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1)

        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.cloud_url}/sync/changes",
                params={"since": last_pull.isoformat()},
                headers=headers,
                timeout=settings.NETWORK_TIMEOUT_SECONDS * 2
            )
            if resp.status_code != 200:
                logger.error(f"Luboil pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        # Order matters — equipment types must exist before samples
        mapping = {
            "luboil_equipment_types": LuboilEquipmentType,
            "luboil_name_mappings": LuboilNameMapping,
            "luboil_reports": LuboilReport,
            "luboil_samples": LuboilSample,
            "notifications": Notification,
            "luboil_events": LuboilEvent,
            "luboil_event_read_states": LuboilEventReadState,
            "luboil_vessel_configs": LuboilVesselConfig,
        }

        for key, items in changes.items():
            model_class = mapping.get(key)
            if not model_class:
                logger.warning(f"Luboil Pull: Unknown entity '{key}', skipping.")
                continue
            for item in items:
                try:
                    # Each model uses its own PK name (report_id, sample_id, etc.)
                    pk_col = inspect(model_class).primary_key[0].name
                    entity_id = item.get(pk_col) or item.get("id")
                    if entity_id is None:
                        logger.warning(f"Luboil Pull: No ID found for {key} item, skipping.")
                        continue
                    await SyncService.apply_snapshot(
                        self.db, model_class,
                        entity_id, item.get("version", 1), item
                    )
                except Exception as e:
                    logger.error(f"Luboil Pull: Failed {key} id={item.get('id')}: {e}")

        await self.db.commit()

        pull_completed_at = datetime.utcnow()
        if not state:
            state = SyncState(
                vessel_imo=settings.VESSEL_IMO,
                last_pull_at=pull_completed_at,
                sync_scope="LUBOIL"
            )
            self.db.add(state)
        else:
            state.last_pull_at = pull_completed_at
        await self.db.commit()
        logger.info(f"Luboil Pull complete: last_pull_at={pull_completed_at}")

    async def pull_config_from_cloud(self):
        """PULL: fetch users + vessels from workplace-backend. Runs every 24h + startup."""
        state_stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == "CONFIG"
        )
        state = (await self.db.execute(state_stmt)).scalars().first()
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1)

        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{settings.WORKPLACE_BASE_URL}/sync/config/changes",
                params={"since": last_pull.isoformat()},
                headers=headers,
                timeout=settings.NETWORK_TIMEOUT_SECONDS * 2
            )
            if resp.status_code != 200:
                logger.error(f"Config pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        mapping = {
            "users": User,
            "vessels": Vessel,
        }

        # Config entities go into control_db
        target_db = self.control_db if self.control_db else self.db
        for key, items in changes.items():
            model_class = mapping.get(key)
            if not model_class:
                logger.warning(f"Config Pull: Unknown entity '{key}', skipping.")
                continue
            for item in items:
                try:
                    entity_id = item.get("id") or item.get("imo")
                    await SyncService.apply_snapshot(
                        target_db, model_class,
                        entity_id, item.get("version", 1), item
                    )
                except Exception as e:
                    logger.error(f"Config Pull: Failed {key} id={item.get('id')}: {e}")

        await target_db.commit()

        pull_completed_at = datetime.utcnow()
        # SyncState lives in luboil DB
        if not state:
            state = SyncState(
                vessel_imo=settings.VESSEL_IMO,
                last_pull_at=pull_completed_at,
                sync_scope="CONFIG"
            )
            self.db.add(state)
        else:
            state.last_pull_at = pull_completed_at
        await self.db.commit()
        logger.info(f"Config Pull complete: last_pull_at={pull_completed_at}")

    async def process_single_item(self, record: SyncQueue):
        """Handle blob upload (for LuboilReport PDFs) then push JSON to cloud."""
        if record.entity_type == "luboil_report":
            blob_already_uploaded = record.payload.get("_blob_uploaded", False)
            if not blob_already_uploaded:
                success = await self._handle_blob_upload(record)
                if not success:
                    await self._handle_failure(record, "Blob upload failed")
                    return
                record.payload = {**record.payload, "_blob_uploaded": True}

        success, error_msg = await self._push_to_cloud(record)
        if success:
            record.status = "COMPLETED"
            record.processed_at = datetime.utcnow()
            logger.info(f"Sync: Pushed {record.entity_type} ({record.entity_id})")
        else:
            await self._handle_failure(record, error_msg)

    async def _handle_blob_upload(self, record: SyncQueue) -> bool:
        """Copy PDF from Azurite (local) to real Azure (cloud)."""
        try:
            blob_path = record.payload.get("blob_path")
            if not blob_path:
                return True

            # 1. Download from Azurite
            from azure.storage.blob.aio import BlobServiceClient as AsyncBlobServiceClient
            local_conn = settings.AZURITE_CONNECTION_STRING
            async with AsyncBlobServiceClient.from_connection_string(local_conn) as local_client:
                from app.config import settings as s
                container = s.AZURE_CONTAINER_NAME
                local_blob = local_client.get_container_client(container)
                download_stream = await local_blob.download_blob(blob_path)
                blob_data = await download_stream.readall()

            # 2. Upload to real Azure
            cloud_conn = settings.AZURE_STORAGE_CONNECTION_STRING
            async with AsyncBlobServiceClient.from_connection_string(cloud_conn) as cloud_client:
                cloud_container = cloud_client.get_container_client(container)
                await cloud_container.upload_blob(blob_path, blob_data, overwrite=True)

            logger.info(f"Sync: Blob transferred {blob_path}")
            return True

        except Exception as e:
            logger.error(f"Sync: Blob transfer failed: {e}")
            return False

    async def _push_to_cloud(self, record: SyncQueue):
        """POST JSON payload to cloud sync endpoint."""
        url = f"{self.cloud_url}/sync/{record.entity_type.replace('_', '-')}"
        sync_data = {
            "entity_id": str(record.entity_id),
            "operation": record.operation,
            "data": record.payload,
            "version": record.version,
            "origin": "VESSEL",
            "vessel_imo": record.payload.get("vessel_imo") or settings.VESSEL_IMO
        }
        try:
            headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, json=sync_data, headers=headers,
                    timeout=settings.NETWORK_TIMEOUT_SECONDS * 2
                )
                if response.status_code in [200, 201]:
                    return True, None
                return False, f"Cloud returned {response.status_code}: {response.text}"
        except httpx.RequestError as e:
            return False, f"Network error: {str(e)}"

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
            logger.warning(f"Sync: Record {record.id} retry {record.retry_count}/{self.max_retries} in {backoff_seconds}s.")