# app/services/events_mail_service.py
# Mail to vessel owners whenever a vessel's newest logbook event changes: that vessel's last N events,
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
from app.core.config import settings
from app.core.database import SessionLocal
from app.core.database_control import ControlSession
from app.core.database_vessel_perf import VesselPerfSession

logger = logging.getLogger(__name__)

SOURCE = "mari_apps"
_SECTION_COLOR = {"Log Info": "#00904C", "Performance": "#F15A29", "Emission": "#475569"}
_SECTION_BG = {"Log Info": "#e8f6ef", "Performance": "#fff3ee", "Emission": "#f1f5f9"}
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


def _log_number(ev: dict) -> str:
    for k in ("log_number", "voyage_no", "emissionx_voyage_no"):
        v = ev.get(k)
        if v not in (None, ""):
            return _fmt_value(v)
    return "-"


def _report_type(ev: dict) -> str:
    return ev.get("_ev") or ev.get("log_type") or ev.get("event_type") or "-"


def render_events_html(columns: list, vessel: dict, n_events: int) -> str:
    """vessel: {"name", "rows": [event dicts, latest first]}. One mail per vessel: events across (latest
    first), logbook columns down. Table layout with inline styles only, so it renders in Outlook and on phones."""
    e = html.escape
    font = "font-family:Aptos,'Segoe UI',Calibri,Arial,sans-serif;"
    rows = vessel["rows"]
    th = f"padding:10px 8px;line-height:16px;border-bottom:2px solid #e2e8f0;{font}font-size:11px;font-weight:600;color:#1e293b;text-align:center;background:#f8fafc;"
    td = f"padding:11px 10px;line-height:20px;border-bottom:1px solid #e9edf3;{font}font-size:13px;color:#334155;text-align:center;white-space:nowrap;"

    out = [f'<div style="background:#f1f5f9;padding:20px 8px;{font}">',
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:860px;margin:0 auto;">',
           '<tr><td bgcolor="#00904C" style="background:linear-gradient(135deg,#00904C,#007a40);padding:22px 26px;border-radius:10px 10px 0 0;border-bottom:4px solid #F15A29;">'
           '<div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#dcf3e6;">New Logbook Report</div>'
           f'<div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">{e(vessel["name"])}</div>'
           f'<div style="font-size:12px;color:#eefaf3;margin-top:6px;">Last {n_events} logbook events &middot; latest first &middot; MariApps</div>'
           '</td></tr>',
           '<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:18px 18px 4px;">'
           '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">',
           f'<tr><th style="{th}text-align:left;min-width:170px;">Logbook column</th>']
    for i, ev in enumerate(rows):
        ts = ev["_ts"]
        t = _fmt_time(ts)
        tag = ('<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;font-weight:700;color:#F15A29;">Latest</div>'
               if i == 0 else "")
        out.append(f'<th style="{th}">{e(_fmt_day(ts))}'
                   + (f'<div style="font-weight:400;font-size:10px;color:#00904C;">{t} UTC</div>' if t else "") + tag + "</th>")
    out.append("</tr>")
    for sec in ("Log Info", "Performance", "Emission"):
        cols = [c for c in columns if c["category"] == sec]
        if not cols:
            continue
        out.append(f'<tr><td colspan="{len(rows) + 1}" bgcolor="{_SECTION_BG[sec]}" style="padding:10px 12px;background:{_SECTION_BG[sec]};'
                   f'color:{_SECTION_COLOR[sec]};{font}font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;'
                   f'border-left:3px solid {_SECTION_COLOR[sec]};">{e(sec)}</td></tr>')
        for i, c in enumerate(cols):
            zebra = "#ffffff" if i % 2 == 0 else "#fafbfd"
            unit = f' <span style="font-weight:400;color:#94a3b8;font-size:10px;">{e(c["unit"])}</span>' if c.get("unit") else ""
            out.append(f'<tr><td style="{td}text-align:left;font-weight:600;color:#1e293b;background:{zebra};">{e(c["display_name"])}{unit}</td>')
            for ev in rows:
                val = _fmt_value(ev.get(c["db_column"]))
                out.append(f'<td style="{td}background:{zebra};{"color:#cbd5e1;" if val == "-" else ""}">{e(val)}</td>')
            out.append("</tr>")
    out.append("</table></td></tr>")
    out.append(f'<tr><td bgcolor="#ffffff" style="background:#ffffff;padding:16px 26px;border-radius:0 0 10px 10px;{font}font-size:11px;color:#94a3b8;'
               'text-align:center;border-top:1px solid #e2e8f0;">Automated report from the Ozellar Report Tracker. All times UTC.</td></tr>')
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


async def _load_state(db) -> dict:
    await db.execute(text(
        "CREATE TABLE IF NOT EXISTS events_mail_state ("
        "imo TEXT PRIMARY KEY, last_key TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"))
    await db.commit()
    return {r[0]: r[1] for r in (await db.execute(text("SELECT imo, last_key FROM events_mail_state"))).fetchall()}


async def _save_state(db, imo: str, key: str):
    await db.execute(text(
        "INSERT INTO events_mail_state (imo, last_key) VALUES (:i, :k) "
        "ON CONFLICT (imo) DO UPDATE SET last_key = :k, updated_at = now()"), {"i": imo, "k": key})
    await db.commit()


async def send_new_event_mails(test_to: str = "", dry_run: bool = False, force: bool = False,
                               end_date: date_type | None = None) -> dict:
    """Send one mail per vessel whose newest logbook event is new since the last mail. The first time a
    vessel is seen its current newest event is only recorded (no mail), so enabling this never blasts old
    reports. `test_to` (or EVENTS_MAIL_TEST_TO), `dry_run` and `force` ignore and never touch that state."""
    if VesselPerfSession is None:
        logger.error("[EVENTS-MAIL] VESSEL_PERF_DATABASE_URL is not configured.")
        return {"sent": 0, "error": "vessel_perf not configured"}
    test_to = test_to or settings.EVENTS_MAIL_TEST_TO
    n = settings.EVENTS_MAIL_EVENTS
    today = end_date or date_type.today()
    track = not (test_to or dry_run or force)

    async with ControlSession() as control_db:
        groups = await _owner_groups(control_db)
    if not test_to:
        groups = [g for g in groups if g["emails"]]
    if not groups:
        return {"sent": 0, "mails": 0, "previews": []}

    sent, previews = 0, []
    async with SessionLocal() as state_db, VesselPerfSession() as perf_db:
        state = await _load_state(state_db) if track else {}
        # Ask for plenty of events: days with no report come back as "missing" entries, dropped below.
        data = await build_logbook(perf_db, SOURCE, 60, 0, today, None)
        by_imo = {v["imo"]: [r for r in v["rows"] if not r.get("_missing")] for v in data["vessels"]}

        done = {}  # imo -> key, for vessels a mail went out for
        for g in groups:
            for v in g["vessels"]:
                real = by_imo.get(v["imo"])
                if not real:
                    continue
                latest = real[-1]
                key = f"{latest['_ts']}|{latest.get('_ev')}"
                if track:
                    if v["imo"] not in state:
                        await _save_state(state_db, v["imo"], key)
                        state[v["imo"]] = key
                        logger.info(f"[EVENTS-MAIL] {v['name']}: baseline recorded, no mail.")
                        continue
                    if state[v["imo"]] == key:
                        continue
                rows = list(reversed(real[-n:]))  # latest first
                day = date_type.fromisoformat(latest["_ts"][:10]).strftime("%d %b %Y")
                subject = (f"{'[TEST] ' if test_to else ''}{v['name']} - {_log_number(latest)} - "
                           f"{_report_type(latest)} - {day}")
                body = render_events_html(data["columns"], {"name": v["name"], "rows": rows}, n)
                previews.append((subject, body))
                if dry_run:
                    continue
                to = _emails(test_to) if test_to else g["emails"]
                if await _graph_send(to, subject, body):
                    sent += 1
                    done[v["imo"]] = key
                    logger.info(f"[EVENTS-MAIL] Sent '{subject}' to {', '.join(to)}.")
        if track:
            for imo, key in done.items():
                await _save_state(state_db, imo, key)
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
