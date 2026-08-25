"""Step 0 — vessel identity resolution, cached in vessel_source_ids.

Resolution is a one-time cache per (imo_number, source): once a row exists, extraction
scripts use it forever without re-running discovery. Pass force=True to ignore the cache
and re-resolve from scratch (e.g. if you suspect a mapping went stale — see the plan's
"Known risks" section for why that can happen silently).
"""
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select

from db import taskmgmt_engine, control_engine, vessel_source_ids, vessels

logger = logging.getLogger(__name__)


def get_cached_mapping(imo_number: str, source: str):
    with taskmgmt_engine.connect() as conn:
        row = conn.execute(
            select(vessel_source_ids).where(
                vessel_source_ids.c.imo_number == imo_number,
                vessel_source_ids.c.source == source,
            )
        ).first()
    return row._mapping if row else None


def save_mapping(imo_number: str, source: str, source_vessel_id: str, resolved_by: str):
    with taskmgmt_engine.begin() as conn:
        conn.execute(
            vessel_source_ids.delete().where(
                vessel_source_ids.c.imo_number == imo_number,
                vessel_source_ids.c.source == source,
            )
        )
        conn.execute(
            vessel_source_ids.insert().values(
                imo_number=imo_number,
                source=source,
                source_vessel_id=source_vessel_id,
                resolved_by=resolved_by,
                verified_at=datetime.now(timezone.utc),
            )
        )


def get_our_vessels():
    """(imo, name) for every active vessel in the control DB."""
    with control_engine.connect() as conn:
        rows = conn.execute(
            select(vessels.c.imo, vessels.c.name).where(vessels.c.is_active.is_(True))
        ).all()
    return [(r.imo, r.name) for r in rows]


def resolve_direct_imo(source: str, imo_number: str, fleet: list, get_imo, get_id, force: bool = False):
    """Shared by SmartPAL/DNV/ABS — all 3 expose a fleet-list endpoint that returns IMO
    directly, so no fuzzy matching or separate confirmation step is needed (unlike IRS).

    fleet: parsed JSON list from that source's fleet-list call.
    get_imo(item) / get_id(item): field accessors, since each source names them differently
    (SmartPAL: imo/id, DNV: imo/id, ABS: imo_num/assetnum).
    """
    cached = None if force else get_cached_mapping(imo_number, source)
    if cached:
        return cached["source_vessel_id"], cached["resolved_by"]

    match = next(
        (v for v in fleet if str(get_imo(v) or "").strip() == imo_number.strip()),
        None,
    )
    if match:
        source_vessel_id = str(get_id(match))
        save_mapping(imo_number, source, source_vessel_id, "AUTO_VERIFIED")
        return source_vessel_id, "AUTO_VERIFIED"

    logger.warning("%s: no vessel in fleet list matches IMO %s — leaving unresolved", source, imo_number)
    save_mapping(imo_number, source, "", "MANUAL")
    return None, "MANUAL"


def resolve_smartpal(imo_number: str, all_vessels_payload: list, force: bool = False):
    """MDMCommon/VesselRegister/GetAllVessels: [{"id":..., "imo":..., "name":...}, ...]"""
    return resolve_direct_imo(
        "SMARTPAL", imo_number, all_vessels_payload,
        get_imo=lambda v: v.get("imo"), get_id=lambda v: v["id"], force=force,
    )


def resolve_dnv(imo_number: str, fleet_payload: list, force: bool = False):
    """Portal-VesselSelector/api/Me/Vessels: [{"id":"41195", "imo":"9832925", "name":...}, ...]"""
    return resolve_direct_imo(
        "DNV", imo_number, fleet_payload,
        get_imo=lambda v: v.get("imo"), get_id=lambda v: v["id"], force=force,
    )


def resolve_abs(imo_number: str, fleet_payload: list, force: bool = False):
    """ABSAPIPRTLVSLSTATCNT: [{"imo_num":"9481697", "assetnum":"V0206955", ...}, ...]"""
    return resolve_direct_imo(
        "ABS", imo_number, fleet_payload,
        get_imo=lambda v: v.get("imo_num"), get_id=lambda v: v["assetnum"], force=force,
    )


def resolve_irs(imo_number: str, vessel_name: str, fleet_payload: list, fetch_candidate_imo, force: bool = False):
    """GetShipDetailsJson has no IMO — genuine name-match-then-confirm, per the original
    spec. Tries an exact, normalized name match first (the fleet is small, ~13 vessels,
    so this resolves nearly everything cleanly); falls back to fuzzy only if that fails.
    Either way, still confirms via the downloaded report's IMO before AUTO_VERIFIED —
    name matching alone, exact or fuzzy, is never sufficient on its own.

    fleet_payload: parsed JSON from GetShipDetailsJson — [{"SHIP_NAME":..., "IR_NUMBER":...}, ...]
    fetch_candidate_imo(ir_number) -> IMO string from that candidate's downloaded report
        (page 1), or None if the download/parse failed.
    """
    cached = None if force else get_cached_mapping(imo_number, "IRS")
    if cached:
        return cached["source_vessel_id"], cached["resolved_by"]

    if not fleet_payload:
        logger.warning("IRS: fleet list came back empty — leaving %s unresolved", imo_number)
        save_mapping(imo_number, "IRS", "", "MANUAL")
        return None, "MANUAL"

    def norm(s):
        return re.sub(r"\s+", " ", (s or "").strip().upper())

    target = norm(vessel_name)
    candidate = next((v for v in fleet_payload if norm(v.get("SHIP_NAME")) == target), None)

    if candidate is None:
        from rapidfuzz import process, fuzz
        names = [v.get("SHIP_NAME", "") for v in fleet_payload]
        best = process.extractOne(vessel_name, names, scorer=fuzz.token_sort_ratio)
        if not best or best[1] < 85:
            logger.warning(
                "IRS: no confident name match for '%s' (best=%s) — leaving unresolved",
                vessel_name, best,
            )
            save_mapping(imo_number, "IRS", "", "MANUAL")
            return None, "MANUAL"
        candidate = next(v for v in fleet_payload if v.get("SHIP_NAME") == best[0])

    ir_number = candidate["IR_NUMBER"]
    ir_number_str = str(int(ir_number)) if isinstance(ir_number, float) else str(ir_number)

    confirmed_imo = fetch_candidate_imo(ir_number_str)
    if confirmed_imo and confirmed_imo.strip() == imo_number.strip():
        save_mapping(imo_number, "IRS", ir_number_str, "AUTO_VERIFIED")
        return ir_number_str, "AUTO_VERIFIED"

    logger.warning(
        "IRS: name-matched '%s' (IR_NUMBER=%s) but IMO did not confirm (expected %s, got %s) — leaving for MANUAL",
        candidate.get("SHIP_NAME"), ir_number_str, imo_number, confirmed_imo,
    )
    save_mapping(imo_number, "IRS", ir_number_str, "MANUAL")
    return None, "MANUAL"


def resolve_fuzzy_then_confirm(
    imo_number: str,
    vessel_name: str,
    source: str,
    fetch_fleet_names,
    fetch_candidate_imo,
    force: bool = False,
    score_threshold: int = 85,
):
    """Generic fuzzy-match-then-confirm flow for DNV/ABS/IRS.

    fetch_fleet_names()      -> list[(source_vessel_id, name)] from the portal's fleet list
    fetch_candidate_imo(id)  -> IMO string from that candidate's downloaded report (page 1),
                                or None if the download/parse failed
    """
    cached = None if force else get_cached_mapping(imo_number, source)
    if cached:
        return cached["source_vessel_id"], cached["resolved_by"]

    from rapidfuzz import process, fuzz

    fleet = fetch_fleet_names()
    if not fleet:
        logger.warning("%s: fleet list came back empty — leaving %s unresolved", source, imo_number)
        save_mapping(imo_number, source, "", "MANUAL")
        return None, "MANUAL"

    names = [name for _, name in fleet]
    best = process.extractOne(vessel_name, names, scorer=fuzz.token_sort_ratio)
    if not best or best[1] < score_threshold:
        logger.warning(
            "%s: no confident name match for '%s' (best=%s) — leaving unresolved",
            source, vessel_name, best,
        )
        save_mapping(imo_number, source, "", "MANUAL")
        return None, "MANUAL"

    matched_name = best[0]
    candidate_id = next(sid for sid, name in fleet if name == matched_name)

    confirmed_imo = fetch_candidate_imo(candidate_id)
    if confirmed_imo and confirmed_imo.strip() == imo_number.strip():
        save_mapping(imo_number, source, str(candidate_id), "AUTO_VERIFIED")
        return str(candidate_id), "AUTO_VERIFIED"

    logger.warning(
        "%s: name-matched '%s' but IMO did not confirm (expected %s, got %s) — leaving for MANUAL",
        source, matched_name, imo_number, confirmed_imo,
    )
    save_mapping(imo_number, source, str(candidate_id), "MANUAL")
    return None, "MANUAL"
