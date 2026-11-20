# app/api/v1/endpoints/events_mail.py
# Admin API behind Report Config > Event mails: who gets each vessel's new-report mail.
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.api.deps import require_admin
from app.core.database import get_db
from app.core.database_control import get_control_db
from app.models.events_mail import EventsMailRecipient, EventsMailVessel

router = APIRouter(prefix="/events-mail", tags=["Events mail"])

_EMAIL = re.compile(r"^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$")


class RecipientIn(BaseModel):
    vessel_imo: str
    email: str


class EnabledIn(BaseModel):
    enabled: bool


async def _vessel_name(control_db: AsyncSession, imo: str):
    row = (await control_db.execute(
        text("SELECT name FROM vessels WHERE imo = :imo AND is_active IS NOT FALSE"), {"imo": imo}
    )).first()
    return row[0] if row else None


@router.get("/recipients")
async def list_recipients(db: AsyncSession = Depends(get_db),
                          control_db: AsyncSession = Depends(get_control_db),
                          current_user=Depends(require_admin)):
    """Every active vessel with its recipients, on/off switch and the time of its last mail."""
    vessels = (await control_db.execute(
        text("SELECT imo, name FROM vessels WHERE is_active IS NOT FALSE ORDER BY name")
    )).fetchall()
    emails: dict = {}
    for r in (await db.execute(select(EventsMailRecipient).order_by(EventsMailRecipient.email))).scalars():
        emails.setdefault(r.vessel_imo, []).append({"id": str(r.id), "email": r.email})
    off = {r.vessel_imo for r in (await db.execute(select(EventsMailVessel))).scalars() if not r.enabled}
    last = {r[0]: r[1] for r in (await db.execute(
        text("SELECT imo, max(sent_at) FROM events_mail_sent GROUP BY imo"))).fetchall()}
    return [{"imo": imo, "name": name, "enabled": imo not in off,
             "recipients": emails.get(imo, []),
             "last_mailed": last[imo].isoformat() if last.get(imo) else None}
            for imo, name in vessels]


@router.post("/recipients")
async def add_recipient(body: RecipientIn, db: AsyncSession = Depends(get_db),
                        control_db: AsyncSession = Depends(get_control_db),
                        current_user=Depends(require_admin)):
    email = body.email.strip().lower()
    if not _EMAIL.match(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")
    if not await _vessel_name(control_db, body.vessel_imo):
        raise HTTPException(status_code=404, detail="Vessel not found.")
    dup = (await db.execute(select(EventsMailRecipient).where(
        EventsMailRecipient.vessel_imo == body.vessel_imo, EventsMailRecipient.email == email))).scalars().first()
    if dup:
        raise HTTPException(status_code=409, detail="This address is already on the list.")
    row = EventsMailRecipient(vessel_imo=body.vessel_imo, email=email)
    db.add(row)
    await db.commit()
    return {"id": str(row.id), "email": row.email}


@router.delete("/recipients/{recipient_id}")
async def delete_recipient(recipient_id: str, db: AsyncSession = Depends(get_db),
                           current_user=Depends(require_admin)):
    row = (await db.execute(select(EventsMailRecipient).where(EventsMailRecipient.id == recipient_id))).scalars().first()
    if not row:
        raise HTTPException(status_code=404, detail="Recipient not found.")
    await db.delete(row)
    await db.commit()
    return {"ok": True}


@router.put("/vessels/{imo}/enabled")
async def set_enabled(imo: str, body: EnabledIn, db: AsyncSession = Depends(get_db),
                      control_db: AsyncSession = Depends(get_control_db),
                      current_user=Depends(require_admin)):
    if not await _vessel_name(control_db, imo):
        raise HTTPException(status_code=404, detail="Vessel not found.")
    row = (await db.execute(select(EventsMailVessel).where(EventsMailVessel.vessel_imo == imo))).scalars().first()
    if row:
        row.enabled = body.enabled
    else:
        db.add(EventsMailVessel(vessel_imo=imo, enabled=body.enabled))
    await db.commit()
    return {"imo": imo, "enabled": body.enabled}


@router.post("/vessels/{imo}/test")
async def send_test(imo: str, current_user=Depends(require_admin)):
    """Send this vessel's latest report to the signed-in admin only (never to the vessel's recipients)."""
    from app.services.events_mail_service import send_new_event_mails
    to = getattr(current_user, "email", "") or ""
    if not to:
        raise HTTPException(status_code=400, detail="Your account has no email address.")
    res = await send_new_event_mails(test_to=to, force=True, only_imo=imo)
    if res.get("error"):
        raise HTTPException(status_code=503, detail=res["error"])
    if not res.get("sent"):
        raise HTTPException(status_code=404, detail="No logbook report found for this vessel, or the mail could not be sent.")
    return {"sent_to": to}
