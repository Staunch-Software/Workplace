# app/services/sync_processor.py
# Push pending vessel changes to shore, and pull shore changes down to the
# vessel. Same push/pull skeleton as Drs-backend's sync_processor.py.
import logging
import httpx
from datetime import datetime, timedelta, timezone
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.sync import SyncQueue, SyncState
from app.models.report import (
    Report, ReportThread, ReportThreadAttachment, ReportAttachment,
    ReportConfig, ReportEvent,
)
from app.services.sync_service import SyncService
from app.core.config import settings
from app.core.blob_storage import get_blob_service_client

logger = logging.getLogger("reports.sync_processor")

ENTITY_MODEL_MAP = {
    "report": Report,
    "report_thread": ReportThread,
    "report_thread_attachment": ReportThreadAttachment,
    "report_attachment": ReportAttachment,
    "report_config": ReportConfig,
    "report_event": ReportEvent,
}

PULL_MAPPING = {
    "reports": Report,
    "report_threads": ReportThread,
    "report_thread_attachments": ReportThreadAttachment,
    "report_attachments": ReportAttachment,
    "report_configs": ReportConfig,
    "report_events": ReportEvent,
}

BLOB_ENTITY_TYPES = {"report_thread_attachment", "report_attachment"}


class SyncProcessor:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.cloud_url = settings.CLOUD_BASE_URL
        self.max_retries = settings.MAX_SYNC_RETRIES

    async def process_pending_queue(self):
        """Push a batch of pending SyncQueue records from vessel to shore."""
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
        records = (await self.db.execute(stmt)).scalars().all()
        if not records:
            return 0

        for record in records:
            record.status = "PROCESSING"
        await self.db.commit()

        logger.info(f"Sync: Processing {len(records)} records...")
        for record in records:
            try:
                await self.process_single_item(record)
            except Exception as e:
                logger.error(f"Sync: Critical failure on record {record.id}: {e}")

        await self.db.commit()
        return len(records)

    async def process_single_item(self, record: SyncQueue):
        if record.entity_type in BLOB_ENTITY_TYPES:
            if not record.payload.get("_blob_uploaded", False):
                success = await self._handle_blob_upload(record)
                if not success:
                    await self._handle_failure(record, "Blob upload failed")
                    return
                record.payload = {**record.payload, "_blob_uploaded": True}

        success, error_msg = await self._push_to_cloud(record)
        if success:
            record.status = "COMPLETED"
            record.processed_at = datetime.utcnow()
            logger.info(f"Sync: Successfully pushed {record.entity_type} ({record.entity_id})")
        else:
            await self._handle_failure(record, error_msg)

    async def _handle_blob_upload(self, record: SyncQueue) -> bool:
        try:
            blob_path = record.payload.get("blob_path")
            if not blob_path:
                return True

            local_service_client = get_blob_service_client()

            from azure.storage.blob.aio import BlobServiceClient
            from azure.identity.aio import ClientSecretCredential

            cloud_credential = ClientSecretCredential(
                tenant_id=settings.AZURE_TENANT_ID,
                client_id=settings.AZURE_CLIENT_ID,
                client_secret=settings.AZURE_CLIENT_SECRET,
            )
            cloud_url = f"https://{settings.CLOUD_STORAGE_ACCOUNT_NAME}.blob.core.windows.net"
            cloud_service_client = BlobServiceClient(cloud_url, credential=cloud_credential)

            async with local_service_client:
                local_container = local_service_client.get_container_client(settings.AZURE_CONTAINER_NAME)
                download_stream = await local_container.download_blob(blob_path)
                blob_data = await download_stream.readall()

            async with cloud_service_client:
                cloud_container = cloud_service_client.get_container_client(settings.CLOUD_AZURE_CONTAINER_NAME)
                await cloud_container.upload_blob(blob_path, blob_data, overwrite=True)

            return True
        except Exception as e:
            logger.error(f"Sync: Blob transfer failed: {e}")
            return False

    async def _push_to_cloud(self, record: SyncQueue):
        url = f"{self.cloud_url}/sync/{record.entity_type}"
        sync_data = {
            "entity_id": str(record.entity_id),
            "operation": record.operation,
            "data": record.payload,
            "origin": "VESSEL",
            "vessel_imo": record.payload.get("vessel_imo") or settings.VESSEL_IMO,
        }
        try:
            headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, json=sync_data, headers=headers,
                    timeout=settings.NETWORK_TIMEOUT_SECONDS * 2,
                )
                if response.status_code in (200, 201):
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
            logger.warning(f"Sync: Record {record.id} failed. Retry {record.retry_count}/{self.max_retries}.")

    async def pull_changes_from_cloud(self):
        """Pull report/thread/attachment/config/event changes from shore since last pull."""
        state_stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == "REPORTS",
        )
        state = (await self.db.execute(state_stmt)).scalars().first()
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1)

        headers = {"X-Sync-API-Key": settings.SYNC_API_KEY}
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{self.cloud_url}/sync/changes",
                params={"since": last_pull.isoformat(), "vessel_imo": settings.VESSEL_IMO},
                headers=headers,
                timeout=settings.NETWORK_TIMEOUT_SECONDS * 2,
            )
            if resp.status_code != 200:
                logger.error(f"Reports pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        for key, items in changes.items():
            model_class = PULL_MAPPING.get(key)
            if not model_class:
                logger.warning(f"Reports Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    await SyncService.apply_snapshot(self.db, model_class, item["id"], item)
                except Exception as e:
                    logger.error(f"Reports Pull: Failed to apply {key} id={item.get('id')}: {e}")

        pull_completed_at = datetime.utcnow()
        if not state:
            state = SyncState(vessel_imo=settings.VESSEL_IMO, sync_scope="REPORTS", last_pull_at=pull_completed_at)
            self.db.add(state)
        else:
            state.last_pull_at = pull_completed_at
        await self.db.commit()
        logger.info(f"Reports Pull complete: last_pull_at={pull_completed_at}")
