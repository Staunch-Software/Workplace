import logging
import httpx
import math
from datetime import datetime, timedelta
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.sync import SyncQueue, SyncState
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
from app.models.tasks import Task, Notification, LiveFeed
from app.models.user import User
from app.models.vessel import Vessel
from app.services.sync_service import SyncService
from app.core.config import settings
from azure.storage.blob.aio import BlobServiceClient # Async Azure SDK
from azure.identity.aio import ClientSecretCredential
from azure.storage.blob.aio import BlobServiceClient
from app.core.blob_storage import get_blob_service_client 

logger = logging.getLogger("drs.sync_processor")

class SyncProcessor:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.control_db = control_db
        self.cloud_url = settings.CLOUD_BASE_URL
        self.max_retries = settings.MAX_SYNC_RETRIES

    async def process_pending_queue(self):
        """Fetches and processes a batch of pending sync records."""
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

        # Claim records immediately to prevent double-processing
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
                logger.error(f"Sync: Critical failure on record {record.id}: {str(e)}")
        
        await self.db.commit()
        return len(records)

    async def pull_defects_from_cloud(self):
        """DEFECT scope pull from drs_backend. Runs every 60s."""
        state_stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == "DEFECT"
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
                logger.error(f"Defect pull failed: {resp.status_code} {resp.text}")
                return
            changes = resp.json()

        mapping = {
            "defects": Defect,
            "threads": Thread,
            "attachments": Attachment,
            "pr_entries": PrEntry,
            "defect_images": DefectImage,
            "tasks": Task,
            "notifications": Notification,
            "live_feed": LiveFeed,
        }

        for key, items in changes.items():
            model_class = mapping.get(key)
            if not model_class:
                logger.warning(f"Defect Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    await SyncService.apply_snapshot(
                        self.db, model_class, item['id'], item['version'], item
                    )
                except Exception as e:
                    logger.error(f"Defect Pull: Failed to apply {key} id={item.get('id')}: {e}")
                    continue
        await self.db.commit()

        pull_completed_at = datetime.utcnow()
        if not state:
            state = SyncState(
                vessel_imo=settings.VESSEL_IMO,
                last_pull_at=pull_completed_at,
                sync_scope="DEFECT"
            )
            self.db.add(state)
        else:
            state.last_pull_at = pull_completed_at
        await self.db.commit()
        logger.info(f"Defect Pull complete: last_pull_at={pull_completed_at}")


    async def pull_config_from_cloud(self):
        """CONFIG scope pull from workplace_backend. Runs every 24h + startup."""
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

        for key, items in changes.items():
            model_class = mapping.get(key)
            if not model_class:
                logger.warning(f"Config Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    entity_id = item.get('id') or item.get('imo')
                    await SyncService.apply_snapshot(
                        self.db, model_class, entity_id, item.get('version', 1), item
                    )
                except Exception as e:
                    logger.error(f"Config Pull: Failed to apply {key} id={item.get('id')}: {e}")
                    continue
        await self.db.commit()

        pull_completed_at = datetime.utcnow()
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
        if record.entity_type in ["attachment", "defect_image"]:
            blob_already_uploaded = record.payload.get("_blob_uploaded", False)
            if not blob_already_uploaded:
                success = await self._handle_blob_upload(record)
                if not success:
                    await self._handle_failure(record, "Blob upload failed")
                    return
                # Mark blob as uploaded so retries skip re-upload safely
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
            if not blob_path: return True

            # 1. LOCAL CLIENT (Azurite)
            local_service_client = get_blob_service_client()
            
            # 2. CLOUD CLIENT (Azure AD)
            cloud_credential = ClientSecretCredential(
                tenant_id=settings.AZURE_TENANT_ID,
                client_id=settings.AZURE_CLIENT_ID,
                client_secret=settings.AZURE_CLIENT_SECRET
            )
            cloud_url = "https://deploymentvmstorage.blob.core.windows.net"
            cloud_service_client = BlobServiceClient(cloud_url, credential=cloud_credential)

            async with local_service_client:
                local_container = local_service_client.get_container_client(settings.AZURE_CONTAINER_NAME)
                download_stream = await local_container.download_blob(blob_path)
                blob_data = await download_stream.readall()

            async with cloud_service_client:
                # Use the container name from your .env.online
                cloud_container = cloud_service_client.get_container_client("pdf-repository")
                await cloud_container.upload_blob(blob_path, blob_data, overwrite=True)
            
            return True
        except Exception as e:
            logger.error(f"Sync: Blob transfer failed: {e}")
            return False

    async def _push_to_cloud(self, record: SyncQueue) -> (bool, str):
        """Sends the JSON payload to the Cloud API."""
        url = f"{self.cloud_url}/sync/{record.entity_type.lower()}" 
        
        # Prepare payload for Cloud
        sync_data = {
            "entity_id": str(record.entity_id),
            "operation": record.operation,
            "data": record.payload,
            "version": record.version,
            "origin": "VESSEL",
            "vessel_imo": record.payload.get("vessel_imo") or settings.VESSEL_IMO
        }

        try:
            headers = {"X-Sync-API-Key": settings.SYNC_API_KEY} # Add this
    
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url, 
                    json=sync_data, 
                    headers=headers, # Pass the headers here
                    timeout=settings.NETWORK_TIMEOUT_SECONDS * 2
                )
                
                if response.status_code in [200, 201]:
                    return True, None
                else:
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
            # Exponential backoff: store next_retry_at so worker can skip it
            backoff_seconds = min(60 * (2 ** record.retry_count), 3600)  # Cap at 1 hour
            record.next_retry_at = datetime.utcnow() + timedelta(seconds=backoff_seconds)
            logger.warning(f"Sync: Record {record.id} failed. Retry {record.retry_count}/{self.max_retries}. Next attempt in {backoff_seconds}s.")

    async def _mark_as_failed(self, record: SyncQueue, error_msg: str):
        record.status = "FAILED"
        record.error_message = error_msg