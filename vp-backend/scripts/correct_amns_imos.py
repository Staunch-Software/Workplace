"""Put the three AMNS vessels on the same IMO numbers the workplace uses (dry run by default).

The workplace control database (and ORB with it) knows these vessels as

    AMNS POLAR      9521813
    AMNSI MAXIMUS   9628893
    AMNSI STALLION  9628910

while the Vessel Performance database was changed earlier (scripts/fix_amns_imos.py, now removed) to

    AMNS POLAR      9961609
    AMNSI MAXIMUS   9942768
    AMNSI STALLION  9942770

so the two systems could not be linked by IMO (ORB, for one, found no pipeline data for them). This script
moves the Vessel Performance side to the workplace numbers, in ONE transaction:

  1. add a copy of the vessel row under the new IMO,
  2. re-point EVERY column named vessel_imo / imo in the database (found from the schema, so tables added
     later are covered too, including the ones without a foreign key such as the expanded_* tables,
     fleet_status_data and the saved column layouts),
  3. delete the old vessel row, and check that nothing still carries the old IMO.

Anything unexpected rolls the whole thing back. Run from vp-backend/, with the old API and the cron jobs
STOPPED (the Wartsila scraper writes IMOs too):

    python scripts/correct_amns_imos.py            # dry run: what would change, per table
    python scripts/correct_amns_imos.py --apply

Safe to run again: vessels already on the new IMO are skipped.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import create_engine, text  # noqa: E402

from backend.config import config  # noqa: E402

# current Vessel Performance IMO -> IMO used by the workplace
CORRECTIONS = {
    "9961609": "9521813",   # AMNS POLAR
    "9942768": "9628893",   # AMNSI MAXIMUS
    "9942770": "9628910",   # AMNSI STALLION
}

IMO_COLUMNS = ("vessel_imo", "imo", "imo_number")


def q(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


def imo_columns(conn) -> list[tuple[str, str]]:
    """Every (table, column) that holds a vessel IMO, apart from the vessels table itself."""
    rows = conn.execute(text("""
        SELECT c.table_name, c.column_name
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.column_name = ANY(:cols) AND c.table_name <> 'vessels'
        ORDER BY c.table_name, c.column_name"""), {"cols": list(IMO_COLUMNS)}).all()
    return [(r[0], r[1]) for r in rows]


def vessel_columns(conn) -> list[str]:
    return [r[0] for r in conn.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='vessels' "
        "ORDER BY ordinal_position"))]


def count(conn, table: str, col: str, imo: str) -> int:
    return conn.execute(text(f"SELECT count(*) FROM {q(table)} WHERE {q(col)} = :i"), {"i": imo}).scalar() or 0


def plan(conn, corrections: dict[str, str]) -> list[dict]:
    """What the run would do for each vessel, with row counts per table."""
    cols = imo_columns(conn)
    out = []
    for old, new in corrections.items():
        row = conn.execute(text("SELECT vessel_name FROM vessels WHERE imo_number = :i"), {"i": old}).first()
        new_row = conn.execute(text("SELECT vessel_name FROM vessels WHERE imo_number = :i"), {"i": new}).first()
        if row and new_row:
            state = "conflict"        # both IMOs exist as vessels: needs a person to look
        elif row:
            state = "migrate"
        elif new_row:
            state = "done"
        else:
            state = "missing"
        tables = []
        for table, col in cols:
            n_old, n_new = count(conn, table, col, old), count(conn, table, col, new)
            if n_old or n_new:
                tables.append({"table": table, "column": col, "old": n_old, "new": n_new})
        out.append({"old": old, "new": new, "name": (row or new_row or ["?"])[0], "state": state, "tables": tables})
    return out


def apply_one(conn, old: str, new: str) -> dict:
    """Move one vessel. Raises (so the caller rolls back) if anything still carries the old IMO."""
    vcols = vessel_columns(conn)
    select_list = ", ".join(":new" if c == "imo_number" else q(c) for c in vcols)
    conn.execute(text(f"INSERT INTO vessels ({', '.join(q(c) for c in vcols)}) "
                      f"SELECT {select_list} FROM vessels WHERE imo_number = :old"), {"new": new, "old": old})
    moved = {}
    for table, col in imo_columns(conn):
        n = conn.execute(text(f"UPDATE {q(table)} SET {q(col)} = :new WHERE {q(col)} = :old"), {"new": new, "old": old}).rowcount
        if n:
            moved[f"{table}.{col}"] = n
    conn.execute(text("DELETE FROM vessels WHERE imo_number = :old"), {"old": old})
    left = {f"{t}.{c}": count(conn, t, c, old) for t, c in imo_columns(conn)}
    left = {k: v for k, v in left.items() if v}
    if left:
        raise RuntimeError(f"rows still carry the old IMO {old}: {left}")
    return moved


def run(engine, corrections: dict[str, str], do_apply: bool) -> int:
    with engine.connect() as conn:
        plans = plan(conn, corrections)
    bad = False
    for p in plans:
        print(f"\n{p['name']}: {p['old']} -> {p['new']}   [{p['state']}]")
        if p["state"] == "conflict":
            print("  Both IMOs exist in the vessels table. Not touched: look at it by hand.")
            bad = True
        elif p["state"] == "missing":
            print("  Neither IMO is in the vessels table. Skipped.")
        elif p["state"] == "done":
            leftovers = [t for t in p["tables"] if t["old"]]
            print("  Already on the new IMO." + (" Rows still on the old IMO: " + ", ".join(
                f"{t['table']}.{t['column']}={t['old']}" for t in leftovers) if leftovers else ""))
        for t in p["tables"]:
            clash = "   <- rows already on the new IMO" if t["new"] and p["state"] == "migrate" else ""
            print(f"  {t['table'] + '.' + t['column']:46} old {t['old']:>7}   new {t['new']:>7}{clash}")
    if bad:
        return 1
    if not do_apply:
        print("\nDry run: nothing written. Add --apply to make the change.")
        return 0

    with engine.begin() as conn:          # one transaction: any error undoes everything
        for p in plans:
            if p["state"] == "migrate":
                moved = apply_one(conn, p["old"], p["new"])
                print(f"\n{p['name']}: moved {sum(moved.values())} row(s) in {len(moved)} table column(s).")
            elif p["state"] == "done" and any(t["old"] for t in p["tables"]):
                for t in p["tables"]:
                    if t["old"]:
                        conn.execute(text(f"UPDATE {q(t['table'])} SET {q(t['column'])} = :n WHERE {q(t['column'])} = :o"),
                                     {"n": p["new"], "o": p["old"]})
                print(f"\n{p['name']}: moved leftover rows from the old IMO.")
    print("\nDone. Re-run check_vessel_links.py: all vessels should now match by IMO.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    return run(create_engine(config.DATABASE_URL), CORRECTIONS, args.apply)


if __name__ == "__main__":
    sys.exit(main())
