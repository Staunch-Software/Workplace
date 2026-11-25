# app/services/events_mail_service.py
# Mail to vessel owners for every new logbook report of a vessel: that vessel's last N events,
# latest first, laid out like the Overview "Events" tab. Sent through Microsoft Graph, like mail_service.py.
import asyncio
import html
import json
import logging
import re
from datetime import date as date_type

import httpx
from sqlalchemy import text

from app.api.v1.endpoints.events import build_logbook
from app.services.events_mail_spec import COLUMNS as MAIL_COLUMNS
from app.core.config import settings
from app.core.database import Base, SessionLocal, engine
from app.core.database_control import ControlSession
from app.models.events_mail import EventsMailRecipient, EventsMailVessel, EventsMailSent
from app.core.database_vessel_perf import VesselPerfSession

logger = logging.getLogger(__name__)

SOURCE = "mari_apps"
# (text colour, background) of each tab band; tabs not listed use the default green
_TAB_COLOR = {"Performance (KPI)": ("#F15A29", "#fff3ee")}
_TAB_DEFAULT = ("#00904C", "#e8f6ef")
_NUM = re.compile(r"^-?\d+(\.\d+)?$")
_DT = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2})?$")  # 2026-11-24 07:00:00
_UTC_KEY = "raw:Excel_Data/Log Date (UTC)"   # the report's own UTC date/time (vessel clock is local)
_DEPARTURE = "VoyageMeta_departure_port_last_leg_operational_LF"


def _fmt_value(v):
    if v is None or v == "":
        return "-"
    if _NUM.match(str(v).strip()):
        n = round(float(v), 3)
        return str(int(n)) if n == int(n) else str(n)
    return str(v)


def _fmt_day(iso: str) -> str:
    d = date_type.fromisoformat(iso[:10])
    return d.strftime("%d %b")


def _fmt_time(ts: str) -> str:
    m = re.search(r"[T ](\d{2}:\d{2})", ts or "")
    return m.group(1) if m else ""


def _cell(ev: dict, c: dict) -> str:
    """Value of one spec row for one event: the first candidate column that has a value."""
    for k in c.get("candidates") or [c["db_column"]]:
        if k == "@date_utc":
            t = _fmt_time(ev["_ts"])
            return date_type.fromisoformat(ev["_ts"][:10]).strftime("%d %b %Y") + (f" {t}" if t else "")
        if k == "@date_local":
            return date_type.fromisoformat(ev["_ts"][:10]).strftime("%d %b %Y")
        v = ev.get(k)
        if v is not None and str(v).strip() != "":
            m = _DT.match(str(v).strip())
            if m:  # a date and time from the raw report
                return date_type.fromisoformat(m.group(1)).strftime("%d %b %Y") + f" {m.group(2)}"
            return _fmt_value(v)
    return "-"


def _header_time(ev: dict):
    """(date, time, is_utc) for an event's column header. The report's own UTC time when we have it; otherwise
    the logbook time, which is the vessel's local time, so it is shown without a UTC label."""
    m = _DT.match(str(ev.get(_UTC_KEY) or "").strip())
    if m:
        return m.group(1), m.group(2), True
    return ev["_ts"][:10], _fmt_time(ev["_ts"]), False


def _carry_departure_port(events: list):
    """The departure port of the last leg is the same for every report of a leg, but MariApps only fills it on
    some of them. Fill the gaps from the nearest report of the same leg that has it."""
    for i, ev in enumerate(events):
        if str(ev.get(_DEPARTURE) or "").strip():
            continue
        leg = ev.get("emissionx_voyage_no")
        if not leg:
            continue
        best = min((j for j, o in enumerate(events) if j != i and o.get("emissionx_voyage_no") == leg
                    and str(o.get(_DEPARTURE) or "").strip()), key=lambda j: abs(j - i), default=None)
        if best is not None:
            ev[_DEPARTURE] = events[best][_DEPARTURE]


def _log_number(ev: dict) -> str:
    for k in ("log_number", "voyage_no", "emissionx_voyage_no"):
        v = ev.get(k)
        if v not in (None, ""):
            return _fmt_value(v)
    return "-"


def _report_type(ev: dict) -> str:
    return ev.get("_ev") or ev.get("log_type") or ev.get("event_type") or "-"


def render_events_html(columns: list, vessel: dict, n_events: int) -> str:
    """vessel: {"name", "rows": [event dicts, latest first]}; columns: events_mail_spec rows (tab, section,
    label). Laid out like the MariApps event sheet: Section | Parameter | one column per event (latest first),
    grouped under a band per tab. Table layout with inline styles only, so it renders in Outlook and on phones."""
    e = html.escape
    font = "font-family:Aptos,'Segoe UI',Calibri,Arial,sans-serif;"
    rows = vessel["rows"]
    ncols = len(rows) + 2
    th = f"padding:9px 8px;line-height:16px;border-bottom:2px solid #e2e8f0;{font}font-size:11px;font-weight:600;color:#1e293b;text-align:center;background:#f8fafc;"
    td = f"padding:8px 9px;line-height:18px;border-bottom:1px solid #e9edf3;{font}font-size:12px;color:#334155;text-align:center;word-break:break-word;"

    out = [f'<div style="background:#f1f5f9;padding:20px 8px;{font}">',
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:980px;margin:0 auto;">',
           '<tr><td bgcolor="#00904C" style="background:linear-gradient(135deg,#00904C,#007a40);padding:22px 26px;border-radius:10px 10px 0 0;border-bottom:4px solid #F15A29;">'
           '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#dcf3e6;">New Logbook Report</div>'
           f'<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">{e(vessel["name"])}</div>'
           f'<div style="font-size:12px;color:#eefaf3;margin-top:6px;">Last {n_events} logbook events &middot; latest first &middot; MariApps</div>'
           '</td></tr>',
           '<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:18px 18px 4px;">'
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">',
           f'<tr><th style="{th}text-align:left;min-width:100px;">Section</th><th style="{th}text-align:left;min-width:190px;">Parameter</th>']
    for i, ev in enumerate(rows):
        day, t, is_utc = _header_time(ev)
        tag = ('<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#F15A29;">Latest</div>'
               if i == 0 else "")
        out.append(f'<th style="{th}">{e(_fmt_day(day))}'
                   + (f'<div style="font-weight:400;font-size:10px;color:#00904C;">{t}{" UTC" if is_utc else ""}</div>' if t else "")
                   + tag + "</th>")
    out.append("</tr>")

    # tab -> section -> parameters, in sheet order
    tabs = []
    for c in columns:
        if not tabs or tabs[-1][0] != c["tab"]:
            tabs.append((c["tab"], []))
        secs = tabs[-1][1]
        if not secs or secs[-1][0] != c["section"]:
            secs.append((c["section"], []))
        secs[-1][1].append(c)

    for tab, secs in tabs:
        color, bg = _TAB_COLOR.get(tab, _TAB_DEFAULT)
        out.append(f'<tr><td colspan="{ncols}" bgcolor="{bg}" style="padding:9px 12px;background:{bg};color:{color};{font}'
                   f'font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;border-left:3px solid {color};">{e(tab)}</td></tr>')
        i = 0
        for section, cols in secs:
            for j, c in enumerate(cols):
                zebra = "#ffffff" if i % 2 == 0 else "#fafbfd"
                i += 1
                out.append("<tr>")
                if j == 0:
                    out.append(f'<td rowspan="{len(cols)}" valign="top" style="padding:8px 10px;border-bottom:1px solid #e9edf3;'
                               f'border-right:1px solid #eef1f6;background:#f8fafc;{font}font-size:11px;font-weight:700;color:#475569;'
                               f'text-align:left;">{e(section)}</td>')
                unit = f' <span style="font-weight:400;color:#94a3b8;font-size:10px;">{e(c["unit"])}</span>' if c.get("unit") else ""
                out.append(f'<td style="{td}text-align:left;font-weight:600;color:#1e293b;background:{zebra};">{e(c["display_name"])}{unit}</td>')
                for ev in rows:
                    val = _cell(ev, c)
                    out.append(f'<td style="{td}background:{zebra};{"color:#cbd5e1;" if val == "-" else ""}">{e(val)}</td>')
                out.append("</tr>")
    out.append("</table></td></tr>")
    out.append(f'<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:16px 26px;border-radius:0 0 10px 10px;{font}font-size:11px;color:#94a3b8;'
               'text-align:center;border-top:1px solid #e2e8f0;">Automated report from the Ozellar Report Tracker. All times UTC.</td></tr>')
    out.append("</table></div>")
    return "".join(out)


async def _graph_send(to: list, subject: str, body_html: str, cc: list | None = None) -> bool:
    s = settings
    if not all([s.AZURE_TENANT_ID, s.AZURE_CLIENT_ID, s.AZURE_CLIENT_SECRET, s.MAIL_FROM]):
        logger.error("[EVENTS-MAIL] Graph mail settings are missing; not sending.")
        return False
    async with httpx.AsyncClient(timeout=60.0) as client:
        tok = await client.post(
            f"https://login.microsoftonline.com/{s.AZURE_TENANT_ID}/oauth2/v2.0/token",
            data={"client_id": s.AZURE_CLIENT_ID, "client_secret": s.AZURE_CLIENT_SECRET,
                  "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials"},
        )
        if tok.status_code != 200:
            logger.error(f"[EVENTS-MAIL] Graph token request failed: {tok.text}")
            return False
        res = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{s.MAIL_FROM}/sendMail",
            headers={"Authorization": f"Bearer {tok.json()['access_token']}"},
            json={"message": {"subject": subject, "body": {"contentType": "HTML", "content": body_html},
                              "toRecipients": [{"emailAddress": {"address": a}} for a in to],
                              "ccRecipients": [{"emailAddress": {"address": a}} for a in (cc or [])]},
                  "saveToSentItems": "false"},
        )
    if res.status_code not in (200, 202):
        logger.error(f"[EVENTS-MAIL] sendMail failed ({res.status_code}): {res.text}")
        return False
    return True


def _emails(value: str) -> list:
    return [a.strip() for a in (value or "").split(",") if a.strip()]


async def _ensure_tables(db):
    """Create the mail tables if the app has not yet (e.g. the CLI runs before the service restarts), and on
    the very first run copy the old EVENTS_MAIL_OWNERS .env list into the recipients table once."""
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Base.metadata.create_all(
            c, tables=[EventsMailRecipient.__table__, EventsMailVessel.__table__, EventsMailSent.__table__]))
        await conn.execute(text("ALTER TABLE events_mail_recipient ADD COLUMN IF NOT EXISTS kind VARCHAR(2) NOT NULL DEFAULT 'to'"))
    empty = (await db.execute(text("SELECT count(*) FROM events_mail_recipient"))).scalar() == 0
    if empty and settings.EVENTS_MAIL_OWNERS.strip():
        try:
            for g in json.loads(settings.EVENTS_MAIL_OWNERS):
                for imo in g.get("vessels", []):
                    for email in g.get("emails", []):
                        db.add(EventsMailRecipient(vessel_imo=str(imo), email=email.strip().lower()))
            await db.commit()
            logger.info("[EVENTS-MAIL] Copied EVENTS_MAIL_OWNERS into the recipients table (managed in the UI from now on).")
        except Exception as e:
            await db.rollback()
            logger.error(f"[EVENTS-MAIL] Could not import EVENTS_MAIL_OWNERS: {e}")


# Vessels that do not report through MariApps (AMNS TUFMAX sends Excel/email noon reports), so this mail would
# be almost empty for them. They are never mailed.
NOT_ON_MARIAPPS = {"9486295"}


async def _vessel_targets(db, control_db, only_imo: str = "") -> dict:
    """{imo: {"name", "emails"}} for the vessels to check: active vessels that are switched on and have at
    least one recipient (the recipient list is edited on the Report Config > Event mails page)."""
    vessels = (await control_db.execute(
        text("SELECT imo, name FROM vessels WHERE is_active IS NOT FALSE ORDER BY name"))).fetchall()
    emails: dict = {}
    cc: dict = {}
    for imo, email, kind in (await db.execute(text(
            "SELECT vessel_imo, email, kind FROM events_mail_recipient ORDER BY email"))).fetchall():
        (cc if kind == "cc" else emails).setdefault(imo, []).append(email)
    off = {r[0] for r in (await db.execute(text("SELECT vessel_imo FROM events_mail_vessel WHERE enabled = false"))).fetchall()}
    return {imo: {"name": name, "emails": emails.get(imo, []), "cc": cc.get(imo, []), "enabled": imo not in off}
            for imo, name in vessels
            if imo not in NOT_ON_MARIAPPS and (not only_imo or imo == only_imo)}


def _event_id(ev: dict) -> str:
    """Stable identity of one logbook report. Built from the log number, not the timestamp (the UTC time
    can appear later and would make the same report look new)."""
    num, typ = ev.get("log_number"), _report_type(ev)
    if num not in (None, ""):
        return f"{num}|{typ}"
    return f"{ev['_ts'][:10]}|{typ}"


_MAX_MAILS_PER_VESSEL = 10  # per check; older unseen events beyond this are recorded without a mail


async def _seen_vessels(db) -> set:
    return {r[0] for r in (await db.execute(text("SELECT DISTINCT imo FROM events_mail_sent"))).fetchall()}


async def _claim(db, imo: str, event_id: str) -> bool:
    """Atomically mark the event as mailed. True only for the one process/run that gets to send it."""
    row = (await db.execute(text(
        "INSERT INTO events_mail_sent (imo, event_id) VALUES (:i, :e) ON CONFLICT DO NOTHING RETURNING event_id"),
        {"i": imo, "e": event_id})).first()
    await db.commit()
    return row is not None


async def _release(db, imo: str, event_id: str):
    await db.execute(text("DELETE FROM events_mail_sent WHERE imo = :i AND event_id = :e"), {"i": imo, "e": event_id})
    await db.commit()


# "raw:Section/Key" candidates of the spec: values the expanded table does not carry, read from the raw report
RAW_KEYS = sorted({k for c in MAIL_COLUMNS for k in c["candidates"] if k.startswith("raw:")})


async def _fill_raw(db, events: list, cache: dict):
    """Add the RAW_KEYS values to each event (looked up by its raw_log_id = raw_mariapps_logs.id). A failure
    only leaves those rows empty; the mail still goes out."""
    if not RAW_KEYS:
        return
    need = sorted({int(ev["raw_log_id"]) for ev in events if ev.get("raw_log_id") and int(ev["raw_log_id"]) not in cache})
    if need:
        try:
            sel = ", ".join(f"raw_json #>> CAST(:p{i} AS text[]) AS v{i}" for i in range(len(RAW_KEYS)))
            params = {f"p{i}": k[4:].split("/", 1) for i, k in enumerate(RAW_KEYS)}
            res = await db.execute(text(f"SELECT id, {sel} FROM raw_mariapps_logs WHERE id = ANY(:ids)"),
                                   {**params, "ids": need})
            for row in res.fetchall():
                cache[row[0]] = {k: row[1 + i] for i, k in enumerate(RAW_KEYS)}
        except Exception as e:
            logger.warning(f"[EVENTS-MAIL] Could not read the raw report values: {e}")
            await db.rollback()
        for i in need:
            cache.setdefault(i, {})
    for ev in events:
        if ev.get("raw_log_id"):
            ev.update(cache.get(int(ev["raw_log_id"]), {}))


async def send_new_event_mails(test_to: str = "", dry_run: bool = False, force: bool = False,
                               end_date: date_type | None = None, only_imo: str = "") -> dict:
    """Send one mail for every logbook report that has not been mailed yet, oldest first, each showing the
    last N events up to that report. Every mailed report is recorded (events_mail_sent) BEFORE sending, so
    several workers or overlapping checks can never send the same report twice; a failed send releases the
    record so the next check retries. The first time a vessel is seen its current reports are only recorded
    (no mail), so enabling this never blasts old reports. `test_to` (or EVENTS_MAIL_TEST_TO), `dry_run` and
    `force` send each vessel's latest report only and never touch the record."""
    if VesselPerfSession is None:
        logger.error("[EVENTS-MAIL] VESSEL_PERF_DATABASE_URL is not configured.")
        return {"sent": 0, "error": "vessel_perf not configured"}
    test_to = test_to or settings.EVENTS_MAIL_TEST_TO
    n = settings.EVENTS_MAIL_EVENTS
    today = end_date or date_type.today()
    track = not (test_to or dry_run or force)

    sent, previews = 0, []
    async with SessionLocal() as state_db, ControlSession() as control_db, VesselPerfSession() as perf_db:
        await _ensure_tables(state_db)
        vessels = await _vessel_targets(state_db, control_db, only_imo)
        if test_to:  # test: any vessel, only the test address receives it
            for v in vessels.values():
                v["emails"], v["cc"] = _emails(test_to), []
        else:
            vessels = {k: v for k, v in vessels.items() if v["emails"] and v["enabled"]}
        if not vessels:
            return {"sent": 0, "mails": 0, "previews": []}
        seen = await _seen_vessels(state_db) if track else set()
        # Ask for plenty of events: days with no report come back as "missing" entries, dropped below.
        data = await build_logbook(perf_db, SOURCE, 60, 0, today, None, columns_override=MAIL_COLUMNS)
        if data.get("missing_columns"):
            logger.warning(f"[EVENTS-MAIL] Columns not in the logbook table, skipped: {', '.join(data['missing_columns'])}")
        by_imo = {v["imo"]: [r for r in v["rows"] if not r.get("_missing")] for v in data["vessels"]}
        for evs in by_imo.values():
            _carry_departure_port(evs)
        raw_cache: dict = {}

        for imo, info in vessels.items():
            real = by_imo.get(imo)
            if not real:
                continue
            if track:
                if imo not in seen:  # first sight: remember what exists, mail nothing
                    for ev in real:
                        await _claim(state_db, imo, _event_id(ev))
                    logger.info(f"[EVENTS-MAIL] {info['name']}: baseline recorded ({len(real)} reports), no mail.")
                    continue
                todo = [i for i, ev in enumerate(real) if await _claim(state_db, imo, _event_id(ev))]
                for i in todo[:-_MAX_MAILS_PER_VESSEL]:
                    logger.warning(f"[EVENTS-MAIL] {info['name']}: too many new reports, skipping mail for {_event_id(real[i])}.")
                todo = todo[-_MAX_MAILS_PER_VESSEL:]
            else:
                todo = [len(real) - 1]

            for i in todo:  # oldest first
                ev = real[i]
                rows = list(reversed(real[max(0, i - n + 1):i + 1]))  # latest first
                await _fill_raw(perf_db, rows, raw_cache)
                day = date_type.fromisoformat(ev["_ts"][:10]).strftime("%d %b %Y")
                subject = (f"{'[TEST] ' if test_to else ''}{info['name']} - {_log_number(ev)} - "
                           f"{_report_type(ev)} - {day}")
                body = render_events_html(data["columns"], {"name": info["name"], "rows": rows}, n)
                previews.append((subject, body))
                if dry_run:
                    continue
                if await _graph_send(info["emails"], subject, body, info["cc"]):
                    sent += 1
                    logger.info(f"[EVENTS-MAIL] Sent '{subject}' to {', '.join(info['emails'])}"
                                + (f", cc {', '.join(info['cc'])}." if info["cc"] else "."))
                elif track:
                    await _release(state_db, imo, _event_id(ev))  # retry on the next check
    return {"sent": sent, "mails": len(previews), "previews": previews}


async def start_background_events_mail(interval_minutes: int = 15):
    """Poll for new logbook events and mail owners (shore only; started from the app lifespan)."""
    logger.info(f"[EVENTS-MAIL] Watching for new logbook events every {interval_minutes} minutes.")
    await asyncio.sleep(60)
    while True:
        try:
            res = await send_new_event_mails()
            if res.get("sent"):
                logger.info(f"[EVENTS-MAIL] {res['sent']} mail(s) sent.")
        except Exception as e:
            logger.error(f"[EVENTS-MAIL] Poll failed: {e}", exc_info=True)
        await asyncio.sleep(interval_minutes * 60)
