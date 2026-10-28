# app/services/events_mail_service.py
# Daily mail to vessel owners: each vessel's last N logbook events, laid out like the Overview
# "Events" tab (vessels across, logbook columns down). Sent through Microsoft Graph, like mail_service.py.
import html
import json
import logging
import re
from datetime import date as date_type

import httpx
from sqlalchemy import text

from app.api.v1.endpoints.events import _timeline, build_logbook
from app.core.config import settings
from app.core.database_control import ControlSession
from app.core.database_vessel_perf import VesselPerfSession

logger = logging.getLogger(__name__)

SOURCE = "mari_apps"
_SECTION_COLOR = {"Log Info": "#4f46e5", "Performance": "#d97706", "Emission": "#059669"}
_SECTION_BG = {"Log Info": "#f2f4ff", "Performance": "#fff8eb", "Emission": "#effaf4"}
_NUM = re.compile(r"^-?\d+(\.\d+)?$")


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


def render_events_html(title: str, columns: list, vessels: list, n_events: int) -> str:
    """vessels: [{"name", "imo", "rows": [event dicts, oldest first]}]. Vessels across, columns down."""
    e = html.escape
    th = "padding:6px 8px;border:1px solid #e2e6ef;background:#f8fafc;font:600 12px Segoe UI,Arial,sans-serif;color:#1e293b;text-align:center;"
    td = "padding:5px 8px;border:1px solid #eef0f6;font:12px Segoe UI,Arial,sans-serif;color:#334155;text-align:center;white-space:nowrap;"
    sticky = "text-align:left;white-space:nowrap;background:#ffffff;font-weight:600;color:#1e293b;"

    total = len(vessels) * n_events
    out = [f'<div style="font:14px Segoe UI,Arial,sans-serif;color:#0f172a;"><h2 style="margin:0 0 4px">{e(title)}</h2>',
           f'<p style="margin:0 0 14px;color:#64748b;font-size:12px">Last {n_events} logbook events per vessel (MariApps). '
           'A day without a report is shown as <b style="color:#b91c1c">Missing</b>.</p>',
           '<table cellspacing="0" cellpadding="0" style="border-collapse:collapse;">']

    # header row 1: vessel names
    out.append(f'<tr><th rowspan="2" style="{th}text-align:left;min-width:190px;">Logbook Column</th>')
    for v in vessels:
        out.append(f'<th colspan="{n_events}" style="{th}background:#eef0ff;font-size:13px;">{e(v["name"])}'
                   f'<div style="font-weight:400;font-size:10px;color:#64748b">IMO {e(v["imo"])}</div></th>')
    out.append("</tr><tr>")
    # header row 2: date (+ time) / Missing per event
    for v in vessels:
        for ev in v["rows"]:
            ts = ev["_ts"]
            if ev.get("_missing"):
                out.append(f'<th style="{th}background:#fff1f1;color:#b91c1c;">{e(_fmt_day(ts))}'
                           '<div style="font-size:9px;letter-spacing:.05em;text-transform:uppercase">Missing</div></th>')
            else:
                t = _fmt_time(ts)
                out.append(f'<th style="{th}">{e(_fmt_day(ts))}'
                           + (f'<div style="font-weight:400;font-size:10px;color:#4338ca">{t} UTC</div>' if t else "")
                           + "</th>")
    out.append("</tr>")

    for sec in ("Log Info", "Performance", "Emission"):
        cols = [c for c in columns if c["category"] == sec]
        if not cols:
            continue
        out.append(f'<tr><td colspan="{total + 1}" style="padding:6px 8px;background:{_SECTION_BG[sec]};'
                   f'color:{_SECTION_COLOR[sec]};font:700 11px Segoe UI,Arial,sans-serif;letter-spacing:.06em;'
                   f'text-transform:uppercase;border:1px solid #eef0f6;">{e(sec)}</td></tr>')
        for c in cols:
            unit = f' <span style="font-weight:400;color:#94a3b8;font-size:10px">{e(c["unit"])}</span>' if c.get("unit") else ""
            out.append(f'<tr><td style="{td}{sticky}">{e(c["display_name"])}{unit}</td>')
            for v in vessels:
                for ev in v["rows"]:
                    if ev.get("_missing"):
                        out.append(f'<td style="{td}background:#fff5f5;color:#f3b4b4;">-</td>')
                        continue
                    val = _fmt_value(ev.get(c["db_column"]))
                    out.append(f'<td style="{td}{"color:#cbd5e1;" if val == "-" else ""}">{e(val)}</td>')
            out.append("</tr>")
    out.append("</table></div>")
    return "".join(out)


async def _graph_send(to: list, subject: str, body_html: str) -> bool:
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
                              "toRecipients": [{"emailAddress": {"address": a}} for a in to]},
                  "saveToSentItems": "false"},
        )
    if res.status_code not in (200, 202):
        logger.error(f"[EVENTS-MAIL] sendMail failed ({res.status_code}): {res.text}")
        return False
    return True


def _emails(value: str) -> list:
    return [a.strip() for a in (value or "").split(",") if a.strip()]


async def _owner_groups(control_db) -> list:
    """[{owner, emails, vessels: [{imo, name}]}] from EVENTS_MAIL_OWNERS (JSON); with none configured,
    one group holding every active vessel (only used together with EVENTS_MAIL_TEST_TO)."""
    rows = (await control_db.execute(
        text("SELECT imo, name FROM vessels WHERE is_active IS NOT FALSE ORDER BY name")
    )).mappings().fetchall()
    by_imo = {r["imo"]: {"imo": r["imo"], "name": r["name"]} for r in rows}
    cfg = json.loads(settings.EVENTS_MAIL_OWNERS) if settings.EVENTS_MAIL_OWNERS.strip() else []
    if not cfg:
        return [{"owner": "All vessels", "emails": [], "vessels": list(by_imo.values())}]
    groups = []
    for g in cfg:
        vs = [by_imo[i] for i in g.get("vessels", []) if i in by_imo]
        if vs and g.get("emails"):
            groups.append({"owner": g.get("owner", ""), "emails": g["emails"], "vessels": vs})
    return groups


async def send_daily_events_mail(test_to: str = "", max_vessels: int = 0, dry_run: bool = False,
                                 end_date: date_type | None = None) -> dict:
    """Build and send one mail per owner group. `test_to` (or EVENTS_MAIL_TEST_TO) redirects every mail
    to that address; `max_vessels` limits vessels per mail (keeps test mails readable)."""
    if VesselPerfSession is None:
        logger.error("[EVENTS-MAIL] VESSEL_PERF_DATABASE_URL is not configured.")
        return {"sent": 0, "error": "vessel_perf not configured"}
    test_to = test_to or settings.EVENTS_MAIL_TEST_TO
    n = settings.EVENTS_MAIL_EVENTS
    today = end_date or date_type.today()

    async with ControlSession() as control_db:
        groups = await _owner_groups(control_db)
    if not test_to:
        groups = [g for g in groups if g["emails"]]

    sent, previews = 0, []
    async with VesselPerfSession() as perf_db:
        data = await build_logbook(perf_db, SOURCE, n, 0, today, None)
        by_imo = {v["imo"]: v["rows"] for v in data["vessels"]}
        for g in groups:
            vessels = []
            for v in g["vessels"]:
                rows = by_imo.get(v["imo"]) or _timeline({}, today, n, 0)
                vessels.append({"name": v["name"], "imo": v["imo"], "rows": rows})
            if max_vessels:
                vessels = vessels[:max_vessels]
            title = f"Vessel Logbook Events - {g['owner']}" if g["owner"] else "Vessel Logbook Events"
            body = render_events_html(title, data["columns"], vessels, n)
            to = _emails(test_to) if test_to else g["emails"]
            subject = f"{'[TEST] ' if test_to else ''}Daily vessel events - {g['owner']} - {today.strftime('%d %b %Y')}"
            previews.append((subject, body))
            if dry_run:
                continue
            if await _graph_send(to, subject, body):
                sent += 1
                logger.info(f"[EVENTS-MAIL] Sent '{subject}' to {', '.join(to)} ({len(vessels)} vessels).")
    return {"sent": sent, "mails": len(groups), "previews": previews}
