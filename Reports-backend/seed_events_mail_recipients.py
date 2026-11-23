# One-time seed of the Event mails recipients (To and CC per vessel).
#   python seed_events_mail_recipients.py            show what would be inserted (writes nothing)
#   python seed_events_mail_recipients.py --apply    insert it
# Safe to re-run: addresses already on a vessel are skipped. After this, change recipients on the
# Report Config > Event mails page. Once a vessel has a To address, new logbook reports are mailed to it.
import argparse
import asyncio
import uuid
from datetime import datetime

from sqlalchemy import text

from app.core.database import Base, SessionLocal, engine
from app.core.database_control import ControlSession
from app.models.events_mail import EventsMailRecipient, EventsMailVessel, EventsMailSent

# imo: (to, cc)
DATA = {
    "9832925": (["amkirti@ozellar.com", "pavan@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamkirti@ozellar.com", "techdevops@ozellar.com"]),
    "9832913": (["amtarang@ozellar.com", "pavan@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamtarang@ozellar.com", "techdevops@ozellar.com"]),
    "9481685": (["gclnarmada@ozellar.com", "pavan@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclnarmada@ozellar.com", "techdevops@ozellar.com"]),
    "9481661": (["gclsabarmati@ozellar.com", "pavan@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclsabarmati@ozellar.com", "techdevops@ozellar.com"]),
    "9532082": (["gclfos@ozellar.com", "gauravsingh.r@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclfos@ozellar.com", "techdevops@ozellar.com"]),
    "9481219": (["gclyamuna@ozellar.com", "gauravsingh.r@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclyamuna@ozellar.com", "techdevops@ozellar.com"]),
    "9481697": (["gclganga@ozellar.com", "gauravsingh.r@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclganga@ozellar.com", "techdevops@ozellar.com"]),
    "9644500": (["gclsaraswati@ozellar.com", "abhinav.s@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgclsaraswati@ozellar.com", "techdevops@ozellar.com"]),
    "9521813": (["amns.polar@gtmailplus.com", "abhinav.s@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamnspolar@ozellar.com", "techdevops@ozellar.com"]),
    "9486295": (["amnstufmax@ozellar.com", "abhinav.s@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamnstufmax@ozellar.com", "techdevops@ozellar.com"]),
    "9628893": (["amnsimaximus@gtmailplus.com", "Murtuza@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamnsimaximus@ozellar.com", "techdevops@ozellar.com"]),
    "9792058": (["amumang@ozellar.com", "Murtuza@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamumang@ozellar.com", "techdevops@ozellar.com"]),
    "9481659": (["gcltapi@ozellar.com", "Murtuza@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmgcltapi@ozellar.com", "techdevops@ozellar.com"]),
    "9628910": (["amnsistallion@gtmailplus.com", "Murtuza@ozellar.com", "kunalchandra@ozellar.com", "meenakshy@ozellar.com"],
                ["tmamnsistallion@ozellar.com", "techdevops@ozellar.com"]),
}


def build_rows():
    """[(imo, email, kind)] lower-cased; an address given as both To and CC stays To only."""
    rows = []
    for imo, (to, cc) in DATA.items():
        seen = set()
        for kind, emails in (("to", to), ("cc", cc)):
            for e in emails:
                e = e.strip().lower()
                if e and e not in seen:
                    seen.add(e)
                    rows.append((imo, e, kind))
    return rows


async def main(apply: bool):
    rows = build_rows()

    async with ControlSession() as control_db:
        known = {r[0]: r[1] for r in (await control_db.execute(text("SELECT imo, name FROM vessels"))).fetchall()}
    for imo in DATA:
        if imo not in known:
            print(f"WARNING: IMO {imo} is not in the control DB vessels table, it will not show on the page.")

    if not apply:
        for imo in DATA:
            print(f"{imo} {known.get(imo, '?'):<16} To: {sum(1 for r in rows if r[0] == imo and r[2] == 'to')}"
                  f"  CC: {sum(1 for r in rows if r[0] == imo and r[2] == 'cc')}")
        print(f"\nDRY RUN: {len(rows)} addresses for {len(DATA)} vessels. Nothing written. Re-run with --apply.")
        return

    # create_all never adds a column to an existing table
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[EventsMailRecipient.__table__, EventsMailVessel.__table__, EventsMailSent.__table__]))
        await conn.execute(text("ALTER TABLE events_mail_recipient ADD COLUMN IF NOT EXISTS kind VARCHAR(2) NOT NULL DEFAULT 'to'"))

    added = skipped = 0
    async with SessionLocal() as db:
        have = {(r[0], r[1]) for r in (await db.execute(text("SELECT vessel_imo, email FROM events_mail_recipient"))).fetchall()}
        for imo, email, kind in rows:
            if (imo, email) in have:
                skipped += 1
                continue
            db.add(EventsMailRecipient(id=uuid.uuid4(), vessel_imo=imo, email=email, kind=kind, created_at=datetime.utcnow()))
            have.add((imo, email))
            added += 1
        await db.commit()
    print(f"Inserted {added} addresses, skipped {skipped} already present.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write to the database (default is a dry run)")
    args = ap.parse_args()
    asyncio.run(main(args.apply))
