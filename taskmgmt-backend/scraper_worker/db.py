# Standalone DB layer for scraper_worker — plain SQLAlchemy Core, no ORM, no dependency
# on taskmgmt-backend/app/. Two engines: one for our own domain DB (writes), one for the
# shared control DB (read-only, just for vessels.imo/name).
import logging
import re
from datetime import datetime, timezone
from decouple import config
from sqlalchemy import (
    create_engine, MetaData, Table, Column, select,
    Integer, BigInteger, Text, Date, DateTime, String, Boolean,
)
from sqlalchemy.dialects.postgresql import insert as pg_insert

logger = logging.getLogger(__name__)

# Formats actually seen across the 4 sources' parsers: DNV/ABS's condition/survey dates
# ("25-Mar-2029"), SmartPAL's already-ISO dates ("2026-08-20"), IRS's own DD/MM/YYYY dates
# (confirmed from its DATE_RE in sources/irs_extract.py — NOT the same format as ABS/DNV).
# Any string that doesn't cleanly match one of these (e.g. a wrapped-text parsing bug
# dropping the day, producing "Mar-2026") gets logged and stored as NULL instead of crashing
# the whole batch insert — confirmed live: a single malformed ABS condition date took down
# an entire --all run.
_DATE_FORMATS = ("%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y")


def _coerce_date(value):
    if value is None or not isinstance(value, str):
        return value
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    logger.warning("Could not parse date value %r — storing NULL instead of failing the batch", value)
    return None


def _sanitize_date_columns(table, rows):
    date_cols = [c.name for c in table.columns if isinstance(c.type, Date)]
    if not date_cols:
        return rows
    for row in rows:
        for col in date_cols:
            if col in row:
                row[col] = _coerce_date(row[col])
    return rows

TASKMGMT_DATABASE_URL = config("TASKMGMT_DATABASE_URL")
CONTROL_DATABASE_URL = config("CONTROL_DATABASE_URL")

taskmgmt_engine = create_engine(TASKMGMT_DATABASE_URL, pool_pre_ping=True)
control_engine = create_engine(CONTROL_DATABASE_URL, pool_pre_ping=True)

metadata = MetaData()

vessel_source_ids = Table(
    "vessel_source_ids", metadata,
    Column("id", Integer, primary_key=True),
    Column("imo_number", Text, nullable=False),
    Column("source", Text, nullable=False),
    Column("source_vessel_id", Text, nullable=False),
    Column("resolved_by", Text),
    Column("verified_at", DateTime(timezone=True)),
)

smartpal_certificates = Table(
    "smartpal_certificates", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column("vessel_id", Integer, nullable=False),
    Column("certificate_id", Integer),
    Column("certificate_name", Text),
    Column("type", Text),
    Column("sub_type", Text),
    Column("term_type", Text),
    Column("issued_date", Date),
    Column("due_date", Date),
    Column("validity_months", Integer),
    Column("attachment_files", Text),
    Column("synced_at", DateTime(timezone=True)),
)

smartpal_surveys = Table(
    "smartpal_surveys", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column("vessel_id", Integer, nullable=False),
    Column("survey_id", Integer),
    Column("survey_name", Text),
    Column("type", Text),
    Column("date_last_done", Date),
    Column("date_due", Date),
    Column("due_range_from", Date),
    Column("due_range_to", Date),
    Column("validity_months", Integer),
    Column("synced_at", DateTime(timezone=True)),
)

smartpal_items = Table(
    "smartpal_items", metadata,
    Column("id", BigInteger, primary_key=True, autoincrement=False),
    Column("vessel_id", Integer, nullable=False),
    Column("doc_type", Text, nullable=False),
    Column("item_status", Text),
    Column("item_classification", Text),
    Column("narrative", Text),
    Column("remarks", Text),
    Column("date_issued", Date),
    Column("date_due", Date),
    Column("extension_date", Date),
    Column("rectification_date", Date),
    Column("deletion_date", Date),
    Column("risk_assessment", Integer),
    Column("parent_type", Text),
    Column("parent_id", BigInteger),
    Column("synced_at", DateTime(timezone=True)),
)

class_certificates = Table(
    "class_certificates", metadata,
    Column("id", Integer, primary_key=True),
    Column("vessel_id", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("certificate_number", Text),
    Column("certificate_name", Text),
    Column("term_type", Text),
    Column("issued_date", Date),
    Column("place_of_issuance", Text),
    Column("issued_by", Text),
    Column("expiry_date", Date),
    Column("status", Text),
    Column("status_date", Date),
    Column("doc_type", Text),
    Column("category", Text),
    Column("raw_code", Text),
    Column("synced_at", DateTime(timezone=True)),
)

class_surveys = Table(
    "class_surveys", metadata,
    Column("id", Integer, primary_key=True),
    Column("vessel_id", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("survey_name", Text),
    Column("code", Text),
    Column("category", Text),
    Column("due_date", Date),
    Column("range_date_from", Date),
    Column("range_date_to", Date),
    Column("last_survey_date", Date),
    Column("last_attending_office", Text),
    Column("extended_force_majeure", Text),
    Column("status", Text),
    Column("synced_at", DateTime(timezone=True)),
)

class_conditions = Table(
    "class_conditions", metadata,
    Column("id", Integer, primary_key=True),
    Column("vessel_id", Integer, nullable=False),
    Column("source", Text, nullable=False),
    Column("condition_no", Text),
    Column("condition_category", Text),
    Column("category", Text),  # 'COC' | 'MEMORANDA' | 'DISPENSATION' | 'FINDINGS'
    Column("reference_number", Text),
    Column("description", Text),
    Column("status", Text),
    Column("raised_date", Date),
    Column("due_date", Date),
    Column("synced_at", DateTime(timezone=True)),
)


def _name_mapping_table(name):
    return Table(
        name, metadata,
        Column("id", Integer, primary_key=True),
        Column("smartpal_name", Text),
        Column("dnv_name", Text),
        Column("abs_name", Text),
        Column("irs_name", Text),
        Column("status", Text, nullable=False),
        Column("notes", Text),
        Column("updated_at", DateTime(timezone=True)),
    )


cert_name_mapping = _name_mapping_table("cert_name_mapping")
survey_name_mapping = _name_mapping_table("survey_name_mapping")

# Read-only mirror of workplace-backend's control Vessel table — only the columns we need.
control_metadata = MetaData()
vessels = Table(
    "vessels", control_metadata,
    Column("imo", String(7), primary_key=True),
    Column("name", Text),
    Column("is_active", Boolean),
)


def upsert_by_pk(engine, table, rows):
    """Upsert rows into a table whose PK is the source's own stable id
    (smartpal_certificates / smartpal_surveys / smartpal_items)."""
    if not rows:
        return 0
    rows = _sanitize_date_columns(table, rows)
    pk_cols = [c.name for c in table.primary_key.columns]
    update_cols = {c.name: c for c in table.columns if c.name not in pk_cols}
    stmt = pg_insert(table).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=pk_cols,
        set_={name: stmt.excluded[name] for name in update_cols},
    )
    with engine.begin() as conn:
        conn.execute(stmt)
    return len(rows)


def replace_for_vessel_source(engine, table, vessel_id, source, rows):
    """Full refresh for one (vessel_id, source) scope — used for class_certificates/
    class_surveys/class_conditions, which have no source-provided stable id to upsert on."""
    with engine.begin() as conn:
        conn.execute(
            table.delete().where(
                table.c.vessel_id == vessel_id, table.c.source == source
            )
        )
        if rows:
            conn.execute(table.insert(), _sanitize_date_columns(table, rows))
    return len(rows)


# Standing unmapped-name detection — NOT a one-time query. Certificate/survey naming is
# inconsistent across sources (confirmed: no reliable pattern to auto-match on — sometimes
# DNV's wording matches SmartPAL's, sometimes ABS's does, sometimes IRS uses a name none of
# the others do), so this only ever flags NEW names as NEEDS_REVIEW for a human to actually
# map — it never guesses a match itself.
_NAME_MAPPING_COLUMN_BY_SOURCE = {
    "SMARTPAL": "smartpal_name",
    "DNV": "dnv_name",
    "ABS": "abs_name",
    "IRS": "irs_name",
}

# (raw table, name column, source column or None if the table is already source-specific)
_RAW_NAME_SOURCE = {
    ("SMARTPAL", "certificates"): (smartpal_certificates, "certificate_name", None),
    ("SMARTPAL", "surveys"): (smartpal_surveys, "survey_name", None),
    ("DNV", "certificates"): (class_certificates, "certificate_name", "source"),
    ("DNV", "surveys"): (class_surveys, "survey_name", "source"),
    ("ABS", "certificates"): (class_certificates, "certificate_name", "source"),
    ("ABS", "surveys"): (class_surveys, "survey_name", "source"),
    ("IRS", "certificates"): (class_certificates, "certificate_name", "source"),
    ("IRS", "surveys"): (class_surveys, "survey_name", "source"),
}


# ABS titles per-equipment-instance certificates with the specific engine/crane/appliance's
# own serial number baked into the title itself (e.g. "Engine International Air Pollution
# Prevention Certificate-4888008-482", one per physical engine) — confirmed directly against
# the source PDF's word positions, not a parser bug: certificate_number is already extracted
# into its own column correctly. That per-instance suffix is real, correct data and must stay
# in class_certificates.certificate_name (removing it there would lose which physical
# equipment instance the row is about). But for *cross-source type matching* it's noise — DNV/
# IRS refer to the same certificate type generically, with no such suffix — so it's stripped
# only here, at mapping-candidate generation, collapsing e.g. 14 per-engine ABS rows down to
# one real type name to map against.
_ABS_CERT_INSTANCE_SUFFIX_RE = re.compile(r"-\d{6,8}-\d{2,4}$")


def _normalize_for_mapping(source, category, name):
    if source == "ABS" and category == "certificates":
        return _ABS_CERT_INSTANCE_SUFFIX_RE.sub("", name).strip()
    return name


def _distinct_raw_names(engine, source, category):
    table, name_col, source_col = _RAW_NAME_SOURCE[(source, category)]
    col = table.c[name_col]
    stmt = select(col).distinct().where(col.isnot(None))
    if source_col:
        stmt = stmt.where(table.c[source_col] == source)
    with engine.connect() as conn:
        rows = conn.execute(stmt).all()
    names = {r[0].strip() for r in rows if r[0] and r[0].strip()}
    return {_normalize_for_mapping(source, category, n) for n in names}


def detect_unmapped_names(engine, source):
    """Call after every extraction run, scoped to just the source that ran. For
    'certificates' and 'surveys' separately: pulls every distinct name currently in that
    source's raw data, and inserts a new NEEDS_REVIEW row (other source columns left null)
    into cert_name_mapping / survey_name_mapping for any name not already present in that
    mapping table's column for this source. Incremental — a name already in the mapping
    table (under ANY status) is never touched or re-flagged.

    Returns {"certificates": [new names], "surveys": [new names]} for the caller to log."""
    if source not in _NAME_MAPPING_COLUMN_BY_SOURCE:
        raise ValueError(f"Unknown source {source!r} for detect_unmapped_names")
    col_name = _NAME_MAPPING_COLUMN_BY_SOURCE[source]
    new_by_category = {}
    for category, mapping_table in (("certificates", cert_name_mapping), ("surveys", survey_name_mapping)):
        raw_names = _distinct_raw_names(engine, source, category)
        with engine.connect() as conn:
            existing = {
                r[0] for r in conn.execute(
                    select(mapping_table.c[col_name]).where(mapping_table.c[col_name].isnot(None))
                ).all()
            }
        new_names = sorted(raw_names - existing)
        if new_names:
            now = datetime.now(timezone.utc)
            with engine.begin() as conn:
                conn.execute(mapping_table.insert(), [
                    {col_name: name, "status": "NEEDS_REVIEW", "updated_at": now}
                    for name in new_names
                ])
        new_by_category[category] = new_names
    return new_by_category


def report_unmapped_names(engine, source, logger):
    """detect_unmapped_names() + a standard log summary — call this once at the end of each
    extraction script's main(), scoped to the source that just ran."""
    new_names = detect_unmapped_names(engine, source)
    total_new = sum(len(v) for v in new_names.values())
    if not total_new:
        logger.info("Name mapping: no new unmapped %s certificate/survey names this run", source)
        return new_names
    logger.warning("Name mapping: %d new unmapped %s name(s) this run — added to the mapping "
                    "table(s) as NEEDS_REVIEW:", total_new, source)
    for category, names in new_names.items():
        for name in names:
            logger.warning("  [%s] %s", category, name)
    return new_names
