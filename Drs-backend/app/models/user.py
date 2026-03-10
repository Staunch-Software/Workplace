import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship

from app.core.database_control import ControlBase as Base
from app.models.enums import UserRole
from app.models.associations import user_vessel_link # <--- Import the bridge

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    
    full_name = Column(String, nullable=False)
    job_title = Column(String)  # e.g. "Chief Engineer"
    role = Column(String, default=UserRole.VESSEL, nullable=False)
    
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    created_at = Column(DateTime, default=datetime.utcnow)
    preferences = Column(
        JSONB, 
        nullable=False,
        server_default='{}',
        comment='User-specific UI preferences (e.g., visible columns, filters, etc.)'
    )

    # RELATIONS
    # This 'secondary' argument is the magic key
    vessels = relationship(
        "Vessel", 
        secondary=user_vessel_link, 
        back_populates="users",
        lazy="selectin"  # HIGH EFFICIENCY: Loads vessels instantly when fetching user
    )

    # reported_defects = relationship(
    #     "Defect", 
    #     back_populates="reporter",
    #     foreign_keys="[Defect.reported_by_id]" # <--- Explicitly link to the reporter column
    # )
