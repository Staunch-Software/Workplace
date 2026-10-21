# app/api/v1/endpoints/events.py
# Latest N days of Vessel_Performance logbook data for the Overview "Events" tab.

from datetime import date as date_type
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

_SKIP_COLUMNS = {"vessel_imo", "log_date", "date", "raw_log_id", "source_id"}

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


async def _fetch_rows(db, table, date_col, cols, days, end_date, imos):
    """Latest `days` distinct dates per vessel -> {imo: {date: {col: value}}}."""
    cols = sorted(cols)
    if not cols:
        return {}
    dcol = _quote(date_col)
    sql = (
        f"WITH ranked AS ("
        f"  SELECT vessel_imo, {dcol} AS d, "
        f"         DENSE_RANK() OVER (PARTITION BY vessel_imo ORDER BY {dcol} DESC) AS rk "
        f"  FROM {table} WHERE {dcol} IS NOT NULL"
        f"  {'AND vessel_imo = ANY(:imos)' if imos is not None else ''}"
        f"  {'AND ' + dcol + '::date <= :end_date' if end_date else ''}"
        f") "
        f"SELECT t.vessel_imo, t.{dcol} AS d, {', '.join('t.' + _quote(c) for c in cols)} "
        f"FROM {table} t JOIN ranked r "
        f"  ON r.vessel_imo = t.vessel_imo AND r.d = t.{dcol} "
        f"WHERE r.rk <= :days "
        f"ORDER BY t.vessel_imo, t.{dcol} DESC, t.ctid DESC"
    )
    params = {"days": days}
    if imos is not None:
        params["imos"] = imos
    if end_date:
        params["end_date"] = end_date
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

    # Column definitions from metadata (also acts as the whitelist for SQL identifiers).
    meta = (await db.execute(
        text(
            "SELECT db_column, display_name, unit, performance, emission, is_identity "
            "FROM expanded_column_metadata "
            "WHERE source = :s AND is_active = TRUE "
            "ORDER BY sort_order, db_column"
        ),
        {"s": source},
    )).fetchall()
    by_col = {r[0]: r for r in meta}

    columns, used = [], set()

    def add(db_col, category):
        r = by_col.get(db_col)
        if r is None or db_col in used:
            return
        used.add(db_col)
        columns.append({
            "db_column": db_col,
            "display_name": r[1],
            "unit": r[2] or "",
            "category": category,
        })

    # Log Info: identity fields (log type/number, loading condition) first,
    # then the pinned voyage fields.
    for r in meta:
        if r[5] and r[0] not in _SKIP_COLUMNS:
            add(r[0], "Log Info")
    for c in _HEADER_COLUMNS:
        add(c, "Log Info")
    for r in meta:
        if r[3]:
            add(r[0], "Performance")
    for r in meta:
        if r[4]:
            add(r[0], "Emission")
    # A column tagged both Performance and Emission appears once (Performance);
    # re-list it under Emission as well so each section is complete.
    for r in meta:
        if r[3] and r[4]:
            columns.append({
                "db_column": r[0],
                "display_name": r[1],
                "unit": r[2] or "",
                "category": "Emission",
            })

    vessels = await _fetch_rows(db, table, date_col, used, days, end_date, allowed)
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
            backup = await _fetch_rows(db, b_table, b_date, b_cols, days, end_date, b_imos)
            for imo, b_rows in backup.items():
                m_rows = vessels.get(imo)
                if not m_rows or max(b_rows) > max(m_rows):
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
