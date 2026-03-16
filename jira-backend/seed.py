# seed.py
import asyncio
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from db.database import SessionLocal, init_models
from models.schema import User, Vessel
from core.security import hash_password
import uuid


async def seed():
    await init_models()

    now = datetime.utcnow()

    async with SessionLocal() as db:
        from sqlalchemy import select

        # ── Vessels ──────────────────────────────────────────
        vessels = [
            Vessel(id=str(uuid.uuid4()), name="GCL GANGA",     code="GCL-GAN",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL YAMUNA",    code="GCL-YAM",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL SARASWATI", code="GCL-SAR",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL SABARMATI", code="GCL-SAB",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL NARMADA",   code="GCL-NAR",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL TAPI",      code="GCL-TAP",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="GCL FOS",       code="GCL-FOS",  isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AM KIRTI",      code="AM-KIR",   isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AM TARANG",     code="AM-TAR",   isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AM UMANG",      code="AM-UMA",   isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AMNS POLAR",    code="AMNS-POL", isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AMNS TUFMAX",   code="AMNS-TUF", isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AMNS MAXIMUS",  code="AMNS-MAX", isActive=True, createdAt=now, updatedAt=now),
            Vessel(id=str(uuid.uuid4()), name="AMNS STALLION", code="AMNS-STA", isActive=True, createdAt=now, updatedAt=now),
        ]

        for v in vessels:
            existing = (await db.execute(select(Vessel).where(Vessel.name == v.name))).scalar_one_or_none()
            if not existing:
                db.add(v)
                print(f"  + Vessel: {v.name}")
            else:
                print(f"  skip (exists): {v.name}")

        await db.commit()
        print(f"\n✅ Vessels done")

        # ── Users ─────────────────────────────────────────────
        users = [
            User(id=str(uuid.uuid4()), name="Shore Admin",     email="admin@ozellar.com",  password=hash_password("admin123"),  role="admin",  vesselName=None,          createdAt=now, updatedAt=now),
            User(id=str(uuid.uuid4()), name="Shore Staff",     email="shore@ozellar.com",  password=hash_password("shore123"),  role="shore",  vesselName=None,          createdAt=now, updatedAt=now),
            User(id=str(uuid.uuid4()), name="GCL Ganga Crew",  email="ganga@ozellar.com",  password=hash_password("vessel123"), role="vessel", vesselName="GCL GANGA",   createdAt=now, updatedAt=now),
            User(id=str(uuid.uuid4()), name="GCL Yamuna Crew", email="yamuna@ozellar.com", password=hash_password("vessel123"), role="vessel", vesselName="GCL YAMUNA",  createdAt=now, updatedAt=now),
        ]

        for u in users:
            existing = (await db.execute(select(User).where(User.email == u.email))).scalar_one_or_none()
            if not existing:
                db.add(u)
                print(f"  + User: {u.email}")
            else:
                print(f"  skip (exists): {u.email}")

        await db.commit()
        print(f"\n✅ Users done")

    print("\n🎉 Seed complete! Test credentials:")
    print("   Admin:  admin@ozellar.com  / admin123")
    print("   Shore:  shore@ozellar.com  / shore123")
    print("   Vessel: ganga@ozellar.com  / vessel123")
    print("   Vessel: yamuna@ozellar.com / vessel123")


asyncio.run(seed())