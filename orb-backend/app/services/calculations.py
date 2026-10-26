"""
Compliance calculation checks — runs after every extraction.

Which alerts are on, their severity and every threshold come from the configuration tables
(services/alert_config.py, reviewed alert set in services/alert_catalog.py); a withdrawn alert is disabled,
never deleted.

Checks 15-23 (alerts 23, 25, 29-36) came with the compliance review (20 and 21 read Mariapps data):
  15 weekly_c11_missing   16 missing_officer_signature   17 late_entry
  18 code_ab_present / accidental_discharge_notify   19 orb_language
  20 auto_discharge_location   21 bunker_bdn_mismatch   22 tank_not_in_iopp
  23 ows_alarm_record_mismatch (imported 15 ppm monitor data)
The 14 earlier checks:
  1  wrong_item_code
  2  mass_balance_error
  3  tank_capacity_exceeded
  4  combined_capacity_threshold
  5  sludge_generation_rate            (sludge-tank drop pattern)
  6  bilge_increasing_rate
  7  sludge_vs_fuel_consumption        (Actual Generation vs Scraped Fuel)
  8  bilge_transfer_vs_soundings
  9  bilge_pump_capacity               (Pump output vs duration)
  10 bunker_mismatch / bunker_quantity_mismatch
  11 missing_master_signature          (Aggregated: One alert per upload)
  12 non_chronological_entry / erasure_detected
  13 gap_between_entries               (blank full line before an entry)
"""
import uuid
import re
import logging
from datetime import timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func

from app.models.orb_entry import OrbEntry
from app.models.orb_entry_quantity import OrbEntryQuantity
from app.models.orb_alert import OrbAlert
from app.models.vessel_tank import VesselTank
from app.models.fuel_consumption import FuelConsumption
from app.models.vessel import Vessel
from app.models.orb_config import Equipment
from app.services import alert_config
from app.services.alert_config import current as cfg_now

logger = logging.getLogger(__name__)

# Tank groups excluded from the standard mass-balance check
EXCLUDED_MASS_BALANCE_GROUPS = {"BILGE", "SLUDGE"}

BUNKER_ORB_CODE = "H"
BUNKER_ITEM = "26.3"
BUNKER_ITEMS = ["26.3", "26.4"]

# Valid item numbers per ORB code, per IMO MEPC.1/Circ.736/Rev.1. Code I
# carries no item number at all, so it's checked separately (any item number
# on a Code I row is itself the violation).
_VALID_ITEMS_BY_CODE = {
    "C": {"11.1", "11.2", "11.3", "11.4", "12.1", "12.2", "12.3", "12.4"},
    "D": {"13", "14", "15.1", "15.2", "15.3"},
    "E": {"16", "17", "18"},
    "F": {"19", "20", "21"},
    "G": {"22", "23", "24", "25"},
    "H": {"26.1", "26.2", "26.3", "26.4"},
}

# Qualifier words that handwritten/extracted tank names inconsistently
# include, omit, or misspell relative to the registered vessel_tanks.tank_name
# ("Bilge Tank" vs "Bilge Holding Tank", "Bilge Sep/Seperated Oil Tank" vs
# "Bilge Separated Oil Tank", "Waste Oil Tank No.1" vs "Waste Oil Settling
# Tank No.1"). Stripped before comparing so the tank's core identity
# (BILGE/SLUDGE/WASTE OIL + any No.1/No.2 ordinal) still matches -- these
# words are never load-bearing for telling two DIFFERENT registered tanks
# apart, only ordinals and the OIL/type tokens are, and those are untouched.
_TANK_NAME_STOPWORDS = {"TANK", "HOLDING", "SETTLING", "SEPARATED", "SEPARATION", "SEPERATED", "SEP"}

def _norm_tank(name: str | None, protect: frozenset[str] = frozenset()) -> str:
    """Normalise a tank name for comparison.

    `protect` excludes specific words from being stripped -- see
    _compute_protected_tank_words for why this is needed per-vessel.
    """
    if not name:
        return "unknown"
    cleaned = re.sub(r"[#.\-]", " ", name)
    cleaned = re.sub(r"\s+", " ", cleaned.upper().strip())
    tokens = [t for t in cleaned.split(" ") if t not in _TANK_NAME_STOPWORDS or t in protect]
    return " ".join(tokens) or cleaned


def _compute_protected_tank_words(tanks: list[VesselTank]) -> frozenset[str]:
    """Words that must NOT be stripped by _norm_tank for THIS vessel.

    The stopword list exists to unify formatting variants of the SAME
    physical tank ("Bilge Tank" == "Bilge Holding Tank"). But on a vessel
    that has TWO genuinely distinct registered tanks whose names differ only
    by one of those stopwords -- confirmed in production: "Bilge Water Tank"
    (28.1 m3) and "Bilge Water Settling Tank" (19.44 m3) both strip down to
    "BILGE WATER" -- the same stripping silently conflates them, comparing
    one tank's real readings against the other's certified capacity.

    Detects any such collision among this vessel's OWN registered tanks and
    protects exactly the word(s) that distinguish the colliding pair, so
    normalisation stays aggressive everywhere it's safe and only backs off
    where it would otherwise merge two real, different tanks.
    """
    from collections import defaultdict

    def _tokens(name: str) -> set[str]:
        cleaned = re.sub(r"[#.\-]", " ", name or "")
        cleaned = re.sub(r"\s+", " ", cleaned.upper().strip())
        return set(cleaned.split(" "))

    by_key: dict[str, list[VesselTank]] = defaultdict(list)
    for t in tanks:
        by_key[_norm_tank(t.tank_name)].append(t)

    protected: set[str] = set()
    for group in by_key.values():
        distinct_names = {t.tank_name.strip().upper() for t in group}
        if len(distinct_names) < 2:
            continue
        token_sets = [_tokens(t.tank_name) for t in group]
        for i in range(len(token_sets)):
            for j in range(i + 1, len(token_sets)):
                protected |= (token_sets[i] ^ token_sets[j]) & _TANK_NAME_STOPWORDS
    return frozenset(protected)

def _get_effective_group(tank: VesselTank) -> str:
    """Returns the tank's functional group: SLUDGE, BILGE, or OTHER.

    Prefers the registered tank_group over guessing from the tank name, but
    matches it by keyword rather than exact equality -- real vessel setups
    use free text here ("SLUDGE OIL", "BILGE WATER", "L.O. & Cyl. Oil"),
    never necessarily the bare word "SLUDGE"/"BILGE" that callers compare
    against. An exact-match comparison silently treats every such tank as
    "OTHER": sludge/bilge-specific checks (5, 6, 9) then find no tanks to
    run on at all, and mass_balance_error (which is supposed to exempt
    bilge/sludge tanks) runs on them anyway since they never match
    EXCLUDED_MASS_BALANCE_GROUPS either. Only fall back to the tank's own
    name when tank_group is unset entirely.
    """
    source = tank.tank_group.strip().upper() if tank.tank_group and tank.tank_group.strip() else tank.tank_name.upper()
    if "SLUDGE" in source or "WASTE OIL" in source or "OIL RESIDUE" in source:
        return "SLUDGE"
    if "BILGE" in source:
        return "BILGE"
    return "OTHER"

def _parse_time(t: str | None):
    """Parses time strings like '14:30' into minutes since midnight."""
    if not t:
        return None
    t = t.strip().upper().replace(".", ":")
    m = re.match(r"^(\d{1,2}):?(\d{2})\s*(AM|PM)?$", t)
    if not m:
        return None
    hh, mm, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
    if ampm == "PM" and hh != 12:
        hh += 12
    if ampm == "AM" and hh == 12:
        hh = 0
    if hh > 23 or mm > 59:
        return None
    return hh * 60 + mm 

async def create_alert_if_new(
    db: AsyncSession,
    vessel_id: uuid.UUID,
    entry_id,
    alert_type: str,
    severity: str,
    message: str,
    upload_id: uuid.UUID | None = None,
    keep_severity: bool = False,
):
    """Creates a compliance alert unless it is switched off, or an identical one already exists.

    - A disabled (withdrawn) alert type is never raised.
    - The severity comes from the alert configuration, except where the check decides it itself
      (keep_severity: one alert with two levels, e.g. sludge vs fuel burn).
    - An entry alert is unique per entry and type, and stays unique after it is resolved.
    - A batch alert (no entry) is unique per upload and type, so the next upload can raise it again.
    - A vessel-level alert is raised again once the previous one is resolved.
    """
    cfg = cfg_now()
    if not cfg.is_enabled(alert_type):
        return
    if not keep_severity:
        severity = cfg.severity(alert_type, severity)

    q = select(OrbAlert.id).where(OrbAlert.alert_type == alert_type, OrbAlert.vessel_id == vessel_id)
    if entry_id:
        q = q.where(OrbAlert.entry_id == entry_id)
    else:
        q = q.where(OrbAlert.entry_id.is_(None))
        if cfg.scope(alert_type) == "Batch (vessel)":
            q = q.where(OrbAlert.is_resolved.is_(False))
        elif upload_id:
            q = q.where(OrbAlert.upload_id == upload_id)

    if (await db.execute(q.limit(1))).first():
        return

    alert = OrbAlert(
        id=uuid.uuid4(),
        vessel_id=vessel_id,
        entry_id=entry_id,
        upload_id=None if entry_id else upload_id,
        alert_type=alert_type,
        severity=severity,
        message=message,
        is_resolved=False
    )
    db.add(alert)
    await db.flush()

# Every check with the alert codes it can raise: a check whose alerts are all disabled is not run.
def _checks():
    return [
        (check_wrong_item_code,              ["wrong_item_code"]),
        (check_mass_balance_error,           ["mass_balance_error"]),
        (check_tank_capacity_exceeded,       ["tank_capacity_exceeded", "reading_needs_review", "capacity_reading_mismatch"]),
        (check_combined_capacity_threshold,  ["combined_capacity_threshold"]),
        (check_sludge_generation_rate,       ["sludge_generation_rate"]),
        (check_bilge_increasing_rate,        ["bilge_increasing_rate"]),
        (check_sludge_vs_fuel_consumption,   ["sludge_vs_fuel_consumption", "sludge_review_fuel_missing"]),
        (check_bilge_transfer_vs_soundings,  ["bilge_transfer_vs_soundings"]),
        (check_bilge_pump_capacity,          ["bilge_pump_capacity"]),
        (check_bunker_mismatch,              ["bunker_mismatch", "bunker_quantity_mismatch"]),
        (check_missing_master_signature,     ["missing_master_signature"]),
        (check_chronology_and_erasures,      ["non_chronological_entry", "erasure_detected"]),
        (check_entry_gaps,                   ["gap_between_entries"]),
        (check_item_numbers,                 ["item_value_missing", "item_number_missing"]),
        (check_weekly_c11,                   ["weekly_c11_missing"]),
        (check_officer_signatures,           ["missing_officer_signature"]),
        (check_late_entries,                 ["late_entry"]),
        (check_code_flags,                   ["code_ab_present", "accidental_discharge_notify"]),
        (check_book_language,                ["orb_language"]),
        (check_auto_discharge_location,      ["auto_discharge_location"]),
        (check_bunker_bdn_mismatch,          ["bunker_bdn_mismatch"]),
        (check_tank_not_in_iopp,             ["tank_not_in_iopp"]),
        (check_ows_alarm_record,             ["ows_alarm_record_mismatch"]),
    ]


async def run_all_checks(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Run every enabled compliance check, scoped closely to avoid duplication loops."""
    try:
        cfg = await alert_config.load_run_config(db, vessel_id)
    except Exception:
        # Configuration tables not there yet (migration 017 pending): run with the built-in defaults.
        logger.exception("Alert configuration unavailable, using defaults")
        await db.rollback()
        cfg = alert_config.RunConfig()

    token = alert_config.set_current(cfg)
    try:
        for check, codes in _checks():
            if not any(cfg.is_enabled(c) for c in codes):
                continue
            await check(vessel_id, upload_id, db)
        await db.commit()
    finally:
        alert_config.reset_current(token)

# ─────────────────────────────────────────────────────────────────────────
# Check 1 — Wrong Item Code
# ─────────────────────────────────────────────────────────────────────────
async def check_wrong_item_code(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id)
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)

    result = await db.execute(q)
    for entry in result.scalars().all():
        item = (entry.item_number or "").strip()
        code = entry.orb_code
        if code in ("A", "B"):
            continue  # alert 32 (Code A / B found) covers these, their items are not validated
        if code == "I":
            is_wrong = bool(item)  # Code I entries must carry no item number
        else:
            valid_items = _VALID_ITEMS_BY_CODE.get(code)
            is_wrong = valid_items is None or item not in valid_items
        if is_wrong:
            msg = f"[{entry.entry_date}] Invalid Item/Code combination ({code or '?'} {item or '-'})."
            await create_alert_if_new(db, vessel_id, entry.id, "wrong_item_code", "major", msg)


# ─────────────────────────────────────────────────────────────────────────
# Check 14 — Item numbers written for every line of a block
# ─────────────────────────────────────────────────────────────────────────
async def check_item_numbers(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Each row of a block (e.g. 11.1 tank / 11.2 capacity / 11.3 retained) must
    carry its own item number. Judged only on entries whose line transcription is
    known (item_lines is not NULL), so older uploads never raise false alerts."""
    from app.services.item_rules import item_line_problems

    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.item_lines.isnot(None))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    for entry in (await db.execute(q)).scalars().all():
        qty_rows = (await db.execute(
            select(OrbEntryQuantity.qty_type).where(OrbEntryQuantity.entry_id == entry.id)
        )).scalars().all()
        problems = item_line_problems(entry.orb_code, entry.item_number, entry.item_lines, qty_rows)
        where = f" ({entry.tank_location})" if entry.tank_location else ""
        for p in problems:
            parts = ", ".join(f"{i} ({l})" for i, l in zip(p["items"], p["labels"]))
            if p["kind"] == "value_missing":
                msg = f"[{entry.entry_date}] Code {entry.orb_code}{where}: nothing recorded for item {parts}."
                await create_alert_if_new(db, vessel_id, entry.id, "item_value_missing", "major", msg)
            else:
                msg = (f"[{entry.entry_date}] Code {entry.orb_code}{where}: item number {parts} "
                       f"not written in the Item column.")
                await create_alert_if_new(db, vessel_id, entry.id, "item_number_missing", "minor", msg)

# ─────────────────────────────────────────────────────────────────────────
# Shared helper — real-world handwritten tank names rarely match the
# registered vessel_tanks.tank_name character-for-character ("BILGE TANK" vs
# "Bilge Holding Tank", "WASTE OIL SETTLING TANK NO#1" vs "...No.1", etc).
# Fetch broadly and match tank-by-tank in Python using _norm_tank() instead
# of relying on exact SQL equality, which silently drops most real entries.
# ─────────────────────────────────────────────────────────────────────────
async def _fetch_vessel_qty_rows(db: AsyncSession, vessel_id: uuid.UUID, upload_id: uuid.UUID | None, extra_filters=None):
    q = select(OrbEntry, OrbEntryQuantity).join(OrbEntryQuantity).where(OrbEntry.vessel_id == vessel_id)
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    if extra_filters:
        q = q.where(and_(*extra_filters))
    rows = (await db.execute(q)).all()
    # Sort in Python (stable) rather than via SQL ORDER BY: Postgres does not
    # guarantee tie order for rows sharing an entry_date, and a single
    # physical ORB line commonly produces a "transferred" row immediately
    # followed by the "retained" figure it results in (e.g. "3.0 m3
    # transferred to X, 12.5 m3 retained"). An unstable sort can silently
    # swap that pair, so the balance walk below applies the transfer AGAIN
    # on top of a retained figure that already reflects it -- double
    # counting it and flagging the next real reading as a mass-balance
    # error that never happened. A stable Python sort keyed only on
    # entry_date preserves the query's natural row order for every tie,
    # which keeps a single entry's own quantity rows in their true
    # written sequence.
    rows.sort(key=lambda r: r[0].entry_date)
    return rows

def _order_within_entry(matched: list, tn: str, protect: frozenset[str]) -> list:
    """Reorder same-entry quantity rows so a "retained" reading that is the
    OPENING balance of a same-entry "transferred" quantity is applied to the
    running balance walk BEFORE that transfer, and a "retained" reading that
    is the CLOSING balance is applied AFTER it.

    Every balance-walk check (mass_balance_error, bilge_transfer_vs_soundings,
    sludge_generation_rate) processes rows in whatever order the DB query
    happens to return them for ties on the same entry_date -- which is not
    guaranteed to match the physical opening-then-transfer-then-closing order
    a single ORB block states. Confirmed in production (AM KIRTI,
    10-Mar-2026): a bilge entry stated "7.2 m3 retained [before pumping] ...
    21.5 m3 transferred ... 28.7 m3 retained [after pumping]" -- a perfectly
    consistent operation (7.2 + 21.5 = 28.7) -- but the opening 7.2 reading
    got compared against the running balance AFTER the 21.5 transfer had
    already been applied to it, manufacturing a ~39 m3 "mismatch" that never
    happened. Only kicks in when an entry has two or more "retained" rows for
    the SAME tank alongside a "transferred" row connecting to it -- the
    overwhelmingly common case of a single retained reading per entry is
    completely untouched.

    A second, related case: an entry with only ONE retained reading for this
    tank alongside a disposed/evaporated/incinerated reading (no transfer).
    Every IMO guidance example for this shape (e.g. Annex Example #12/#14:
    "13 xx m3 bilge water from tank... Capacity xx m3, xx m3 retained")
    states the retained figure as the CLOSING balance, after the disposal --
    never an opening one, since there is no second retained reading to be an
    opening figure in the first place. Confirmed in production (AM KIRTI,
    22-May-2026): an entry stated "19.5 m3 disposed ... 9.0 m3 retained"
    (9.0 being the balance AFTER disposing 19.5), but the retained figure was
    processed before the disposal in the balance walk -- adopting 9.0 as a
    checkpoint and THEN subtracting 19.5 from it a second time, manufacturing
    a physically impossible NEGATIVE "expected" balance (-10.5 m3) for the
    next real sounding to be compared against. Reorder so any disposal-type
    reading for this tank is applied to the running balance BEFORE this
    entry's own retained figure is compared/adopted.
    """
    from collections import OrderedDict

    disposal_types = {"disposed", "evaporated", "incinerated"}

    groups: "OrderedDict" = OrderedDict()
    for e, qy in matched:
        groups.setdefault(e.id, []).append((e, qy))

    ordered: list = []
    for group in groups.values():
        same_tank_retained = [
            (e, qy) for e, qy in group
            if qy.qty_type == "retained" and _norm_tank(qy.from_tank, protect) == tn
        ]
        transfer_item = next(
            (
                (e, qy) for e, qy in group
                if qy.qty_type == "transferred"
                and tn in (_norm_tank(qy.from_tank, protect), _norm_tank(qy.to_tank, protect))
            ),
            None,
        )
        if len(same_tank_retained) < 2 or transfer_item is None:
            disposal_items = [
                (e, qy) for e, qy in group
                if qy.qty_type in disposal_types and _norm_tank(qy.from_tank, protect) == tn
            ]
            if same_tank_retained and disposal_items and transfer_item is None:
                retained_ids = {id(qy) for _, qy in same_tank_retained}
                disposal_ids = {id(qy) for _, qy in disposal_items}
                rest = [item for item in group if id(item[1]) not in retained_ids and id(item[1]) not in disposal_ids]
                ordered.extend(rest + disposal_items + same_tank_retained)
            else:
                ordered.extend(group)
            continue

        # Inflow (transfer INTO this tank) -> opening balance is the SMALLER
        # figure, closing is larger. Outflow -> the reverse.
        inflow = _norm_tank(transfer_item[1].to_tank, protect) == tn
        same_tank_retained.sort(key=lambda item: item[1].qty_value, reverse=not inflow)
        opening, closing = same_tank_retained[0], same_tank_retained[-1]
        excluded_ids = {id(opening[1]), id(closing[1]), id(transfer_item[1])}
        rest = [item for item in group if id(item[1]) not in excluded_ids]
        ordered.extend([opening, transfer_item] + rest + [closing])
    return ordered


def _rows_for_tank(rows, tn: str, protect: frozenset[str] = frozenset()):
    matched = [(e, qy) for e, qy in rows if _norm_tank(qy.from_tank, protect) == tn or _norm_tank(qy.to_tank, protect) == tn]
    return _order_within_entry(matched, tn, protect)

# ─────────────────────────────────────────────────────────────────────────
# Check 2 — Mass Balance Error
# ─────────────────────────────────────────────────────────────────────────
async def check_mass_balance_error(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Alert 4. For every tank, the retained figure must not fall below the running balance (previous
    retained +/- logged transfers, disposals, evaporation and incineration) -- zero tolerance on a drop.
    Tanks other than bilge/sludge keep the old check on a rise (a missing transfer in). An evaporation
    entry on a tank whose IOPP Supplement has no evaporation provision is flagged as well."""
    cfg = cfg_now()
    tanks = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    if not tanks: return
    protect = _compute_protected_tank_words(tanks)
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id)

    for tank in tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)
        keeps_rise_check = _get_effective_group(tank) not in EXCLUDED_MASS_BALANCE_GROUPS
        balance = None
        for entry, qty in rows:
            from_here = _norm_tank(qty.from_tank, protect) == tn
            if qty.qty_type == "retained":
                if balance is not None:
                    drop = balance - qty.qty_value
                    if cfg.exceeds("mass_balance_drop_tolerance", drop):
                        msg = (f"[{entry.entry_date}] Tank {tank.tank_name}: retained {qty.qty_value:g}m³ is {drop:.2f}m³ "
                               f"below the expected {balance:.2f}m³ -- no transfer, disposal, evaporation or incineration "
                               f"from this tank explains the drop.")
                        await create_alert_if_new(db, vessel_id, entry.id, "mass_balance_error", "major", msg)
                    elif keeps_rise_check and cfg.exceeds("mass_balance_rise_tolerance", -drop):
                        msg = f"[{entry.entry_date}] Tank {tank.tank_name} mass balance error."
                        await create_alert_if_new(db, vessel_id, entry.id, "mass_balance_error", "major", msg)
                balance = qty.qty_value
            elif qty.qty_type == "transferred":
                if balance is not None: balance += qty.qty_value if _norm_tank(qty.to_tank, protect) == tn else -qty.qty_value
            elif qty.qty_type in ("disposed", "evaporated", "incinerated") and from_here:
                if balance is not None: balance -= qty.qty_value

            if qty.qty_type == "evaporated" and from_here and not tank.is_evaporation_allowed:
                msg = (f"[{entry.entry_date}] Evaporation recorded from {tank.tank_name}, but the IOPP Supplement "
                       f"has no evaporation provision for this tank.")
                await create_alert_if_new(db, vessel_id, entry.id, "mass_balance_error", "major", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 3 — Tank Capacity Exceeded (+ capacity-reading transcription check)
# ─────────────────────────────────────────────────────────────────────────
# Entries at or below the configured confidence (default 0.4) carry figures the extractor could not stand behind.
def _reading_is_uncertain(entry) -> bool:
    conf = entry.confidence_score
    if conf is not None and cfg_now().exceeds("low_confidence_cutoff", conf):
        return True
    return "auto-corrected" in (entry.operation_description or "").lower()


async def check_tank_capacity_exceeded(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    tanks = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    if not tanks: return
    protect = _compute_protected_tank_words(tanks)
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id, [OrbEntryQuantity.qty_type.in_(["retained", "capacity"])])

    for tank in tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)
        if not tank.capacity_m3:
            continue

        retained_rows = [(e, qy) for e, qy in rows if qy.qty_type == "retained"]
        for entry, qy in retained_rows:
            if qy.qty_value > tank.capacity_m3:
                if _reading_is_uncertain(entry):
                    # A figure the extractor itself marked unreliable (auto-corrected capacity, or
                    # low confidence because its block was cut across a page) must not raise a
                    # Critical alert: confirmed on AM KIRTI 7-Feb, where another tank's 8.5 m3 landed
                    # on the L.O. drain tank and produced a false "exceeds certified capacity".
                    msg = (f"[{entry.entry_date}] Tank {tank.tank_name}: retained {qy.qty_value}m³ appears to exceed "
                           f"the certified capacity {tank.capacity_m3}m³, but this entry's figures are uncertain "
                           f"(low confidence or auto-corrected) -- verify against the original page.")
                    await create_alert_if_new(db, vessel_id, entry.id, "reading_needs_review", "observation", msg)
                    continue
                msg = f"[{entry.entry_date}] Tank {tank.tank_name} exceeds certified capacity."
                await create_alert_if_new(db, vessel_id, entry.id, "tank_capacity_exceeded", "critical", msg)

        # "Tank quantities exceeding certified capacity: Transcription error or
        # fabricated figure" — a tank's capacity is a fixed physical property,
        # so an extracted "capacity" reading that deviates from the registered
        # certified capacity is itself a red flag, regardless of direction.
        tol = max(0.1, tank.capacity_m3 * 0.05)
        for entry, qy in rows:
            if qy.qty_type == "capacity" and abs(qy.qty_value - tank.capacity_m3) > tol:
                msg = (f"[{entry.entry_date}] Tank {tank.tank_name} capacity reading {qy.qty_value}m³ "
                       f"does not match certified capacity {tank.capacity_m3}m³ — possible transcription error.")
                await create_alert_if_new(db, vessel_id, entry.id, "capacity_reading_mismatch", "minor", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 4 — Combined Capacity Threshold
# ─────────────────────────────────────────────────────────────────────────
async def check_combined_capacity_threshold(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Alert 5. Latest retained figures of the MAIN tanks (capacity above the configured minimum, 10 m³)
    against their total capacity. A tank without a capacity is out of both sides of the ratio."""
    cfg = cfg_now()
    tanks = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    main_tanks = [t for t in tanks if t.capacity_m3 and cfg.exceeds("main_tank_min_capacity", t.capacity_m3)]
    if not main_tanks: return
    protect = _compute_protected_tank_words(tanks)
    total_cap = sum(t.capacity_m3 for t in main_tanks)
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, None, [OrbEntryQuantity.qty_type == "retained"])

    total_ret = 0.0
    for tank in main_tanks:
        tn = _norm_tank(tank.tank_name, protect)
        matches = _rows_for_tank(all_rows, tn, protect)
        if matches: total_ret += matches[-1][1].qty_value
    fill_pct = total_ret / total_cap * 100
    if total_cap > 0 and cfg.exceeds("combined_fill_pct", fill_pct):
        msg = (f"Combined fill of the main tanks (over {cfg.value('main_tank_min_capacity'):g} m³) is {fill_pct:.1f}% "
               f"of {total_cap:.1f} m³, above the {cfg.value('combined_fill_pct'):g}% limit.")
        await create_alert_if_new(db, vessel_id, None, "combined_capacity_threshold", "major", msg, upload_id=upload_id)

# ─────────────────────────────────────────────────────────────────────────
# Check 5 — Sludge Generation Rate (Pattern Tracking)
# ─────────────────────────────────────────────────────────────────────────
async def check_sludge_generation_rate(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    tanks_all = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    protect = _compute_protected_tank_words(tanks_all)
    sludge_tanks = [t for t in tanks_all if _get_effective_group(t) == "SLUDGE"]
    if not sludge_tanks: return
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id)

    for tank in sludge_tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)
        prev_ret, prev_ent = None, None
        for entry, qty in rows:
            if qty.qty_type == "retained":
                if prev_ret is not None:
                    diff = prev_ret - qty.qty_value
                    # An unchanged level between two soundings is completely
                    # normal (the tank simply wasn't touched) -- this used to
                    # raise an "observation" alert every single time, which
                    # produced no actionable signal and, in practice, drowned
                    # out every other check: on one real upload this single
                    # branch alone accounted for 72 of 101 total alerts (71%)
                    # raised for the vessel. Only a genuine unexplained DROP
                    # is worth surfacing.
                    if cfg_now().exceeds("sludge_drop_tolerance", diff):
                        has_mov = any(e2.entry_date >= prev_ent.entry_date and e2.entry_date <= entry.entry_date and q2.qty_type in ("transferred", "disposed", "incinerated", "evaporated") for e2, q2 in rows)
                        if not has_mov:
                            msg = f"[{entry.entry_date}] Sludge drop in {tank.tank_name} without matching log entry."
                            await create_alert_if_new(db, vessel_id, entry.id, "sludge_generation_rate", "minor", msg)
                prev_ret, prev_ent = qty.qty_value, entry

# ─────────────────────────────────────────────────────────────────────────
# Check 6 — Bilge Increasing Rate
# ─────────────────────────────────────────────────────────────────────────
BILGE_RISE_TOLERANCE_M3 = 0.3


async def check_bilge_increasing_rate(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    tanks_all = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    protect = _compute_protected_tank_words(tanks_all)
    bilge_tanks = [t for t in tanks_all if _get_effective_group(t) == "BILGE"]
    if not bilge_tanks: return
    discharge_dates = [e.entry_date for e in (await db.execute(select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code.in_(["D", "E"])))).scalars().all()]
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id, [OrbEntryQuantity.qty_type == "retained"])

    for tank in bilge_tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)
        prev_v, prev_d, prev_entry_id = None, None, None
        for entry, qty in rows:
            # Any single rise from the last figure with no D/E discharge logged
            # in between is itself the violation -- "Bilge tank increasing from
            # last figure ... combined into one figure as error" describes a
            # per-instance trigger, not a streak. (Previously required two
            # consecutive unexplained rises, which silently let a lone
            # unexplained increase through with no alert at all.)
            #
            # Skip the comparison when both readings belong to the SAME entry
            # (an opening balance and closing balance either side of that
            # entry's own logged transfer, per _order_within_entry) -- that
            # rise is already explained by the transfer recorded right there
            # in the entry, but the discharge_dates window below only looks
            # at STRICTLY LATER dates, so a same-day pair would otherwise
            # never find its own entry as the explaining discharge.
            # A rise within sounding tolerance (tank gauging is only accurate to a few tenths of a
            # m3 -- MARPOL ORB instructions) is not an unexplained discharge.
            if prev_v is not None and qty.qty_value - prev_v > BILGE_RISE_TOLERANCE_M3 + 1e-9 and entry.id != prev_entry_id:
                if not any(prev_d < d <= entry.entry_date for d in discharge_dates):
                    msg = f"[{entry.entry_date}] Bilge rising in {tank.tank_name} from {prev_v}m³ to {qty.qty_value}m³ without a discharge logged in between."
                    await create_alert_if_new(db, vessel_id, entry.id, "bilge_increasing_rate", "major", msg)
            prev_v, prev_d, prev_entry_id = qty.qty_value, entry.entry_date, entry.id

# ─────────────────────────────────────────────────────────────────────────
# Check 7 — Sludge vs Fuel Consumption
# ─────────────────────────────────────────────────────────────────────────
async def check_sludge_vs_fuel_consumption(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Sludge generated must stay under ~1% of fuel consumed over the SAME
    period; >=1.5% is a warning, >=2% is critical.

    Both sides of the ratio must cover the same window. Comparing a
    lifetime-cumulative sludge total against a single day's fuel figure (the
    previous approach) produces a meaningless, inflated ratio on any
    multi-day document -- e.g. a 5-month ORB batch would compare ~5 months
    of sludge generation against one day of fuel burn. Instead, sum fuel
    consumption over the exact date range spanned by the entries being
    evaluated here.
    """
    vessel = await db.get(Vessel, vessel_id)
    if not vessel: return

    date_filter = [OrbEntry.vessel_id == vessel_id]
    if upload_id:
        date_filter.append(OrbEntry.upload_id == upload_id)
    date_range = (await db.execute(
        select(func.min(OrbEntry.entry_date), func.max(OrbEntry.entry_date)).where(*date_filter)
    )).one_or_none()
    if not date_range or not date_range[0]:
        return
    start_date, end_date = date_range

    # Consumed fuel for the period: the Mariapps reports (vessel performance database) when that source is
    # connected, otherwise the older WNI fuel table.
    from app.services import performance_data as perf
    mariapps = await perf.fuel_for_period(vessel.imo_number, vessel.name, start_date, end_date)
    if mariapps is not None and mariapps.total_mt <= 0:
        mariapps = None              # nothing in Mariapps for this period: the older WNI table may still have it
    fuel_gap = None
    if mariapps is not None:
        total_fuel = mariapps.total_mt
        if cfg_now().exceeds("fuel_coverage_min_pct", mariapps.coverage_pct):
            first = ", ".join(d.strftime("%d-%b") for d in mariapps.missing_days[:5])
            fuel_gap = (f"fuel consumption is recorded for only {mariapps.days_covered} of {mariapps.days_total} days "
                        f"({mariapps.coverage_pct:.0f}%, at least {cfg_now().value('fuel_coverage_min_pct'):.0f}% needed); "
                        f"missing e.g. {first}.")
    else:
        total_fuel = (await db.execute(
            select(func.sum(FuelConsumption.total_fuel_consumption)).where(
                FuelConsumption.vessel_name == vessel.name,
                FuelConsumption.report_date >= start_date,
                FuelConsumption.report_date <= end_date,
            )
        )).scalar_one_or_none()
        if not total_fuel or total_fuel <= 0:
            fuel_gap = "no daily fuel consumption records for this period."

    tanks_all = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    protect = _compute_protected_tank_words(tanks_all)
    sludge_tanks = [t for t in tanks_all if _get_effective_group(t) == "SLUDGE"]
    if not sludge_tanks: return

    if fuel_gap:
        # Alert 37: the ratio cannot be judged, so say so instead of staying silent.
        msg = f"[{start_date} to {end_date}] Review of the generated sludge quantity is not possible: {fuel_gap}"
        await create_alert_if_new(db, vessel_id, None, "sludge_review_fuel_missing", "minor", msg, upload_id=upload_id)
        return

    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id, [OrbEntry.orb_code == "C"])

    total_sludge_generated = 0.0

    for tank in sludge_tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)

        # A. Get Opening and Closing Quantities
        soundings = [qy for e, qy in rows if qy.qty_type == "retained"]
        net_sounding_change = 0.0
        if len(soundings) >= 2:
            net_sounding_change = soundings[-1].qty_value - soundings[0].qty_value

        # B. Get Total Removals
        total_removals = sum(
            qy.qty_value for e, qy in rows
            if qy.qty_type in ("disposed", "incinerated", "transferred") and _norm_tank(qy.from_tank, protect) == tn
        )

        total_sludge_generated += (net_sounding_change + total_removals)

    if total_sludge_generated <= 0: return

    ratio_pct = (total_sludge_generated / total_fuel) * 100

    cfg = cfg_now()
    if cfg.exceeds("sludge_ratio_critical", ratio_pct):
        severity = "critical"
    elif cfg.exceeds("sludge_ratio_major", ratio_pct):
        severity = "major"
    else:
        return

    grades = ""
    if mariapps is not None and mariapps.by_grade:
        grades = " (" + ", ".join(f"{g} {mt:.1f}" for g, mt in sorted(mariapps.by_grade.items())) + ")"
    msg = (f"[{start_date} to {end_date}] Sludge generation rate is {ratio_pct:.2f}% of fuel consumed "
           f"over this period ({total_fuel:.2f} MT{grades}). Total generated: {total_sludge_generated:.2f} m³.")
    await create_alert_if_new(db, vessel_id, None, "sludge_vs_fuel_consumption", severity, msg, upload_id=upload_id, keep_severity=True)

# ─────────────────────────────────────────────────────────────────────────
# Check 8 — Bilge Transfer vs Soundings
# ─────────────────────────────────────────────────────────────────────────
async def check_bilge_transfer_vs_soundings(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    tanks_all = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    protect = _compute_protected_tank_words(tanks_all)
    bilge_tanks = [t for t in tanks_all if _get_effective_group(t) == "BILGE"]
    if not bilge_tanks: return
    # Fetch broadly and match tank-by-tank via _norm_tank(), same as every
    # other tank-scoped check in this file -- an exact SQL-level name match
    # (the previous approach) never matches real handwritten ORB entries
    # against the registered vessel_tanks.tank_name ("BILGE TANK" vs
    # "Bilge Holding Tank"), so this check found zero rows in practice.
    all_rows = await _fetch_vessel_qty_rows(db, vessel_id, upload_id)
    for tank in bilge_tanks:
        tn = _norm_tank(tank.tank_name, protect)
        rows = _rows_for_tank(all_rows, tn, protect)
        # Track a single running balance, adjusted immediately as each movement
        # is encountered, then checked/reset against the next actual sounding.
        # (Previously only counted transfers INTO the tank and disposals tagged
        # with code D/E -- so a normal outgoing transfer to another tank, or a
        # residue disposal logged under Code C (as this vessel does for item
        # 12.1), was never subtracted, making every correctly-logged outflow
        # look like an unexplained "mismatch".)
        #
        # Tolerance: unlike a sealed sludge/residue tank, a bilge tank has
        # continuous natural water ingress between logged pump-out operations
        # -- this is exactly why bilge/sludge tanks are excluded from
        # check_mass_balance_error's strict 0.15 m3 tolerance entirely. A flat
        # 0.2 m3 tolerance here made the same mistake: traced against real
        # data, consecutive readings routinely drift ~2-3 m3 from natural
        # inflow alone (confirmed on this vessel: 30-Dec/02-Jan/04-Jan/06-Jan
        # all showed a consistent ~2.0-2.7 m3 gap), which isn't a violation --
        # it fired on almost every single sounding in the document. Scale the
        # tolerance to the tank's own capacity so only a mismatch large enough
        # to plausibly represent an unlogged operation gets flagged.
        tolerance = max(1.0, (tank.capacity_m3 or 0) * 0.15)
        balance = None
        for entry, qty in rows:
            if qty.qty_type == "retained":
                if balance is not None and abs(qty.qty_value - balance) > tolerance:
                    msg = (f"[{entry.entry_date}] Bilge sounding mismatch in {tank.tank_name}: "
                           f"expected ~{balance:.2f}m³ from prior reading + logged movements, "
                           f"but {qty.qty_value:.2f}m³ was recorded.")
                    await create_alert_if_new(db, vessel_id, entry.id, "bilge_transfer_vs_soundings", "minor", msg)
                balance = qty.qty_value
            elif qty.qty_type == "transferred" and balance is not None:
                if _norm_tank(qty.to_tank, protect) == tn: balance += qty.qty_value
                elif _norm_tank(qty.from_tank, protect) == tn: balance -= qty.qty_value
            elif qty.qty_type in ("disposed", "evaporated") and _norm_tank(qty.from_tank, protect) == tn and balance is not None:
                balance -= qty.qty_value

# ─────────────────────────────────────────────────────────────────────────
# Check 9 — Bilge Pump Capacity
# ─────────────────────────────────────────────────────────────────────────
async def check_bilge_pump_capacity(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    tanks_all = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id, VesselTank.is_active == True))).scalars().all()
    protect = _compute_protected_tank_words(tanks_all)
    # The pump rate is the rated capacity in the vessel's equipment register, linked to the tank it
    # pumps from. There is NO default rate: a tank without one is not checked (Vessel Configuration
    # lists the tanks that still need it). Two pumps on one tank: the faster one counts.
    # Keyed by normalised tank name -- qty.from_tank is the raw extracted
    # string ("BILGE TANK", "E/R BILGE WELLS", ...), which rarely matches
    # the registered vessel_tanks.tank_name verbatim, so an exact-string key
    # (the previous approach) silently missed almost every real entry.
    by_id = {t.id: t for t in tanks_all}
    pumps = (await db.execute(select(Equipment).where(
        Equipment.vessel_id == vessel_id, Equipment.is_active.is_(True),
        Equipment.equipment_type.in_(["BILGE_PUMP", "OWS"]),
        Equipment.rated_capacity_m3_hr.isnot(None), Equipment.rated_capacity_m3_hr > 0,
        Equipment.linked_tank_id.isnot(None),
    ))).scalars().all()
    tanks: dict[str, float] = {}
    for pump in pumps:
        tank = by_id.get(pump.linked_tank_id)
        if tank is None: continue
        key = _norm_tank(tank.tank_name, protect)
        tanks[key] = max(tanks.get(key, 0.0), pump.rated_capacity_m3_hr)
    if not tanks: return

    base_q = select(OrbEntry, OrbEntryQuantity).join(OrbEntryQuantity).where(
        OrbEntry.vessel_id == vessel_id,
        OrbEntry.orb_code.in_(["D", "E"]),
        OrbEntryQuantity.qty_type == "disposed"
    )
    if upload_id:
        base_q = base_q.where(OrbEntry.upload_id == upload_id)

    res = await db.execute(base_q)
    for entry, qty in res.all():
        pump_cap = tanks.get(_norm_tank(qty.from_tank, protect))
        if not pump_cap: continue
        start, stop = _parse_time(entry.time_start), _parse_time(entry.time_stop)
        if start is None or stop is None: continue
        hours = ((stop - start) if stop >= start else ((1440 - start) + stop)) / 60.0
        if hours <= 0: continue
        if cfg_now().exceeds("pump_capacity_allowance", qty.qty_value - pump_cap * hours):
            msg = f"[{entry.entry_date}] Disposed quantity {qty.qty_value}m³ exceeds {pump_cap}m³/hr pump capacity limit."
            await create_alert_if_new(db, vessel_id, entry.id, "bilge_pump_capacity", "major", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 10 — Bunker Mismatch
# ─────────────────────────────────────────────────────────────────────────
def _is_mt(unit: str | None) -> bool:
    return (unit or "").strip().lower() in ("mt", "t", "tonne", "tonnes", "ton", "tons", "metric ton", "metric tons")


async def check_bunker_mismatch(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    q_filter = and_(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == BUNKER_ORB_CODE, OrbEntry.item_number.in_(BUNKER_ITEMS))
    if upload_id: q_filter = and_(q_filter, OrbEntry.upload_id == upload_id)
    res = await db.execute(select(OrbEntry).where(q_filter))
    for entry in res.scalars().all():
        qty_res = await db.execute(select(OrbEntryQuantity).where(OrbEntryQuantity.entry_id == entry.id, OrbEntryQuantity.qty_type == "bunkered"))
        bunkered = qty_res.scalars().all()

        # A bunker entry may state an overall header total (to_tank=null) plus a
        # per-tank breakdown (to_tank=<tank>) — see IMO guidance Example #18/#19.
        header_total = next((q.qty_value for q in bunkered if not q.to_tank), None)
        tank_splits = [q for q in bunkered if q.to_tank]
        split_sum = sum(q.qty_value for q in tank_splits)
        total_qty = header_total if header_total is not None else split_sum

        desc = entry.operation_description or ""
        is_lube = entry.item_number == "26.4"
        missing_grade = False if is_lube else not re.search(r"\b(VLSFO|HSFO|MGO|MDO|LSMGO|VLSMGO|IFO|ULSFO|B24|B30)\b", desc, re.I)
        if total_qty <= 0 or missing_grade or not re.search(r"[A-Za-z0-9]{6,}", desc):
            msg = f"[{entry.entry_date}] Bunker entry missing essential details/specification grades."
            await create_alert_if_new(db, vessel_id, entry.id, "bunker_mismatch", "minor", msg)

        # Self-contained quantity check: does the per-tank breakdown add up to the
        # header total actually written on the page? No external reference needed.
        # Compared in MT (alert 8): a figure written in another unit is not compared.
        in_mt = all(_is_mt(q.qty_unit) for q in bunkered)
        if in_mt and header_total is not None and tank_splits and cfg_now().exceeds("bunker_sum_tolerance", abs(split_sum - header_total)):
            msg = (f"[{entry.entry_date}] Bunker quantity mismatch: total bunkered "
                   f"{header_total:.2f} MT vs per-tank breakdown sums to {split_sum:.2f} MT.")
            await create_alert_if_new(db, vessel_id, entry.id, "bunker_quantity_mismatch", "major", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 11 — Missing Master Signature (Aggregated)
# ─────────────────────────────────────────────────────────────────────────
async def check_missing_master_signature(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    if not upload_id: return
    result = await db.execute(select(OrbEntry.page_number).where(
        OrbEntry.vessel_id == vessel_id, OrbEntry.upload_id == upload_id,
        or_(OrbEntry.master_signature_present.is_(False), OrbEntry.master_signature_present.is_(None)),
    ))
    pages = sorted({p for (p,) in result.all() if p is not None})
    if not pages:
        return
    page_list = ", ".join(str(p) for p in pages)
    label = "page" if len(pages) == 1 else "pages"
    msg = f"Master/Officer signature not detected on {label} {page_list} in this upload batch."
    await create_alert_if_new(db, vessel_id, None, "missing_master_signature", "minor", msg, upload_id=upload_id)

# ─────────────────────────────────────────────────────────────────────────
# Check 12 — Chronology and Erasures
# ─────────────────────────────────────────────────────────────────────────
async def check_chronology_and_erasures(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    q_filter = OrbEntry.vessel_id == vessel_id
    if upload_id: q_filter = and_(q_filter, OrbEntry.upload_id == upload_id)
    # NOTE: order by page_number (true physical document order), not created_at.
    # All entries from one upload are inserted in the same DB transaction, so
    # Postgres' now() gives every row an identical created_at timestamp -- the
    # ORDER BY then falls back to an arbitrary tie-break that does NOT reliably
    # match page order, producing false "out of order" alerts on a perfectly
    # sequential source document. created_at is kept as the tiebreak for entries
    # that genuinely share a page_number (or have none, e.g. mock/legacy data).
    entries = (await db.execute(
        select(OrbEntry).where(q_filter).order_by(OrbEntry.page_number, OrbEntry.created_at)
    )).scalars().all()
    # Compare each entry's date against the highest date seen on any STRICTLY
    # EARLIER page, not against its immediate neighbour in this list. Entries
    # within the same physical page are not reliably returned in true
    # top-to-bottom reading order by the extractor (multiple blocks on one
    # page can legitimately come back in a different order than they were
    # written), so policing order within a page produces false positives on
    # a perfectly sequential source document. A real chronology violation --
    # a later page actually going backward in time -- is still caught, since
    # that comparison is against the running max from completed prior pages.
    max_date_prior_pages = None
    current_page = object()  # sentinel, not equal to any real page_number
    page_max_date = None
    for entry in entries:
        if entry.page_number != current_page:
            if page_max_date is not None:
                max_date_prior_pages = page_max_date if max_date_prior_pages is None else max(max_date_prior_pages, page_max_date)
            current_page = entry.page_number
            page_max_date = None

        if max_date_prior_pages and entry.entry_date < max_date_prior_pages:
            msg = f"[{entry.entry_date}] Entry out of chronological validation order (Previous: {max_date_prior_pages})."
            await create_alert_if_new(db, vessel_id, entry.id, "non_chronological_entry", "minor", msg)
        page_max_date = entry.entry_date if page_max_date is None else max(page_max_date, entry.entry_date)

        if entry.has_erasure:
            # IMO guidance permits corrections: a wrong entry struck through with a
            # single line, then signed and dated, with the corrected entry
            # following, is the COMPLIANT way to fix a mistake -- not itself a
            # violation. The extractor can only detect that a strike-through
            # exists, not whether it was separately signed/dated as required, so
            # this stays an "observation" prompting manual verification rather
            # than asserting improper correction outright.
            msg = (f"[{entry.entry_date}] Erasure or correction mark detected on physical page — "
                   f"verify it was struck through with a single line and separately signed/dated "
                   f"per IMO guidance, not left as an unexplained alteration.")
            await create_alert_if_new(db, vessel_id, entry.id, "erasure_detected", "observation", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 13 — Gap Between Entries
# ─────────────────────────────────────────────────────────────────────────
async def check_entry_gaps(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Flags entries preceded by a blank full line (IMO guidance: 'Do not leave
    any full lines empty between successive entries')."""
    q_filter = and_(OrbEntry.vessel_id == vessel_id, OrbEntry.has_gap_before.is_(True))
    if upload_id:
        q_filter = and_(q_filter, OrbEntry.upload_id == upload_id)
    result = await db.execute(select(OrbEntry).where(q_filter))
    for entry in result.scalars().all():
        page = f" (page {entry.page_number})" if entry.page_number else ""
        msg = f"[{entry.entry_date}] Blank line left before this entry{page} — successive entries must not have empty lines between them."
        await create_alert_if_new(db, vessel_id, entry.id, "gap_between_entries", "minor", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 15 — Weekly sludge inventory (alert 29)
# ─────────────────────────────────────────────────────────────────────────
async def check_weekly_c11(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """A sludge tank needs a Code C 11 retained-quantity entry at least every 7 days. The gap is measured
    across the vessel's whole history (an upload starts mid-book); the alert goes on the later entry and
    only for entries of the upload being checked."""
    tanks = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id))).scalars().all()
    protect = _compute_protected_tank_words(tanks)
    sludge = {_norm_tank(t.tank_name, protect): t.tank_name for t in tanks if _get_effective_group(t) == "SLUDGE"}
    if not sludge:
        return
    entries = (await db.execute(
        select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == "C", OrbEntry.item_number.like("11%"))
        .order_by(OrbEntry.entry_date, OrbEntry.page_number, OrbEntry.created_at)
    )).scalars().all()

    last_seen: dict[str, object] = {}
    for e in entries:
        tn = _norm_tank(e.tank_location, protect)
        if tn not in sludge:
            continue
        prev = last_seen.get(tn)
        last_seen[tn] = e.entry_date
        if prev is None or e.entry_date == prev:
            continue
        if upload_id and e.upload_id != upload_id:
            continue
        gap = (e.entry_date - prev).days
        if cfg_now().exceeds("weekly_inventory_interval", gap):
            msg = (f"[{e.entry_date}] {sludge[tn]}: {gap} days since the previous Code C 11 entry ({prev}) - "
                   f"the retained quantity of a sludge tank must be recorded at least every 7 days.")
            await create_alert_if_new(db, vessel_id, e.id, "weekly_c11_missing", "minor", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 16 — Officer signature per entry (alert 30)
# ─────────────────────────────────────────────────────────────────────────
async def check_officer_signatures(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Each operation needs the signature of the officer in charge. Judged only where the extractor read
    it (officer_signature_present not NULL), so older uploads never raise false alerts."""
    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.officer_signature_present.is_(False))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    for e in (await db.execute(q)).scalars().all():
        page = f" (page {e.page_number})" if e.page_number else ""
        msg = f"[{e.entry_date}] Code {e.orb_code} {e.item_number or ''}{page}: no officer-in-charge signature detected on this entry."
        await create_alert_if_new(db, vessel_id, e.id, "missing_officer_signature", "major", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 17 — Late entry inside a page (alert 31)
# ─────────────────────────────────────────────────────────────────────────
async def check_late_entries(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """An entry dated earlier than an entry above it on the same page was inserted late. Uses the order in
    which the extractor returned the entries (entry_seq), so older uploads without it are skipped. Entries
    already caught by the cross-page check (alert 16) are not raised twice."""
    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.entry_seq.isnot(None))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    entries = (await db.execute(q.order_by(OrbEntry.upload_id, OrbEntry.page_number, OrbEntry.entry_seq))).scalars().all()

    upload_max: dict = {}           # upload -> highest date on the pages before the current one
    cur_key, page_max = None, None
    for e in entries:
        key = (e.upload_id, e.page_number)
        if key != cur_key:
            if cur_key is not None and page_max is not None:
                upload_max[cur_key[0]] = max(upload_max.get(cur_key[0], page_max), page_max)
            cur_key, page_max = key, None
        earlier_pages = upload_max.get(e.upload_id)
        cross_page = earlier_pages is not None and e.entry_date < earlier_pages
        if page_max is not None and e.entry_date < page_max and not cross_page:
            msg = (f"[{e.entry_date}] Entry on page {e.page_number} is dated earlier than the entry above it ({page_max}) - "
                   f"possible late or back-dated entry; operations must be recorded without delay.")
            await create_alert_if_new(db, vessel_id, e.id, "late_entry", "minor", msg)
        page_max = e.entry_date if page_max is None else max(page_max, e.entry_date)

# ─────────────────────────────────────────────────────────────────────────
# Check 18 — Code A/B (alert 32) and Code G (alert 34)
# ─────────────────────────────────────────────────────────────────────────
async def check_code_flags(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code.in_(("A", "B", "G")))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    for e in (await db.execute(q)).scalars().all():
        page = f" (page {e.page_number})" if e.page_number else ""
        if e.orb_code == "G":
            msg = (f"[{e.entry_date}] Accidental or exceptional discharge recorded (Code G {e.item_number or ''}){page} - "
                   f"confirm the circumstances are written up and the coastal/flag State report was made.")
            await create_alert_if_new(db, vessel_id, e.id, "accidental_discharge_notify", "major", msg)
        else:
            what = "fuel tank ballasting / cleaning" if e.orb_code == "A" else "dirty ballast / cleaning water discharge"
            msg = f"[{e.entry_date}] Code {e.orb_code} entry ({what}){page} - not validated by the system, review the full entry."
            await create_alert_if_new(db, vessel_id, e.id, "code_ab_present", "observation", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 19 — Book language (alert 36)
# ─────────────────────────────────────────────────────────────────────────
_ACCEPTED_LANGUAGES = {"english", "french", "spanish", "en", "fr", "es", "francais", "français", "espanol", "español"}


async def check_book_language(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """MARPOL Annex I Reg 17.5: entries are in an official language of the flag State and, where that is not
    English, French or Spanish, also in one of these. Raised once per vessel until resolved."""
    vessel = await db.get(Vessel, vessel_id)
    flag_lang = (getattr(vessel, "flag_official_language", None) or "").strip().lower()
    if not flag_lang or flag_lang in _ACCEPTED_LANGUAGES:
        return
    q = select(OrbEntry.page_language).where(OrbEntry.vessel_id == vessel_id, OrbEntry.page_language.isnot(None))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    found = {(l or "").strip().lower() for (l,) in (await db.execute(q.distinct())).all()}
    found.discard("")
    if not found or found & _ACCEPTED_LANGUAGES:
        return
    msg = (f"Entries are written in {', '.join(sorted(l.title() for l in found))}; the flag State's official language is "
           f"{vessel.flag_official_language}, so a translation into English, French or Spanish is required.")
    await create_alert_if_new(db, vessel_id, None, "orb_language", "minor", msg, upload_id=upload_id)


# ─────────────────────────────────────────────────────────────────────────
# Check 20 — Automatic discharge in port / at anchor / polar or special area (alert 33)
# ─────────────────────────────────────────────────────────────────────────
async def check_auto_discharge_location(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Code E 16 (system placed in automatic mode for discharge overboard): where was the vessel at that time?
    Position and status come from the Mariapps reports (noon / arrival / departure / BOSP / EOSP) kept in the
    vessel performance database. Major in port, at anchor or in polar waters; an Observation in a MARPOL special
    area (confirm the 15 ppm alarm and automatic stop). Where the reports do not cover the time, nothing is raised.
    Code E 17/18 (back to manual mode, reasons) are not discharges and are not judged."""
    from datetime import datetime, time as dtime
    from app.services import performance_data as perf
    from app.services.geo_areas import POLAR

    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == "E", OrbEntry.item_number == "16")
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    entries = [e for e in (await db.execute(q)).scalars().all() if _parse_time(e.time_start) is not None]
    if not entries:
        return
    vessel = await db.get(Vessel, vessel_id)
    first = min(e.entry_date for e in entries) - timedelta(days=4)
    last = max(e.entry_date for e in entries) + timedelta(days=4)
    logs = await perf.load_logs(vessel.imo_number, vessel.name, first, last)
    if not logs:
        return

    for e in entries:
        mins = _parse_time(e.time_start)
        near = min(logs, key=lambda r: abs((r.local_date - e.entry_date).days))
        t_local = datetime.combine(e.entry_date, dtime(mins // 60, mins % 60))
        t_utc = t_local - timedelta(minutes=near.tz_min)
        st = perf.status_at(logs, t_utc)
        area = perf.area_of(st)
        when = f"[{e.entry_date} {e.time_start}]"
        if st.not_en_route:
            msg = (f"{when} Automatic discharge (Code E 16) started while the vessel was {st.state} ({st.basis}) - "
                   f"automatic discharge is not permitted in port or at anchor.")
            await create_alert_if_new(db, vessel_id, e.id, "auto_discharge_location", "major", msg, keep_severity=True)
        elif area in POLAR:
            msg = (f"{when} Automatic discharge (Code E 16) started in the {area} ({st.lat:.2f}, {st.lon:.2f}; {st.basis}) - "
                   f"discharge of oily mixtures is prohibited there.")
            await create_alert_if_new(db, vessel_id, e.id, "auto_discharge_location", "major", msg, keep_severity=True)
        elif area:
            msg = (f"{when} Automatic discharge (Code E 16) started in a special area: {area} ({st.lat:.2f}, {st.lon:.2f}; {st.basis}) - "
                   f"confirm the 15 ppm alarm and automatic stop were in operation.")
            await create_alert_if_new(db, vessel_id, e.id, "auto_discharge_location", "observation", msg, keep_severity=True)

# ─────────────────────────────────────────────────────────────────────────
# Check 21 — Bunker entry vs Bunker Delivery Note (alert 35)
# ─────────────────────────────────────────────────────────────────────────
_SULPHUR_STATED = re.compile(r"(sulph|sulf)|\bS\s*[:=]?\s*\d|\d\s*%\s*(m/?m|wt)?", re.I)
_HFO_WORDS = re.compile(r"\b(VLSFO|HSFO|ULSFO|LSFO|IFO|HFO|RME|RMG|RMK|B24|B30)\b", re.I)
_MDO_WORDS = re.compile(r"\b(MGO|MDO|LSMGO|VLSMGO|ULSMGO|DMA|DMB|DMX|DMZ)\b", re.I)


def _grade_family(text_: str | None) -> str | None:
    t = text_ or ""
    hfo, mdo = bool(_HFO_WORDS.search(t)), bool(_MDO_WORDS.search(t))
    if hfo == mdo:
        return None      # none named, or both: nothing to compare
    return "HFO" if hfo else "MDO"


async def check_bunker_bdn_mismatch(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """H 26.3 must state the sulphur content (% m/m), and its quantity and grade must match the Bunker Delivery
    Note kept in Mariapps. BDNs are matched by date (within 2 days). Skipped for a vessel with no bunker reports in
    Mariapps, and an entry older than the vessel's first bunker report is not blamed for having no BDN."""
    from app.services import performance_data as perf

    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == BUNKER_ORB_CODE, OrbEntry.item_number == BUNKER_ITEM)
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    entries = (await db.execute(q)).scalars().all()
    if not entries:
        return
    vessel = await db.get(Vessel, vessel_id)
    records = await perf.load_bunkers(vessel.imo_number, vessel.name)
    if not records:
        return                       # source not connected, or this vessel has no bunker reports there
    bunkerings = [b for b in records if b.transaction_type.strip().lower() == "bunkering" and b.begin]
    if not bunkerings:
        return
    covered_from = min(b.begin.date() for b in bunkerings)

    for e in entries:
        qty_rows = (await db.execute(select(OrbEntryQuantity).where(OrbEntryQuantity.entry_id == e.id, OrbEntryQuantity.qty_type == "bunkered"))).scalars().all()
        header = next((qy.qty_value for qy in qty_rows if not qy.to_tank), None)
        splits = [qy for qy in qty_rows if qy.to_tank]
        total = header if header is not None else (sum(qy.qty_value for qy in splits) if splits else None)
        in_mt = bool(qty_rows) and all(_is_mt(qy.qty_unit) for qy in qty_rows)
        text_ = f"{e.operation_description or ''} {e.raw_text or ''}"

        issues = []
        if not _SULPHUR_STATED.search(text_):
            issues.append("the sulphur content (% m/m) is not stated")

        near = [b for b in bunkerings if abs((b.begin.date() - e.entry_date).days) <= 2]
        if not near:
            if e.entry_date >= covered_from:
                issues.append("no Bunker Delivery Note found in Mariapps for this date")
        else:
            bdn = min(near, key=lambda b: abs((b.quantity_mt or 0) - (total or 0)) if total is not None else 0)
            if total is not None and in_mt and bdn.quantity_mt:
                pct = abs(total - bdn.quantity_mt) / bdn.quantity_mt * 100
                if cfg_now().exceeds("bdn_qty_tolerance", pct):
                    issues.append(f"quantity {total:.2f} MT differs from the BDN {bdn.bdn_reference_no or ''} ({bdn.quantity_mt:.2f} MT, {pct:.1f}%)".replace("  ", " "))
            fam, bdn_fam = _grade_family(text_), _grade_family(f"{bdn.imo_fuel_grade} {bdn.fuel_type}")
            if fam and bdn_fam and fam != bdn_fam:
                issues.append(f"grade written as {fam} but the BDN is {bdn_fam} ({bdn.fuel_type or bdn.imo_fuel_grade})")
        if issues:
            msg = f"[{e.entry_date}] Bunker entry vs BDN: " + "; ".join(issues) + "."
            await create_alert_if_new(db, vessel_id, e.id, "bunker_bdn_mismatch", "minor", msg)


# ─────────────────────────────────────────────────────────────────────────
# Check 22 — Tank not in the IOPP Supplement (alert 25)
# ─────────────────────────────────────────────────────────────────────────
_NOT_A_TANK = re.compile(r"incinerat|overboard|shore|ashore|reception|barge|separator|\bows\b|\bsea\b|\bfacility\b", re.I)


async def check_tank_not_in_iopp(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Every sludge / bilge tank named in a Code C or D entry must be a tank of the vessel's IOPP register
    (the registered tanks marked IOPP, by their registered or their IOPP name), valid on the entry date, and where
    the IOPP capacity is recorded it must equal the registered capacity. A vessel with no IOPP tanks registered
    cannot be judged. Destinations that are not tanks (incinerator, shore, overboard...) are ignored."""
    tanks = (await db.execute(select(VesselTank).where(VesselTank.vessel_id == vessel_id))).scalars().all()
    register = [t for t in tanks if t.is_iopp]
    if not register:
        return
    protect = _compute_protected_tank_words(tanks)
    index: dict[str, list] = {}
    for t in register:
        for nm in (t.tank_name, t.tank_name_iopp):
            if nm:
                index.setdefault(_norm_tank(nm, protect), []).append(t)

    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code.in_(("C", "D")))
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    for e in (await db.execute(q)).scalars().all():
        qty_rows = (await db.execute(select(OrbEntryQuantity.from_tank, OrbEntryQuantity.to_tank).where(OrbEntryQuantity.entry_id == e.id))).all()
        names: dict[str, str] = {}
        for nm in [e.tank_location] + [x for r in qty_rows for x in r]:
            if nm and nm.strip():
                names.setdefault(_norm_tank(nm, protect), nm.strip())
        problems = []
        for key, nm in names.items():
            if key == "unknown" or (_NOT_A_TANK.search(nm) and "tank" not in nm.lower()):
                continue
            cands = index.get(key)
            if not cands:
                problems.append(f"'{nm}' is not a tank of the IOPP register")
                continue
            valid = [t for t in cands if (t.effective_from is None or t.effective_from <= e.entry_date)
                     and (t.effective_to is None or e.entry_date <= t.effective_to)]
            if not valid:
                problems.append(f"'{nm}' was not in the IOPP register on this date")
                continue
            t = valid[0]
            if t.iopp_capacity_m3 is not None and abs(t.iopp_capacity_m3 - t.capacity_m3) > 0.005:
                problems.append(f"'{t.tank_name}': registered capacity {t.capacity_m3:g} m3 differs from the IOPP capacity {t.iopp_capacity_m3:g} m3")
        if problems:
            msg = f"[{e.entry_date}] Code {e.orb_code} {e.item_number or ''}: " + "; ".join(problems) + "."
            await create_alert_if_new(db, vessel_id, e.id, "tank_not_in_iopp", "major", msg)

# ─────────────────────────────────────────────────────────────────────────
# Check 23 — ORB vs 15 ppm bilge alarm record (alert 23)
# ─────────────────────────────────────────────────────────────────────────
async def check_ows_alarm_record(vessel_id: uuid.UUID, upload_id: uuid.UUID | None, db: AsyncSession):
    """Each D 15.1 (discharge overboard through the 15 ppm equipment) must match a discharge operation in the
    imported monitor data, within the time window, and each recorded operation must have a D 15.1 entry. Only
    dates the imported data covers are judged. An operation with no entry has no entry to carry the alert, so those
    are listed in one alert for the upload."""
    from datetime import datetime, time as dtime
    from app.models.orb_config import OcmImport, OcmRecord
    from app.services import ocm_data

    cover = (await db.execute(select(func.min(OcmImport.period_from), func.max(OcmImport.period_to)).where(OcmImport.vessel_id == vessel_id))).one()
    if not cover[0]:
        return                                      # no monitor data imported for this vessel
    cov_from, cov_to = cover[0].date(), cover[1].date()

    q = select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == "D", OrbEntry.item_number == "15.1")
    if upload_id:
        q = q.where(OrbEntry.upload_id == upload_id)
    in_scope = [e for e in (await db.execute(q)).scalars().all() if cov_from <= e.entry_date <= cov_to]
    if not in_scope:
        return
    window = cfg_now().value("alarm_match_window")

    lo = min(e.entry_date for e in in_scope) - timedelta(days=1)
    hi = max(e.entry_date for e in in_scope) + timedelta(days=2)
    recs = (await db.execute(
        select(OcmRecord.recorded_at, OcmRecord.discharging).where(
            OcmRecord.vessel_id == vessel_id, OcmRecord.recorded_at >= datetime.combine(lo, dtime.min), OcmRecord.recorded_at <= datetime.combine(hi, dtime.min)
        ).order_by(OcmRecord.recorded_at)
    )).all()
    ops = ocm_data.operations(recs)

    def span(e):
        s = _parse_time(e.time_start)
        if s is None:
            return datetime.combine(e.entry_date, dtime.min), datetime.combine(e.entry_date, dtime.min) + timedelta(days=1)
        start = datetime.combine(e.entry_date, dtime(s // 60, s % 60))
        t = _parse_time(e.time_stop)
        end = start if t is None else datetime.combine(e.entry_date, dtime(t // 60, t % 60))
        return start, end + (timedelta(days=1) if end < start else timedelta())

    for e in in_scope:
        s, t = span(e)
        if not any(ocm_data.overlaps(s, t, op, window) for op in ops):
            when = f"{e.time_start}" + (f"-{e.time_stop}" if e.time_stop else "") if e.time_start else "no time written"
            msg = (f"[{e.entry_date} {when}] Discharge overboard through the 15 ppm equipment (D 15.1) has no matching "
                   f"discharge in the 15 ppm monitor record (within {window:g} minutes).")
            await create_alert_if_new(db, vessel_id, e.id, "ows_alarm_record_mismatch", "critical", msg)

    # recorded operations with no D 15.1 entry anywhere in the vessel's book
    if upload_id:
        d_lo, d_hi = min(e.entry_date for e in in_scope), max(e.entry_date for e in in_scope)
        all_d = (await db.execute(
            select(OrbEntry).where(OrbEntry.vessel_id == vessel_id, OrbEntry.orb_code == "D", OrbEntry.item_number == "15.1",
                                   OrbEntry.entry_date >= d_lo - timedelta(days=1), OrbEntry.entry_date <= d_hi + timedelta(days=1))
        )).scalars().all()
        spans = [span(e) for e in all_d]
        orphans = [op for op in ops if d_lo <= op[0].date() <= d_hi and not any(ocm_data.overlaps(s, t, op, window) for s, t in spans)]
        if orphans:
            first = "; ".join(f"{op[0]:%d-%b %H:%M}-{op[1]:%H:%M}" for op in orphans[:5])
            more = f" and {len(orphans) - 5} more" if len(orphans) > 5 else ""
            msg = (f"{len(orphans)} discharge operation(s) in the 15 ppm monitor record have no D 15.1 entry in the Oil Record Book "
                   f"({d_lo} to {d_hi}): {first}{more}.")
            await create_alert_if_new(db, vessel_id, None, "ows_alarm_record_mismatch", "critical", msg, upload_id=upload_id)
