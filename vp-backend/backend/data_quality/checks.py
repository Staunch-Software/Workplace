# ===========================================================================
# backend/data_quality/checks.py
#
# The 3 confirmed mandatory-field rules (client request 2026-10):
#   - missing_weather: a steaming report missing BF_Wind or Sig_Wave_Ht_m —
#     the CP fair-weather filter input every CP calculation depends on
#     (see CLAUDE.md's Charter-Party Performance section).
#   - missing_fuel: a real steaming day (Distance_nm/Duration_h present) with
#     zero fuel logged across every grade — the AM KIRTI 38/05 gap found
#     2026-09 while chasing the "fuel chart scale looks wrong" complaint.
#   - missing_cp_instruction: reads the dataqualityx_missing_cp_instruction
#     flag expander.py already computes at ingestion (vessel-gated by
#     cp_vessel_description.requires_cp_remarks_check) — not recomputed here.
#
# Pure read-only query functions — no DB writes, no email. The daily job
# (daily_job.py) owns the open/resolved state machine and notifications.
# ===========================================================================
from sqlalchemy import text

from ..cp.cp_compliance_v2 import _is_steaming, _is_sea_passage_event

# Same consumer-prefix/grade enumeration as api/routes/cp_routes.py's
# _FO_COLS/_DOGO_COLS (duplicated rather than cross-imported from api.routes
# into backend, to not invert that layering — api/routes depends on backend,
# never the reverse elsewhere in this codebase). Keep in sync manually if a
# new consumer type is ever added there.
_CONSUMER_PREFIXES = ("me", "ae", "bl", "combl", "inc", "aeb", "blfo", "eg")
_FO_COLS = [f"{c}_{g}" for c in _CONSUMER_PREFIXES for g in ("hfo", "lfo")]
_DOGO_COLS = [f"{c}_mdo" for c in _CONSUMER_PREFIXES]


def _numexpr(col):
    # Require at least one digit (rejects '', '.', text); optional sign/decimals.
    return f"(CASE WHEN {col} ~ '^[-+]?[0-9]+(\\.[0-9]+)?$' THEN {col}::double precision ELSE 0 END)"


_FO_EXPR = "(" + "+".join(_numexpr(f"n.{c}") for c in _FO_COLS) + ")"
_DOGO_EXPR = "(" + "+".join(_numexpr(f"n.{c}") for c in _DOGO_COLS) + ")"

# Per-source join: WNI links via raw_report_id, MariApps via raw_mariapps_id,
# Wartsila FOS links via raw_report_id into noon_report_data.
_SOURCE_SQL = {
    "wni": ('JOIN noon_report_data n ON n.raw_report_id = a.raw_report_id', "wni"),
    "mari_apps": ('JOIN mariapps_reports_data n ON n.raw_report_id = a.raw_mariapps_id', "mari_apps"),
    "Wartsila FOS": ('JOIN noon_report_data n ON n.raw_report_id = a.raw_report_id', "Wartsila FOS"),
}


def fetch_report_rows(db, vessel_imo, report_date, source):
    """One analysis_data row per report for this vessel/date/source — same
    shape cp_routes.py's _rows_for_source() produces (Distance_nm, Duration_h,
    BF_Wind, Sig_Wave_Ht_m, fo_mt, dogo_mt, event_type)."""
    if source not in _SOURCE_SQL:
        return []
    join, src = _SOURCE_SQL[source]
    sql = f"""
        SELECT a."Voyage_No", a."Loading_Cond", a."Date", a."Distance_nm", a."Duration_h",
               a."BF_Wind", a."Sig_Wave_Ht_m",
               {_FO_EXPR} AS fo_mt, {_DOGO_EXPR} AS dogo_mt,
               n.log_type AS event_type, n.log_number AS log_number
        FROM analysis_data a
        {join}
        WHERE a.vessel_imo = :imo AND a.source_id = :src AND a."Date" = :report_date
    """
    rows = db.execute(text(sql), {"imo": vessel_imo, "src": src, "report_date": report_date}).mappings().all()
    return [dict(r) for r in rows]


def _steaming_sea_passage_rows(db, vessel_imo, report_date, source):
    rows = fetch_report_rows(db, vessel_imo, report_date, source)
    return [r for r in rows if _is_steaming(r) and _is_sea_passage_event(r)]


def _identifier_detail(bad, source):
    """MariApps identifies a report by its log_number (e.g. "66/03/09") — more
    specific than the voyage/leg number ("66/03") and what the master actually
    looks up in MariApps. WNI has no equivalent log-number concept in this
    digest, so it keeps showing Voyage_No, unchanged."""
    if source == "mari_apps":
        return {"logs": sorted({r["log_number"] for r in bad if r.get("log_number")})}
    return {"voyages": sorted({r["Voyage_No"] for r in bad if r.get("Voyage_No")})}


def check_missing_weather(db, vessel_imo, report_date, source):
    rows = _steaming_sea_passage_rows(db, vessel_imo, report_date, source)
    bad = [r for r in rows if r.get("BF_Wind") is None or r.get("Sig_Wave_Ht_m") is None]
    if not bad:
        return None
    return {"count": len(bad), **_identifier_detail(bad, source)}


def check_missing_fuel(db, vessel_imo, report_date, source):
    rows = _steaming_sea_passage_rows(db, vessel_imo, report_date, source)
    bad = [r for r in rows if (r.get("fo_mt") or 0) == 0 and (r.get("dogo_mt") or 0) == 0]
    if not bad:
        return None
    return {"count": len(bad), **_identifier_detail(bad, source)}


def check_missing_cp_instruction(db, vessel_imo, report_date):
    """MariApps-only — the CP remarks mechanism doesn't exist for WNI. Already
    respects the per-vessel requires_cp_remarks_check gate, since
    dataqualityx_missing_cp_instruction is only ever set non-null for vessels
    that have that flag on (see expander.py's _data_quality_extra_fields)."""
    # expanded_mariapps_data has no plain `voyage_no` column — MariApps' voyage
    # number only exists as the dedicated Emission Log column emissionx_voyage_no
    # (see expander.py's _mariapps_voyage_no_field). log_number (e.g. "40/02/27")
    # already uniquely identifies the report, which is enough for the digest.
    rows = db.execute(text("""
        SELECT log_number FROM expanded_mariapps_data
        WHERE vessel_imo = :imo AND log_date = :report_date
          AND dataqualityx_missing_cp_instruction IS NOT NULL
    """), {"imo": vessel_imo, "report_date": report_date}).mappings().all()
    if not rows:
        return None
    return {
        "count": len(rows),
        "logs": sorted({r["log_number"] for r in rows if r["log_number"]}),
    }


# Distance (nm) above which E01 / E11 apply - drifting / manoeuvring noise stays below it.
_MIN_DISTANCE_NM = 5

_ME_FUEL_EXPR = "(" + "+".join(
    _numexpr(f"r.me_{g}::text") for g in ("total_cons", "hfo", "lfo", "mdo", "bio_fuel", "lng", "methanol", "ethanol",
                                    "ammonia", "lpg_propane", "lpg_butane")) + ")"
_ME_HOURS_EXPR = _numexpr('x."ME_RHME_dCnt_operational_LF"::text')
_DIST_EXPR = _numexpr("r.distance_og::text")


def _mariapps_rows(db, vessel_imo, report_date, where):
    """MariApps reports of this vessel/date (retired duplicate copies excluded) that satisfy
    `where` (a SQL condition over r = mariapps_reports_data, x = expanded_mariapps_data)."""
    rows = db.execute(text(f"""
        SELECT x.log_number
        FROM expanded_mariapps_data x
        JOIN mariapps_reports_data r ON r.raw_report_id = x.raw_log_id
        JOIN raw_mariapps_logs l ON l.id = x.raw_log_id
        WHERE x.vessel_imo = :imo AND x.log_date = :report_date
          AND COALESCE(l.is_duplicate, false) = false
          AND {where}
    """), {"imo": vessel_imo, "report_date": report_date}).mappings().all()
    if not rows:
        return None
    return {"count": len(rows), "logs": sorted({r["log_number"] for r in rows if r["log_number"]})}


def check_distance_no_me(db, vessel_imo, report_date):
    """E01 (MariApps only): distance steamed but no ME fuel and no ME running hours -
    the burnt fuel is missing from every emission total. Port-type reports are excluded
    (a vessel at port legitimately has the ME stopped; their stray distance is E11)."""
    return _mariapps_rows(db, vessel_imo, report_date, f"""
        {_DIST_EXPR} > {_MIN_DISTANCE_NM}
        AND {_ME_FUEL_EXPR} = 0 AND {_ME_HOURS_EXPR} = 0
        AND UPPER(TRIM(COALESCE(x.log_type, ''))) NOT IN ('NOON AT PORT', 'ARRIVAL REPORT', 'DEPARTURE REPORT')""")


def check_port_noon_with_distance(db, vessel_imo, report_date):
    """E11 (MariApps only): a 'Noon at port' report that carries steamed distance -
    either the report type or the distance is wrong."""
    return _mariapps_rows(db, vessel_imo, report_date, f"""
        {_DIST_EXPR} > {_MIN_DISTANCE_NM}
        AND UPPER(TRIM(COALESCE(x.log_type, ''))) LIKE 'NOON AT PORT%'""")


_NOT_PORT = "UPPER(TRIM(COALESCE(x.log_type, ''))) NOT IN ('NOON AT PORT', 'ARRIVAL REPORT', 'DEPARTURE REPORT')"
_SEA_NOON = "(UPPER(TRIM(COALESCE(x.log_type, ''))) LIKE 'NOON AT SEA%' OR UPPER(TRIM(COALESCE(x.log_type, ''))) = 'NOON')"
_X_CARGO = _numexpr('x."Vessel_Cargo_onboard_operational_LF"::text')
_X_CARGO_BLANK = "NULLIF(TRIM(x.\"Vessel_Cargo_onboard_operational_LF\"::text), '') IS NULL"
_X_ME_HOURS_BLANK = "NULLIF(TRIM(x.\"ME_RHME_dCnt_operational_LF\"::text), '') IS NULL"
_X_DURATION = _numexpr('x."VoyageMeta_log_durationh_operational_LF"::text')
_X_GRAND_TOTAL = _numexpr("x.emissionx_grand_total_mt::text")
# A ballast passage can legitimately carry a little cargo residue / slops.
_BALLAST_CARGO_MIN_T = 100


def check_loading_cargo_mismatch(db, vessel_imo, report_date):
    """E10 (MariApps only): 'Laden' with a cargo figure of exactly 0, or 'Ballast' with
    more than 100 t of cargo. A blank cargo is M09, not this. Port-type reports are
    excluded (cargo is legitimately changing there)."""
    return _mariapps_rows(db, vessel_imo, report_date, f"""
        {_NOT_PORT} AND (
          (UPPER(TRIM(COALESCE(x.loading_condition, ''))) = 'LADEN'
             AND NOT ({_X_CARGO_BLANK}) AND {_X_CARGO} = 0)
          OR (UPPER(TRIM(COALESCE(x.loading_condition, ''))) = 'BALLAST' AND {_X_CARGO} > {_BALLAST_CARGO_MIN_T}))""")


def check_zero_total_fuel(db, vessel_imo, report_date):
    """E07 (MariApps only): no fuel at all on a report covering 2 h or more - the auxiliary
    engine alone must burn something."""
    return _mariapps_rows(db, vessel_imo, report_date, f"""
        {_X_DURATION} >= 2 AND {_X_GRAND_TOTAL} = 0""")


def check_cargo_blank(db, vessel_imo, report_date):
    """M09 (MariApps only): Cargo Onboard not filled in (a ballast ship should enter 0)."""
    return _mariapps_rows(db, vessel_imo, report_date, _X_CARGO_BLANK)


def check_me_hours_blank(db, vessel_imo, report_date):
    """M11 (MariApps only): ME running hours blank on a sea-type report."""
    return _mariapps_rows(db, vessel_imo, report_date, f"{_X_ME_HOURS_BLANK} AND {_NOT_PORT}")


def check_position_blank(db, vessel_imo, report_date):
    """M15 (MariApps only): latitude or longitude blank on a Noon at sea report."""
    return _mariapps_rows(db, vessel_imo, report_date, f"""
        {_SEA_NOON} AND (NULLIF(TRIM(x."VoyageMeta_latitude_operational_LF"::text), '') IS NULL
                         OR NULLIF(TRIM(x."VoyageMeta_longitude_operational_LF"::text), '') IS NULL)""")


def run_checks_for_date(db, vessel_imo, report_date):
    """Returns {(source_id, rule_key): detail_dict} for every rule that found
    a gap on this vessel/date — empty dict if everything's clean."""
    findings = {}
    for source in ("wni", "mari_apps"):
        weather = check_missing_weather(db, vessel_imo, report_date, source)
        if weather:
            findings[(source, "missing_weather")] = weather
        fuel = check_missing_fuel(db, vessel_imo, report_date, source)
        if fuel:
            findings[(source, "missing_fuel")] = fuel

    cp_instr = check_missing_cp_instruction(db, vessel_imo, report_date)
    if cp_instr:
        findings[("mari_apps", "missing_cp_instruction")] = cp_instr

    # E01: a log already reported as "zero fuel on a steaming day" is the same problem told
    # twice, so it is left out of E01 (E01 still catches the ones missing_fuel does not,
    # e.g. ME at zero while the boiler or AE burnt fuel, or EOSP / BOSP reports).
    e01 = check_distance_no_me(db, vessel_imo, report_date)
    if e01:
        already = set((findings.get(("mari_apps", "missing_fuel")) or {}).get("logs", []))
        logs = [lg for lg in e01["logs"] if lg not in already]
        if logs:
            findings[("mari_apps", "distance_no_me_consumption")] = {"count": len(logs), "logs": logs}

    e11 = check_port_noon_with_distance(db, vessel_imo, report_date)
    if e11:
        findings[("mari_apps", "port_noon_with_distance")] = e11

    # Same report, same problem, one finding: a log already raised as zero fuel / no ME
    # consumption is left out of the fuel and ME-hours checks below.
    covered = set()
    for key in ("missing_fuel", "distance_no_me_consumption"):
        covered |= set((findings.get(("mari_apps", key)) or {}).get("logs", []))
    for rule_key, fn, skip_covered in (
            ("loading_cargo_mismatch", check_loading_cargo_mismatch, False),
            ("zero_total_fuel", check_zero_total_fuel, True),
            ("cargo_blank", check_cargo_blank, False),
            ("me_hours_blank", check_me_hours_blank, True),
            ("position_blank", check_position_blank, False)):
        found = fn(db, vessel_imo, report_date)
        if not found:
            continue
        logs = [lg for lg in found["logs"] if not (skip_covered and lg in covered)]
        if logs:
            findings[("mari_apps", rule_key)] = {"count": len(logs), "logs": logs}

    return findings
