# Save this as: backend/routers/ticket_status.py
# Add this route to your existing tickets router

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from db.mongodb import get_db
from bson import ObjectId
from datetime import datetime

router = APIRouter()

class StatusUpdate(BaseModel):
    status: str

# Allowed status values
VALID_STATUSES = [
    "Sup In Progress", "Dev In Progress", "In Progress",
    "Waiting for Customer", "Pending", "FSD TO REVIEW",
    "FSD APPROVED", "READY FOR UAT", "UAT IN PROGRESS",
    "Resolved Awaiting Confirmation", "Resolved",
    "Cancelled", "Closed",
]

@router.patch("/tickets/{ticket_id}/status")
async def update_ticket_status(ticket_id: str, body: StatusUpdate):
    db = get_db()
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, f"Invalid status: {body.status}")
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(400, "Invalid ticket ID")

    result = await db["tickets"].find_one_and_update(
        {"_id": oid},
        {"$set": {
            "jiraStatus": body.status,
            "status": body.status,
            "updatedAt": datetime.utcnow(),
        }},
        return_document=True
    )
    if not result:
        raise HTTPException(404, "Ticket not found")

    from utils.serializer import fmt
    return fmt(result)