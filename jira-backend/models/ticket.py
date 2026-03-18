from pydantic import BaseModel
from typing import Optional, List, Literal
from datetime import datetime

class Comment(BaseModel):
    author: str
    message: str
    createdAt: str

class TicketCreate(BaseModel):
    summary: str
    description: str = ""
    module: str
    environment: str
    priority: Literal["Critical", "Major", "Minor"]
    attachments: Optional[List[dict]] = []  # ← ADD: allows frontend to send Azure attachment metadata