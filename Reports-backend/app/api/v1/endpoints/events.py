# app/api/v1/endpoints/events.py
# Latest N days of Vessel_Performance logbook data for the Overview "Events" tab.

from datetime import date as date_type, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_any
from app.core.database_vessel_perf import get_vessel_perf_db

router = APIRouter(prefix="/events", tags=["Events"])

# Fixed map: source -> (table, date column). Never built from user input.
_SOURCES = {
    "mari_apps": ("expanded_mariapps_data", "log_date"),
    "wni": ("expanded_wni_data", "date"),
}

# Keys used for lookups, never shown as rows.
# Vessel_Performance and the Workplace vessel list use different IMOs for some
# vessels. Map the Vessel_Performance IMO -> the Workplace IMO so rows land under
# the right vessel column (9521813 is POLAR's old IMO, still in expanded_wni_data).
_IMO_ALIAS = {
    "9961609": "9521813",  # AMNS POLAR
    "9942768": "9628893",  # AMNSI MAXIMUS
    "9942770": "9628910",  # AMNSI STALLION
}


def _perf_imos(wp_imos):
    """Workplace IMOs -> every IMO those vessels may be stored under."""
    wp = set(wp_imos)
    return sorted(wp | {perf for perf, w in _IMO_ALIAS.items() if w in wp})


# Vessels whose noon reports arrive as Excel/email (TUFMAX) or via the Wartsila
# scraper (POLAR) rather than MariApps. Their data lives in expanded_wni_data;
# in the MariApps view it is used as a backup when MariApps has no data for the
# vessel or the backup is newer.
_BACKUP_VESSELS = {"9486295", "9521813"}  # Workplace IMOs: TUFMAX, POLAR
_BACKUP_SOURCE = "wni"

# Whose saved Vessel_Performance column order the Events tab follows (for every viewer).
_PREF_USER_EMAIL = "kunalchandra@ozellar.com"

# Exact column sequence of the logbook's Emission view (EMISSION_LOG_GROUPS in
# Vessel_Performance frontend AnalysisTable.jsx). Emission is sorted by this first.
_EMISSION_LOG_ORDER = [
    "emissionx_voyage_no",
    "VoyageMeta_departure_port_last_leg_operational_LF", "emissionx_from_country", "emissionx_from_eu_port",
    "VoyageMeta_to_port_operational_LF", "emissionx_to_country", "emissionx_to_eu_port",
    "loading_condition", "VoyageMeta_latitude_operational_LF", "VoyageMeta_longitude_operational_LF",
    "emissionx_op_status",
    "Vessel_DOG_dCnt_operational_LF", "VoyageMeta_log_durationh_operational_LF", "Vessel_SOG_avg_operational_LF",
    "Vessel_Tf_avg_operational_LF", "Vessel_Ta_avg_operational_LF",
    "Vessel_Cargo_onboard_operational_LF",
    "emissionx_me_hfo_mt", "emissionx_me_lfo_mt", "emissionx_me_mdo_mt", "emissionx_me_biofuel_mt",
    "ME_FO_mFOCME_dCnt_operational_LF",
    "emissionx_ae_hfo_mt", "emissionx_ae_lfo_mt", "emissionx_ae_mdo_mt", "emissionx_ae_biofuel_mt",
    "AE_FO_mFOCAE_dCnt_operational_LF",
    "emissionx_bl_hfo_mt", "emissionx_bl_lfo_mt", "emissionx_bl_mdo_mt", "emissionx_bl_biofuel_mt",
    "AuxBoiler_mFOCBL_dCnt_operational_LF",
    "emissionx_ig_other_mt", "emissionx_grand_total_mt",
    "emissionx_total_hfo_mt", "emissionx_total_lfo_mt", "emissionx_total_mdo_mt", "emissionx_total_biofuel_mt",
    "emissionx_bdn_ref",
]
_EMISSION_RANK = {c: i for i, c in enumerate(_EMISSION_LOG_ORDER)}

_SKIP_COLUMNS = {"vessel_imo", "log_date", "date", "raw_log_id", "source_id", "raw_report_id"}

# Voyage fields shown in Log Info, above the Performance/Emission sections.
_HEADER_COLUMNS = [
    "VoyageMeta_departure_port_last_leg_operational_LF",
    "VoyageMeta_to_port_operational_LF",
    "VoyageMeta_latitude_operational_LF",
    "VoyageMeta_longitude_operational_LF",
    "Vessel_SOG_avg_operational_LF",
    "Vessel_DOG_dCnt_operational_LF",
    "VoyageMeta_log_durationh_operational_LF",
]


def _quote(ident: str) -> str:
    return '"' + ident.replace('"', '""') + '"'


async def _fetch_rows(db, table, date_col, cols, start_date, end_date, imos):
    """Fetch logbook values in [start_date, end_date] -> {imo: {date: {col: value}}}."""
    cols = sorted(cols)
    if not cols:
        return {}
    dcol = _quote(date_col)
    sql = (
        f"SELECT t.vessel_imo, t.{dcol} AS d, {', '.join('t.' + _quote(c) for c in cols)} "
        f"FROM {table} t "
        f"WHERE t.{dcol} IS NOT NULL "
        f"  AND t.{dcol}::date >= :start_date "
        f"  AND t.{dcol}::date <= :end_date "
        f"  {'AND t.vessel_imo = ANY(:imos)' if imos is not None else ''} "
        f"ORDER BY t.vessel_imo, t.{dcol} DESC, t.ctid DESC"
    )
    params = {"start_date": start_date, "end_date": end_date}
    if imos is not None:
        params["imos"] = imos
    result = await db.execute(text(sql), params)
    keys = list(result.keys())
    out, seen = {}, set()
    for row in result.fetchall():
        m = dict(zip(keys, row))
        imo, d = _IMO_ALIAS.get(m["vessel_imo"], m["vessel_imo"]), str(m["d"])[:10]
        if (imo, d) in seen:  # keep one log per day (the latest)
            continue
        seen.add((imo, d))
        out.setdefault(imo, {})[d] = {c: (None if m[c] is None else str(m[c])) for c in cols}
    return out


async def _latest_date(db, table, date_col, imos):
    dcol = _quote(date_col)
    return (await db.execute(
        text(
            f"SELECT MAX({dcol}::date) FROM {table}"
            + (" WHERE vessel_imo = ANY(:imos)" if imos is not None else "")
        ),
        {"imos": imos} if imos is not None else {},
    )).scalar()


@router.get("/logbook")
async def get_logbook(
    source: str = Query("mari_apps"),
    days: int = Query(5, ge=1, le=14),
    end_date: Optional[date_type] = Query(None, description="Show the latest days up to and including this date"),
    db: Optional[AsyncSession] = Depends(get_vessel_perf_db),
    current_user=Depends(require_any),
):
    if source not in _SOURCES:
        raise HTTPException(status_code=400, detail="Unknown source")
    if db is None:
        raise HTTPException(status_code=503, detail="Vessel Performance database is not configured")

    table, date_col = _SOURCES[source]

    allowed = None
    if current_user.role == "VESSEL":
        assigned = getattr(current_user, "assigned_vessels", None)
        if assigned is None:
            raise HTTPException(
                status_code=503,
                detail="Could not verify vessel assignment. Please retry.",
            )
        # assigned_vessels are Workplace IMOs; also match the Vessel_Performance IMOs
        allowed = _perf_imos(assigned)
        if not allowed:
            return {"source": source, "columns": [], "vessels": []}

    target_end_date = end_date or date_type.today()
    start_date = target_end_date - timedelta(days=days - 1)

    # Column definitions from metadata (also acts as the whitelist for SQL identifiers).
    meta = (await db.execute(
        text(
            "SELECT db_column, display_name, unit, performance, emission, is_identity, "
            "sort_order, user_sort_order, emission_sort_order, is_active "
            "FROM expanded_column_metadata "
            "WHERE source = :s"
        ),
        {"s": source},
    )).fetchall()

    by_col = {
        r[0]: {
            "db_column": r[0],
            "display_name": r[1],
            "unit": r[2] or "",
            "performance": bool(r[3]),
            "emission": bool(r[4]),
            "is_identity": bool(r[5]),
            "sort_order": r[6] if r[6] is not None else 9999,
            "user_sort_order": r[7],
            "emission_sort_order": r[8],
            "is_active": bool(r[9]),
        }
        for r in meta
    }
    table_cols = {r[0] for r in (await db.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
        {"t": table},
    )).fetchall()}
    by_col = {k: v for k, v in by_col.items() if k in table_cols}

    # Column order saved by the reference user in Vessel_Performance
    # (user_column_preferences: {visible: [...], order?: [...]}). Used only to
    # ORDER fields -- nothing is hidden by it; fields it does not list keep the
    # Configure Columns order after the listed ones. User-level pref first, else
    # the most recently saved vessel-level one. No saved pref -> no effect.
    pref_rank: dict[str, int] = {}
    try:
        pref_row = (await db.execute(
            text(
                "SELECT p.column_prefs FROM user_column_preferences p "
                "JOIN users u ON u.id = p.user_id "
                "WHERE lower(u.email) = lower(:email) AND p.source = :s "
                "ORDER BY (p.vessel_imo IS NULL) DESC, p.updated_at DESC LIMIT 1"
            ),
            {"email": _PREF_USER_EMAIL, "s": source},
        )).first()
        prefs = (pref_row[0] if pref_row else None) or {}
        for name in (prefs.get("order") or []) + (prefs.get("visible") or []):
            pref_rank.setdefault(name, len(pref_rank))
    except Exception:
        pref_rank = {}
        await db.rollback()  # a failed statement leaves the transaction aborted

    # Curated order per calculation category from Vessel_Performance
    calc_by_cat: dict[str, dict[str, int]] = {}
    try:
        calc_rows = (await db.execute(
            text(
                "SELECT c.name as category, ccc.db_column, ccc.sort_order "
                "FROM calculation_categories c "
                "JOIN calculation_category_columns ccc ON ccc.calculation_category_id = c.id "
                "WHERE c.source = :s "
                "ORDER BY ccc.sort_order"
            ),
            {"s": source},
        )).fetchall()
        for r in calc_rows:
            calc_by_cat.setdefault(r[0], {})[r[1]] = r[2]
    except Exception:
        calc_by_cat = {}
        await db.rollback()

    def col_rank(col_name: str, section: str = "primary"):
        r = by_col.get(col_name)
        if not r:
            return (999, 9999)
        # Priority 1: reference user's saved column order
        if col_name in pref_rank:
            return (0, pref_rank[col_name])
        # Priority 2: calculation_category_columns for this section
        if section in calc_by_cat and col_name in calc_by_cat[section]:
            return (1, calc_by_cat[section][col_name])
        # Priority 3: emission_sort_order if section is emission
        if section == "Emission" and r["emission_sort_order"] is not None:
            return (2, r["emission_sort_order"])
        # Priority 4: user_sort_order
        if r["user_sort_order"] is not None:
            return (3, r["user_sort_order"])
        # Priority 5: sort_order
        return (4, r["sort_order"])

    columns, used = [], set()

    def _section_cols(cat_name: str, flag: str):
        """Fields of the Performance/Emission calculation category, in the order set
        on the admin Configure Columns page (this is what the logbook chips show).
        Falls back to the old per-column flags if the category has no fields."""
        cat = calc_by_cat.get(cat_name)
        if cat:
            if cat_name == "Emission":
                # logbook Emission order first, then saved preference, then Configure Columns
                key = lambda c: (_EMISSION_RANK.get(c, 10**9), pref_rank.get(c, 10**9), cat[c])
            else:
                key = lambda c: (pref_rank.get(c, 10**9), cat[c])
            ordered = sorted(cat, key=key)
            return [by_col[c] for c in ordered if c in by_col]
        return sorted(
            [r for r in by_col.values() if r[flag] and r["is_active"]],
            key=lambda r: col_rank(r["db_column"], cat_name),
        )

    # Section 1: Log Info
    # Pinned identity fields in STICKY_ORDER, then other identity fields, then pinned voyage navigation fields.
    log_info_added = set()

    def add_log_info(db_col: str):
        r = by_col.get(db_col)
        if r is None or db_col in log_info_added:
            return
        log_info_added.add(db_col)
        used.add(db_col)
        columns.append({
            "db_column": db_col,
            "display_name": r["display_name"],
            "unit": r["unit"],
            "category": "Log Info",
        })

    for c in ["log_type", "event_type", "log_number", "voyage_no", "loading_condition"]:
        if c in by_col:
            add_log_info(c)

    remaining_ident = sorted(
        [r for r in by_col.values() if r["is_identity"] and r["db_column"] not in _SKIP_COLUMNS and r["db_column"] not in log_info_added],
        key=lambda r: col_rank(r["db_column"])
    )
    for r in remaining_ident:
        add_log_info(r["db_column"])

    header_cols = sorted(_HEADER_COLUMNS, key=lambda c: col_rank(c))
    for c in header_cols:
        add_log_info(c)

    # Section 2: Performance
    # Calculation category "Performance" (Configure Columns page).
    perf_added = set()

    def add_perf(db_col: str):
        r = by_col.get(db_col)
        # not repeated from Log Info (Performance/Emission may share fields, as in the logbook)
        if r is None or db_col in perf_added or db_col in log_info_added:
            return
        perf_added.add(db_col)
        used.add(db_col)
        columns.append({
            "db_column": db_col,
            "display_name": r["display_name"],
            "unit": r["unit"],
            "category": "Performance",
        })

    perf_cols = _section_cols("Performance", "performance")
    for r in perf_cols:
        add_perf(r["db_column"])

    # Section 3: Emission
    # Calculation category "Emission" (Configure Columns page).
    emis_added = set()

    def add_emis(db_col: str):
        r = by_col.get(db_col)
        # not repeated from Log Info (Performance/Emission may share fields, as in the logbook)
        if r is None or db_col in emis_added or db_col in log_info_added:
            return
        emis_added.add(db_col)
        used.add(db_col)
        columns.append({
            "db_column": db_col,
            "display_name": r["display_name"],
            "unit": r["unit"],
            "category": "Emission",
        })

    emis_cols = _section_cols("Emission", "emission")
    for r in emis_cols:
        add_emis(r["db_column"])

    vessels = await _fetch_rows(db, table, date_col, used, start_date, target_end_date, allowed)
    latest = await _latest_date(db, table, date_col, allowed)
    via_backup = []

    if source == "mari_apps":
        b_table, b_date = _SOURCES[_BACKUP_SOURCE]
        b_imos = [i for i in _perf_imos(_BACKUP_VESSELS)
                  if allowed is None or i in allowed]
        if b_imos:
            existing = {r[0] for r in (await db.execute(
                text("SELECT column_name FROM information_schema.columns WHERE table_name = :t"),
                {"t": b_table},
            )).fetchall()}
            b_cols = {c for c in used if c in existing}
            backup = await _fetch_rows(db, b_table, b_date, b_cols, start_date, target_end_date, b_imos)
            for imo, b_rows in backup.items():
                m_rows = vessels.get(imo)
                if b_rows and (not m_rows or max(b_rows) > max(m_rows)):
                    vessels[imo] = b_rows
                    via_backup.append(imo)
            b_latest = await _latest_date(db, b_table, b_date, b_imos)
            if b_latest and (latest is None or b_latest > latest):
                latest = b_latest

    return {
        "source": source,
        "latest_date": latest.isoformat() if latest else None,
        "columns": columns,
        "vessels": [
            {"imo": imo, "rows": rows, **({"via": "excel_mail"} if imo in via_backup else {})}
            for imo, rows in vessels.items()
        ],
    }
