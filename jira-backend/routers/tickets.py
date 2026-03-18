# routers/tickets.py
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, not_
from sqlalchemy.orm import selectinload
from db.database import get_db
from models.schema import Ticket, Comment
from services.azure_blob import upload_file_to_blob
from models.ticket import TicketCreate
from core.deps import get_current_user
from pydantic import BaseModel
from datetime import datetime
import uuid

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

CLOSED_STATUSES = ["Cancelled", "Closed", "Resolved", "Resolved Awaiting Confirmation"]
VALID_STATUSES = [
    "Sup In Progress", "Dev In Progress", "In Progress",
    "Waiting for Customer", "Pending", "FSD TO REVIEW",
    "FSD APPROVED", "READY FOR UAT", "UAT IN PROGRESS",
    "Resolved Awaiting Confirmation", "Resolved", "Cancelled", "Closed",
]


def _fmt_comment(c: Comment) -> dict:
    return {
        "id":        c.id,
        "author":    c.author,
        "message":   c.message,
        "source":    c.source,
        "createdAt": c.createdAt.isoformat() if c.createdAt else None,
        "images":    c.images or [],
    }


def fmt(t: Ticket) -> dict:
    return {
        "id":                   t.id,
        "reference":            t.reference,
        "referenceNum":         t.referenceNum,
        "summary":              t.summary,
        "description":          t.description,
        "module":               t.module,
        "environment":          t.environment,
        "priority":             t.priority,
        "requestType":          t.requestType,
        "status":               t.status,
        "jiraStatus":           t.jiraStatus,
        "jiraSubmissionStatus": t.jiraSubmissionStatus,
        "jiraUrl":              t.jiraUrl,
        "jiraSortOrder":        t.jiraSortOrder,
        "vesselName":           t.vesselName,
        "requester":            t.requester,
        "attachments":          t.attachments or [],
        "sharedWith":           t.sharedWith or [],
        "comments":             [_fmt_comment(c) for c in (t.comments or [])],
        "createdAt":            t.createdAt.isoformat() if t.createdAt else None,
        "updatedAt":            t.updatedAt.isoformat() if t.updatedAt else None,
        "jiraCreatedAt":        t.jiraCreatedAt.isoformat() if t.jiraCreatedAt else None,
        "jiraUpdatedAt":        t.jiraUpdatedAt.isoformat() if t.jiraUpdatedAt else None,
        "lastSyncedAt":         t.lastSyncedAt.isoformat() if t.lastSyncedAt else None,
    }


class StatusUpdate(BaseModel):
    status: str

class CommentCreate(BaseModel):
    message: str
    images: list[dict] = []        # ← ADDED


@router.get("")
async def get_tickets(
    vesselName:  str = Query(None),
    status:      str = Query(None),
    statusList:  str = Query(None),
    priority:    str = Query(None),
    search:      str = Query(None),
    sortBy:      str = Query("updatedAt"),
    sortOrder:   str = Query("desc"),
    page:        int = 1,
    limit:       int = 15,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(Ticket)

    if user.role == "VESSEL":
        vessel_names = [v.name for v in user.vessels]
        q = q.where(Ticket.vesselName.in_(vessel_names))
    elif vesselName and vesselName != "all":
        q = q.where(Ticket.vesselName == vesselName)

    if statusList:
        statuses = [s.strip() for s in statusList.split(",") if s.strip()]
        if statuses:
            q = q.where(Ticket.jiraStatus.in_(statuses))
    elif status == "open":
        q = q.where(
            or_(
                Ticket.jiraStatus.is_(None),
                not_(Ticket.jiraStatus.in_(CLOSED_STATUSES))
            )
        )
    elif status == "closed":
        q = q.where(Ticket.jiraStatus.in_(CLOSED_STATUSES))
    elif status and status != "all":
        q = q.where(Ticket.jiraStatus == status)

    if priority and priority != "all":
        q = q.where(Ticket.priority == priority)

    if search:
        q = q.where(or_(
            Ticket.summary.ilike(f"%{search}%"),
            Ticket.reference.ilike(f"%{search}%"),
        ))

    total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()

    sort_map = {
        "reference":     Ticket.reference,
        "requester":     Ticket.requester,
        "createdAt":     Ticket.createdAt,
        "updatedAt":     Ticket.updatedAt,
        "priority":      Ticket.priority,
        "jiraSortOrder": Ticket.jiraSortOrder,
    }
    col = sort_map.get(sortBy, Ticket.updatedAt)
    q = q.order_by(col.asc().nulls_last() if sortOrder == "asc" else col.desc().nulls_last())
    q = q.options(selectinload(Ticket.comments)).offset((page - 1) * limit).limit(limit)

    tickets_raw = (await db.execute(q)).scalars().all()
    return {
        "tickets": [fmt(t) for t in tickets_raw],
        "pagination": {"page": page, "limit": limit, "total": total, "totalPages": -(-total // limit)},
    }

@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    content = await file.read()
    result = await upload_file_to_blob(content, file.filename, file.content_type)
    return result

@router.post("")
async def create_ticket(
    body: TicketCreate,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    ticket = Ticket(
        id=str(uuid.uuid4()), summary=body.summary, description=body.description,
        module=body.module, environment=body.environment, priority=body.priority,
        vesselName=user.vessels[0].name if user.vessels else None,
        requester=user.email,
        jiraSubmissionStatus="PENDING", status="SUP IN PROGRESS",
        attachments=body.attachments,  # ← UPDATED
        sharedWith=[], createdAt=now, updatedAt=now,
    )
    db.add(ticket)
    await db.flush()
    await db.refresh(ticket, ["comments"])
    return fmt(ticket)


@router.get("/{ticket_id}")
async def get_ticket(ticket_id: str, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.comments)).where(Ticket.id == ticket_id)
    )
    t = result.scalar_one_or_none()
    if not t:
        raise HTTPException(404, "Ticket not found")
    return fmt(t)


@router.post("/{ticket_id}/comments")
async def add_comment(
    ticket_id: str, body: CommentCreate,
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if not body.message.strip():
        raise HTTPException(400, "Comment message cannot be empty")
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.comments)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    comment = Comment(
        id=str(uuid.uuid4()), ticket_id=ticket_id,
        author=user.full_name or user.email or "User",
        message=body.message.strip(), source="portal",
        createdAt=datetime.utcnow(),
        images=body.images,            # ← UPDATED
    )
    db.add(comment)
    ticket.updatedAt = datetime.utcnow()
    await db.flush()
    await db.refresh(ticket, ["comments"])
    return fmt(ticket)


@router.patch("/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: str, body: StatusUpdate,
    user=Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status: {body.status}")
    result = await db.execute(
        select(Ticket).options(selectinload(Ticket.comments)).where(Ticket.id == ticket_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    ticket.jiraStatus = body.status
    ticket.status     = body.status
    ticket.updatedAt  = datetime.utcnow()
    return fmt(ticket)