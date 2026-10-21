import uuid
from sqlalchemy import Column, String, Boolean
from sqlalchemy.dialects.postgresql import UUID, JSONB

from app.control_database import ControlBase


class ControlUser(ControlBase):
    """Read-only view of workplace-backend's `users` table (control database)."""

    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    role = Column(String, nullable=False)
    is_active = Column(Boolean, nullable=False)
    permissions = Column(JSONB, nullable=False)

    # Filled in by get_current_user: IMO numbers from user_vessel_link.
    assigned_vessels: list = []

    @property
    def name(self) -> str:
        return self.full_name
