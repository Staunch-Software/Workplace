import logging
from typing import Type, Dict, Any
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError

from db.database import Base
from models.sync import SyncConflict

logger = logging.getLogger("jira.sync_service")

# Models that support soft-delete
_SOFT_DELETE_TABLES = {"tickets", "comments", "attachments", "tasks", "notifications"}


class SyncService:

    @staticmethod
    async def apply_snapshot(
        db: AsyncSession,
        model_class: Type[Base],
        entity_id: Any,
        incoming_version: int,
        data: Dict[str, Any],
    ):
        try:
            stmt = select(model_class).where(model_class.id == entity_id)
            result = await db.execute(stmt)
            existing_entity = result.scalars().first()

            # ── SOFT DELETE ──────────────────────────────────────────────
            if data.get("is_deleted", False):
                tablename = getattr(model_class, "__tablename__", "")
                if tablename in _SOFT_DELETE_TABLES and existing_entity:
                    if not getattr(existing_entity, "is_deleted", False):
                        existing_entity.is_deleted = True
                        if hasattr(existing_entity, "version"):
                            existing_entity.version = incoming_version
                        if hasattr(existing_entity, "updated_at"):
                            existing_entity.updated_at = datetime.utcnow()
                        await db.flush()
                        await db.commit()
                        logger.info(f"SYNC DELETE: {tablename} {entity_id}")
                return

            clean_data = SyncService._prepare_data(model_class, data)
            clean_data["id"] = entity_id

            if hasattr(model_class, "origin"):
                clean_data["origin"] = data.get("origin", "SYNC")
            if hasattr(model_class, "version"):
                clean_data["version"] = incoming_version

            if not existing_entity:
                # ── INSERT ───────────────────────────────────────────────
                logger.info(f"SYNC INSERT: {model_class.__tablename__} {entity_id} v{incoming_version}")
                instance = model_class(**clean_data)
                db.add(instance)

            else:
                current_version = getattr(existing_entity, "version", 0)

                if incoming_version > current_version:
                    # ── UPDATE ───────────────────────────────────────────
                    logger.info(
                        f"SYNC UPDATE: {model_class.__tablename__} {entity_id} "
                        f"v{current_version} -> v{incoming_version}"
                    )
                    for key, value in clean_data.items():
                        if hasattr(existing_entity, key):
                            setattr(existing_entity, key, value)

                elif incoming_version == current_version:
                    incoming_origin = data.get("origin", "SYNC")
                    local_origin = getattr(existing_entity, "origin", "VESSEL")

                    if incoming_origin == "SHORE" and local_origin != "SHORE":
                        # Shore wins
                        for key, value in clean_data.items():
                            if hasattr(existing_entity, key):
                                setattr(existing_entity, key, value)
                    elif incoming_origin == "VESSEL" and local_origin == "VESSEL":
                        # Same origin — skip
                        return
                    else:
                        # Last-write-wins by updated_at
                        inc_ts = data.get("updated_at")
                        loc_ts = getattr(existing_entity, "updated_at", None)
                        if inc_ts and loc_ts:
                            if isinstance(inc_ts, str):
                                inc_ts = datetime.fromisoformat(inc_ts.replace("Z", "+00:00"))
                            if getattr(inc_ts, "tzinfo", None) is None:
                                inc_ts = inc_ts.replace(tzinfo=timezone.utc)
                            if getattr(loc_ts, "tzinfo", None) is None:
                                loc_ts = loc_ts.replace(tzinfo=timezone.utc)
                            if inc_ts > loc_ts:
                                for key, value in clean_data.items():
                                    if hasattr(existing_entity, key):
                                        setattr(existing_entity, key, value)
                            else:
                                return
                        else:
                            # Log conflict, keep local
                            conflict = SyncConflict(
                                entity_type=model_class.__tablename__,
                                entity_id=entity_id,
                                version=incoming_version,
                                incoming_data={k: str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v for k, v in data.items()},
                                existing_data={c.name: str(getattr(existing_entity, c.name)) if not isinstance(getattr(existing_entity, c.name), (str, int, float, bool, type(None))) else getattr(existing_entity, c.name) for c in existing_entity.__table__.columns},
                                detected_at=datetime.utcnow(),
                            )
                            db.add(conflict)
                            await db.commit()
                            return
                else:
                    # Incoming older — ignore
                    logger.info(
                        f"SYNC IGNORE: {model_class.__tablename__} {entity_id} "
                        f"incoming v{incoming_version} < current v{current_version}"
                    )
                    return

            await db.flush()
            await db.commit()

        except IntegrityError as e:
            await db.rollback()
            logger.error(f"SYNC INTEGRITY ERROR: {e}")
            raise ValueError(f"Database integrity error: {e}")
        except Exception as e:
            await db.rollback()
            logger.error(f"SYNC ERROR in {model_class.__tablename__}: {e}", exc_info=True)
            raise

    @staticmethod
    def _prepare_data(model_class: Type[Base], data: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {}
        valid_columns = model_class.__table__.columns.keys()
        for key, value in data.items():
            if key not in valid_columns:
                continue
            if value is None:
                continue
            if isinstance(value, str):
                value = value.encode("ascii", "ignore").decode("ascii")
            if isinstance(value, str) and len(value) >= 10:
                if "T" in value or (value[4:5] == "-" and value[7:8] == "-"):
                    try:
                        dt_obj = datetime.fromisoformat(value.replace("Z", "+00:00"))
                        if dt_obj.tzinfo is not None:
                            dt_obj = dt_obj.replace(tzinfo=None)
                        value = dt_obj
                    except ValueError:
                        pass
            cleaned[key] = value
        return cleaned