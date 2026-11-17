"""Do the Vessel Performance vessels line up with the workplace vessels? (read-only)

Every table of this module refers to a vessel by its IMO number, and the workplace control database also
identifies vessels by IMO. This prints which IMOs exist on both sides, which only on one side, and
vessels whose names differ for the same IMO, so mismatches can be fixed by hand before cutover.
Nothing is written to either database.

Run from vp-backend/:

    python scripts/check_vessel_links.py
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from backend.config import config  # noqa: E402


def compare(vp: dict[str, str], control: dict[str, str]):
    """IMO -> name maps in, (matched, only_vp, only_control, name_differs) out."""
    matched = sorted(set(vp) & set(control))
    only_vp = sorted(set(vp) - set(control))
    only_control = sorted(set(control) - set(vp))
    differs = [i for i in matched if vp[i].strip().lower() != control[i].strip().lower()]
    return matched, only_vp, only_control, differs


def main() -> int:
    if not config.CONTROL_DATABASE_URL:
        print("CONTROL_DATABASE_URL is not set in .env")
        return 1
    vp_engine = create_engine(config.DATABASE_URL)
    control_engine = create_engine(re.sub(r"^postgres(ql)?(\+\w+)?://", "postgresql+psycopg2://", config.CONTROL_DATABASE_URL))
    with vp_engine.connect() as c:
        vp = {str(r[0]).strip(): r[1] or "" for r in c.execute(text("SELECT imo_number, vessel_name FROM vessels"))}
    with control_engine.connect() as c:
        control = {str(r[0]).strip(): r[1] or "" for r in c.execute(text("SELECT imo, name FROM vessels"))}

    matched, only_vp, only_control, differs = compare(vp, control)
    print(f"Matched by IMO: {len(matched)}")
    for i in matched:
        flag = "" if i not in differs else f"   (names differ: VP '{vp[i]}' / workplace '{control[i]}')"
        print(f"  {i}  {vp[i]}{flag}")
    print(f"\nOnly in Vessel Performance ({len(only_vp)}): their data stays, but no workplace vessel is linked")
    for i in only_vp:
        print(f"  {i}  {vp[i]}")
    print(f"\nOnly in the workplace ({len(only_control)}): no Vessel Performance data")
    for i in only_control:
        print(f"  {i}  {control[i]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
