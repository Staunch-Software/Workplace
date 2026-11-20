# ===========================================================================
# backend/fix_boiler_mapping.py
#
# One-off repair of the aux-boiler (bl_*) fuel values stored in
# mariapps_reports_data, and of the Emission columns derived from them.
# Found 2026-11-20: map_mariapps_to_160 looked the aux boiler up by the substring
# "Boiler", which also matches "Composite Boiler ..." keys. On a vessel with no
# separate aux-boiler entry the lookup returned the COMPOSITE boiler's value, so
# bl_* was an exact copy of combl_* and every total that adds the consumers (the
# Emission tab / IMO DCS / EU ETS / FuelEU, and the CII fuel sum) counted that
# boiler fuel twice - about 792 t on the VM (GCL FOS, AMNSI MAXIMUS / STALLION,
# GCL SARASWATI, AMNS POLAR). The mapping is fixed (it now ignores "Composite" and
# "Cargo" keys for the aux boiler); this command re-derives bl_* for the stored
# reports from their raw JSON with the fixed mapping, which is also exactly what the
# next ingestion of those reports would do. raw_json is never touched.
#
# It then recomputes the Emission fuel columns in expanded_mariapps_data for the
# reports whose bl_* changed AND for every report with a composite-boiler value
# (the Emission tab now shows the composite boiler under Boiler instead of
# IG/Other; totals are unchanged for those).
#
# USAGE (from vp-backend, app venv; do NOT run it in the first minute after a service
# restart - the startup migration locks the expanded tables):
#   python -m backend.fix_boiler_mapping            # dry run, writes nothing
#   python -m backend.fix_boiler_mapping --apply
# Idempotent: a second run finds nothing to change.
# ===========================================================================
import argparse
import logging
from collections import Counter, defaultdict

from sqlalchemy import text

from .database import engine
from .mapping import map_mariapps_to_160
from .pipeline.expander import _emission_log_fuel_fields, _get_table_cols

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)

GRADES = ["hfo", "lfo", "mdo", "lpg_propane", "lpg_butane", "lng", "methanol", "ethanol", "ammonia", "bio_fuel"]
BL_COLS = ["bl_total_cons"] + [f"bl_{g}" for g in GRADES]
SHOW_GRADES = ["hfo", "lfo", "mdo", "bio_fuel"]
BATCH = 200


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_plan(conn):
    """Read-only. Returns (changes, composite_ids, names).
    changes = [dict(id, imo, new={col: value}, old={col: value}, copy=bool)]
    composite_ids = raw ids of reports with a composite-boiler value (> 0)."""
    names = {i: n for i, n in conn.execute(text("SELECT imo_number, vessel_name FROM vessels"))}
    sel = ", ".join(f"m.{c}" for c in BL_COLS)
    rows = conn.execute(text(
        f"SELECT r.id, r.vessel_imo, r.raw_json, {sel}, m.combl_total_cons "
        "FROM raw_mariapps_logs r JOIN mariapps_reports_data m ON m.raw_report_id = r.id "
        "WHERE COALESCE(r.is_duplicate, false) = false")).fetchall()
    changes, composite_ids = [], []
    for row in rows:
        rid, imo, j = row[0], row[1], row[2]
        old = dict(zip(BL_COLS, row[3:3 + len(BL_COLS)]))
        comp_total = row[3 + len(BL_COLS)]
        if _f(comp_total) > 0:
            composite_ids.append(rid)
        j = j or {}
        m = map_mariapps_to_160(j, excel_data=j.get("Excel_Data"), header_data=j.get("Header_Data"))
        new = {c: m.get(c) for c in BL_COLS}
        if any(abs(_f(new[c]) - _f(old[c])) > 1e-9 for c in BL_COLS):
            changes.append(dict(id=rid, imo=imo, old=old, new=new,
                                copy=abs(_f(old["bl_total_cons"]) - _f(comp_total)) < 1e-9))
    return changes, composite_ids, names


def report(changes, composite_ids, names):
    per = defaultdict(lambda: Counter())
    tonnes = defaultdict(lambda: Counter())
    for c in changes:
        v = names.get(c["imo"], c["imo"])
        per[v]["reports"] += 1
        per[v]["not_a_copy"] += 0 if c["copy"] else 1
        tonnes[v]["total"] += _f(c["old"]["bl_total_cons"]) - _f(c["new"]["bl_total_cons"])
        for g in SHOW_GRADES:
            tonnes[v][g] += _f(c["old"][f"bl_{g}"]) - _f(c["new"][f"bl_{g}"])
    log.info(f"Reports whose aux-boiler fuel will change: {len(changes)}")
    log.info(f"  {'vessel':16} {'reports':>8} {'tonnes counted twice':>21}   " + "  ".join(f"{g:>7}" for g in SHOW_GRADES))
    for v in sorted(per, key=lambda k: -tonnes[k]["total"]):
        log.info(f"  {v:16} {per[v]['reports']:>8} {tonnes[v]['total']:>21.1f}   "
                 + "  ".join(f"{tonnes[v][g]:>7.1f}" for g in SHOW_GRADES))
    log.info(f"  TOTAL fuel counted twice: {sum(t['total'] for t in tonnes.values()):.1f} t")
    odd = sum(p["not_a_copy"] for p in per.values())
    if odd:
        log.warning(f"{odd} changed reports were NOT an exact copy of the composite boiler - review before applying")
    else:
        log.info("Every changed report was an exact copy of the composite boiler (aux == composite).")
    log.info(f"Reports with a composite-boiler value (Boiler / IG-Other split in the Emission tab may move): {len(composite_ids)}")


def _recompute_expanded(conn, raw_ids, apply):
    """Recompute the Emission fuel columns of expanded_mariapps_data for raw_ids; only rows
    whose values differ are updated (and counted)."""
    cols = _get_table_cols(conn, "expanded_mariapps_data")
    updated = 0
    for i in range(0, len(raw_ids), BATCH):
        for rid in raw_ids[i:i + BATCH]:
            fields = _emission_log_fuel_fields(conn, "mari_apps", rid, cols)
            if not fields:
                continue
            sel = ", ".join(f'"{c}"' for c in fields)
            cur = conn.execute(text(f"SELECT {sel} FROM expanded_mariapps_data WHERE raw_log_id = :r"), {"r": rid}).fetchone()
            if cur is None or all((str(a) if a is not None else None) == b for a, b in zip(cur, fields.values())):
                continue
            updated += 1
            if apply:
                conn.execute(text("UPDATE expanded_mariapps_data SET " + ", ".join(f'"{c}" = :{c}' for c in fields)
                                  + " WHERE raw_log_id = :_r"), {**fields, "_r": rid})
        if apply:
            conn.commit()      # release locks between batches
    return updated


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    with engine.connect() as conn:
        changes, composite_ids, names = build_plan(conn)
        conn.rollback()
        report(changes, composite_ids, names)
        if not args.apply:
            exp = _recompute_expanded(conn, sorted(set(composite_ids)), apply=False)
            conn.rollback()
            log.info(f"Expanded Emission rows that differ from the corrected values and would be updated now: {exp} "
                     "(more follow once the aux values are corrected)")
            log.info("DRY RUN - nothing written. Re-run with --apply to correct the stored rows.")
            return

        # step 1: correct bl_* in the mapped table, committing in batches
        for i in range(0, len(changes), BATCH):
            for c in changes[i:i + BATCH]:
                params = {f"v{n}": (None if c["new"][col] is None else str(c["new"][col])) for n, col in enumerate(BL_COLS)}
                conn.execute(text("UPDATE mariapps_reports_data SET " + ", ".join(f"{col} = :v{n}" for n, col in enumerate(BL_COLS))
                                  + " WHERE raw_report_id = :rid"), {**params, "rid": c["id"]})
            conn.commit()
        log.info(f"Step 1: aux-boiler values corrected on {len(changes)} reports.")

        # step 2: recompute the Emission columns for those reports and for composite-boiler reports
        ids = sorted({c["id"] for c in changes} | set(composite_ids))
        n = _recompute_expanded(conn, ids, apply=True)
        log.info(f"Step 2: Emission fuel columns updated on {n} of {len(ids)} reports.")
        log.info("APPLIED. Re-run the dry run: it should report 0 reports to change.")


if __name__ == "__main__":
    main()
