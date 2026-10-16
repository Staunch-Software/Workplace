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
        allowed = list(assigned)
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

    select_cols = ", ".join(_quote(c) for c in sorted(used))
    dcol = _quote(date_col)
    sql = (
        f"WITH ranked AS ("
        f"  SELECT vessel_imo, {dcol} AS d, "
        f"         DENSE_RANK() OVER (PARTITION BY vessel_imo ORDER BY {dcol} DESC) AS rk "
        f"  FROM {table} WHERE {dcol} IS NOT NULL"
        f"  {'AND vessel_imo = ANY(:imos)' if allowed is not None else ''}"
        f"  {'AND ' + dcol + '::date <= :end_date' if end_date else ''}"
        f") "
        f"SELECT t.vessel_imo, t.{dcol} AS d, {', '.join('t.' + _quote(c) for c in sorted(used))} "
        f"FROM {table} t JOIN ranked r "
        f"  ON r.vessel_imo = t.vessel_imo AND r.d = t.{dcol} "
        f"WHERE r.rk <= :days "
        f"ORDER BY t.vessel_imo, t.{dcol} DESC, t.ctid DESC"
    ) if select_cols else None

    vessels: dict = {}
    if sql:
        params = {"days": days}
        if allowed is not None:
            params["imos"] = allowed
        if end_date:
            params["end_date"] = end_date
        result = await db.execute(text(sql), params)
        keys = list(result.keys())
        seen = set()
        for row in result.fetchall():
            m = dict(zip(keys, row))
            imo, d = m["vessel_imo"], str(m["d"])[:10]
            if (imo, d) in seen:  # keep one log per day (the latest)
                continue
            seen.add((imo, d))
            vessels.setdefault(imo, {})[d] = {
                c: (None if m[c] is None else str(m[c])) for c in used
            }

    # Newest date in the data (ignores end_date) so the UI knows where "Latest" is.
    lat_params = {"imos": allowed} if allowed is not None else {}
    latest = (await db.execute(
        text(
            f"SELECT MAX({dcol}::date) FROM {table}"
            + (" WHERE vessel_imo = ANY(:imos)" if allowed is not None else "")
        ),
        lat_params,
    )).scalar()

    return {
        "source": source,
        "latest_date": latest.isoformat() if latest else None,
        "columns": columns,
        "vessels": [{"imo": imo, "rows": rows} for imo, rows in vessels.items()],
    }
