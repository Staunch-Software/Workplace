import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database_control import ControlBase
from app.models.control.associations import user_vessel_link

class User(ControlBase):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    job_title = Column(String, nullable=True)
    role = Column(String, nullable=False, default="VESSEL")
    is_active = Column(Boolean, default=True, nullable=False)
    last_login = Column(DateTime, nullable=True)
    can_self_assign_vessels = Column(Boolean, default=False, nullable=False, server_default='false')
    permissions = Column(JSONB, nullable=False, server_default='{"drs": false, "jira": false, "voyage": false, "lubeoil": false, "engine_performance": false}')
    preferences = Column(JSONB, nullable=False, server_default='{"visible_columns": [], "filters": {}}')
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    vessels = relationship("Vessel", secondary=user_vessel_link, back_populates="users", lazy="selectin")