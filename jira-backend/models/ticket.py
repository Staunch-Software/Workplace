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
