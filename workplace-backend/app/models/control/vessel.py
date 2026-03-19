import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.core.database_control import ControlBase
from app.models.control.associations import user_vessel_link

class Vessel(ControlBase):
    __tablename__ = "vessels"

    imo = Column(String(7), primary_key=True, index=True)
    name = Column(String, nullable=False)
    vessel_type = Column(String, nullable=True)
    vessel_email = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    vessel_report_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    users = relationship("User", secondary=user_vessel_link, back_populates="vessels")