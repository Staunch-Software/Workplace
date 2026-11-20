"""
Read-only audit: the "blank field" codes of the colleague's Fleet Noon Records
Issues Log (2026-11-19) counted against OUR MariApps tables, so we can tell
which blanks really exist in our data before anything is sent to MariApps or
the vessels. Writes nothing. Run from vp-backend with the app's venv:

    python audit_blank_fields.py > blanks.txt

Blank = NULL, empty or whitespace. M04 is special: Op. Status is derived by our own
expander, so its count is a backfill gap, not a MariApps blank. All codes are counted over every MariApps
record unless the code is sea-only (M12, M13, M14, M15). Counts are comparable
with the workbook only approximately: the export is a 19/11 snapshot and some
definitions (M05, M12, M18) are interpreted from the workbook's wording.
"""
from sqlalchemy import text

from backend.database import SessionLocal

db = SessionLocal()
names = {i: n for i, n in db.execute(text("SELECT imo_number, vessel_name FROM vessels")).fetchall()}

X = "expanded_mariapps_data"
NUM = r"^[-+]?[0-9]+(\.[0-9]+)?$"


def blank(col, alias="x"):
    return f'NULLIF(TRIM({alias}."{col}"::text), \'\') IS NULL'


def num(col, alias="x"):
    return f"(CASE WHEN {alias}.\"{col}\"::text ~ '{NUM}' THEN {alias}.\"{col}\"::double precision ELSE 0 END)"


# code -> (title, report fleet count, SQL boolean over alias x / r (raw) / a (analysis))
FROM_RAW = "LEFT JOIN mariapps_reports_data r ON r.raw_report_id = x.raw_log_id"
FROM_ANA = "LEFT JOIN analysis_data a ON a.raw_mariapps_id = x.raw_log_id"
SEA = "x.log_type ILIKE 'noon at sea%' OR x.log_type = 'NOON'"
MOVED = f"{num('Vessel_DOG_dCnt_operational_LF')} > 0"


def rblank(col):
    return f"NULLIF(TRIM(r.{col}::text), '') IS NULL"


FUEL_RAW = [f"{g}_{f}" for g in ("me", "ae", "bl") for f in ("hfo", "lfo", "mdo", "bio_fuel")]
FUEL_EXP = [f"emissionx_{g}_{f}_mt" for g in ("me", "ae", "bl") for f in ("hfo", "lfo", "mdo", "biofuel")] + \
           ["emissionx_ig_other_mt", "emissionx_total_hfo_mt", "emissionx_total_lfo_mt",
            "emissionx_total_mdo_mt", "emissionx_total_biofuel_mt", "emissionx_grand_total_mt"]

CODES = [
    ("M01", "Departure port / destination port blank", 2182,
     f"({blank('VoyageMeta_departure_port_last_leg_operational_LF')} OR {blank('VoyageMeta_to_port_operational_LF')})", None),
    ("M02", "Country (From) / Country (To) blank", 2182,
     f"({blank('emissionx_from_country')} OR {blank('emissionx_to_country')})", None),
    ("M03", "EU Port? (From/To) flag blank", 2182,
     f"({blank('emissionx_from_eu_port')} OR {blank('emissionx_to_eu_port')})", None),
    # NOT a MariApps blank: MariApps's raw data has no Op. Status field. Ours is derived by
    # expander._backfill_op_status (BOSP/EOSP walk), so NULL here = our backfill has not covered
    # the row. Not comparable with the report's M04 (the export's own Op. Status column).
    ("M04", "Op. Status NULL in OUR table (derived by us - backfill gap, not a MariApps blank)", 1030,
     blank('emissionx_op_status'), None),
    ("M05", "Any fuel consumption field blank (ME/AE/Boiler/IG/totals)", 408,
     "(" + " OR ".join(blank(c) for c in FUEL_EXP) + ")", None),
    ("M06", "ME total (me_total_cons) blank", 1868, rblank("me_total_cons"), FROM_RAW),
    ("M07", "Composite BL Mass FO Consumption (boiler total) blank", 2856,
     blank('CompositeBoiler_mFOCComBL_dCnt_operational_LF'), None),
    ("M08", "Distance / Log Duration blank", 1,
     f"({blank('Vessel_DOG_dCnt_operational_LF')} OR {blank('VoyageMeta_log_durationh_operational_LF')})", None),
    ("M09", "Cargo Onboard blank", 771, blank('Vessel_Cargo_onboard_operational_LF'), None),
    ("M10", "CP warranted speed/consumption/tolerances blank", 4,
     "(" + " OR ".join(blank(c) for c in ("mariappsx_cp_warranted_speed_kn", "mariappsx_cp_warranted_consumption_mtday",
                                          "mariappsx_cp_speed_tolerance_kn", "mariappsx_cp_consumption_tolerance_pct")) + ")", None),
    ("M11", "ME Running Hours blank", 948, blank('ME_RHME_dCnt_operational_LF'), None),
    ("M12", "SOG and STW both blank where the ship moved", 180,
     f"({MOVED}) AND {blank('Vessel_SOG_operational_LF')} AND {blank('Vessel_SOG_avg_operational_LF')} "
     f"AND {blank('Vessel_STW_operational_LF')} AND {blank('Vessel_STW_avg_operational_LF')}", None),
    ("M13", "Wind or swell blank on Noon at sea (analysis_data)", 952,
     f"({SEA}) AND (a.\"BF_Wind\" IS NULL OR a.\"Sig_Wave_Ht_m\" IS NULL)", FROM_ANA),
    ("M14", "CP instruction (Voyage Remarks) blank on Noon at sea", 1877,
     f"({SEA}) AND {blank('cpx_remarks')}", None),
    ("M15", "Latitude / Longitude blank on a sea report", 32,
     f"({SEA}) AND ({blank('VoyageMeta_latitude_operational_LF')} OR {blank('VoyageMeta_longitude_operational_LF')})", None),
    ("M16", "Country (To) blank for a non-EU destination", 5557,
     f"{blank('emissionx_to_country')} AND UPPER(COALESCE(TRIM(x.emissionx_to_eu_port::text), '')) NOT IN ('YES', 'Y', 'TRUE', '1')", None),
    ("M18", "Remarks filled but no speed/consumption keyword (approx.)", 52,
     "(NULLIF(TRIM(x.cpx_remarks::text), '') IS NOT NULL AND "
     "x.cpx_remarks::text !~* '(speed|\\mkn|knot|rpm|cons|mt/d|mt per|slow|full|eco|instruct)')", None),
]


def main():
    totals = {}
    for code, title, report_n, cond, join in CODES:
        sql = (f"SELECT x.vessel_imo, COUNT(*) FROM {X} x {join or ''} "
               f"WHERE {cond} GROUP BY 1 ORDER BY 1")
        try:
            rows = db.execute(text(sql)).fetchall()
        except Exception as ex:
            db.rollback()
            print(f"\n{code} {title}\n  !! could not run: {type(ex).__name__}: {str(ex)[:160]}")
            continue
        total = sum(c for _, c in rows)
        totals[code] = (total, report_n)
        print(f"\n{code}  {title}")
        print(f"   ours: {total:>6}    report: {report_n:>6}")
        if rows:
            print("   per vessel: " + ", ".join(f"{names.get(i, i)} {c}" for i, c in sorted(rows, key=lambda r: -r[1])))

    n_rows = db.execute(text(f"SELECT COUNT(*) FROM {X}")).scalar()
    print("\n" + "=" * 70)
    print(f"SUMMARY  (our expanded_mariapps_data rows: {n_rows}; export had ~5,929 incl. duplicates)")
    print(f"{'code':5} {'ours':>7} {'report':>7}  reading")
    for code, (ours, rep) in totals.items():
        if code == "M04":
            read = "our derived column - NULL = backfill gap (not comparable)"
        elif rep == 0:
            read = "n/a"
        elif ours == 0:
            read = "NOT in our data (export-only / different definition)"
        elif 0.8 <= ours / rep <= 1.25:
            read = "matches the report"
        elif ours < rep:
            read = "fewer than report"
        else:
            read = "MORE than report"
        print(f"{code:5} {ours:>7} {rep:>7}  {read}")
    db.close()
    print("\nDone. Read-only: nothing was written.")


if __name__ == "__main__":
    main()
