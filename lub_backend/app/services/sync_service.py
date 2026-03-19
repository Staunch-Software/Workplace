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

        if incoming_version <= existing_version:
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