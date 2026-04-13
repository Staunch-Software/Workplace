import logging
from datetime import datetime, timezone
from typing import Type, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, inspect

logger = logging.getLogger("lub.sync_service")


class SyncService:

    @staticmethod
    async def apply_snapshot(
        db: AsyncSession,
        model_class: Type[Any],
        entity_id: Any,
        incoming_version: int,
        data: dict,
    ):
        """
        Upserts a record using version control.
        - If record does not exist → INSERT
        - If incoming_version > existing version → UPDATE
        - If incoming_version <= existing version → skip (conflict log)
        """
        # Determine primary key column name
        mapper = inspect(model_class)
        pk_col = mapper.primary_key[0].name

        # Cast entity_id to match the primary key column type
        pk_type = type(mapper.primary_key[0].type).__name__
        if pk_type in ('Integer', 'BigInteger', 'SmallInteger'):
            try:
                entity_id = int(entity_id)
            except (ValueError, TypeError):
                pass

        # Coerce string date/datetime values to proper Python types
        from datetime import date as _date
        valid_cols_map = {c.key: c for c in mapper.columns}
        coerced = {}
        for k, v in data.items():
            if k not in valid_cols_map:
                continue
            col_type = type(valid_cols_map[k].type).__name__
            if v is not None and isinstance(v, str):
                if col_type.upper() in ("DATE",):
                    try:
                        v = _date.fromisoformat(v)
                    except ValueError:
                        pass
                elif col_type.upper() in ("DATETIME", "TIMESTAMP", "DATETIME_"):
                    try:
                        v = datetime.fromisoformat(v)
                        # If parsed datetime has no timezone, attach UTC
                        if v.tzinfo is None:
                            v = v.replace(tzinfo=timezone.utc)
                    except ValueError:
                        pass
            coerced[k] = v
        data = coerced

        stmt = select(model_class).where(
            getattr(model_class, pk_col) == entity_id
        )
        result = await db.execute(stmt)
        existing = result.scalars().first()

        if not existing:
            # INSERT — strip keys not in model
            valid_cols = {c.key for c in mapper.columns}
            clean_data = {k: v for k, v in data.items() if k in valid_cols}
            new_record = model_class(**clean_data)
            db.add(new_record)
            logger.info(f"SyncService: INSERT {model_class.__tablename__} id={entity_id}")
            return

        existing_version = getattr(existing, "version", 0) or 0

        if incoming_version < existing_version:
            logger.info(
                f"SyncService: SKIP {model_class.__tablename__} id={entity_id} "
                f"(incoming v{incoming_version} <= existing v{existing_version})"
            )
            return

        # UPDATE
        valid_cols = {c.key for c in mapper.columns}
        for key, value in data.items():
            if key in valid_cols:
                setattr(existing, key, value)

        logger.info(
            f"SyncService: UPDATE {model_class.__tablename__} id={entity_id} "
            f"v{existing_version} → v{incoming_version}"
        )