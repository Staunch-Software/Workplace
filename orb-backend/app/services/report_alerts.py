"""Alert selection shared by the Excel and PDF exports."""
import re
import uuid
from datetime import timedelta

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orb_alert import OrbAlert
from app.models.orb_entry import OrbEntry
from app.models.orb_upload import OrbUpload
from app.services.alert_config import disabled_alert_codes, not_withdrawn

_MESSAGE_DATE_RE = re.compile(r"^\[(\d{4}-\d{2}-\d{2})")

# run_all_checks() fires right after extraction commits, so a batch-level alert
# (one with no entry_id) raised for an upload lands inside this window.
_BATCH_ALERT_SLACK = timedelta(minutes=10)


async def alerts_for_upload(db: AsyncSession, upload: OrbUpload, entries: list[OrbEntry]) -> list[OrbAlert]:
    """Alerts that belong to this upload only.

    orb_alerts has no upload_id, and the old export loaded every alert of the
    vessel, so an upload's report listed findings from unrelated uploads (and
    showed alerts even when the upload itself had no entries). An alert belongs
    to the upload when it points at one of the upload's entries, or when it is a
    batch-level alert (no entry_id) raised while this upload was processed.
    """
    entry_ids = [e.id for e in entries]
    conditions = []
    if entry_ids:
        conditions.append(OrbAlert.entry_id.in_(entry_ids))
    conditions.append(OrbAlert.upload_id == upload.id)
    if upload.created_at is not None:
        window_end = (upload.updated_at or upload.created_at) + _BATCH_ALERT_SLACK
        conditions.append(and_(
            OrbAlert.entry_id.is_(None),
            OrbAlert.created_at >= upload.created_at,
            OrbAlert.created_at <= window_end,
        ))
    if not conditions:
        return []
    q = select(OrbAlert).where(OrbAlert.vessel_id == upload.vessel_id, or_(*conditions))
    if disabled := await disabled_alert_codes(db):
        q = q.where(not_withdrawn(disabled))     # withdrawn alerts are left out of the tab and the exports
    result = await db.execute(q.order_by(OrbAlert.created_at.desc()))
    return list(result.scalars().all())


def alert_status_label(alert) -> str:
    """Open / Pending approval / Resolved, for the Excel and PDF exports."""
    status = getattr(alert, "status", None) or ("RESOLVED" if alert.is_resolved else "OPEN")
    return {"RESOLVED": "Resolved", "PENDING_APPROVAL": "Pending approval"}.get(status, "Open")


def alert_entry_date(alert: OrbAlert, entry_dates: dict[uuid.UUID, object]) -> str:
    """The date the alert is about: its entry's date, else the [date] in its message."""
    if alert.entry_id is not None and alert.entry_id in entry_dates:
        return str(entry_dates[alert.entry_id])
    m = _MESSAGE_DATE_RE.match(alert.message or "")
    return m.group(1) if m else ""
