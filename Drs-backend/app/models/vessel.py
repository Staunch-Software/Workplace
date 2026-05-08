from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text,Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database_control import ControlBase as Base
from app.models.associations import user_vessel_link

class Vessel(Base):
    __tablename__ = "vessels"

    # IMO Number is unique worldwide (e.g., "9123456")
    imo = Column(String(7), primary_key=True, index=True)

    name = Column(String, nullable=False)       # e.g., "MT ALFA"
    vessel_type = Column(String)                # e.g., "OIL_TANKER"
    vessel_email = Column(String, nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    module_status = Column(JSONB, nullable=False, server_default='{}')
    # ✅ Sync tracking columns
    last_push_at = Column(DateTime(timezone=True), nullable=True)   # shore → vessel
    last_pull_at = Column(DateTime(timezone=True), nullable=True)   # vessel → shore
    last_sync_success = Column(Boolean, default=True, nullable=False)
    last_sync_error = Column(Text, nullable=True)
    module_error_counts = Column(JSONB, nullable=False, server_default='{}')
    total_error_count = Column(Integer, nullable=False, default=0, server_default='0')
    vessel_telemetry = Column(JSONB, nullable=False, server_default='{}')

    # RELATIONS
    users = relationship(
        "User",
        secondary=user_vessel_link,
        back_populates="vessels"
    )