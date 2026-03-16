# automation/pull_service.py
import asyncio
import re
import uuid
from datetime import datetime, timedelta
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from db.database import SessionLocal
from models.schema import Ticket, Comment
from automation.playwright_service import get_jira_service
from automation.status_map import detect_vessel_from_text, extract_reference_num


def _parse_jira_date(date_str: str) -> datetime | None:
    if not date_str:
        return None
    s = date_str.strip()
    IST_OFFSET = timedelta(hours=5, minutes=30)
    now_utc = datetime.utcnow()
    now_ist = now_utc + IST_OFFSET

    def ist_to_utc(dt): return dt - IST_OFFSET

    if s.lower() == "today":
        return ist_to_utc(datetime(now_ist.year, now_ist.month, now_ist.day, 12, 0))
    if s.lower() == "yesterday":
        return ist_to_utc(datetime(now_ist.year, now_ist.month, now_ist.day, 12, 0) - timedelta(days=1))

    m = re.match(r'^(Today|Yesterday)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
    if m:
        label = m.group(1).lower()
        h, mi = int(m.group(2)), int(m.group(3))
        ap = m.group(4).upper()
        if ap == "PM" and h < 12: h += 12
        if ap == "AM" and h == 12: h = 0
        base = datetime(now_ist.year, now_ist.month, now_ist.day)
        if label == "yesterday": base -= timedelta(days=1)
        return ist_to_utc(base.replace(hour=h, minute=mi))

    m = re.match(r"^(\d{1,2})[\s/]+([A-Za-z]+)[\s/]+(\d{2,4})$", s)
    if m:
        months = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}
        mn = months.get(m.group(2).lower()[:3]); yr = int(m.group(3))
        if yr < 100: yr += 2000
        if mn: return ist_to_utc(datetime(yr, mn, int(m.group(1)), 12, 0))

    m = re.match(r'^(\d{1,2})/([A-Za-z]+)/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
    if m:
        months = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}
        h, mi = int(m.group(4)), int(m.group(5)); ap = m.group(6).upper()
        if ap == "PM" and h < 12: h += 12
        if ap == "AM" and h == 12: h = 0
        mn = months.get(m.group(2).lower()[:3]); yr = int(m.group(3))
        if yr < 100: yr += 2000
        if mn: return ist_to_utc(datetime(yr, mn, int(m.group(1)), h, mi))

    m = re.match(r'^(\d{1,2})\s+([A-Za-z]+)\s+(\d{2,4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
    if m:
        months = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}
        h, mi = int(m.group(4)), int(m.group(5)); ap = m.group(6).upper()
        if ap == "PM" and h < 12: h += 12
        if ap == "AM" and h == 12: h = 0
        mn = months.get(m.group(2).lower()[:3]); yr = int(m.group(3))
        if yr < 100: yr += 2000
        if mn: return datetime(yr, mn, int(m.group(1)), h, mi)

    m = re.match(r'^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4}),?\s+(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
    if m:
        months = {"jan":1,"feb":2,"mar":3,"apr":4,"may":5,"jun":6,"jul":7,"aug":8,"sep":9,"oct":10,"nov":11,"dec":12}
        mn = months.get(m.group(1).lower()[:3]); h, mi = int(m.group(4)), int(m.group(5))
        ap = m.group(6).upper()
        if ap == "PM" and h < 12: h += 12
        if ap == "AM" and h == 12: h = 0
        if mn: return datetime(int(m.group(3)), mn, int(m.group(2)), h, mi)

    m = re.match(r'^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2}):(\d{2})\s*(AM|PM)$', s, re.IGNORECASE)
    if m:
        days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"]
        target = days.index(m.group(1).lower())
        h, mi = int(m.group(2)), int(m.group(3)); ap = m.group(4).upper()
        if ap == "PM" and h < 12: h += 12
        if ap == "AM" and h == 12: h = 0
        base = datetime(now_ist.year, now_ist.month, now_ist.day)
        diff = (now_ist.weekday() - target) % 7
        return ist_to_utc((base - timedelta(days=diff)).replace(hour=h, minute=mi))

    try:
        if len(s) > 5 and s[-5] in ('+','-') and s[-4:].isdigit(): s = s[:-2]+':'+s[-2:]
        s = s.replace('Z', '+00:00')
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is not None:
            from datetime import timezone
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception as e:
        print(f"[SYNC] Date parse failed '{date_str}': {e}")
        return None


def _needs_detail_fetch(existing, jira_item: dict, full_sync: bool) -> tuple[bool, str]:
    if full_sync: return True, "full_sync"
    if existing is None: return True, "new_ticket"
    if not existing.detailFetchedAt: return True, "never_fetched"
    if (existing.jiraStatus or "").strip().lower() != (jira_item.get("status") or "").strip().lower():
        return True, "status_changed"
    jira_upd = _parse_jira_date(jira_item.get("updatedAt") or "")
    if jira_upd and existing.jiraUpdatedAt and jira_upd > existing.jiraUpdatedAt:
        return True, "jira_updated_newer"
    return False, "no_changes"


def _build_final_comments(raw_jira: list, portal_comments: list) -> list[dict]:
    jira = []
    for c in raw_jira:
        author = (c.get("author") or "Jira User").strip()
        msg = (c.get("message") or "").strip()
        if not msg or author.lower() in ("automatic response", "system"): continue
        jira.append({
            "author": author, "message": msg,
            "createdAt": _parse_jira_date(c.get("createdAt") or "") or datetime.utcnow(),
            "images": c.get("images", []), "source": "jira",
        })
    portal = [
        {"id": c.id, "author": c.author, "message": c.message,
         "createdAt": c.createdAt, "images": c.images or [], "source": "portal"}
        for c in portal_comments if c.source == "portal"
    ]
    return jira + portal


async def pull_jira_updates(full_sync: bool = False) -> dict:
    service = get_jira_service()
    mode = "FULL" if full_sync else "INCREMENTAL"
    now = datetime.utcnow()
    print(f"[SYNC] {mode} sync at {now:%H:%M:%S UTC}")

    jira_tickets = service.scrape_all_tickets()
    total = len(jira_tickets)
    print(f"[SYNC] Got {total} tickets from Jira")

    all_refs = [jt.get("reference", "").strip() for jt in jira_tickets if jt.get("reference")]
    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Ticket).options(selectinload(Ticket.comments)).where(Ticket.reference.in_(all_refs))
        )).scalars().all()
    existing_map = {t.reference: t for t in rows}
    print(f"[SYNC] Found {len(existing_map)} existing in PostgreSQL")

    needs_detail, skip_list = [], []
    for idx, jt in enumerate(jira_tickets):
        ref = jt.get("reference", "").strip()
        if not ref: continue
        fetch, reason = _needs_detail_fetch(existing_map.get(ref), jt, full_sync)
        (needs_detail if fetch else skip_list).append((idx, jt, existing_map.get(ref), reason))

    print(f"[SYNC] Detail fetch: {len(needs_detail)} | Skip: {len(skip_list)}")

    detail_map = {}
    if needs_detail:
        detail_map = await asyncio.to_thread(service.fetch_all_details_sync, needs_detail)
        if detail_map is None:
            raise RuntimeError("fetch_all_details_sync returned None -- browser thread crashed.")

    updated = created = skipped = 0
    errors = []
    now = datetime.utcnow()

    for idx, jt in enumerate(jira_tickets):
        ref = jt.get("reference", "").strip()
        if not ref: skipped += 1; continue
        jira_status = jt.get("status", "").strip()
        summary     = jt.get("summary", "").strip()
        created_at  = _parse_jira_date(jt.get("createdAt"))
        updated_at  = _parse_jira_date(jt.get("updatedAt"))
        list_rt     = jt.get("requestType") or ""
        existing    = existing_map.get(ref)
        vessel_name = await detect_vessel_from_text(summary) or await detect_vessel_from_text(list_rt)
        clean_summary = re.sub(
            rf"^{re.escape(vessel_name or '')}\s*[-:]\s*", "", summary, flags=re.IGNORECASE
        ).strip() if vessel_name else summary
        detail = detail_map.get(ref)
        new_comments_data = None
        if detail is not None:
            portal = [c for c in (existing.comments if existing else []) if c.source == "portal"]
            new_comments_data = _build_final_comments(detail.get("comments", []), portal)
        try:
            async with SessionLocal() as session:
                if existing:
                    t = (await session.execute(
                        select(Ticket).options(selectinload(Ticket.comments)).where(Ticket.reference == ref)
                    )).scalar_one()
                    t.jiraStatus = jira_status; t.jiraUrl = jt.get("url", ""); t.jiraSortOrder = idx
                    t.lastSyncedAt = now; t.updatedAt = updated_at or now; t.jiraSubmissionStatus = "SYNCED"
                    if created_at: t.jiraCreatedAt = created_at
                    if updated_at: t.jiraUpdatedAt = updated_at
                    if vessel_name: t.vesselName = vessel_name
                    if list_rt: t.requestType = list_rt
                    if detail:
                        t.detailFetchedAt = now
                        if detail.get("description"): t.description = detail["description"]
                        if detail.get("requestType"): t.requestType = detail["requestType"]
                        if detail.get("module"):      t.module = detail["module"]
                        if detail.get("environment"): t.environment = detail["environment"]
                        if detail.get("sharedWith"):  t.sharedWith = detail["sharedWith"]
                        if detail.get("attachments"): t.attachments = detail["attachments"]
                        if detail.get("raisedAt"):
                            rd = _parse_jira_date(detail["raisedAt"])
                            if rd: t.jiraCreatedAt = rd; print(f"[SYNC] raisedAt -> {rd}")
                        if new_comments_data is not None:
                            await session.execute(delete(Comment).where(Comment.ticket_id == t.id, Comment.source == "jira"))
                            for cd in new_comments_data:
                                if cd["source"] == "jira":
                                    session.add(Comment(
                                        id=str(uuid.uuid4()), ticket_id=t.id,
                                        author=cd["author"], message=cd["message"], source="jira",
                                        createdAt=cd["createdAt"], images=cd.get("images", []),
                                    ))
                    await session.commit(); updated += 1
                else:
                    t = Ticket(
                        id=str(uuid.uuid4()), reference=ref,
                        referenceNum=extract_reference_num(ref), summary=clean_summary,
                        description=(detail or {}).get("description", ""),
                        module=(detail or {}).get("module") or "Admin",
                        environment=(detail or {}).get("environment") or "Vessel",
                        priority="Minor", status="SUP IN PROGRESS", vesselName=vessel_name,
                        requester=jt.get("requester") or "", jiraStatus=jira_status,
                        jiraUrl=jt.get("url", ""), jiraSortOrder=idx, jiraSubmissionStatus="SYNCED",
                        requestType=list_rt or None,
                        attachments=(detail or {}).get("attachments", []),
                        sharedWith=(detail or {}).get("sharedWith", []),
                        createdAt=created_at or now, updatedAt=updated_at or now,
                        jiraCreatedAt=created_at, jiraUpdatedAt=updated_at,
                        lastSyncedAt=now, detailFetchedAt=now if detail else None,
                    )
                    if detail and detail.get("raisedAt"):
                        rd = _parse_jira_date(detail["raisedAt"])
                        if rd: t.jiraCreatedAt = rd
                    session.add(t); await session.flush()
                    for cd in (new_comments_data or []):
                        session.add(Comment(
                            id=str(uuid.uuid4()), ticket_id=t.id,
                            author=cd["author"], message=cd["message"], source=cd["source"],
                            createdAt=cd["createdAt"], images=cd.get("images", []),
                        ))
                    await session.commit(); created += 1
        except Exception as e:
            errors.append(f"{ref}: {e}"); print(f"[SYNC] Error {ref}: {e}")

    print(f"[SYNC] DONE -- Updated={updated} Created={created} Errors={len(errors)}")
    return {
        "mode": mode, "totalScraped": total, "detailFetched": len(detail_map),
        "detailSkipped": len(skip_list), "updated": updated, "created": created,
        "skipped": skipped, "errors": errors,
    }
