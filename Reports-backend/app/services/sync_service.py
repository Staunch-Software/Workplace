# app/services/sync_service.py
# Applies an incoming sync snapshot (from vessel push or shore pull) to the
# local DB. Same overall approach as Drs-backend's SyncService.apply_snapshot,
# simplified since Report Tracker entities have no integer `version` column --
# conflict resolution uses `updated_at` last-write-wins where available, and
# falls back to insert-if-missing for append-only entities (threads,
# attachments, events).
import logging
from typing import Type, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from app.core.database import Base
from app.models.sync import SyncConflict

logger = logging.getLogger("reports.sync_service")


def _parse_dt(value):
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


class SyncService:

    @staticmethod
    def _prepare_data(model_class: Type[Base], data: Dict[str, Any]) -> Dict[str, Any]:
        valid_columns = model_class.__table__.columns.keys()
        cleaned = {}
        for key, value in data.items():
            if key not in valid_columns:
                continue
            if isinstance(value, str) and len(value) >= 10 and (
                "T" in value or (len(value) > 7 and value[4] == "-" and value[7] == "-")
            ):
                try:
                    value = datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
                except ValueError:
                    pass
            cleaned[key] = value
        return cleaned

    @staticmethod
    async def apply_snapshot(
        db: AsyncSession,
        model_class: Type[Base],
        entity_id: Any,
        data: Dict[str, Any],
    ):
        """
        Generic upsert: insert if the row doesn't exist locally; otherwise
        update only if the incoming record is newer (by `updated_at`) than
        the local one. Entities without `updated_at` (threads, attachments,
        events) are insert-once/skip-if-exists, since nothing ever edits
        them in place.
        """
        try:
            stmt = select(model_class).where(model_class.id == entity_id)
            existing = (await db.execute(stmt)).scalars().first()

            clean_data = SyncService._prepare_data(model_class, data)
            clean_data["id"] = entity_id

            if not existing:
                logger.info(f"SYNC INSERT: {model_class.__tablename__} {entity_id}")
                db.add(model_class(**clean_data))
                await db.commit()
                return

            if not hasattr(model_class, "updated_at"):
                # Append-only entity already exists locally -- nothing to do.
                logger.info(f"SYNC SKIP (append-only, already present): {model_class.__tablename__} {entity_id}")
                return

            incoming_updated = _parse_dt(data.get("updated_at"))
            local_updated = getattr(existing, "updated_at", None)
            if local_updated is not None and local_updated.tzinfo is None:
                local_updated = local_updated.replace(tzinfo=timezone.utc)

            if incoming_updated and local_updated and incoming_updated <= local_updated:
                logger.info(f"SYNC IGNORE (local same/newer): {model_class.__tablename__} {entity_id}")
                return

            if not incoming_updated or not local_updated:
                # No comparable timestamps on either side -- log a conflict
                # for manual review rather than silently overwriting.
                conflict = SyncConflict(
                    entity_type=model_class.__tablename__,
                    entity_id=entity_id,
                    incoming_data={k: str(v) for k, v in data.items()},
                    existing_data={c.name: str(getattr(existing, c.name)) for c in existing.__table__.columns},
                    detected_at=datetime.utcnow(),
                )
                db.add(conflict)
                await db.commit()
                logger.warning(f"SYNC CONFLICT logged: {model_class.__tablename__} {entity_id}")
                return

            logger.info(f"SYNC UPDATE: {model_class.__tablename__} {entity_id}")
            for key, value in clean_data.items():
                if key == "id":
                    continue
                setattr(existing, key, value)
            await db.commit()

        except IntegrityError as e:
            await db.rollback()
            logger.error(f"SYNC INTEGRITY ERROR in {model_class.__tablename__}: {e}")
            raise ValueError(f"Database integrity error: {e}")
        except Exception as e:
            await db.rollback()
            logger.error(f"SYNC ERROR in {model_class.__tablename__}: {e}", exc_info=True)
            raise
