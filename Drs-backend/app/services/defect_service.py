# =============================================================================
# app/services/defect_service.py  — PRODUCTION READY (Shore + Vessel)
#
# ONE file runs on BOTH deployments:
#
#   Shore  (STORAGE_MODE=online)  → business logic only, SyncQueue SKIPPED.
#   Vessel (STORAGE_MODE=offline) → business logic + SyncQueue row written
#                                   so background worker can push to shore
#                                   when connectivity returns.
#
# The only difference between the two deployments is the `if _should_sync():`
# guard around every SyncQueue insertion. Everything else is identical.
#
# METHODS:
#   1.  create_defect()       — date parsing, enum validation, vessel notify
#   2.  update_defect()       — full status machine (request/approve/reject),
#                               priority escalation, image validation, system threads
#   3.  delete_defect()       — soft delete (is_deleted = True)
#   4.  close_defect()        — legacy full close-with-evidence endpoint
#   5.  create_thread()       — with @mention task creation
#   6.  add_attachment()      — metadata only (blob already uploaded by UI)
#   7.  save_defect_image()   — before/after image metadata
#   8.  delete_defect_image() — hard delete from DB (blob stays in storage)
#   9.  create_pr_entry()     — commit-first pattern so real UUID is in SyncQueue
#   10. update_pr_entry()     — partial update (pr_number / pr_description)
#   11. delete_pr_entry()     — soft delete (is_deleted = True)
#
# SyncQueue Schema (Advanced Enterprise):
#   - entity_id  → UUID object (not str)
#   - operation  → "CREATE" | "UPDATE" | "DELETE"  (renamed from action)
#   - version    → 1
#   - origin     → "VESSEL"
# =============================================================================

import uuid
import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.models.defect import Defect, Thread, Attachment, DefectImage, PrEntry
from app.models.sync import SyncQueue
from app.models.vessel import Vessel
from app.models.enums import DefectStatus, DefectPriority
from app.services.notification_service import notify_vessel_users, create_task_for_mentions
from app.core.config import settings

logger = logging.getLogger(__name__)


# =============================================================================
# SYNC GUARD
# =============================================================================

def _should_sync() -> bool:
    """
    Returns True only when running on a vessel in offline mode.
    Single place that controls whether a SyncQueue row is written.

    Shore  (STORAGE_MODE=online)  → False  (skip SyncQueue, already in cloud)
    Vessel (STORAGE_MODE=offline) → True   (write SyncQueue for later push)

    Exposed at module level so defects.py can import and use it directly
    for the batch import endpoint's inline SyncQueue writes.
    """
    return settings.is_offline_vessel


# =============================================================================
# SERVICE CLASS
# =============================================================================

class DefectService:

    # =========================================================================
    # 1. CREATE DEFECT
    # =========================================================================
    @staticmethod
    async def create_defect(db: AsyncSession, control_db: AsyncSession, defect_in, user) -> Defect:
        """
        Shore  → saves Defect to cloud DB. SyncQueue skipped.
        Vessel → saves Defect to local DB + SyncQueue entry for later push.

        - Validates date format (YYYY-MM-DD) with clear error messages.
        - Validates priority/status enums before writing to DB.
        - Sends vessel notification (non-blocking, separate commit).
        - Returns defect with vessel_name and empty pr_entries pre-populated
          so the response serializer doesn't trigger lazy-load errors.
        """
        logger.info(f"[DefectService] Creating defect for vessel: {defect_in.vessel_imo}")

        # --- Parse dates ---
        date_identified = None
        if defect_in.date:
            try:
                date_identified = datetime.strptime(defect_in.date, '%Y-%m-%d')
            except ValueError:
                raise ValueError("Invalid date format. Use YYYY-MM-DD.")

        target_close_date = None
        if defect_in.target_close_date:
            try:
                target_close_date = datetime.strptime(defect_in.target_close_date, '%Y-%m-%d')
            except ValueError:
                raise ValueError("Invalid target_close_date format. Use YYYY-MM-DD.")

        # --- Validate enums ---
        try:
            priority_enum = DefectPriority(defect_in.priority.upper())
            status_enum = DefectStatus(defect_in.status.upper())
        except ValueError as e:
            raise ValueError(f"Invalid enum value: {str(e)}")

        # --- Build defect object (COMMON to both Shore and Vessel) ---
        new_defect = Defect(
            id=defect_in.id,
            vessel_imo=defect_in.vessel_imo,
            reported_by_id=user.id,
            title=defect_in.equipment,
            equipment_name=defect_in.equipment,
            description=defect_in.description,
            defect_source=defect_in.defect_source,
            priority=priority_enum,
            status=status_enum,
            responsibility=defect_in.responsibility,
            pr_status=defect_in.pr_status or 'Not Set',
            date_identified=date_identified,
            target_close_date=target_close_date,
            json_backup_path=defect_in.json_backup_path,
            before_image_required=defect_in.before_image_required or False,
            after_image_required=defect_in.after_image_required or False,
            before_image_path=defect_in.before_image_path,
            after_image_path=defect_in.after_image_path,
            is_owner=False,
            origin="VESSEL" if _should_sync() else "SHORE",
            updated_at=datetime.utcnow(),
        )
        db.add(new_defect)

        # --- SyncQueue: VESSEL ONLY ---
        if _should_sync():
            # 1. Get the raw input
            sync_payload = defect_in.model_dump(mode='json')
            
            # 2. Inject the missing database columns!
            sync_payload["reported_by_id"] = str(user.id)
            sync_payload["title"] = defect_in.equipment
            sync_payload["equipment_name"] = defect_in.equipment
            sync_payload["date_identified"] = date_identified.isoformat() if date_identified else None
            sync_payload["target_close_date"] = target_close_date.isoformat() if target_close_date else None

            db.add(SyncQueue(
                entity_id=new_defect.id,           
                entity_type="DEFECT",
                operation="CREATE",                 
                payload=sync_payload,  # <--- Use the updated payload here
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))
            logger.debug(f"[DefectService] SyncQueue queued: DEFECT CREATE {new_defect.id}")

        # --- Atomic commit (defect + optional SyncQueue row together) ---
        await db.commit()
        await db.refresh(new_defect, attribute_names=["pr_entries"])

        # --- Notifications (non-blocking, separate commit so main write is safe) ---
        vessel = await control_db.get(Vessel, defect_in.vessel_imo)
        vessel_name = vessel.name if vessel else defect_in.vessel_imo
        try:
            await notify_vessel_users(
                db=db,
                control_db=control_db,
                vessel_imo=defect_in.vessel_imo,
                vessel_name=vessel_name,
                title="New Defect Reported",
                message=f"New defect: {defect_in.equipment}",
                exclude_user_id=user.id,
                defect_id=str(new_defect.id),
            )
            await db.commit()
        except Exception as e:
            logger.error(f"[DefectService] Notification failed (defect still created): {e}")

        # Pre-populate computed fields to avoid serializer lazy-load errors
        new_defect.vessel_name = vessel_name
        new_defect.pr_entries = []
        return new_defect

    # =========================================================================
    # 2. UPDATE DEFECT  — Full Status Machine
    # =========================================================================
    @staticmethod
    async def update_defect(db: AsyncSession, control_db: AsyncSession, defect_id: UUID, defect_update, user) -> Optional[Defect]:
        """
        Applies full status-machine logic, then writes SyncQueue on vessel only.
        """
        defect = await db.get(Defect, defect_id)
        if not defect:
            return None

        notification_task = None
        priority_changed = False
        old_priority = defect.priority
        update_data = defect_update.model_dump(exclude_unset=True)

        for field, value in update_data.items():

            # -----------------------------------------------------------------
            # PRIORITY
            # -----------------------------------------------------------------
            if field == "priority":
                try:
                    new_priority = DefectPriority(value.upper())
                    if new_priority != defect.priority:
                        priority_changed = True
                        old_priority = defect.priority   # capture BEFORE mutating
                        defect.priority = new_priority
                except ValueError:
                    pass

            # -----------------------------------------------------------------
            # STATUS MACHINE
            # -----------------------------------------------------------------
            elif field == "status":
                try:
                    new_status = DefectStatus(value.upper())

                    # VESSEL → requests closure (OPEN/any → PENDING_CLOSURE)
                    if (
                        new_status == DefectStatus.PENDING_CLOSURE
                        and defect.status != DefectStatus.PENDING_CLOSURE
                    ):
                        if not defect_update.closure_remarks or len(defect_update.closure_remarks) < 50:
                            raise ValueError("Closure remarks must be at least 50 characters.")

                        missing_images = []
                        if defect.before_image_required:
                            r = await db.execute(select(DefectImage).where(
                                DefectImage.defect_id == defect_id,
                                DefectImage.image_type == 'before',
                            ))
                            if not r.scalars().all():
                                missing_images.append("Before")

                        if defect.after_image_required:
                            r = await db.execute(select(DefectImage).where(
                                DefectImage.defect_id == defect_id,
                                DefectImage.image_type == 'after',
                            ))
                            if not r.scalars().all():
                                missing_images.append("After")

                        if missing_images:
                            raise ValueError(
                                f"Cannot request closure. Missing mandatory images: {', '.join(missing_images)}"
                            )

                        defect.closure_remarks = defect_update.closure_remarks
                        db.add(Thread(
                            id=uuid.uuid4(),
                            defect_id=defect.id,
                            user_id=user.id,
                            author_role="SYSTEM",
                            is_system_message=True,
                            body=f"Closure requested by {user.full_name}. Awaiting shore approval.",
                        ))
                        notification_task = {
                            "type": "Closure Requested",
                            "message": f"Closure requested: {defect.title}",
                        }

                    # SHORE → approves closure (PENDING_CLOSURE → CLOSED)
                    elif (
                        new_status == DefectStatus.CLOSED
                        and defect.status == DefectStatus.PENDING_CLOSURE
                    ):
                        defect.closed_at = datetime.now()
                        defect.closed_by_id = user.id
                        db.add(Thread(
                            id=uuid.uuid4(),
                            defect_id=defect.id,
                            user_id=user.id,
                            author_role="SYSTEM",
                            is_system_message=True,
                            body=f" Closure APPROVED by {user.full_name}",
                        ))
                        notification_task = {
                            "type": "Closure Approved",
                            "message": f"Closure approved: {defect.title}",
                        }

                    # SHORE → rejects closure (PENDING_CLOSURE → OPEN)
                    elif (
                        new_status == DefectStatus.OPEN
                        and defect.status == DefectStatus.PENDING_CLOSURE
                    ):
                        defect.closure_remarks = None
                        db.add(Thread(
                            id=uuid.uuid4(),
                            defect_id=defect.id,
                            user_id=user.id,
                            author_role="SYSTEM",
                            is_system_message=True,
                            body=f"Closure REJECTED by {user.full_name}",
                        ))
                        notification_task = {
                            "type": "Closure Rejected",
                            "message": f"Closure rejected: {defect.title}",
                        }

                    defect.status = new_status

                except ValueError:
                    raise  # Surface as HTTP 400 in the endpoint

            elif field == "target_close_date":
                if value is None:
                    defect.target_close_date = None
                else:
                    try:
                        defect.target_close_date = datetime.strptime(value, '%Y-%m-%d')
                    except (ValueError, TypeError):
                        raise ValueError("Invalid target_close_date format. Use YYYY-MM-DD.")
 
            elif field == "equipment_name":
                defect.title = value
                defect.equipment_name = value  

            # -----------------------------------------------------------------
            # ALL OTHER SCALAR FIELDS
            # closure_remarks handled above — skip here to avoid overwriting
            # -----------------------------------------------------------------
            elif field != "closure_remarks":
                setattr(defect, field, value)

        # --- Priority system thread (after loop so defect.priority is final) ---
        if priority_changed:
            old_str = old_priority.value if hasattr(old_priority, "value") else str(old_priority)
            new_str = defect.priority.value if hasattr(defect.priority, "value") else str(defect.priority)
            db.add(Thread(
                id=uuid.uuid4(),
                defect_id=defect.id,
                user_id=user.id,
                author_role="SYSTEM",
                is_system_message=True,
                body=f"priority escalated from {old_str} to {new_str} by {user.full_name}",
            ))

        # --- Version bump (guard against None) ---
        defect.version = (defect.version or 0) + 1
        defect.updated_at = datetime.utcnow()

        # --- SyncQueue: VESSEL ONLY ---
        if _should_sync():
            db.add(SyncQueue(
                entity_id=defect.id,
                entity_type="DEFECT",
                operation="UPDATE",
                payload=update_data,
                version=defect.version,
                origin="VESSEL",
                status="PENDING",
            ))
            logger.debug(f"[DefectService] SyncQueue queued: DEFECT UPDATE {defect.id}")

        # --- Atomic commit ---
        await db.commit()
        await db.refresh(defect, attribute_names=["pr_entries"])

        # --- Notifications (non-blocking, separate commit) ---
        if notification_task or priority_changed:
            logger.info(f"[DEBUG] priority_changed={priority_changed}, notification_task={notification_task}")
            try:
                vessel = await control_db.get(Vessel, defect.vessel_imo)
                logger.info(f"[DEBUG] vessel={vessel}, vessel_imo={defect.vessel_imo}")
                vessel_name = vessel.name if vessel else defect.vessel_imo

                if notification_task:
                    await notify_vessel_users(
                        db=db,
                        control_db=control_db,
                        vessel_imo=defect.vessel_imo,
                        vessel_name=vessel_name,
                        title=notification_task["type"],
                        message=notification_task["message"],
                        exclude_user_id=user.id,
                        defect_id=str(defect.id),
                    )

                if priority_changed:
                    old_str = old_priority.value if hasattr(old_priority, "value") else str(old_priority)
                    new_str = defect.priority.value if hasattr(defect.priority, "value") else str(defect.priority)
                    logger.info(f"[DEBUG] Sending priority notification: {old_str} -> {new_str}")
                    await notify_vessel_users(
                        db=db,
                        control_db=control_db,
                        vessel_imo=defect.vessel_imo,
                        vessel_name=vessel_name,
                        title="Priority Escalated",
                        message=f"Priority raised to {new_str} for: {defect.title}",
                        exclude_user_id=user.id,
                        defect_id=str(defect.id),
                    )
                    logger.info(f"[DEBUG] Priority notification sent successfully")
                await db.commit()
            except Exception as e:
                logger.error(f"[DefectService] Update notification failed (defect still updated): {e}")

        return defect
    
    
    # =========================================================================
    # 3. DELETE DEFECT (Soft)
    # =========================================================================
    @staticmethod
    async def delete_defect(db: AsyncSession, defect_id: UUID) -> Optional[Defect]:
        """
        Soft-deletes a defect by setting is_deleted=True.
        SyncQueue entry written on vessel so the cloud can mirror the deletion.
        """
        defect = await db.get(Defect, defect_id)
        if not defect:
            return None

        defect.is_deleted = True
        defect.updated_at = datetime.utcnow()

        if _should_sync():
            db.add(SyncQueue(
                entity_id=defect.id,               # UUID object (not str)
                entity_type="DEFECT",
                operation="DELETE",                 # renamed from action
                payload={"id": str(defect.id), "is_deleted": True, "updated_at": datetime.utcnow().isoformat()},
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        return defect

    # =========================================================================
    # 4. CLOSE DEFECT (Legacy full-close endpoint)
    # =========================================================================
    @staticmethod
    async def close_defect(db: AsyncSession, control_db: AsyncSession, defect_id: UUID, close_data, user) -> Optional[Defect]:
        """
        Used by the legacy POST /{defect_id}/close endpoint.
        Closes a defect immediately to CLOSED status with evidence images.

        - Validates mandatory before/after images are present before closing.
        - Sets closure_remarks, closure_image_before, closure_image_after.
        - Creates SYSTEM thread with truncated remarks preview.
        - Writes SyncQueue on vessel.
        - Sends vessel notification.
        """
        defect = await db.get(Defect, defect_id)
        if not defect:
            return None

        # Validate mandatory images
        missing_images = []
        if defect.before_image_required:
            r = await db.execute(select(DefectImage).where(
                DefectImage.defect_id == defect_id,
                DefectImage.image_type == 'before',
            ))
            if not r.scalars().all():
                missing_images.append("Before")

        if defect.after_image_required:
            r = await db.execute(select(DefectImage).where(
                DefectImage.defect_id == defect_id,
                DefectImage.image_type == 'after',
            ))
            if not r.scalars().all():
                missing_images.append("After")

        if missing_images:
            raise ValueError(
                f"Cannot close defect. Missing mandatory images: {', '.join(missing_images)}"
            )

        defect.status = DefectStatus.CLOSED
        defect.closed_at = datetime.now()
        defect.closed_by_id = user.id
        defect.closure_remarks = close_data.closure_remarks
        defect.closure_image_before = close_data.closure_image_before
        defect.closure_image_after = close_data.closure_image_after

        db.add(Thread(
            id=uuid.uuid4(),
            defect_id=defect.id,
            user_id=user.id,
            author_role="SYSTEM",
            is_system_message=True,
            body=f"Defect CLOSED by {user.full_name}. Remarks: {close_data.closure_remarks[:50]}...",
        ))

        if _should_sync():
            db.add(SyncQueue(
                entity_id=defect.id,               # UUID object (not str)
                entity_type="DEFECT",
                operation="UPDATE",                 # renamed from action
                payload={
                    "status": "CLOSED",
                    "closure_remarks": close_data.closure_remarks,
                    "closure_image_before": close_data.closure_image_before,
                    "closure_image_after": close_data.closure_image_after,
                    "closed_at": datetime.now().isoformat(),
                },
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        await db.refresh(defect, attribute_names=["pr_entries"])

        try:
            vessel = await control_db.get(Vessel, defect.vessel_imo)
            vessel_name = vessel.name if vessel else defect.vessel_imo
            await notify_vessel_users(
                db=db,
                control_db=control_db,
                vessel_imo=defect.vessel_imo,
                vessel_name=vessel_name,
                title="Defect Closed",
                message=f"Defect '{defect.title}' closed with evidence.",
                exclude_user_id=user.id,
                defect_id=str(defect.id),
            )
            await db.commit()
        except Exception as e:
            logger.error(f"[DefectService] Close notification failed: {e}")

        return defect

    # =========================================================================
    # 5. CREATE THREAD
    # =========================================================================
    @staticmethod
    async def create_thread(db: AsyncSession, defect_id: UUID, thread_in, user) -> Thread:
        """
        Creates a thread/comment on a defect.
        Sends @mention tasks to tagged users.
        Writes SyncQueue on vessel.

        Note: is_internal filtering and SHORE/ADMIN role guard are handled
        by the endpoint in defects.py — the service just writes the row.
        """
        new_thread = Thread(
            id=thread_in.id,
            defect_id=defect_id,
            user_id=user.id,
            author_role=thread_in.author,
            body=thread_in.body,
            tagged_user_ids=thread_in.tagged_user_ids,
            origin="VESSEL" if _should_sync() else "SHORE",
        )
        db.add(new_thread)

        if thread_in.tagged_user_ids:
            try:
                await create_task_for_mentions(
                    db=db,
                    defect_id=defect_id,
                    tagged_user_ids=thread_in.tagged_user_ids,
                    created_by_id=user.id,
                    message_preview=thread_in.body[:100],
                )
            except Exception as e:
                logger.error(f"[DefectService] Mention task failed (thread still created): {e}")

        if _should_sync():
            db.add(SyncQueue(
                entity_id=new_thread.id,           # UUID object (not str)
                entity_type="THREAD",
                operation="CREATE",                 # renamed from action
                payload=thread_in.model_dump(mode='json'),
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        await db.refresh(new_thread, attribute_names=["attachments"])
        return new_thread

    # =========================================================================
    # 6. ADD ATTACHMENT
    # =========================================================================
    @staticmethod
    async def add_attachment(
        db: AsyncSession,
        defect_id: UUID,
        thread_id: UUID,
        attachment_in,
    ) -> Attachment:
        """
        Saves attachment metadata to the DB.
        The actual blob was already uploaded directly to Azure by the browser UI.
        Writes SyncQueue on vessel.
        """
        new_attachment = Attachment(
            id=attachment_in.id,
            thread_id=thread_id,
            file_name=attachment_in.file_name,
            blob_path=attachment_in.blob_path,
            file_size=attachment_in.file_size,
            content_type=attachment_in.content_type,
            origin="VESSEL" if _should_sync() else "SHORE",        # ← ADD THIS
            version=1,            
            updated_at=datetime.utcnow(),  # ← ADD THIS
        )
        db.add(new_attachment)

        if _should_sync():
            db.add(SyncQueue(
                entity_id=new_attachment.id,       # UUID object (not str)
                entity_type="ATTACHMENT",
                operation="CREATE",                 # renamed from action
                payload=attachment_in.model_dump(mode='json'),
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        await db.refresh(new_attachment)
        return new_attachment

    # =========================================================================
    # 7. SAVE DEFECT IMAGE (Before / After)
    # =========================================================================
    @staticmethod
    async def save_defect_image(db: AsyncSession, defect_id: UUID, image_in) -> DefectImage:
        """
        Saves before/after image metadata to the DB.
        The actual blob was already uploaded by the browser via the write SAS URL.
        Writes SyncQueue on vessel.
        """
        new_image = DefectImage(
            id=image_in.id,
            defect_id=defect_id,
            image_type=image_in.image_type,
            file_name=image_in.file_name,
            file_size=image_in.file_size,
            blob_path=image_in.blob_path,
            origin="VESSEL" if _should_sync() else "SHORE",       # ← ADD THIS
            version=1,            # ← ADD THIS
            updated_at=datetime.utcnow(),  # ← ADD THIS
        )
        db.add(new_image)

        if _should_sync():
            db.add(SyncQueue(
                entity_id=new_image.id,            # UUID object (not str)
                entity_type="IMAGE",
                operation="CREATE",                 # renamed from action
                payload=image_in.model_dump(mode='json'),
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        await db.refresh(new_image)
        return new_image

    # =========================================================================
    # 8. DELETE DEFECT IMAGE (Hard delete from DB)
    # =========================================================================
    @staticmethod
    async def delete_defect_image(db: AsyncSession, defect_id: UUID, image_id: UUID) -> bool:
        """
        Hard-deletes the DefectImage row from the DB.
        The blob remains in Azure Storage (not deleted here — use storage lifecycle).
        Validates defect_id ownership to prevent cross-defect deletion.
        Writes SyncQueue on vessel.
        """
        image = await db.get(DefectImage, image_id)
        if not image or image.defect_id != defect_id:
            return False

        if _should_sync():
            db.add(SyncQueue(
                entity_id=image_id,                # UUID object (not str)
                entity_type="IMAGE",
                operation="DELETE",                 # renamed from action
                payload={"id": str(image_id), "defect_id": str(defect_id)},
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.delete(image)
        await db.commit()
        return True

    # =========================================================================
    # 9. CREATE PR ENTRY
    # =========================================================================
    @staticmethod
    async def create_pr_entry(db: AsyncSession, defect_id: UUID, pr_entry_in, user) -> PrEntry:
        """
        Creates a PR entry linked to a defect.

        COMMIT-FIRST PATTERN:
        We commit the PrEntry first so PostgreSQL assigns the real UUID.
        Only then do we add the SyncQueue row with the real entity_id.
        This avoids a race condition where the SyncQueue row is committed
        before the PrEntry row, leaving a dangling entity_id reference.
        """
        new_pr_entry = PrEntry(
            defect_id=defect_id,
            pr_number=pr_entry_in.pr_number,
            pr_description=pr_entry_in.pr_description,
            created_by_id=user.id,
            origin="VESSEL" if _should_sync() else "SHORE",
            version=1,
            updated_at=datetime.utcnow(),
        )
        db.add(new_pr_entry)

        # First commit — get real UUID from DB
        await db.commit()
        await db.refresh(new_pr_entry)

        # Now safe to put the real UUID in SyncQueue
        if _should_sync():
            db.add(SyncQueue(
                entity_id=new_pr_entry.id,         # UUID object (not str)
                entity_type="PR_ENTRY",
                operation="CREATE",                 # renamed from action
                payload=pr_entry_in.model_dump(mode='json'),
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))
            await db.commit()

        return new_pr_entry

    # =========================================================================
    # 10. UPDATE PR ENTRY
    # =========================================================================
    @staticmethod
    async def update_pr_entry(
        db: AsyncSession,
        defect_id: UUID,
        pr_entry_id: UUID,
        pr_update,
    ) -> Optional[PrEntry]:
        """
        Updates PR number and/or description.
        Validates defect_id ownership.
        Only adds changed fields to the SyncQueue payload.
        """
        pr_entry = await db.get(PrEntry, pr_entry_id)
        if not pr_entry or pr_entry.defect_id != defect_id:
            return None

        update_payload = {}
        if pr_update.pr_number is not None:
            pr_entry.pr_number = pr_update.pr_number
            update_payload["pr_number"] = pr_update.pr_number
        if pr_update.pr_description is not None:
            pr_entry.pr_description = pr_update.pr_description
            update_payload["pr_description"] = pr_update.pr_description

        pr_entry.version += 1
        pr_entry.updated_at = datetime.utcnow()

        if _should_sync():
            db.add(SyncQueue(
                entity_id=pr_entry_id,             # UUID object (not str)
                entity_type="PR_ENTRY",
                operation="UPDATE",                 # renamed from action
                payload=update_payload,
                version=pr_entry.version,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        await db.refresh(pr_entry)
        return pr_entry

    # =========================================================================
    # 11. DELETE PR ENTRY (Soft)
    # =========================================================================
    @staticmethod
    async def delete_pr_entry(db: AsyncSession, defect_id: UUID, pr_entry_id: UUID) -> bool:
        """
        Soft-deletes a PR entry by setting is_deleted=True.
        Validates defect_id ownership.
        Writes SyncQueue on vessel.
        """
        pr_entry = await db.get(PrEntry, pr_entry_id)
        if not pr_entry or pr_entry.defect_id != defect_id:
            return False

        pr_entry.is_deleted = True
        pr_entry.updated_at = datetime.utcnow()

        if _should_sync():
            db.add(SyncQueue(
                entity_id=pr_entry_id,             # UUID object (not str)
                entity_type="PR_ENTRY",
                operation="DELETE",                 # renamed from action
                payload={"id": str(pr_entry_id), "is_deleted": True, "updated_at": datetime.utcnow().isoformat()},
                version=1,
                origin="VESSEL",
                status="PENDING",
            ))

        await db.commit()
        return True
