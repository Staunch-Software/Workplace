"""What syncs, in which order, and how each kind of row is merged.

Pull (VM -> vessel) walks PULL_ORDER (parents before children; deletes first). Push (vessel -> VM) sends
the PUSH_ENTITIES the vessel is allowed to write. Anything else the vessel holds is a copy of the VM's row.

Merge strategies (app/services/sync_service.py):
  shore_owned   the VM is the only writer; the newer updated_at wins (alerts: the higher version wins)
  insert_only   written once, never edited (chat messages, files); a row that exists is left alone
  thread_read   per user "last opened": the later time wins
  notification  created on the VM; the vessel only flips is_read (read stays read)
  feed_read     per user read/unread state: last write wins
"""
from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import Date, DateTime, inspect
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.models.orb_alert import OrbAlert
from app.models.orb_alert_thread import OrbAlertAttachment, OrbAlertThread, OrbAlertThreadRead
from app.models.orb_entry import OrbEntry
from app.models.orb_entry_quantity import OrbEntryQuantity
from app.models.orb_notification import OrbFeedEvent, OrbFeedRead, OrbNotification
from app.models.orb_upload import OrbUpload
from app.models.vessel import Vessel
from app.models.vessel_tank import VesselTank


@dataclass(frozen=True)
class Spec:
    key: str                  # name on the wire
    model: type
    strategy: str
    ts_col: str = "updated_at"    # the column the pull cursor runs on
    blob_cols: tuple = ()         # columns holding a blob URL that must also be copied to the vessel


# Parents before children. This is also the order rows are applied in.
PULL_SPECS: list[Spec] = [
    Spec("vessel", Vessel, "shore_owned"),
    Spec("vessel_tank", VesselTank, "shore_owned", blob_cols=("iopp_doc1_url", "iopp_doc2_url")),
    Spec("upload", OrbUpload, "shore_owned", blob_cols=("pdf_blob_url",)),
    Spec("entry", OrbEntry, "shore_owned"),
    Spec("entry_quantity", OrbEntryQuantity, "shore_owned"),
    Spec("alert", OrbAlert, "shore_owned"),
    Spec("thread", OrbAlertThread, "insert_only"),
    Spec("attachment", OrbAlertAttachment, "insert_only", blob_cols=("storage_path",)),
    Spec("thread_read", OrbAlertThreadRead, "thread_read"),
    Spec("notification", OrbNotification, "notification"),
    Spec("feed_event", OrbFeedEvent, "insert_only"),
    Spec("feed_read", OrbFeedRead, "feed_read"),
]
SPECS: dict[str, Spec] = {s.key: s for s in PULL_SPECS}

# What a vessel may write and the VM accepts (everything else a vessel sends is refused).
PUSH_ENTITIES = {"thread", "attachment", "thread_read", "notification", "feed_read", "alert_resolution_request"}

# Delete markers, applied before any rows. Children first so no foreign key is violated.
TOMBSTONE_ORDER = ["alert", "entry_quantity", "entry", "upload"]
TOMBSTONE_MODELS = {"alert": OrbAlert, "entry_quantity": OrbEntryQuantity, "entry": OrbEntry, "upload": OrbUpload}

BLOB_DOWNLOAD = "blob_download"


# ── Row <-> JSON ─────────────────────────────────────────────────────────────

def _jsonable(v: Any) -> Any:
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, uuid.UUID):
        return str(v)
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, enum.Enum):
        return v.value
    return v


def row_to_dict(obj) -> dict:
    """Every column of a mapped row as JSON-safe values."""
    mapper = inspect(obj.__class__)
    return {c.key: _jsonable(getattr(obj, c.key)) for c in mapper.column_attrs}


def parse_datetime(v: Any) -> Optional[datetime]:
    if v is None or isinstance(v, datetime):
        return v
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


def prepare(model: type, data: dict) -> dict:
    """Keep only the model's columns and turn strings back into UUIDs / datetimes."""
    out = {}
    for col in inspect(model).columns:
        if col.key not in data:
            continue
        v = data[col.key]
        if v is not None:
            if isinstance(col.type, PGUUID) and not isinstance(v, uuid.UUID):
                v = uuid.UUID(str(v))
            elif isinstance(col.type, DateTime):
                v = parse_datetime(v)
            elif isinstance(col.type, Date) and not isinstance(v, date):
                v = date.fromisoformat(str(v)[:10])
        out[col.key] = v
    return out


def pk_of(spec: Spec, data: dict) -> tuple:
    return tuple(
        (uuid.UUID(str(data[c.key])) if isinstance(c.type, PGUUID) else data[c.key])
        for c in inspect(spec.model).primary_key
    )
