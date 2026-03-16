"""
migrate_mongo_to_pg.py
Run ONCE after first uvicorn startup to copy MongoDB data to PostgreSQL:
    python migrate_mongo_to_pg.py
"""
import asyncio, uuid, sys, os
from datetime import datetime
sys.path.insert(0, os.path.dirname(__file__))

MONGO_URI = "mongodb://localhost:27017"
MONGO_DB  = "ozellar"

from db.database import SessionLocal, init_models
from models.schema import Ticket, Comment, Vessel, User


async def migrate():
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(MONGO_URI)
    mdb = mongo[MONGO_DB]
    await init_models()

    print("--- Vessels ---")
    vessels = await mdb["vessels"].find().to_list(500)
    async with SessionLocal() as s:
        for v in vessels:
            s.add(Vessel(id=str(uuid.uuid4()), name=v.get("name",""), code=v.get("code",""),
                isActive=v.get("isActive", True),
                createdAt=v.get("createdAt") or datetime.utcnow(),
                updatedAt=v.get("updatedAt") or datetime.utcnow()))
        await s.commit()
    print(f"  {len(vessels)} vessels done")

    print("--- Users ---")
    users = await mdb["users"].find().to_list(500)
    async with SessionLocal() as s:
        for u in users:
            s.add(User(id=str(uuid.uuid4()), name=u.get("name",""), email=u.get("email",""),
                password=u.get("password",""), role=u.get("role","vessel"),
                vesselName=u.get("vesselName"),
                createdAt=u.get("createdAt") or datetime.utcnow(),
                updatedAt=u.get("updatedAt") or datetime.utcnow()))
        await s.commit()
    print(f"  {len(users)} users done")

    print("--- Tickets + Comments ---")
    tickets = await mdb["tickets"].find().to_list(2000)
    tc = cc = 0
    def dt(v): return v if isinstance(v, datetime) else None
    for t in tickets:
        tid = str(uuid.uuid4())
        async with SessionLocal() as s:
            ticket = Ticket(
                id=tid, reference=t.get("reference"), referenceNum=t.get("referenceNum"),
                summary=t.get("summary",""), description=t.get("description",""),
                module=t.get("module"), environment=t.get("environment"),
                priority=t.get("priority"), requestType=t.get("requestType"),
                status=t.get("status","SUP IN PROGRESS"), jiraStatus=t.get("jiraStatus"),
                jiraSubmissionStatus=t.get("jiraSubmissionStatus","PENDING"),
                jiraUrl=t.get("jiraUrl"), jiraSortOrder=t.get("jiraSortOrder"),
                vesselName=t.get("vesselName"), requester=t.get("requester",""),
                attachments=t.get("attachments") or [], sharedWith=t.get("sharedWith") or [],
                createdAt=dt(t.get("createdAt")) or datetime.utcnow(),
                updatedAt=dt(t.get("updatedAt")) or datetime.utcnow(),
                jiraCreatedAt=dt(t.get("jiraCreatedAt")), jiraUpdatedAt=dt(t.get("jiraUpdatedAt")),
                lastSyncedAt=dt(t.get("lastSyncedAt")), detailFetchedAt=dt(t.get("detailFetchedAt")),
            )
            s.add(ticket)
            await s.flush()
            for c in (t.get("comments") or []):
                s.add(Comment(id=str(uuid.uuid4()), ticket_id=tid,
                    author=c.get("author",""), message=c.get("message",""),
                    source=c.get("source","jira"),
                    createdAt=dt(c.get("createdAt")) or datetime.utcnow(),
                    images=c.get("images") or []))
                cc += 1
            await s.commit()
            tc += 1
        if tc % 50 == 0: print(f"  ...{tc}/{len(tickets)}")

    mongo.close()
    print(f"Done! Vessels={len(vessels)} Users={len(users)} Tickets={tc} Comments={cc}")


if __name__ == "__main__":
    asyncio.run(migrate())
