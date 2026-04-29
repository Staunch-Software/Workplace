import logging
from typing import Type, Dict, Any
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy import delete, insert
from app.models.defect import Defect, Thread, Attachment, PrEntry, DefectImage
from sqlalchemy import delete, insert, text as sa_text
from app.core.database import Base
from app.models.sync import SyncConflict
from app.models.user import User
from app.models.vessel import Vessel
from app.models.associations import user_vessel_link
from app.models.tasks import Notification, NotificationType, LiveFeed, FeedEventType
import pytz
IST = pytz.timezone('Asia/Kolkata')

logger = logging.getLogger(__name__)
SOFT_DELETE_MODELS = (Defect, Thread, Attachment, PrEntry, DefectImage)


class SyncService:

    @staticmethod
    async def apply_snapshot(
        db: AsyncSession, 
        model_class: Type[Base], 
        entity_id: Any,
        incoming_version: int, 
        data: Dict[str, Any],
        control_db: AsyncSession = None  # ✅ FIX 1: Added control_db parameter
    ):
        """
        Generic function to apply a sync snapshot.
        ...
        """
        try:
            # --- NEW: SHORE-SIDE SANITIZER ---
            # If pushing a defect, ensure the reporter exists on Shore by Email
            if model_class == Defect and 'reported_by_id' in data:
                
                try:
                    if control_db is None:
                        logger.warning("⚠️ control_db not provided — skipping reporter validation")
                    else:
                        user_stmt = select(User).where(User.id == data['reported_by_id'])
                        user_exists = (await control_db.execute(user_stmt)).scalars().first()
                        if not user_exists:
                            logger.warning(f"⚠️ reported_by_id {data['reported_by_id']} not found — syncing anyway")
                except Exception as e:
                    logger.warning(f"⚠️ User lookup failed — continuing sync: {e}")

            # --- FIX START: Extract Link Data before cleaning ---
            assigned_vessel_imos = None
            if model_class == User and "assigned_vessel_imos" in data:
                # Remove from data so _prepare_data doesn't strip it silently
                assigned_vessel_imos = data.pop("assigned_vessel_imos")
            # --- FIX END ---
            if model_class == Notification:
                print(f"📬 NOTIFICATION SYNC HIT: {entity_id}")  # ← ADD
                print(f"   data keys: {list(data.keys())}")       # ← ADD
                try:
                    existing = (await db.execute(
                        select(Notification).where(Notification.id == entity_id)
                    )).scalars().first()

                    now = datetime.now(timezone.utc).replace(tzinfo=None)

                    def parse_dt(value):
                        if not value:
                            return now
                        if isinstance(value, datetime):
                            if value.tzinfo is not None:
                                return value.astimezone(timezone.utc)
                            return value.replace(tzinfo=timezone.utc)
                        if isinstance(value, str):
                            try:
                                dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                                return dt.astimezone(timezone.utc)
                            except ValueError:
                                return now
                        return now

                    def parse_type(value):
                        try:
                            return NotificationType(value)
                        except (ValueError, KeyError):
                            return NotificationType.ALERT

                    if not existing:
                        # INSERT — fresh notification from shore
                        new_notif = Notification(
                            id=entity_id,
                            user_id=data.get('user_id'),
                            type=parse_type(data.get('type', 'ALERT')),
                            title=data.get('title', ''),
                            message=data.get('message', ''),
                            link=data.get('link'),
                            is_read=data.get('is_read', False),
                            is_seen=data.get('is_seen', False),
                            meta=data.get('meta'),
                            version=data.get('version', 1),  # ← ADD THIS
                            origin=data.get('origin', 'SYNC'),  # ← ADD THIS
                            created_at=parse_dt(data.get('created_at')),  # ← fix
                            updated_at=parse_dt(data.get('updated_at')),  # ← fix
                            
                        )
                        db.add(new_notif)
                        await db.flush()
                        await db.commit()
                        logger.info(f"📬 NOTIFICATION INSERT: {entity_id}")

                    else:
                        # UPDATE — preserve local read state
                        existing.title      = data.get('title', existing.title)
                        existing.message    = data.get('message', existing.message)
                        existing.link       = data.get('link', existing.link)
                        existing.meta       = data.get('meta', existing.meta)
                        existing.updated_at = parse_dt(data.get('updated_at'))
                        if data.get('type'):
                            existing.type   = parse_type(data.get('type'))
                        # ❌ never touch is_read or is_seen

                        await db.flush()
                        await db.commit()
                        logger.info(f"📬 NOTIFICATION UPDATE (read state preserved): {entity_id}")

                except Exception as e:
                    await db.rollback()
                    logger.error(f"❌ NOTIFICATION SYNC ERROR {entity_id}: {str(e)}", exc_info=True)

                return  # ← stop here always, skip all generic logic
            # =========================================================
            # END NOTIFICATION HANDLING
            # =========================================================
            

            # =========================================================
            # LIVE FEED SPECIAL HANDLING
            # Must be BEFORE _prepare_data and generic logic
            # Fixes:
            # 1. event_type is string → convert to FeedEventType Enum
            # 2. created_at missing → set from data or now()
            # 3. is_read/is_seen → never overwrite (local vessel state)
            # =========================================================
            if model_class == LiveFeed:
                print(f"📡 LIVE FEED SYNC HIT: {entity_id}")
                try:
                    existing = (await db.execute(
                        select(LiveFeed).where(LiveFeed.id == entity_id)
                    )).scalars().first()

                    import pytz
                    IST = pytz.timezone('Asia/Kolkata')
                    now = datetime.utcnow()

                    def parse_dt_feed(value):
                        if not value:
                            return now
                        if isinstance(value, datetime):
                            if value.tzinfo is not None:
                                return value.astimezone(timezone.utc).replace(tzinfo=None)
                            return value
                        if isinstance(value, str):
                            try:
                                dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
                                if dt.tzinfo is not None:
                                    return dt.astimezone(timezone.utc).replace(tzinfo=None)
                                return dt
                            except ValueError:
                                return now
                        return now

                    def parse_event_type(value):
                        try:
                            return FeedEventType(value)
                        except (ValueError, KeyError):
                            return FeedEventType.DEFECT_OPENED  # fallback

                    if not existing:
                        print(f"   → INSERTING live feed {entity_id}")
                        new_feed = LiveFeed(
                            id=entity_id,
                            user_id=data.get('user_id'),
                            vessel_imo=data.get('vessel_imo'),
                            vessel_name=data.get('vessel_name'),
                            defect_id=data.get('defect_id'),
                            event_type=parse_event_type(data.get('event_type')),
                            title=data.get('title', ''),
                            message=data.get('message', ''),
                            link=data.get('link'),
                            is_read=False,    # ← always fresh on receiving side
                            is_seen=False,    # ← always fresh on receiving side
                            meta=data.get('meta'),
                            created_at=parse_dt_feed(data.get('created_at')),
                            updated_at=parse_dt_feed(data.get('updated_at')),
                        )
                        db.add(new_feed)
                        await db.flush()
                        await db.commit()
                        print(f"   ✅ LIVE FEED INSERT committed: {entity_id}")
                        logger.info(f"📡 LIVE FEED INSERT: {entity_id}")

                    else:
                        # Already exists — only update content fields
                        # NEVER touch is_read/is_seen — local user state
                        existing.title      = data.get('title', existing.title)
                        existing.message    = data.get('message', existing.message)
                        existing.link       = data.get('link', existing.link)
                        existing.meta       = data.get('meta', existing.meta)
                        existing.updated_at = parse_dt_feed(data.get('updated_at'))
                        if data.get('event_type'):
                            existing.event_type = parse_event_type(data.get('event_type'))
                        # ❌ never touch is_read or is_seen

                        await db.flush()
                        await db.commit()
                        logger.info(f"📡 LIVE FEED UPDATE (read state preserved): {entity_id}")

                except Exception as e:
                    await db.rollback()
                    print(f"   ❌ LIVE FEED ERROR: {type(e).__name__}: {str(e)}")
                    import traceback
                    traceback.print_exc()
                    logger.error(f"❌ LIVE FEED SYNC ERROR {entity_id}: {str(e)}", exc_info=True)

                return  # ← always stop here
            # =========================================================
            # END LIVE FEED HANDLING
            # =========================================================
            
            # 1. Fetch existing entity (Handle IMO for Vessel, ID for others)
            pk_column = model_class.imo if model_class == Vessel else model_class.id
            stmt = select(model_class).where(pk_column == entity_id)

            # (Removed selectinload block here - not needed for direct SQL)

            result = await db.execute(stmt)
            existing_entity = result.scalars().first()
            
            # (DELETE HANDLER)
            incoming_is_deleted = data.get('is_deleted', False)
            
            if incoming_is_deleted and isinstance(model_class, type) and issubclass(model_class, SOFT_DELETE_MODELS):
                if existing_entity:
                    if not getattr(existing_entity, 'is_deleted', False):
                        existing_entity.is_deleted = True

                        # Bump version so future syncs don't overwrite this deletion
                        if hasattr(existing_entity, 'version'):
                            existing_entity.version = incoming_version

                        # Track who deleted and when, if the model supports it
                        if hasattr(existing_entity, 'updated_at'):
                            existing_entity.updated_at = datetime.utcnow()

                        await db.flush()
                        await db.commit()
                        logger.info(f"🗑️ SYNC DELETE: {model_class.__tablename__} {entity_id} (v{incoming_version})")
                    else:
                        # Already deleted — nothing to do
                        logger.info(f"⏭️ SYNC DELETE SKIP: {model_class.__tablename__} {entity_id} already deleted")
                else:
                    # Record doesn't exist on vessel at all — treat as already gone
                    logger.info(f"⏭️ SYNC DELETE SKIP: {model_class.__tablename__} {entity_id} not found locally, nothing to delete")
                return  # Stop here — no insert/update needed after a delete

            # 2. Prepare Data (Clean JSON, Parse Dates, Remove Relationships)
            clean_data = SyncService._prepare_data(model_class, data)

            # 3. FORCE CRITICAL FIELDS (Safely)
            pk_name = 'imo' if model_class == Vessel else 'id'
            clean_data[pk_name] = entity_id

            # Only add these if the table actually has these columns!   
            if hasattr(model_class, 'origin'):
                clean_data['origin'] = data.get('origin', 'SYNC')
            if hasattr(model_class, 'version'):
                clean_data['version'] = incoming_version

            # ADD THIS PRINT TO DEBUG SHORE PUSHES
            print(f"📥 Shore Sync: Applying {model_class.__tablename__} {entity_id}")

            instance = existing_entity

            CONFIG_MODELS = (User, Vessel)
            if isinstance(model_class, type) and issubclass(model_class, CONFIG_MODELS):
                target = control_db if control_db else db   # ✅ User/Vessel use control_db
                if not existing_entity:
                    instance = model_class(**clean_data)
                    target.add(instance)
                else:
                    for key, value in clean_data.items():
                        if hasattr(existing_entity, key):
                            setattr(existing_entity, key, value)
                await target.flush()
                if assigned_vessel_imos is not None and model_class == User:
                    user_id = instance.id if not existing_entity else existing_entity.id
                    await target.execute(delete(user_vessel_link).where(user_vessel_link.c.user_id == user_id))
                    if assigned_vessel_imos:
                        new_links = [{"user_id": user_id, "vessel_imo": imo} for imo in assigned_vessel_imos]
                        await target.execute(insert(user_vessel_link), new_links)
                await target.commit()
                return

            if not existing_entity:
                # --- INSERT CASE ---
                logger.info(f"📥 SYNC INSERT: {model_class.__tablename__} {entity_id} (v{incoming_version})")
                instance = model_class(**clean_data)
                db.add(instance)
                
            else:
                # --- UPDATE CASE ---
                current_version = getattr(existing_entity, 'version', 0)
                
                if incoming_version > current_version:
                    logger.info(f"🔄 SYNC UPDATE: {model_class.__tablename__} {entity_id} (v{current_version} -> v{incoming_version})")

                    # Update fields dynamically
                    for key, value in clean_data.items():
                        if not hasattr(existing_entity, key):
                            continue
                        # Never overwrite a NOT NULL column with a falsy value
                        col = model_class.__table__.columns.get(key)
                        if col is not None and not col.nullable and value is None:
                            continue
                        setattr(existing_entity, key, value)
                elif incoming_version == current_version and hasattr(model_class, 'version'):
                    incoming_origin = data.get('origin', 'SYNC')
                    local_origin = getattr(existing_entity, 'origin', 'VESSEL')

                    def make_json_safe(d):
                        safe_dict = {}
                        for k, v in d.items():
                            if isinstance(v, str):
                                safe_dict[k] = v.encode('ascii', 'ignore').decode('ascii')
                            elif isinstance(v, (UUID, datetime)):
                                safe_dict[k] = str(v)
                            else:
                                safe_dict[k] = v
                        return safe_dict

                    # Shore-created record arriving at Vessel → Shore wins, apply it
                    if incoming_origin == 'SHORE' and local_origin != 'SHORE':
                        logger.info(f"⬇️ SHORE WINS: {model_class.__tablename__} {entity_id} — applying Shore record")
                        for key, value in clean_data.items():
                            if hasattr(existing_entity, key):
                                setattr(existing_entity, key, value)

                    elif incoming_origin == 'VESSEL' and local_origin == 'VESSEL':
                        # Vessel created it, Vessel already has it → safe to skip, not a real conflict
                        logger.info(f"⏭️ SYNC SKIP: {model_class.__tablename__} {entity_id} — Vessel already owns this record")
                        return
                        # falls through to flush + commit below

                    # True conflict — both sides independently modified same version
                    else:
                        incoming_updated_at = data.get('updated_at')
                        local_updated_at = getattr(existing_entity, 'updated_at', None)

                        if incoming_updated_at and local_updated_at:
                            if isinstance(incoming_updated_at, str):
                                incoming_updated_at = datetime.fromisoformat(
                                    incoming_updated_at.replace('Z', '+00:00')
                                )
                            # Make both timezone-aware for comparison
                            if hasattr(incoming_updated_at, 'tzinfo') and incoming_updated_at.tzinfo is None:
                                incoming_updated_at = incoming_updated_at.replace(tzinfo=timezone.utc)
                            if hasattr(local_updated_at, 'tzinfo') and local_updated_at.tzinfo is None:
                                local_updated_at = local_updated_at.replace(tzinfo=timezone.utc)

                            if incoming_updated_at > local_updated_at:
                                # Incoming is newer — apply it
                                logger.info(f"⏱️ LAST WRITE WINS: {model_class.__tablename__} {entity_id} — incoming newer")
                                for key, value in clean_data.items():
                                    if hasattr(existing_entity, key):
                                        setattr(existing_entity, key, value)
                                # falls through to flush + commit below
                            else:
                                # Local is newer — keep local
                                logger.info(f"⏱️ LOCAL NEWER: keeping local for {model_class.__tablename__} {entity_id}")
                                return
                        else:
                            # No timestamps to compare — log conflict
                            conflict = SyncConflict(
                                entity_type=model_class.__tablename__,
                                entity_id=entity_id,
                                version=incoming_version,
                                incoming_data=make_json_safe(data),
                                existing_data=make_json_safe({c.name: getattr(existing_entity, c.name) for c in existing_entity.__table__.columns}),
                                detected_at=datetime.utcnow()
                            )
                            db.add(conflict)
                            await db.commit()
                            return
                else:
                    # --- IGNORE CASE (Idempotency: incoming older than current) ---
                    logger.info(f"⏭️ SYNC IGNORE: {model_class.__tablename__} {entity_id} (Incoming v{incoming_version} < Current v{current_version})")
                    return

            # Flush to ensure the instance has an ID and is attached to session
            await db.flush()

            
            # --- NEW: MASTER SHORE-SIDE NUMBER ASSIGNMENT ---
            if model_class == Defect and control_db is not None:
                incoming_dn = data.get("defect_number")
                
                # If incoming number is Temporary (starts with T-), assign permanent master ID
                if incoming_dn and str(incoming_dn).startswith("T-"):
                    vessel_imo = data.get("vessel_imo")
                    
                    # 1. Get Vessel Name for the prefix (from control_db)
                    v_stmt = sa_text("SELECT name FROM vessels WHERE imo = :imo")
                    vessel_res = await control_db.execute(v_stmt, {"imo": vessel_imo})
                    v_row = vessel_res.fetchone()
                    prefix = v_row.name.replace(" ", "").upper()[:6] if v_row else "SHIP"

                    # 2. Get Next Atomic Sequence from master Shore DB
                    # Logic: If row exists, add 1 and return old value. If not, start at 2 and return 1.
                    seq_stmt = sa_text("""
                        INSERT INTO vessel_defect_sequences (vessel_imo, next_seq)
                        VALUES (:imo, 2)
                        ON CONFLICT (vessel_imo)
                        DO UPDATE SET next_seq = vessel_defect_sequences.next_seq + 1
                        RETURNING vessel_defect_sequences.next_seq
                    """)
                    seq_result = await db.execute(seq_stmt, {"imo": vessel_imo})
                    assigned_seq = seq_result.scalar()
                    
                    final_number = f"{prefix}#{str(assigned_seq).zfill(4)}"

                    # 3. Update the record and BUMP VERSION
                    # This forces the vessel to pull the new permanent number on next sync
                    instance.defect_number = final_number
                    instance.version = incoming_version + 1
                    instance.updated_at = datetime.utcnow()
                    
                    logger.info(f"🔢 Master Number Assigned: {incoming_dn} -> {final_number} (v{instance.version})")
            
            # --- END NEW LOGIC ---
            
            # --- END FIX ---

            # 4. Commit Transaction
            await db.commit()

        except IntegrityError as e:
            await db.rollback()
            logger.error(f"❌ SYNC INTEGRITY ERROR: {str(e)}")
            # We raise generic ValueError so API returns 400/500 properly
            raise ValueError(f"Database integrity error: {str(e)}")
        except Exception as e:
            await db.rollback()
            logger.error(f"❌ SYNC ERROR in {model_class.__tablename__}: {str(e)}", exc_info=True)
            raise e

    @staticmethod
    def _prepare_data(model_class: Type[Base], data: Dict[str, Any]) -> Dict[str, Any]:
        cleaned = {}
        valid_columns = model_class.__table__.columns.keys()
        for key, value in data.items():
            if key not in valid_columns: continue
            if value is None:  continue

            # --- FIX: Character Encoding Sanitizer ---
            if isinstance(value, str):
                # This line removes emojis/characters that the local DB (WIN1252) can't handle
                # It encodes to the local format and ignores errors, then decodes back
                value = value.encode('ascii', 'ignore').decode('ascii')
            # --- END FIX ---

            if isinstance(value, str) and len(value) >= 10:
                if "T" in value or (value[4] == "-" and value[7] == "-"):
                    try:
                        dt_obj = datetime.fromisoformat(value.replace('Z', '+00:00'))
                        
                        if dt_obj.tzinfo is not None:
                            dt_obj = dt_obj.astimezone(IST).replace(tzinfo=None)
                        value = dt_obj
                    except ValueError: pass
            cleaned[key] = value
        return cleaned
