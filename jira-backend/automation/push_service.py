# automation/push_service.py
from sqlalchemy import select
from db.database import SessionLocal
from models.schema import Ticket
from automation.playwright_service import get_jira_service
from automation.status_map import extract_reference_num
from datetime import datetime


async def push_pending_tickets() -> dict:
    service = get_jira_service()

    async with SessionLocal() as session:
        pending = (await session.execute(
            select(Ticket).where(
                Ticket.jiraSubmissionStatus.in_(["PENDING", "FAILED"]),
                Ticket.reference.is_(None),
            ).limit(50)
        )).scalars().all()

    print(f"[PUSH] Found {len(pending)} tickets to submit")
    succeeded = failed = 0
    errors = []

    for ticket in pending:
        print(f"[PUSH] Processing: {ticket.summary[:50]}")
        try:
            result = service.submit_ticket({
                "id": ticket.id, "summary": ticket.summary,
                "description": ticket.description, "module": ticket.module,
                "environment": ticket.environment, "priority": ticket.priority,
                "vesselName": ticket.vesselName, "requester": ticket.requester,
            })
            reference = result.get("reference")
            jira_url  = result.get("jiraUrl")
            async with SessionLocal() as session:
                t = (await session.execute(select(Ticket).where(Ticket.id == ticket.id))).scalar_one()
                t.jiraSubmissionStatus = "SUBMITTED" if not reference else "SYNCED"
                t.jiraUrl = jira_url
                t.updatedAt = datetime.utcnow()
                if reference:
                    t.reference = reference
                    t.referenceNum = extract_reference_num(reference)
                await session.commit()
            print(f"[PUSH] SUCCESS: {reference or 'submitted'}")
            succeeded += 1
        except Exception as e:
            print(f"[PUSH] FAILED: {e}")
            errors.append(f"{ticket.summary[:40]}: {e}")
            async with SessionLocal() as session:
                t = (await session.execute(select(Ticket).where(Ticket.id == ticket.id))).scalar_one_or_none()
                if t:
                    t.jiraSubmissionStatus = "FAILED"
                    t.updatedAt = datetime.utcnow()
                    await session.commit()
            failed += 1

    return {"pushed": succeeded, "failed": failed, "errors": errors}
