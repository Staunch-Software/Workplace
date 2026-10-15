# app/scraper/mail_graph_fetcher.py
#
# Microsoft Graph API Mail Scraper for Daily Work Done Reports.
#
# Queries the technical@ozellar.com mailbox (which receives all emails sent or
# CC'd to vessel TM distribution lists like tmamkirti@ozellar.com,
# tmgclyamuna@ozellar.com, etc.), identifies Daily Work Done Report emails per
# vessel, extracts attachments (automatically unpacking .zip archives so inner
# PDF/Excel/Word documents can be previewed inline in the UI), uploads them to
# Azure Blob Storage, and upserts a single combined Daily Report row per vessel
# per day in the Report Tracker database.

import asyncio
import base64
import io
import logging
import os
import re
import zipfile
from datetime import datetime, timedelta
from uuid import uuid4

import requests
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.blob_storage import upload_pdf_to_blob
from app.core.config import settings
from app.models.report import (
    EmailStatus,
    Report,
    ReportAttachment,
    ReportConfig,
    ReportEvent,
    ScrapeStatus,
    VerifyStatus,
)
from app.utils.report_date import extract_report_period

logger = logging.getLogger("mail_fetcher")

DAILY_CATEGORIES = {
    "DY-01-DECK_DAILY_WORK_DONE": {
        "code": "DY-01-DECK_DAILY_WORK_DONE",
        "name": "DAILY - 01 - DECK DAILY WORKDONE REPORT",
        "dept": "DECK",
    },
    "DY-02-ENG_DAILY_WORK_DONE": {
        "code": "DY-02-ENG_DAILY_WORK_DONE",
        "name": "DAILY - 02 - ENG DAILY WORKDONE REPORT",
        "dept": "ENGINE",
    },
    "DY-03-ELECTRICAL_DAILY_WORK_DONE": {
        "code": "DY-03-ELECTRICAL_DAILY_WORK_DONE",
        "name": "DAILY - 03 - ELECTRICAL DAILY WORKDONE REPORT",
        "dept": "ENGINE",
    },
    "DY-04-WORK_PLAN_MEETING_FORM": {
        "code": "DY-04-WORK_PLAN_MEETING_FORM",
        "name": "DAILY - 04 - WORK PLAN MEETING FORM",
        "dept": "DECK",
    },
    "DY-05-RIDING_TEAM_DAILY_WORK_DONE": {
        "code": "DY-05-RIDING_TEAM_DAILY_WORK_DONE",
        "name": "DAILY - 05 - RIDING TEAM DAILY WORKDONE REPORT",
        "dept": "DECK",
    },
}

def map_attachment_to_daily_category(filename: str) -> str:
    if not filename:
        return "DY-01-DECK_DAILY_WORK_DONE"
    
    clean = re.sub(r"[\-_\.\/]+", " ", filename.lower())
    
    # 1. Work Plan Meeting Form (ADM-19) & Work Planners -> 4th report
    if (
        "adm 19" in clean
        or "meeting form" in clean
        or "work plan" in clean
        or "workplan" in clean
        or "planner" in clean
        or re.search(r"^\d+(st|nd|rd|th)?\s+oct\s+\d+\s+xlsx?m?$", clean)
    ):
        return "DY-04-WORK_PLAN_MEETING_FORM"
    
    # 2. Electrical Work Done -> 3rd report
    if re.search(r"\bel[ec]{1,2}tr", clean) or "electrical" in clean or "electric" in clean:
        return "DY-03-ELECTRICAL_DAILY_WORK_DONE"
        
    # 3. Riding Team / Rider / Roshan / Hydroblaster -> 5th report
    if any(k in clean for k in ["riding", "rider", "roshan", "hydroblaster", "job scope"]):
        return "DY-05-RIDING_TEAM_DAILY_WORK_DONE"
        
    # 4. Engine Daily Work Done -> 2nd report
    if re.search(r"\b(engine|eng|er|e\s*r)\b", clean) or "cleaning" in clean or "blower" in clean:
        return "DY-02-ENG_DAILY_WORK_DONE"
        
    # 5. Deck Daily Work Done (or fallback) -> 1st report
    if re.search(r"\b(deck|bosun|fitter|chief officer|c\s*o)\b", clean):
        return "DY-01-DECK_DAILY_WORK_DONE"
        
    return "DY-01-DECK_DAILY_WORK_DONE"

DEFAULT_MAILBOX = "technical@ozellar.com"

ALLOWED_DOC_EXTS = {".pdf", ".xls", ".xlsx", ".xlsm", ".csv", ".doc", ".docx"}

# Map email prefixes / fragments (TM distribution lists & vessel mailboxes)
# to canonical vessel names in Report Tracker.
EMAIL_TO_VESSEL = [
    ("tmamkirti", "AM KIRTI"),
    ("amkirti", "AM KIRTI"),
    ("am.kirti", "AM KIRTI"),
    ("tmamtarang", "AM TARANG"),
    ("amtarang", "AM TARANG"),
    ("am.tarang", "AM TARANG"),
    ("tmamumang", "AM UMANG"),
    ("amumang", "AM UMANG"),
    ("am.umang", "AM UMANG"),
    ("tmamnspolar", "AMNS POLAR"),
    ("amnspolar", "AMNS POLAR"),
    ("amns.polar", "AMNS POLAR"),
    ("tmamnstufmax", "AMNS TUFMAX"),
    ("tmamnsitufmax", "AMNS TUFMAX"),
    ("tmtufmax", "AMNS TUFMAX"),
    ("amnstufmax", "AMNS TUFMAX"),
    ("amns.tufmax", "AMNS TUFMAX"),
    ("tmamnsimaximus", "AMNSI MAXIMUS"),
    ("amnsimaximus", "AMNSI MAXIMUS"),
    ("amnsi.maximus", "AMNSI MAXIMUS"),
    ("tmamnsistallion", "AMNSI STALLION"),
    ("tmstallion", "AMNSI STALLION"),
    ("amnsistallion", "AMNSI STALLION"),
    ("amnsi.stallion", "AMNSI STALLION"),
    ("tmgclfos", "GCL FOS"),
    ("tmfos", "GCL FOS"),
    ("gclfos", "GCL FOS"),
    ("gcl.fos", "GCL FOS"),
    ("tmgclganga", "GCL GANGA"),
    ("gclganga", "GCL GANGA"),
    ("gcl.ganga", "GCL GANGA"),
    ("tmgclnarmada", "GCL NARMADA"),
    ("gclnarmada", "GCL NARMADA"),
    ("gcl.narmada", "GCL NARMADA"),
    ("tmgclsabarmati", "GCL SABARMATI"),
    ("gclsabarmati", "GCL SABARMATI"),
    ("gcl.sabarmati", "GCL SABARMATI"),
    ("tmgclsaraswati", "GCL SARASWATI"),
    ("gclsaraswati", "GCL SARASWATI"),
    ("gcl.saraswati", "GCL SARASWATI"),
    ("tmgcltapi", "GCL TAPI"),
    ("gcltapi", "GCL TAPI"),
    ("gcl.tapi", "GCL TAPI"),
    ("tmgclyamuna", "GCL YAMUNA"),
    ("gclyamuna", "GCL YAMUNA"),
    ("gcl.yamuna", "GCL YAMUNA"),
]

# Subject / display name keywords to canonical vessel names (including common typos)
KEYWORD_TO_VESSEL = [
    ("kirti", "AM KIRTI"),
    ("tarang", "AM TARANG"),
    ("umang", "AM UMANG"),
    ("polar", "AMNS POLAR"),
    ("tufmax", "AMNS TUFMAX"),
    ("maximus", "AMNSI MAXIMUS"),
    ("stallion", "AMNSI STALLION"),
    ("gcl fos", "GCL FOS"),
    ("m.v.gcl fos", "GCL FOS"),
    ("mv gcl fos", "GCL FOS"),
    ("fos", "GCL FOS"),
    ("ganga", "GCL GANGA"),
    ("narmada", "GCL NARMADA"),
    ("sabarmati", "GCL SABARMATI"),
    ("sabaramati", "GCL SABARMATI"),
    ("saraswati", "GCL SARASWATI"),
    ("tapi", "GCL TAPI"),
    ("yamuna", "GCL YAMUNA"),
    ("yaumna", "GCL YAMUNA"),
]

MONTH_MAP = {
    "jan": 1, "january": 1,
    "feb": 2, "february": 2,
    "mar": 3, "march": 3,
    "apr": 4, "april": 4,
    "may": 5,
    "jun": 6, "june": 6,
    "jul": 7, "july": 7,
    "aug": 8, "august": 8,
    "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10,
    "nov": 11, "november": 11,
    "dec": 12, "december": 12,
}


def _get_graph_token(tenant_id: str, client_id: str, client_secret: str) -> str | None:
    token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    res = requests.post(
        token_url,
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    if res.status_code != 200:
        logger.error(f"[MAIL-FETCH] Failed to obtain Graph API token: {res.text}")
        return None
    return res.json().get("access_token")


def _is_daily_work_done_subject(subject: str) -> bool:
    """
    Return True if the email subject represents a Daily Work Done report.
    Excludes weekly summaries.
    """
    if not subject:
        return False
    s = subject.lower()
    if any(w in s for w in ("weekly", "week ", "wk ")):
        return False
    return ("daily" in s and "work" in s) or "work done" in s or "workdone" in s


def _resolve_vessel_from_message(msg: dict) -> str | None:
    """
    Identify the canonical vessel name from an email message by checking:
      1. To / CC recipients (specifically TM distribution addresses like tmamkirti@ozellar.com)
      2. Sender address and display name
      3. Subject line vessel keywords
    """
    recipients = (msg.get("toRecipients") or []) + (msg.get("ccRecipients") or [])
    for r in recipients:
        addr = ((r.get("emailAddress") or {}).get("address") or "").lower()
        name = ((r.get("emailAddress") or {}).get("name") or "").lower()
        for pat, vname in EMAIL_TO_VESSEL:
            if pat in addr or pat in name:
                return vname

    sender_info = (msg.get("from") or {}).get("emailAddress") or {}
    sender_addr = (sender_info.get("address") or "").lower()
    sender_name = (sender_info.get("name") or "").lower()
    for pat, vname in EMAIL_TO_VESSEL:
        if pat in sender_addr or pat in sender_name:
            return vname
    for kw, vname in KEYWORD_TO_VESSEL:
        if kw in sender_addr or kw in sender_name:
            return vname

    subj = (msg.get("subject") or "").lower()
    for kw, vname in KEYWORD_TO_VESSEL:
        if re.search(r"\b" + re.escape(kw) + r"\b", subj):
            return vname

    return None


def _extract_date_from_text(text: str, default_year: int) -> datetime | None:
    """
    Parse a date from an email subject or filename.
    Supports formats like:
      - 12-Oct-2026 / 12 OCT- 2026 / 10th Oct 2026 / 09 Oct 26
      - Oct 12, 2026
      - 12.10.2026 / 12-10-2026 / 12/10/2026 / 12.10.26
      - 2026-10-12 / 20261012
    """
    if not text:
        return None

    # 1. DD [st/nd/rd/th] Mon YYYY or YY (e.g. "12-Oct-2026", "12 OCT- 2026", "10th Oct 2026", "09 Oct 26")
    m = re.search(
        r"\b(\d{1,2})(?:st|nd|rd|th)?[\s\.\-_\/]+([A-Za-z]{3,9})(?:[\s\.\-_,\/]+(\d{2,4}))?\b",
        text,
        re.IGNORECASE,
    )
    if m:
        day = int(m.group(1))
        mon_str = m.group(2).lower()
        mon = MONTH_MAP.get(mon_str) or MONTH_MAP.get(mon_str[:3])
        if mon and 1 <= day <= 31:
            yr_str = m.group(3)
            if yr_str:
                yr = int(yr_str)
                if yr < 100:
                    yr += 2000
            else:
                yr = default_year
            if 2020 <= yr <= 2035:
                try:
                    return datetime(yr, mon, day)
                except ValueError:
                    pass

    # 2. Mon DD, YYYY (e.g. "Oct 12, 2026")
    m = re.search(
        r"\b([A-Za-z]{3,9})[\s\.\-_]+(\d{1,2})(?:st|nd|rd|th)?[\s\.\-_,]+(\d{2,4})\b",
        text,
        re.IGNORECASE,
    )
    if m:
        mon_str = m.group(1).lower()
        mon = MONTH_MAP.get(mon_str) or MONTH_MAP.get(mon_str[:3])
        day = int(m.group(2))
        yr = int(m.group(3))
        if yr < 100:
            yr += 2000
        if mon and 1 <= day <= 31 and 2020 <= yr <= 2035:
            try:
                return datetime(yr, mon, day)
            except ValueError:
                pass

    # 3. DD.MM.YYYY or DD-MM-YYYY or DD/MM/YYYY (or 2-digit year)
    m = re.search(r"\b(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{2,4})\b", text)
    if m:
        d1, d2, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if yr < 100:
            yr += 2000
        if 2020 <= yr <= 2035:
            # Assume DD.MM.YYYY (standard maritime format across the fleet)
            if 1 <= d1 <= 31 and 1 <= d2 <= 12:
                try:
                    return datetime(yr, d2, d1)
                except ValueError:
                    pass

    # 4. YYYY-MM-DD or YYYYMMDD
    m = re.search(r"\b(202\d)[\-\.]?(0[1-9]|1[0-2])[\-\.]?(0[1-9]|[12]\d|3[01])\b", text)
    if m:
        yr, mon, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(yr, mon, day)
        except ValueError:
            pass

    return None


def _is_valid_doc_filename(filename: str) -> bool:
    """Return True if filename is a valid report document (not temp lock file, OS metadata, or inline image)."""
    if not filename:
        return False
    base = os.path.basename(filename.replace("\\", "/")).strip()
    if not base or base.startswith("~$") or base.startswith("."):
        return False
    low = base.lower()
    if low in ("thumbs.db", "desktop.ini", ".ds_store"):
        return False
    if low.startswith("image00") or low.startswith("outlook-"):
        return False
    ext = os.path.splitext(low)[1]
    return ext in ALLOWED_DOC_EXTS


def _extract_docs_from_zip(zip_bytes: bytes, depth: int = 0) -> list[tuple[str, bytes]]:
    """
    Recursively unpack a .zip archive in memory and return a list of
    (clean_filename, file_bytes) for all valid report documents inside.
    """
    if depth > 2:
        return []
    extracted: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                norm_path = info.filename.replace("\\", "/")
                if "__MACOSX" in norm_path:
                    continue
                base_name = os.path.basename(norm_path).strip()
                if not base_name:
                    continue
                ext = os.path.splitext(base_name)[1].lower()
                if ext == ".zip":
                    try:
                        nested_bytes = zf.read(info.filename)
                        extracted.extend(_extract_docs_from_zip(nested_bytes, depth + 1))
                    except Exception as e:
                        logger.warning(f"[MAIL-FETCH] Failed to read nested zip {base_name}: {e}")
                elif _is_valid_doc_filename(base_name):
                    try:
                        file_bytes = zf.read(info.filename)
                        if file_bytes:
                            extracted.append((base_name, file_bytes))
                    except Exception as e:
                        logger.warning(f"[MAIL-FETCH] Failed to extract {base_name} from zip: {e}")
    except Exception as e:
        logger.warning(f"[MAIL-FETCH] Invalid or corrupt zip attachment: {e}")
    return extracted


def _fetch_message_documents(headers: dict, mailbox: str, msg_id: str) -> tuple[list[tuple[str, bytes]], list[str]]:
    """
    Fetch attachments for a Graph API message.
    Unpacks .zip archives and filters down to valid report documents.
    Returns (list of (filename, bytes), list of original attachment names for date parsing).
    """
    url = f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages/{msg_id}/attachments"
    res = requests.get(url, headers=headers, timeout=60)
    if res.status_code != 200:
        logger.error(f"[MAIL-FETCH] Failed to fetch attachments for message {msg_id}: {res.status_code}")
        return [], []

    docs: list[tuple[str, bytes]] = []
    raw_names: list[str] = []
    seen_name_bytes: dict[str, bytes] = {}

    for att in res.json().get("value", []):
        att_name = (att.get("name") or "").strip()
        is_inline = bool(att.get("isInline", False))
        content_b64 = att.get("contentBytes")
        if not att_name or not content_b64:
            continue

        ext = os.path.splitext(att_name)[1].lower()
        if is_inline and ext not in ALLOWED_DOC_EXTS and ext != ".zip":
            continue

        try:
            raw_bytes = base64.b64decode(content_b64)
        except Exception as e:
            logger.warning(f"[MAIL-FETCH] base64 decode failed for {att_name}: {e}")
            continue

        if not raw_bytes:
            continue

        raw_names.append(att_name)

        if ext == ".zip":
            unpacked = _extract_docs_from_zip(raw_bytes)
            for inner_name, inner_bytes in unpacked:
                if inner_name in seen_name_bytes:
                    if seen_name_bytes[inner_name] == inner_bytes:
                        continue
                    stem, inner_ext = os.path.splitext(inner_name)
                    inner_name = f"{stem}_{ len(seen_name_bytes) + 1 }{inner_ext}"
                seen_name_bytes[inner_name] = inner_bytes
                docs.append((inner_name, inner_bytes))
        elif _is_valid_doc_filename(att_name):
            if att_name in seen_name_bytes and seen_name_bytes[att_name] == raw_bytes:
                continue
            seen_name_bytes[att_name] = raw_bytes
            docs.append((att_name, raw_bytes))

    return docs, raw_names


async def run_mail_fetcher(
    db: AsyncSession,
    days_back: int = 7,
    target_vessel: str | None = None,
    create_events: bool = True,
) -> int:
    """
    Main entry point to scrape Daily Work Done Report emails from Microsoft Graph API.
    Returns the number of vessel-day Report rows created or updated.
    """
    logger.info(f"[MAIL-FETCH] Starting Mail Graph API Fetcher (days_back={days_back}, target_vessel={target_vessel})...")

    tenant_id = settings.AZURE_TENANT_ID
    client_id = settings.AZURE_CLIENT_ID
    client_secret = settings.AZURE_CLIENT_SECRET

    if not all([tenant_id, client_id, client_secret]):
        logger.error("[MAIL-FETCH] Missing Azure credentials in configuration. Aborting.")
        return 0

    mailbox = getattr(settings, "MAIL_SCRAPE_MAILBOX", None) or DEFAULT_MAILBOX

    # 1. Load Daily ReportConfig rows from DB
    stmt = select(ReportConfig).where(
        ReportConfig.frequency.ilike("daily")
    )
    if target_vessel:
        stmt = stmt.where(
            (ReportConfig.vessel_name.ilike(f"%{target_vessel}%")) |
            (ReportConfig.vessel_imo == target_vessel)
        )
    cfg_res = await db.execute(stmt)
    daily_configs = cfg_res.scalars().all()

    if not daily_configs:
        logger.warning("[MAIL-FETCH] No Daily ReportConfig entries found in DB. Nothing to scrape.")
        return 0

    # Map (vessel_name, report_code) -> ReportConfig
    vessel_cfg_map: dict[tuple[str, str], ReportConfig] = {
        (c.vessel_name.strip().upper(), c.report_code.strip()): c for c in daily_configs
    }
    vessel_imo_map: dict[str, str] = {
        c.vessel_name.strip().upper(): c.vessel_imo.strip() for c in daily_configs
    }
    logger.info(f"[MAIL-FETCH] Loaded Daily ReportConfig for {len(vessel_imo_map)} vessel(s): {list(vessel_imo_map.keys())}")

    # 2. Authenticate with Microsoft Graph
    token = await asyncio.to_thread(_get_graph_token, tenant_id, client_id, client_secret)
    if not token:
        return 0
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    # 3. Page through recent messages in technical@ozellar.com (newest first)
    cutoff_dt = datetime.utcnow() - timedelta(days=days_back)
    next_url = (
        f"https://graph.microsoft.com/v1.0/users/{mailbox}/messages"
        f"?$top=200&$orderby=receivedDateTime%20desc"
        f"&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,hasAttachments"
    )

    candidate_messages: list[dict] = []
    page_count = 0
    stop_paging = False

    while next_url and not stop_paging and page_count < 25:
        page_count += 1
        res = await asyncio.to_thread(requests.get, next_url, headers=headers, timeout=30)
        if res.status_code != 200:
            logger.error(f"[MAIL-FETCH] Failed to list messages on page {page_count}: {res.status_code} {res.text[:300]}")
            break

        data = res.json()
        msgs = data.get("value", [])
        if not msgs:
            break

        older_count_on_page = 0
        for m in msgs:
            recv_str = m.get("receivedDateTime")
            recv_dt = None
            if recv_str:
                try:
                    recv_dt = datetime.fromisoformat(recv_str.replace("Z", "+00:00")).replace(tzinfo=None)
                except Exception:
                    pass

            if recv_dt and recv_dt < cutoff_dt:
                older_count_on_page += 1
                continue

            if not m.get("hasAttachments"):
                continue

            subj = m.get("subject") or ""
            if not _is_daily_work_done_subject(subj):
                continue

            vessel_name = _resolve_vessel_from_message(m)
            if not vessel_name:
                logger.debug(f"[MAIL-FETCH] Could not identify vessel for email: '{subj}'")
                continue

            if vessel_name.upper() not in vessel_imo_map:
                logger.debug(f"[MAIL-FETCH] Skipping email for unconfigured/filtered vessel {vessel_name}: '{subj}'")
                continue

            m["_resolved_vessel"] = vessel_name.upper()
            m["_received_dt"] = recv_dt or datetime.utcnow()
            candidate_messages.append(m)

        if older_count_on_page >= max(1, len(msgs) // 2):
            stop_paging = True

        next_url = data.get("@odata.nextLink")

    logger.info(f"[MAIL-FETCH] Found {len(candidate_messages)} candidate Daily Work Done email(s) within last {days_back} days.")

    # Process oldest-first so later emails on the same day naturally append/update
    candidate_messages.sort(key=lambda x: x["_received_dt"])

    # Group by (vessel_name, cat_code, date_key) before DB upsert
    grouped_reports: dict[tuple[str, str, str], dict] = {}

    for m in candidate_messages:
        msg_id = m["id"]
        subj = m.get("subject") or ""
        vessel_key = m["_resolved_vessel"]
        recv_dt: datetime = m["_received_dt"]

        sender_email = (((m.get("from") or {}).get("emailAddress") or {}).get("address") or "").strip()

        docs, raw_att_names = await asyncio.to_thread(_fetch_message_documents, headers, mailbox, msg_id)
        if not docs:
            logger.info(f"[MAIL-FETCH] Skipping email with 0 valid report documents: '{subj}'")
            continue

        # Determine report_date:
        # 1. First, check attached report documents via extract_report_period (same as other reports)
        report_date = None
        report_date_source = None
        for doc_name, doc_bytes in docs:
            try:
                found = await asyncio.to_thread(extract_report_period, doc_bytes, doc_name)
                if found:
                    dt, src = found
                    if abs((recv_dt - dt).days) <= 60:
                        report_date = datetime(dt.year, dt.month, dt.day)
                        report_date_source = f"{src} (Report Content)"
                        break
            except Exception:
                pass

        # 2. If not found in document content, parse from email subject
        if report_date is None:
            subj_date = _extract_date_from_text(subj, recv_dt.year)
            if subj_date:
                report_date = subj_date
                report_date_source = "email subject"

        # 3. If not in subject, check attachment / zip filenames
        if report_date is None:
            for rname in raw_att_names + [d[0] for d in docs]:
                dt = _extract_date_from_text(rname, recv_dt.year)
                if dt:
                    report_date = dt
                    report_date_source = f"filename ({rname})"
                    break

        # 4. Fallback to email receivedDateTime date
        if report_date is None or abs((recv_dt - report_date).days) > 60:
            report_date = datetime(recv_dt.year, recv_dt.month, recv_dt.day)
            report_date_source = "email date (fallback)"

        date_key = report_date.strftime("%Y%m%d")

        for doc_name, doc_bytes in docs:
            cat_code = map_attachment_to_daily_category(doc_name)
            group_key = (vessel_key, cat_code, date_key)

            bucket = grouped_reports.get(group_key)
            if not bucket:
                bucket = {
                    "vessel_name": vessel_key,
                    "cat_code": cat_code,
                    "report_date": report_date,
                    "report_date_source": report_date_source,
                    "received_dt": recv_dt,
                    "sender_email": sender_email,
                    "docs_by_name": {},  # filename -> bytes
                }
                grouped_reports[group_key] = bucket
            else:
                if recv_dt > bucket["received_dt"]:
                    bucket["received_dt"] = recv_dt
                if sender_email and not bucket["sender_email"]:
                    bucket["sender_email"] = sender_email

            bucket["docs_by_name"][doc_name] = doc_bytes

        logger.info(
            f"[MAIL-FETCH] Processed email for {vessel_key} [date={report_date.strftime('%Y-%m-%d')}]: "
            f"'{subj}' -> {len(docs)} file(s)"
        )

    # 4. Upload to Azure Blob Storage & Upsert into DB
    saved_count = 0
    for (vessel_key, cat_code, date_key), bucket in grouped_reports.items():
        vessel_imo = vessel_imo_map.get(vessel_key)
        if not vessel_imo:
            continue

        cfg = vessel_cfg_map.get((vessel_key, cat_code))
        meta = DAILY_CATEGORIES.get(cat_code, {
            "code": cat_code,
            "name": cat_code,
            "dept": "ENGINE",
        })
        if not cfg:
            cfg = ReportConfig(
                id=uuid4(),
                vessel_imo=vessel_imo,
                vessel_name=vessel_key,
                report_code=cat_code,
                report_name=meta["name"],
                department=meta["dept"],
                frequency="Daily",
            )
            db.add(cfg)
            vessel_cfg_map[(vessel_key, cat_code)] = cfg

        report_date: datetime = bucket["report_date"]
        report_date_source: str = bucket["report_date_source"]
        recv_dt: datetime = bucket["received_dt"]
        sender_email: str = bucket["sender_email"]
        docs_by_name: dict[str, bytes] = bucket["docs_by_name"]

        job_order_no = f"MAIL-{date_key}"

        uploaded_files: list[dict] = []
        for fname, fbytes in docs_by_name.items():
            safe_fname = re.sub(r"[^a-zA-Z0-9_\-\. ]", "_", fname).strip() or "report.pdf"
            blob_name = f"reports/{vessel_imo}/{cat_code}/{date_key}_{safe_fname}"
            try:
                await asyncio.to_thread(upload_pdf_to_blob, fbytes, blob_name)
                uploaded_files.append({"file_name": fname, "blob_path": blob_name})
            except Exception as e:
                logger.error(f"[MAIL-FETCH] Blob upload failed for {vessel_key}/{fname}: {e}")

        if not uploaded_files:
            continue

        ok = await _upsert_daily_mail_report(
            db=db,
            cfg=cfg,
            job_order_no=job_order_no,
            report_date=report_date,
            report_date_source=report_date_source,
            received_dt=recv_dt,
            sender_email=sender_email,
            files=uploaded_files,
            create_events=create_events,
        )
        if ok:
            saved_count += 1

    logger.info(f"[MAIL-FETCH] Mail Graph API Fetcher COMPLETE. Saved/updated {saved_count} Daily report row(s).")
    return saved_count


async def _upsert_daily_mail_report(
    db: AsyncSession,
    cfg: ReportConfig,
    job_order_no: str,
    report_date: datetime,
    report_date_source: str,
    received_dt: datetime,
    sender_email: str,
    files: list[dict],
    create_events: bool = True,
) -> bool:
    """
    Insert or update a Daily Report row for (vessel_imo, report_code, job_order_no).
    Merges attachments by file_name so multiple emails on the same day accumulate cleanly.
    """
    try:
        vessel_imo = cfg.vessel_imo.strip()
        report_code = cfg.report_code.strip()

        stmt = (
            select(Report)
            .where(
                Report.vessel_imo == vessel_imo,
                Report.report_code == report_code,
                Report.job_order_no == job_order_no,
            )
            .options(selectinload(Report.attachments))
        )
        res = await db.execute(stmt)
        existing = res.scalars().first()
        now = datetime.utcnow()
        next_due = report_date + timedelta(days=1)

        if existing:
            existing.report_name = cfg.report_name
            existing.department = cfg.department or existing.department or "ENGINE"
            existing.frequency = cfg.frequency or "Daily"
            existing.job_status = "COMPLETED"
            existing.job_type = "Email"
            if sender_email:
                existing.approved_by = sender_email
            existing.job_date = received_dt
            existing.job_start_date = report_date
            existing.job_end_date = report_date
            existing.due_date = report_date
            existing.next_due_date = next_due
            existing.report_date = report_date
            existing.report_date_source = report_date_source
            existing.scrape_status = ScrapeStatus.SCRAPED
            existing.scrape_error = None

            # Merge attachments by file_name so existing files from earlier emails
            # on the same day are kept and new files are added.
            existing_by_name = {att.file_name: att for att in existing.attachments}
            changed_attachments = False
            for f in files:
                fname = f["file_name"]
                bpath = f["blob_path"]
                if fname in existing_by_name:
                    if existing_by_name[fname].blob_path != bpath:
                        existing_by_name[fname].blob_path = bpath
                        changed_attachments = True
                else:
                    existing.attachments.append(
                        ReportAttachment(
                            id=uuid4(),
                            report_id=existing.id,
                            file_name=fname,
                            blob_path=bpath,
                            email_status=EmailStatus.NOT_REQUIRED,
                        )
                    )
                    changed_attachments = True

            if changed_attachments:
                existing.updated_at = now

            logger.info(
                f"[MAIL-FETCH] Updated Daily Report: {cfg.vessel_name} [{vessel_imo}] "
                f"{job_order_no} ({len(existing.attachments)} attachment(s))"
            )
        else:
            new_report = Report(
                id=uuid4(),
                vessel_imo=vessel_imo,
                vessel_name=cfg.vessel_name.strip(),
                report_code=report_code,
                report_name=cfg.report_name.strip(),
                department=cfg.department or "ENGINE",
                frequency=cfg.frequency or "Daily",
                job_order_no=job_order_no,
                job_status="COMPLETED",
                job_type="Email",
                approved_by=sender_email or None,
                job_date=received_dt,
                job_start_date=report_date,
                job_end_date=report_date,
                due_date=report_date,
                next_due_date=next_due,
                report_date=report_date,
                report_date_source=report_date_source,
                scrape_status=ScrapeStatus.SCRAPED,
                verify_status=VerifyStatus.UNVERIFIED,
                created_at=now,
                updated_at=now,
            )
            for f in files:
                new_report.attachments.append(
                    ReportAttachment(
                        id=uuid4(),
                        file_name=f["file_name"],
                        blob_path=f["blob_path"],
                        email_status=EmailStatus.NOT_REQUIRED,
                    )
                )
            db.add(new_report)

            # Remove any stale FAILED placeholder (job_order_no == "N/A") if one existed
            stmt_placeholder = select(Report).where(
                Report.vessel_imo == vessel_imo,
                Report.report_code == report_code,
                Report.job_order_no == "N/A",
            )
            placeholders = (await db.execute(stmt_placeholder)).scalars().all()
            for p in placeholders:
                await db.delete(p)

            if create_events:
                db.add(
                    ReportEvent(
                        id=uuid4(),
                        vessel_imo=vessel_imo,
                        vessel_name=cfg.vessel_name.strip(),
                        report_id=new_report.id,
                        event_type="NEW_REPORT",
                        description=(
                            f"{cfg.report_name} received via email for "
                            f"{report_date.strftime('%d %b %Y')} ({len(files)} file(s))"
                        ),
                        source="SYSTEM",
                        author_name="System",
                        created_at=now,
                    )
                )

            logger.info(
                f"[MAIL-FETCH] Inserted NEW Daily Report: {cfg.vessel_name} [{vessel_imo}] "
                f"{job_order_no} ({len(files)} attachment(s))"
            )

        await db.commit()
        return True
    except Exception as e:
        await db.rollback()
        logger.error(f"[MAIL-FETCH] DB upsert failed for {cfg.vessel_name}/{job_order_no}: {e}")
        return False
