# app/services/sync_processor.py
# Push pending vessel changes to shore, and pull shore changes down to the
# vessel. Same push/pull skeleton as Drs-backend's sync_processor.py.
#
# FIXES applied (2026-08-21):
#   - BUG 3/4: All datetime.utcnow() → datetime.now(timezone.utc) to match
#     DateTime(timezone=True) columns (SyncQueue, SyncState). asyncpg rejects
#     naive vs aware datetime comparisons.
#   - BUG 5: pull_changes_from_cloud() now creates Notification rows for
#     vessel users when a new report_thread arrives from shore, so the
#     notification bell lights up on the vessel side.
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
from app.models.notification import Notification
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
        # FIX BUG 3: Use timezone-aware datetime to match DateTime(timezone=True) column.
        now_utc = datetime.now(timezone.utc)
        stmt = (
            select(SyncQueue)
            .where(SyncQueue.status == "PENDING")
            .where(
                (SyncQueue.next_retry_at == None) |
                (SyncQueue.next_retry_at <= now_utc)
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
            # FIX BUG 3: timezone-aware timestamp for processed_at
            record.processed_at = datetime.now(timezone.utc)
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
            # FIX BUG 3: timezone-aware datetime for next_retry_at (DateTime(timezone=True) column)
            record.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=backoff_seconds)
            logger.warning(f"Sync: Record {record.id} failed. Retry {record.retry_count}/{self.max_retries}.")

    async def pull_changes_from_cloud(self):
        """Pull report/thread/attachment/config/event changes from shore since last pull."""
        state_stmt = select(SyncState).where(
            SyncState.vessel_imo == settings.VESSEL_IMO,
            SyncState.sync_scope == "REPORTS",
        )
        state = (await self.db.execute(state_stmt)).scalars().first()

        # FIX BUG 4: Use timezone-aware fallback so asyncpg doesn't reject the
        # comparison of aware vs naive timestamps when reading SyncState.last_pull_at.
        last_pull = state.last_pull_at if state else datetime(2000, 1, 1, tzinfo=timezone.utc)

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

        # Track newly inserted threads so we can create notifications for them.
        new_thread_ids = set()

        for key, items in changes.items():
            model_class = PULL_MAPPING.get(key)
            if not model_class:
                logger.warning(f"Reports Pull: Unknown entity type '{key}', skipping.")
                continue
            for item in items:
                try:
                    # Check if this thread already exists locally BEFORE applying snapshot.
                    # If it doesn't exist yet, it's a new message from shore.
                    is_new_thread = False
                    if key == "report_threads":
                        existing_check = (await self.db.execute(
                            select(ReportThread).where(ReportThread.id == item["id"])
                        )).scalars().first()
                        is_new_thread = (existing_check is None)

                    await SyncService.apply_snapshot(self.db, model_class, item["id"], item)

                    if is_new_thread:
                        # Only count threads sent FROM shore/admin (author_role != VESSEL)
                        # so we don't re-notify for threads the vessel itself posted.
                        author_role = item.get("author_role", "")
                        if author_role.upper() != "VESSEL":
                            new_thread_ids.add((item["id"], item.get("report_id"), item.get("author_name", "Shore")))
                except Exception as e:
                    logger.error(f"Reports Pull: Failed to apply {key} id={item.get('id')}: {e}")

        # FIX BUG 5: Create Notification rows for vessel users when shore posts new threads.
        # This is what makes the notification bell light up on the vessel side.
        if new_thread_ids:
            await self._create_vessel_notifications(new_thread_ids, changes)

        # FIX BUG 4: Use timezone-aware timestamp for SyncState.last_pull_at.
        pull_completed_at = datetime.now(timezone.utc)
        if not state:
            state = SyncState(
                vessel_imo=settings.VESSEL_IMO,
                sync_scope="REPORTS",
                last_pull_at=pull_completed_at,
            )
            self.db.add(state)
        else:
            state.last_pull_at = pull_completed_at
        await self.db.commit()
        logger.info(f"Reports Pull complete: last_pull_at={pull_completed_at.isoformat()}")

    async def _create_vessel_notifications(self, new_thread_ids: set, changes: dict):
        """
        FIX BUG 5: For each new thread pulled from shore, create a Notification
        for all active VESSEL users on the local control DB. This fires the
        notification bell badge on the vessel side.

        new_thread_ids: set of (thread_id_str, report_id_str, author_name) tuples
        changes: the full changes dict (used to look up report names)
        """
        from sqlalchemy import text as sql_text
        from uuid import UUID

        try:
            # Build a report_id → report record lookup from the pulled data.
            # We prefer the freshly pulled records so we don't need an extra DB query.
            report_map = {}
            for r in changes.get("reports", []):
                report_map[str(r.get("id"))] = r

            # If a thread's report wasn't updated this cycle, query the local DB.
            missing_report_ids = {
                str(rid)
                for (_, rid, _) in new_thread_ids
                if rid and str(rid) not in report_map
            }
            if missing_report_ids:
                for rid in missing_report_ids:
                    try:
                        report_row = (await self.db.execute(
                            select(Report).where(Report.id == UUID(rid))
                        )).scalars().first()
                        if report_row:
                            report_map[rid] = {
                                c.name: getattr(report_row, c.name)
                                for c in report_row.__table__.columns
                            }
                    except Exception:
                        pass

            # Load all active vessel users from the local control DB.
            # The control DB is kept in sync by the DRS/workplace sync worker.
            from app.core.database_control import ControlSession
            async with ControlSession() as ctrl_db:
                users_res = await ctrl_db.execute(
                    sql_text(
                        "SELECT id, full_name FROM users "
                        "WHERE is_active = true AND role = 'VESSEL'"
                    )
                )
                vessel_users = users_res.fetchall()  # [(id, full_name), ...]

            if not vessel_users:
                logger.debug("No active vessel users found; skipping notification creation.")
                return

            import uuid as _uuid

            for thread_id_str, report_id_str, author_name in new_thread_ids:
                report_info = report_map.get(str(report_id_str), {})
                report_name = report_info.get("report_name", "a report")
                vessel_name = report_info.get("vessel_name", "")

                title = f"New message from {author_name}"
                if vessel_name:
                    title += f" — {vessel_name}"

                # report_id/thread_id column is native uuid — the sync payload gives
                # us plain JSON strings, so cast at the boundary rather than loosening
                # the column type (this DB has no migrations, so its uuid columns
                # can't be altered from the model alone).
                thread_uuid = UUID(str(thread_id_str))
                report_uuid = UUID(str(report_id_str)) if report_id_str else None

                for user_row in vessel_users:
                    uid = str(user_row[0])

                    # Idempotency guard: skip if a notification for this exact thread
                    # and user already exists (handles re-pull after a failed commit).
                    existing_notif = (await self.db.execute(
                        select(Notification).where(
                            Notification.user_id == uid,
                            Notification.thread_id == thread_uuid,
                            Notification.type == "new_thread",
                        )
                    )).scalars().first()
                    if existing_notif:
                        continue

                    notif = Notification(
                        id=_uuid.uuid4(),
                        user_id=uid,
                        type="new_thread",
                        title=title,
                        body=f"New message in {report_name}",
                        report_id=report_uuid,
                        thread_id=thread_uuid,
                        is_read=False,
                        created_at=datetime.now(timezone.utc).replace(tzinfo=None),  # stored naive
                    )
                    self.db.add(notif)

            await self.db.commit()
            logger.info(
                f"Vessel Notifications: Created notifications for {len(new_thread_ids)} new shore threads "
                f"→ {len(vessel_users)} vessel users."
            )

        except Exception as e:
            logger.error(f"Vessel Notifications: Failed to create pull notifications: {e}", exc_info=True)
            # Non-fatal — don't crash the sync cycle over a notification failure.
            await self.db.rollback()
