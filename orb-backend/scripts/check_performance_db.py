"""Is ORB reading the vessel performance database? Run from orb-backend/ on the machine that runs ORB:

    python scripts/check_performance_db.py

Prints where PERFORMANCE_DATABASE_URL points (no password), whether each table can be read, and what it holds for
each ORB vessel. Read-only.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select                                  # noqa: E402
from app.database import AsyncSessionLocal                     # noqa: E402
from app.models.vessel import Vessel                           # noqa: E402
from app.services import performance_data as perf              # noqa: E402


async def main() -> int:
    if not perf.configured():
        print("NOT CONFIGURED: PERFORMANCE_DATABASE_URL is empty or missing in orb-backend/.env")
        print("Alerts 33 and 35 are off and alert 37 uses the older fuel table.")
        return 1
    st = await perf.status()
    t = st["target"]
    print(f"Target: {t.get('user')}@{t.get('host')}:{t.get('port')}/{t.get('database')}")
    for name, info in st["tables"].items():
        print(f"  {name:28} " + (f"{info['rows']} rows" if info["rows"] is not None else f"CANNOT READ - {info.get('error')}"))
    if not st.get("connected"):
        print("NOT CONNECTED: no table could be read. Check the URL, the password and the role's SELECT rights.")
        return 1
    async with AsyncSessionLocal() as db:
        vessels = (await db.execute(select(Vessel.name, Vessel.imo_number).order_by(Vessel.name))).all()
    print(f"\n{'ORB vessel':22}{'IMO':10}{'fuel days':>10} {'last':>11} {'logs':>6} {'last':>11} {'bunkerings':>11}")
    for name, imo in vessels:
        g = st["vessels"].get(str(imo).strip(), {})
        f, l, b = g.get("fuel", {}), g.get("logs", {}), g.get("bunker", {})
        print(f"{name:22}{imo:10}{f.get('n', 0):>10} {str(f.get('last') or '-'):>11} {l.get('n', 0):>6} {str(l.get('last') or '-'):>11} {b.get('n', 0):>11}")
    print("\nA vessel with 0 everywhere is not matched: check its IMO in ORB against the pipeline.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
