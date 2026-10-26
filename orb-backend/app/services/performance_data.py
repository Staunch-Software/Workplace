"""Read-only access to the vessel performance pipeline's database: Mariapps noon reports and bunker reports.

ORB never writes there. The connection is optional (PERFORMANCE_DATABASE_URL): every loader returns None when
the source is not configured or cannot be reached, and the alerts that depend on it then stay silent (or fall
back to the older source) instead of raising false alerts. Vessels are matched by IMO, by name when ORB has no IMO.

Used by:
  - alert 37 / 2  : consumed fuel per grade (pipeline's expanded Mariapps table, emissionx_total_* columns)
  - alert 33      : the vessel's status (at sea / in port / at anchor) and position over time
  - alert 35      : bunker delivery notes

Tables read (a SELECT-only role needs exactly these): expanded_mariapps_data (fuel), vessels (name lookup when a
vessel has no IMO), raw_mariapps_logs (position, UTC time, anchorage/drifting hours - the expanded table does not
carry them yet), mariapps_bunker_reports.
"""
import re
import asyncio
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine

from app.config import get_settings
from app.services.geo_areas import special_area

logger = logging.getLogger(__name__)

_engine: AsyncEngine | None = None
_engine_loop = None


def configured() -> bool:
    return bool((get_settings().PERFORMANCE_DATABASE_URL or "").strip())


def _get_engine() -> AsyncEngine | None:
    """One small read-only engine per process. The session itself is read-only and statements time out."""
    global _engine, _engine_loop
    loop = asyncio.get_running_loop()
    if _engine is not None and _engine_loop is not loop:
        _engine = None           # pooled connections belong to the loop that opened them (scripts call asyncio.run repeatedly)
    if _engine is None:
        url = (get_settings().PERFORMANCE_DATABASE_URL or "").strip()
        if not url:
            return None
        _engine_loop = loop
        url = re.sub(r"^postgres(ql)?://", "postgresql+asyncpg://", url)
        _engine = create_async_engine(
            url, pool_size=2, max_overflow=1, pool_pre_ping=True,
            connect_args={"server_settings": {"default_transaction_read_only": "on", "statement_timeout": "20000"}},
        )
    return _engine


# ─────────────────────────────────────────────────────────────────────────
# Parsing (pure functions)
# ─────────────────────────────────────────────────────────────────────────
def num(v) -> float | None:
    """'' / ' ' -> None, '1,355.61' -> 1355.61."""
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_dt(s) -> datetime | None:
    s = (str(s) if s is not None else "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%d-%b-%Y %H:%M"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def tz_minutes(s) -> int:
    m = re.match(r"^\s*([+-])(\d{1,2}):?(\d{2})\s*$", str(s or ""))
    if not m:
        return 0
    return (1 if m.group(1) == "+" else -1) * (int(m.group(2)) * 60 + int(m.group(3)))


def _coord(deg, minutes, direction, pos: str, neg: str) -> float | None:
    d, m = num(deg), num(minutes)
    if d is None:
        return None
    value = d + (m or 0) / 60.0
    direction = (direction or "").strip().lower()
    if direction.startswith(neg):
        return -value
    if direction.startswith(pos):
        return value
    return None          # direction unknown: do not guess the hemisphere


_GRADE = {"HEAVY FUEL OIL": "HFO", "MARINE DIESEL OIL": "MDO", "LIGHT FUEL OIL": "LFO", "MARINE GAS OIL": "MGO"}
_FUEL_ROB = re.compile(r"^Fuel ROB::(.+)::Consumed \(MT\)$")
_CONSUMER_COL = re.compile(r"Consumption \(MT\) - (?:ME|AE|BL|INC|EG|ComBL) (HFO|LFO|MDO|LNG|MGO)$")


@dataclass
class LogRecord:
    log_number: str
    log_type: str
    local_date: date
    utc: datetime | None
    tz_min: int = 0
    duration_h: float | None = None
    lat: float | None = None
    lon: float | None = None
    speed_kn: float | None = None
    anchorage_h: float | None = None
    drifting_h: float | None = None
    fuel_mt: dict = field(default_factory=dict)      # grade -> MT consumed in this report


def parse_log(log_number, log_type, log_date, xd, pd, hd, cd) -> LogRecord | None:
    """One raw_mariapps_logs row. xd/pd/hd/cd are the Excel_Data / Position_Data / Header_Data / Consumption_Data
    parts of its JSON. Returns None when the row has no usable date."""
    xd, pd, hd, cd = xd or {}, pd or {}, hd or {}, cd or {}

    local = parse_dt(xd.get("Log Date")) or parse_dt(str(log_date or "") + " 00:00:00")
    if local is None:
        return None
    utc = parse_dt(xd.get("Log Date (UTC)")) or parse_dt(hd.get("Date (UTC)"))
    tz = tz_minutes(xd.get("Time Zone") or hd.get("Time Zone"))
    if utc is None:
        utc = local - timedelta(minutes=tz)

    # position: the Position_Data block spells the hemisphere out; Excel_Data's longitude direction is unusable
    lat = _coord(pd.get("Latitude Degree"), pd.get("Latitude Minutes"), pd.get("Lattitude Direction") or pd.get("Latitude Direction"), "n", "s")
    lon = _coord(pd.get("Longitude Degree"), pd.get("Longitude Minutes"), pd.get("Longitude Direction"), "e", "w")
    if lat is None:
        lat = _coord(xd.get("Latitude - Lat Degree"), xd.get("Latitude - Lat Minutes"), xd.get("Latitude - Lat Direction"), "n", "s")

    # fuel: the per-grade Fuel ROB block; else the engine/boiler columns (never the cargo breakdown, which repeats them)
    fuel: dict = {}
    for key, val in cd.items():
        m = _FUEL_ROB.match(key)
        if m:
            mt = num(val)
            if mt is not None:
                name = m.group(1).strip().upper()
                grade = _GRADE.get(name, name)
                fuel[grade] = fuel.get(grade, 0.0) + mt
    if not fuel:
        for key, val in xd.items():
            m = _CONSUMER_COL.search(key)
            if m and "Breakdown" not in key:
                mt = num(val)
                if mt is not None:
                    fuel[m.group(1)] = fuel.get(m.group(1), 0.0) + mt

    return LogRecord(
        log_number=str(log_number or ""), log_type=str(log_type or "").strip(), local_date=local.date(), utc=utc, tz_min=tz,
        duration_h=num(xd.get("Log Duration(h)")), lat=lat, lon=lon,
        speed_kn=num(xd.get("Speed OG(knots)")),
        anchorage_h=num(pd.get("Anchorage Hours") or xd.get("Anchorage Hours(h)")),
        drifting_h=num(pd.get("Drifting hours") or xd.get("Drifting Hours(h)") or hd.get("Drifting Time")),
        fuel_mt=fuel,
    )


# ─────────────────────────────────────────────────────────────────────────
# Fuel coverage (alert 37)
# ─────────────────────────────────────────────────────────────────────────
@dataclass
class FuelSummary:
    total_mt: float
    by_grade: dict
    days_total: int
    days_covered: int
    missing_days: list

    @property
    def coverage_pct(self) -> float:
        return 100.0 * self.days_covered / self.days_total if self.days_total else 0.0


def summarise_fuel(logs: list[LogRecord], start: date, end: date) -> FuelSummary:
    by_grade: dict = {}
    covered: set = set()
    for r in logs:
        if not (start <= r.local_date <= end) or not r.fuel_mt:
            continue
        covered.add(r.local_date)
        for g, mt in r.fuel_mt.items():
            by_grade[g] = by_grade.get(g, 0.0) + mt
    total_days = (end - start).days + 1
    missing = [start + timedelta(days=i) for i in range(total_days) if (start + timedelta(days=i)) not in covered]
    return FuelSummary(sum(by_grade.values()), by_grade, total_days, len(covered), missing)


# ─────────────────────────────────────────────────────────────────────────
# Vessel status over time (alert 33)
# ─────────────────────────────────────────────────────────────────────────
@dataclass
class Status:
    state: str                     # at sea | in port | at anchor | drifting | leaving port | approaching port | unknown
    lat: float | None = None
    lon: float | None = None
    basis: str = ""

    @property
    def not_en_route(self) -> bool:
        """In port or at anchor: an automatic discharge is not allowed there (alert 33, major)."""
        return self.state in ("in port", "at anchor", "leaving port", "approaching port")


def _type_state(log_type: str) -> str:
    t = log_type.strip().lower()
    if "anchor" in t:
        return "at anchor"
    if "arrival" in t or "at port" in t or "in port" in t:
        return "in port"
    if "departure" in t:
        return "leaving port"
    if t == "eosp":
        return "approaching port"
    if t == "bosp" or "at sea" in t or t == "noon":
        return "at sea"
    return "unknown"


def status_at(events: list[LogRecord], t_utc: datetime, max_gap_h: float = 48.0) -> Status:
    """Where the vessel was at t_utc, from the reports either side of it. Between two reports the earlier one
    decides: BOSP / noon at sea = at sea until EOSP; EOSP = approaching port until Arrival (all fast);
    Arrival / noon at port = in port until Departure (last line away); Departure = leaving port until BOSP.
    Anchorage hours stated on the next report put the vessel at anchor for that stretch. Anything not covered by
    reports within max_gap_h is unknown - never guessed."""
    evs = sorted((e for e in events if e.utc), key=lambda e: e.utc)
    prev = next((e for e in reversed(evs) if e.utc <= t_utc), None)
    nxt = next((e for e in evs if e.utc > t_utc), None)
    if prev is None:
        return Status("unknown", basis="no earlier report")
    if nxt is None and (t_utc - prev.utc).total_seconds() / 3600 > max_gap_h:
        return Status("unknown", basis="no report after the entry")
    if nxt is not None and (nxt.utc - prev.utc).total_seconds() / 3600 > max_gap_h * 2:
        return Status("unknown", basis="reports too far apart")

    state = _type_state(prev.log_type)
    basis = f"{prev.log_type} {prev.utc:%d-%b %H:%M} UTC"
    if nxt is not None:
        if nxt.anchorage_h and nxt.anchorage_h > 0 and t_utc >= nxt.utc - timedelta(hours=nxt.anchorage_h):
            state, basis = "at anchor", f"{nxt.log_type} {nxt.utc:%d-%b %H:%M} UTC states {nxt.anchorage_h:g} h at anchor"
        elif nxt.drifting_h and nxt.drifting_h > 0 and t_utc >= nxt.utc - timedelta(hours=nxt.drifting_h):
            state, basis = "drifting", f"{nxt.log_type} {nxt.utc:%d-%b %H:%M} UTC states {nxt.drifting_h:g} h drifting"

    # position: between the two reports when both have one, else the nearer one
    lat = lon = None
    a, b = prev, nxt
    if a and b and a.lat is not None and b.lat is not None and a.lon is not None and b.lon is not None:
        span = (b.utc - a.utc).total_seconds()
        f = (t_utc - a.utc).total_seconds() / span if span > 0 else 0.0
        lat, lon = a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f
    else:
        near = min((x for x in (a, b) if x and x.lat is not None), key=lambda x: abs((x.utc - t_utc).total_seconds()), default=None)
        if near:
            lat, lon = near.lat, near.lon
    return Status(state, lat, lon, basis)


def area_of(status: Status) -> str | None:
    if status.lat is None or status.lon is None:
        return None
    return special_area(status.lat, status.lon)


# ─────────────────────────────────────────────────────────────────────────
# Bunker delivery notes (alert 35)
# ─────────────────────────────────────────────────────────────────────────
@dataclass
class BunkerRecord:
    transaction_type: str
    port: str
    fuel_type: str
    imo_fuel_grade: str
    bdn_reference_no: str
    quantity_mt: float | None
    sulphur_content: float | None
    begin: datetime | None
    end: datetime | None
    has_attachment: bool


# ─────────────────────────────────────────────────────────────────────────
# Loaders (database)
# ─────────────────────────────────────────────────────────────────────────
def _identity_clause(imo: str | None, name: str | None):
    if imo and imo.strip():
        return "vessel_imo = :ident", {"ident": imo.strip()}
    if name:
        return "upper(vessel_name) = upper(:ident)", {"ident": name.strip()}
    return None, {}


async def load_logs(imo: str | None, name: str | None, start: date, end: date) -> list[LogRecord] | None:
    """Reports of the vessel between two local dates. None = source not configured / not reachable."""
    eng = _get_engine()
    clause, params = _identity_clause(imo, name)
    if eng is None or clause is None:
        return None
    sql = text(f"""
        SELECT id, log_number, log_type, log_date,
               raw_json->'Excel_Data' AS xd, raw_json->'Position_Data' AS pd,
               raw_json->'Header_Data' AS hd, raw_json->'Consumption_Data' AS cd
        FROM raw_mariapps_logs
        WHERE {clause} AND COALESCE(is_duplicate, false) = false
          AND log_date >= :s AND log_date <= :e
        ORDER BY id
    """)
    try:
        async with eng.connect() as conn:
            rows = (await conn.execute(sql, {**params, "s": start.isoformat(), "e": end.isoformat()})).all()
    except Exception:
        logger.exception("Performance database unavailable (logs)")
        return None
    latest: dict = {}
    for r in rows:
        rec = parse_log(r.log_number, r.log_type, r.log_date, r.xd, r.pd, r.hd, r.cd)
        if rec is not None:
            latest[(rec.log_number, rec.log_type)] = rec         # a re-scraped report replaces the earlier copy
    return list(latest.values())


_EXPANDED_FUEL = (("HFO", "emissionx_total_hfo_mt"), ("LFO", "emissionx_total_lfo_mt"),
                  ("MDO", "emissionx_total_mdo_mt"), ("BIO", "emissionx_total_biofuel_mt"))


async def fuel_for_period(imo: str | None, name: str | None, start: date, end: date) -> FuelSummary | None:
    """Consumed fuel per grade from the pipeline's expanded Mariapps table (the same totals the DCS pages use).
    A day counts as covered when at least one report of that day has a fuel figure. None = source not
    configured / not reachable (the caller then falls back to the older fuel table)."""
    eng = _get_engine()
    if eng is None or not ((imo or "").strip() or name):
        return None
    cols = ", ".join(f'e."{c}" AS {g.lower()}' for g, c in _EXPANDED_FUEL)
    if (imo or "").strip():
        who, params = "e.vessel_imo = :ident", {"ident": imo.strip()}
    else:
        who, params = "e.vessel_imo IN (SELECT imo_number FROM vessels WHERE upper(vessel_name) = upper(:ident))", {"ident": name.strip()}
    sql = text(f"""
        SELECT e.log_date, e.log_number, {cols}
        FROM expanded_mariapps_data e
        WHERE {who} AND e.log_date >= :s AND e.log_date <= :e
    """)
    try:
        async with eng.connect() as conn:
            rows = (await conn.execute(sql, {**params, "s": start, "e": end})).all()
    except Exception:
        logger.exception("Performance database unavailable (expanded fuel)")
        return None
    seen: set = set()
    logs: list[LogRecord] = []
    for r in rows:
        if r.log_number and r.log_number in seen:
            continue                                     # the same report expanded twice
        seen.add(r.log_number)
        fuel = {}
        for g, _c in _EXPANDED_FUEL:
            mt = num(getattr(r, g.lower()))
            if mt is not None:
                fuel[g] = mt
        logs.append(LogRecord(log_number=str(r.log_number or ""), log_type="", local_date=r.log_date, utc=None, fuel_mt=fuel))
    return summarise_fuel(logs, start, end)


async def load_bunkers(imo: str | None, name: str | None) -> list[BunkerRecord] | None:
    """Every bunker report of the vessel (a few dozen rows). None = source not configured / not reachable."""
    eng = _get_engine()
    clause, params = _identity_clause(imo, name)
    if eng is None or clause is None:
        return None
    sql = text(f"""
        SELECT transaction_type, port, fuel_type, imo_fuel_grade, bdn_reference_no, quantity_mt, sulphur_content,
               begin_of_bunkering, end_of_bunkering, attachments, blob_url
        FROM mariapps_bunker_reports WHERE {clause}
    """)
    try:
        async with eng.connect() as conn:
            rows = (await conn.execute(sql, params)).all()
    except Exception:
        logger.exception("Performance database unavailable (bunker reports)")
        return None
    return [
        BunkerRecord(
            transaction_type=r.transaction_type or "", port=r.port or "", fuel_type=r.fuel_type or "",
            imo_fuel_grade=(r.imo_fuel_grade or "").upper(), bdn_reference_no=r.bdn_reference_no or "",
            quantity_mt=r.quantity_mt, sulphur_content=r.sulphur_content,
            begin=parse_dt(r.begin_of_bunkering), end=parse_dt(r.end_of_bunkering),
            has_attachment=bool(r.attachments) or bool(r.blob_url),
        ) for r in rows
    ]
