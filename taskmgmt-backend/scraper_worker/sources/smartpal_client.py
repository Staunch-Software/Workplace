"""Thin wrapper around SmartPAL's generic ServiceRouter endpoint.

Confirmed from real HAR captures: a single endpoint per sub-app
(`/{AppName}PALApp/api/ServiceRouter/{GET|POST}`), routed internally by a `servicepath`
request header. GET calls pass their real parameters urlencoded inside a `pData` query
param (e.g. `pData=pVesselId=315492&pStatus=&pShowFavouriteItems=false`); POST calls pass
a plain JSON body.

Calls go out as plain httpx requests carrying a Cookie header (session.cookie_header) rather
than through Playwright's page/request-context — matches the reference implementation's
"close the browser after auth, everything else is a plain fetch()" pattern.
"""
import json
import logging
import os
import httpx

logger = logging.getLogger(__name__)

STATIC_VESSELS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "smartpal_vessels.json")

ALL_VESSELS_HEADER_CONTEXT = {"v_id": "-2", "v_objectid": "-2", "v_code": "", "v_name": "All Vessels"}

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def vessel_header_context(vessel: dict):
    """vessel: {"id", "objecT_ID", "code", "name", ...} from GetAllVessels, or the static
    fallback file (smartpal_vessels.json). The static file additionally carries real
    per-vessel cmpid/coid/coname — confirmed from a real Vessel Registry screen that these
    genuinely vary by owning company (e.g. "Global Chartering Limited" vs "Umang Shipping
    Private LTD"), not the single fixed company context COMPANY_HEADERS previously assumed.
    Included here (rather than only in COMPANY_HEADERS) so they override that default via
    _base_headers' merge order when present."""
    ctx = {
        "v_id": str(vessel["id"]),
        "v_objectid": str(vessel["objecT_ID"]),
        "v_code": vessel.get("code") or "",
        "v_name": vessel.get("name") or "",
    }
    if vessel.get("cmpid"):
        ctx["v_cmpid"] = str(vessel["cmpid"])
    if vessel.get("coid"):
        ctx["v_coid"] = str(vessel["coid"])
    if vessel.get("coname"):
        ctx["v_coname"] = str(vessel["coname"])
    return ctx


def _base_headers(session, servicepath, session_headers, vessel_ctx):
    return {
        "User-Agent": UA,
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        **session_headers,
        "servicepath": servicepath,
        **(vessel_ctx or ALL_VESSELS_HEADER_CONTEXT),
        "Cookie": session.cookie_header,
    }


def call_get(session, app_name, servicepath, session_headers, pdata: dict, vessel_ctx=None):
    pdata_str = "&".join(f"{k}={v}" for k, v in pdata.items())
    url = f"{session.base}/{app_name}PALApp/api/ServiceRouter/GET"
    headers = _base_headers(session, servicepath, session_headers, vessel_ctx)
    res = httpx.get(url, params={"pData": pdata_str, "_": "0"}, headers=headers, timeout=60, verify=False)
    if res.status_code != 200:
        raise RuntimeError(f"SmartPAL GET {servicepath} failed: {res.status_code} {res.text[:500]}")
    return res.json()


def call_post(session, app_name, servicepath, session_headers, body: dict, vessel_ctx=None):
    url = f"{session.base}/{app_name}PALApp/api/ServiceRouter/POST"
    headers = {
        **_base_headers(session, servicepath, session_headers, vessel_ctx),
        "Content-Type": "application/json; charset=UTF-8",
    }
    res = httpx.post(url, content=json.dumps(body), headers=headers, timeout=60, verify=False)
    if res.status_code != 200:
        raise RuntimeError(f"SmartPAL POST {servicepath} failed: {res.status_code} {res.text[:500]}")
    return res.json()


def _load_static_vessels():
    """Fallback fleet list for when MDM's GetAllVessels is unreachable (see get_all_vessels).
    Format: [{"imo", "id", "objecT_ID", "code", "name", "cmpid", "coid", "coname"}, ...] —
    sourced from a real "Vessel Registry" screen (a separate internal tool, not this codebase)
    that tracks these SmartPAL identifiers per vessel for exactly this kind of sync use case."""
    if not os.path.exists(STATIC_VESSELS_FILE):
        return None
    with open(STATIC_VESSELS_FILE) as f:
        vessels = json.load(f)
    unfilled = [v["imo"] for v in vessels if str(v.get("id", "")).startswith("REPLACE_WITH")]
    if unfilled:
        raise RuntimeError(
            f"{STATIC_VESSELS_FILE} still has placeholder values for IMO(s) {unfilled} — "
            "fill in the real id/objecT_ID/code/name before this fallback can be used."
        )
    return vessels


def get_all_vessels(session, session_headers_mdm):
    """MDMCommon/VesselRegister/GetAllVessels — the whole fleet with id/objecT_ID/name/imo
    in one call. Used directly for vessel resolution (see vessel_resolution.resolve_smartpal).

    MDM itself 401s no matter what's been tried (cookie-only, hardcoded s_key, a real s_key
    read from Home, navigation-based warm-nav, a guessed "Common/" site-wide API path) — see
    git history for the full list of attempts. Since CER (where the actual certificate/survey
    data comes from) is cookie-only and needs no area authorization at all, and this fleet is
    small and stable, falling back to a hand-filled static vessel list (smartpal_vessels.json)
    sidesteps the broken endpoint entirely rather than continuing to guess at it."""
    try:
        return call_post(
            session, "MDM", "MDMCommon/VesselRegister/GetAllVessels",
            session_headers_mdm, {"searchdrop": "Y", "active": "ACT", "page": 1, "pageSize": 1400},
        )
    except (RuntimeError, httpx.HTTPError) as mdm_error:
        # RuntimeError = a clean 401 from call_post; httpx.HTTPError = a network-level
        # failure (confirmed live: a read timeout on this exact call bypassed the fallback
        # entirely and crashed the whole run, since httpx.ReadTimeout isn't a RuntimeError).
        # Either way, MDM is unusable right now — fall back the same way.
        static_vessels = _load_static_vessels()
        if static_vessels is None:
            raise
        logger.warning("MDM GetAllVessels failed (%s) — using static fallback from %s",
                        mdm_error, STATIC_VESSELS_FILE)
        return static_vessels


def get_certificates(session, session_headers_cer, vessel):
    return call_get(
        session, "Certification", "Certification/CertificateDetails/GetCertificateDetailsData",
        session_headers_cer,
        {"pVesselObjectId": vessel["objecT_ID"], "pShowUnassignedItems": "false",
         "pRelatedSurveyFeature": "false", "pShowFavouriteItems": "false"},
        vessel_ctx=vessel_header_context(vessel),
    )


def get_surveys(session, session_headers_cer, vessel):
    return call_get(
        session, "Certification", "Certification/SurveyDetails/GetSurveyDetailsData",
        session_headers_cer,
        {"pVesselId": vessel["id"], "pShowUnassignedItems": "false",
         "pRelatedCertificate": "0", "pShowFavouriteItems": "false"},
        vessel_ctx=vessel_header_context(vessel),
    )


def get_items(session, session_headers_cer, vessel, doc_type: str):
    """doc_type: 'DAE' | 'COC' | 'MEMORANDA' — each is its own servicepath but identical
    response shape (see app/models/task.py smartpal_items mapping)."""
    servicepath_by_type = {
        "DAE": "Certification/DAE/GetDAEData",
        "COC": "Certification/COC/GetCOCData",
        "MEMORANDA": "Certification/Memoranda/GetMemorandaData",
    }
    return call_get(
        session, "Certification", servicepath_by_type[doc_type],
        session_headers_cer,
        {"pVesselId": vessel["id"], "pStatus": "", "pShowFavouriteItems": "false"},
        vessel_ctx=vessel_header_context(vessel),
    )
