import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from app.core.database_control import ControlBase
from app.model.control.associations import user_vessel_link
from sqlalchemy import Integer

class Vessel(ControlBase):
    __tablename__ = "vessels"

    imo = Column(String(7), primary_key=True, index=True)
    name = Column(String, nullable=False)
    vessel_type = Column(String, nullable=True)
    vessel_email = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)  # FK removed — cross-DB
    
    last_push_at = Column(DateTime, nullable=True)
    last_pull_at = Column(DateTime, nullable=True)
    module_status = Column(JSONB, nullable=True)
    module_error_counts = Column(JSONB, nullable=True)
    total_error_count = Column(Integer, default=0, nullable=False)
    last_sync_success = Column(Boolean, default=True, nullable=False)
    last_sync_error = Column(String, nullable=True)

    users = relationship("User", secondary=user_vessel_link, back_populates="vessels")
    # luboil_reports and luboil_configs removed — those live in workplace_lubeoil DB