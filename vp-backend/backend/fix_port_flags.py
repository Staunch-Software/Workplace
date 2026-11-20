# ===========================================================================
# backend/fix_port_flags.py
#
# One-off repair of the derived Country / EU Port? (From/To) columns on stored
# rows (found 2026-11-20). Those columns are derived by expander.py from the port
# strings; an EU port missing from the hardcoded EU list was flagged "N" (e.g.
# "Teneriffe", Spain), and a non-EU destination never got a Country. The rules
# now also learn name -> country / EU flag from the fleet's own
# 'Name {LOCODE},Country' port strings (see expander._FLEET_PORTS); this command
# applies the current rules to rows already stored.
#
# Changes only emissionx_from/to_country and emissionx_from/to_eu_port, only to
# non-blank computed values, only where they differ. Idempotent. Affects the EU
# MRV / ETS / FuelEU voyage classification (legs arriving at a port that flips
# N -> Y become EU legs), so review the dry run first.
#
# USAGE (from vp-backend, app venv):
#   python -m backend.fix_port_flags            # dry run, writes nothing
#   python -m backend.fix_port_flags --apply
# ===========================================================================
import argparse
import logging
from collections import Counter

from .database import engine
from .pipeline.expander import _port_flag_changes

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-8s  %(message)s")
log = logging.getLogger(__name__)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="actually write (default is a dry run)")
    args = ap.parse_args()

    changes = _port_flag_changes(engine, apply=args.apply)
    total = sum(c[3] for c in changes)
    log.info(f"Rows whose Country / EU Port? will change: {total} across {len(changes)} port pairs")

    eu_flips = Counter()      # destination ports whose EU flag changes
    countries = Counter()     # destination ports that gain a country
    for table, dep, dest, n, old, new in changes:
        old_rows = [dict(zip(new.keys(), o)) for o in old]
        if "emissionx_to_eu_port" in new and any(o.get("emissionx_to_eu_port") != new["emissionx_to_eu_port"] for o in old_rows):
            for o in old_rows:
                if o.get("emissionx_to_eu_port") != new["emissionx_to_eu_port"]:
                    eu_flips[(dest, o.get("emissionx_to_eu_port"), new["emissionx_to_eu_port"])] += n
        if "emissionx_to_country" in new and any(not o.get("emissionx_to_country") for o in old_rows):
            countries[(dest, new["emissionx_to_country"])] += n
    log.info("EU flag changes on the destination port (port, old -> new, rows) - these move legs in/out of EU scope:")
    for (dest, o, nw), n in sorted(eu_flips.items(), key=lambda kv: -kv[1]):
        log.info(f"    {dest!s:28} {o} -> {nw}   {n} rows")
    if not eu_flips:
        log.info("    none")
    log.info("Destination ports that gain a Country (top 25):")
    for (dest, ctry), n in countries.most_common(25):
        log.info(f"    {dest!s:28} {ctry}   {n} rows")
    log.info("APPLIED." if args.apply else "DRY RUN - nothing written. Re-run with --apply to fix the stored rows.")


if __name__ == "__main__":
    main()
