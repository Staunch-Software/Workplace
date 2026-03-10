import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database_control import ControlBase
from app.models.control.associations import user_vessel_link

class User(ControlBase):
    __tablename__ = "users"
    __table_args__ = {"extend_existing": True}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    role = Column(String, nullable=False, default="VESSEL")
    is_active = Column(Boolean, default=True, nullable=False)
    job_title = Column(String, nullable=True)
    permissions = Column(JSONB, nullable=True)

    vessels = relationship("Vessel", secondary=user_vessel_link, back_populates="users")