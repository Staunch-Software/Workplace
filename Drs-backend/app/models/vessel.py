from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database_control import ControlBase as Base
from app.models.associations import user_vessel_link # <--- Import the bridge

class Vessel(Base):
    __tablename__ = "vessels"

    # IMO Number is unique worldwide (e.g., "9123456")
    imo = Column(String(7), primary_key=True, index=True)
    
    name = Column(String, nullable=False)     # e.g., "MT ALFA"
    # code = Column(String(3), index=True)      # e.g., "ALF" (Short code for UI)
    vessel_type = Column(String)              # e.g., "OIL_TANKER"
    vessel_email = Column(String, nullable=True)     # Ship's email address
    
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # RELATIONS
    users = relationship(
        "User", 
        secondary=user_vessel_link, 
        back_populates="vessels"
    )

    # defects = relationship("Defect", back_populates="vessel", cascade="all, delete-orphan")
