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
_SECTION_COLOR = {"Log Info": "#F15A29", "Performance": "#00904C", "Emission": "#475569"}
_SECTION_BG = {"Log Info": "#fff3ee", "Performance": "#e8f6ef", "Emission": "#f1f5f9"}
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


def render_events_html(title: str, columns: list, vessels: list, n_events: int, as_of: date_type | None = None) -> str:
    """vessels: [{"name", "imo", "rows": [event dicts, oldest first]}]. One card per vessel, events across,
    logbook columns down. Table layout with inline styles only, so it renders in Outlook and on phones."""
    e = html.escape
    font = "font-family:Aptos,'Segoe UI',Calibri,Arial,sans-serif;"
    as_of = as_of or date_type.today()
    total_missing = sum(1 for v in vessels for ev in v["rows"] if ev.get("_missing"))
    total_events = sum(len(v["rows"]) for v in vessels)

    def stat(label, value, color):
        return (f'<td align="center" style="padding:10px 6px;{font}">'
                f'<div style="font-size:22px;font-weight:700;color:{color};">{value}</div>'
                f'<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">{label}</div></td>')

    out = [f'<div style="background:#f1f5f9;padding:20px 8px;{font}">',
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:860px;margin:0 auto;">',
           # banner
           '<tr><td bgcolor="#F15A29" style="background:linear-gradient(135deg,#F15A29,#d9460f);padding:22px 26px;border-radius:10px 10px 0 0;border-bottom:4px solid #00904C;">'
           f'<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ffe4d9;">Daily Logbook Digest</div>'
           f'<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">{e(title)}</div>'
           f'<div style="font-size:12px;color:#fff1ea;margin-top:6px;">Last {n_events} logbook events per vessel &middot; MariApps &middot; as of {as_of.strftime("%d %b %Y")}</div>'
           '</td></tr>',
           # summary strip
           '<tr><td bgcolor="#ffffff" style="background:#ffffff;border-bottom:1px solid #e2e8f0;">'
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
           + stat("Vessels", len(vessels), "#F15A29") + stat("Events", total_events, "#0f172a")
           + stat("Missing reports", total_missing, "#b91c1c" if total_missing else "#00904C")
           + '</tr></table></td></tr>']

    th = f"padding:10px 8px;line-height:16px;border-bottom:2px solid #e2e8f0;{font}font-size:11px;font-weight:600;color:#1e293b;text-align:center;background:#f8fafc;"
    td = f"padding:11px 10px;line-height:20px;border-bottom:1px solid #e9edf3;{font}font-size:13px;color:#334155;text-align:center;white-space:nowrap;"

    for v in vessels:
        missing = sum(1 for ev in v["rows"] if ev.get("_missing"))
        badge = (f'<span style="background:#fee2e2;color:#b91c1c;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;">{missing} missing</span>'
                 if missing else
                 '<span style="background:#e3f5ec;color:#00904C;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;">All reported</span>')
        out.append('<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:18px 18px 4px;">'
                   '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">'
                   f'<tr><td colspan="{len(v["rows"]) + 1}" bgcolor="#fff3ee" style="background:#fff3ee;padding:11px 14px;border-bottom:1px solid #fcd9cb;">'
                   '<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>'
                   f'<td style="{font}font-size:15px;font-weight:700;color:#3b1d10;">{e(v["name"])}'
                   f'<span style="font-size:11px;font-weight:400;color:#64748b;margin-left:8px;">IMO {e(v["imo"])}</span></td>'
                   f'<td align="right">{badge}</td></tr></table></td></tr>')
        # date header
        out.append(f'<tr><th style="{th}text-align:left;min-width:170px;">Logbook column</th>')
        for ev in v["rows"]:
            ts = ev["_ts"]
            if ev.get("_missing"):
                out.append(f'<th style="{th}background:#fef2f2;color:#b91c1c;">{e(_fmt_day(ts))}'
                           '<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;">Missing</div></th>')
            else:
                t = _fmt_time(ts)
                out.append(f'<th style="{th}">{e(_fmt_day(ts))}'
                           + (f'<div style="font-weight:400;font-size:10px;color:#F15A29;">{t} UTC</div>' if t else "") + "</th>")
        out.append("</tr>")
        for sec in ("Log Info", "Performance", "Emission"):
            cols = [c for c in columns if c["category"] == sec]
            if not cols:
                continue
            out.append(f'<tr><td colspan="{len(v["rows"]) + 1}" bgcolor="{_SECTION_BG[sec]}" style="padding:10px 12px;background:{_SECTION_BG[sec]};'
                       f'color:{_SECTION_COLOR[sec]};{font}font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;'
                       f'border-left:3px solid {_SECTION_COLOR[sec]};">{e(sec)}</td></tr>')
            for i, c in enumerate(cols):
                zebra = "#ffffff" if i % 2 == 0 else "#fafbfd"
                unit = f' <span style="font-weight:400;color:#94a3b8;font-size:10px;">{e(c["unit"])}</span>' if c.get("unit") else ""
                out.append(f'<tr><td style="{td}text-align:left;font-weight:600;color:#1e293b;background:{zebra};">{e(c["display_name"])}{unit}</td>')
                for ev in v["rows"]:
                    if ev.get("_missing"):
                        out.append(f'<td style="{td}background:#fff5f5;color:#f3b4b4;">&ndash;</td>')
                        continue
                    val = _fmt_value(ev.get(c["db_column"]))
                    out.append(f'<td style="{td}background:{zebra};{"color:#cbd5e1;" if val == "-" else ""}">{e(val)}</td>')
                out.append("</tr>")
        out.append("</table></td></tr>")

    out.append(f'<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:16px 26px;border-radius:0 0 10px 10px;{font}font-size:11px;color:#94a3b8;'
               'text-align:center;border-top:1px solid #e2e8f0;">Automated report from the Ozellar Report Tracker. '
               'A day without a logbook report is flagged <b style="color:#b91c1c;">Missing</b>. All times UTC.</td></tr>')
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
            body = render_events_html(title, data["columns"], vessels, n, today)
            to = _emails(test_to) if test_to else g["emails"]
            subject = f"{'[TEST] ' if test_to else ''}Daily vessel events - {g['owner']} - {today.strftime('%d %b %Y')}"
            previews.append((subject, body))
            if dry_run:
                continue
            if await _graph_send(to, subject, body):
                sent += 1
                logger.info(f"[EVENTS-MAIL] Sent '{subject}' to {', '.join(to)} ({len(vessels)} vessels).")
    return {"sent": sent, "mails": len(groups), "previews": previews}
