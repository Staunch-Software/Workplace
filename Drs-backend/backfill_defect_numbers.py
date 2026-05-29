"""
One-time backfill script.
Run from project root: python backfill_defect_numbers.py
"""
import asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from urllib.parse import quote_plus
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

DB_USER = os.environ["DB_USER"]
DB_PASSWORD = quote_plus(os.environ["DB_PASSWORD"])
DB_HOST = os.environ["DB_HOST"]
DB_PORT = os.environ["DB_PORT"]
DB_NAME = os.environ["DB_NAME"]
CONTROL_DATABASE_URL = os.environ["CONTROL_DATABASE_URL"]

DEFECT_DB_URL = f"postgresql+asyncpg://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"

defect_engine = create_async_engine(DEFECT_DB_URL, echo=False)
control_engine = create_async_engine(CONTROL_DATABASE_URL, echo=False)

DefectSession = sessionmaker(defect_engine, class_=AsyncSession, expire_on_commit=False)
ControlSession = sessionmaker(control_engine, class_=AsyncSession, expire_on_commit=False)


def make_prefix(vessel_name: str) -> str:
    return vessel_name.replace(" ", "").upper()[:6]


async def backfill():
    # 1. Fetch vessel names from control DB
    async with ControlSession() as ctrl_db:
        vessel_rows = await ctrl_db.execute(
            text("SELECT imo, name FROM vessels WHERE is_active = TRUE")
        )
        vessels = vessel_rows.fetchall()

    vessel_map = {row.imo: row.name for row in vessels}
    print(f"Found {len(vessel_map)} vessels.")

    async with DefectSession() as db:
        # 2. Fetch ALL defects including deleted, ordered by vessel + created_at
        result = await db.execute(text("""
            SELECT id, vessel_imo, created_at, defect_number, is_deleted
            FROM defects
            ORDER BY vessel_imo, created_at ASC
        """))
        defects = result.fetchall()
        print(f"Found {len(defects)} total defects (including deleted).")

        # 3. Group by vessel — include ALL defects
        vessel_defects = {}
        for d in defects:
            vessel_defects.setdefault(d.vessel_imo, []).append(d)

        updated = 0
        skipped = 0
        now_utc = datetime.utcnow()

        for imo, dlist in vessel_defects.items():
            vessel_name = vessel_map.get(imo)
            if not vessel_name:
                print(f"  ⚠️  IMO {imo} not in control DB — skipping {len(dlist)} defects.")
                skipped += len(dlist)
                continue

            prefix = make_prefix(vessel_name)
            total = len(dlist)
            deleted_count = sum(1 for d in dlist if d.is_deleted)
            print(f"  {vessel_name} ({prefix}) — {total} defects ({deleted_count} deleted)")

            # Track all assigned numbers to avoid duplicates
            taken_numbers = set()

            # First pass — collect already assigned numbers
            for defect in dlist:
                if defect.defect_number:
                    taken_numbers.add(defect.defect_number)

            seq = 0
            for defect in dlist:
                seq += 1

                if defect.defect_number:
                    # Already has a number — just make sure seq stays in sync
                    # Extract the number from existing defect_number if possible
                    try:
                        existing_seq = int(defect.defect_number.split('#')[1].split('-')[0])
                        if existing_seq > seq:
                            seq = existing_seq  # Keep seq in sync with highest seen
                    except (IndexError, ValueError):
                        pass
                    print(f"    Already has defect_number: {defect.defect_number} — skipping")
                    skipped += 1
                    continue

                # Skip assigning numbers to deleted defects that have none
                # but still count them in sequence to avoid gaps
                if defect.is_deleted:
                    defect_number = f"{prefix}#{str(seq).zfill(4)}"
                    while defect_number in taken_numbers:
                        seq += 1
                        defect_number = f"{prefix}#{str(seq).zfill(4)}"
                    taken_numbers.add(defect_number)

                    # Assign number even to deleted defects so sequence is consistent
                    await db.execute(
                        text("""
                            UPDATE defects 
                            SET defect_number = :dn, 
                                updated_at = :now 
                            WHERE id = :id
                        """),
                        {
                            "dn": defect_number,
                            "id": defect.id,
                            "now": now_utc
                        }
                    )
                    print(f"    Deleted defect assigned: {defect_number}")
                    updated += 1
                    continue

                # Assign number to active defect
                defect_number = f"{prefix}#{str(seq).zfill(4)}"
                while defect_number in taken_numbers:
                    seq += 1
                    defect_number = f"{prefix}#{str(seq).zfill(4)}"
                taken_numbers.add(defect_number)

                await db.execute(
                    text("""
                        UPDATE defects 
                        SET defect_number = :dn, 
                            updated_at = :now 
                        WHERE id = :id
                    """),
                    {
                        "dn": defect_number,
                        "id": defect.id,
                        "now": now_utc
                    }
                )
                print(f"    Assigned: {defect_number}")
                updated += 1

            # 4. Upsert sequence table with final seq + 1
            # Use max of current seq and existing next_seq to never go backwards
            seq_rows = await db.execute(
                text("SELECT next_seq FROM vessel_defect_sequences WHERE vessel_imo = :imo"),
                {"imo": imo}
            )
            existing_seq = seq_rows.scalar()
            new_next_seq = max(seq + 1, existing_seq or 0)

            await db.execute(text("""
                INSERT INTO vessel_defect_sequences (vessel_imo, next_seq)
                VALUES (:imo, :next_seq)
                ON CONFLICT (vessel_imo)
                DO UPDATE SET next_seq = EXCLUDED.next_seq
            """), {"imo": imo, "next_seq": new_next_seq})

            print(f"    Sequence set to {new_next_seq} for next defect")

        await db.commit()
        print(f"\n✅ Done. Updated: {updated}, Skipped: {skipped}")


if __name__ == "__main__":
    asyncio.run(backfill())