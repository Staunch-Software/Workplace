from sqlalchemy import Table, Column, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from app.core.database_control import ControlBase

user_vessel_link = Table(
    "user_vessel_link",
    ControlBase.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("vessel_imo", String(7), ForeignKey("vessels.imo", ondelete="CASCADE"), primary_key=True),
)