# models/control.py — mirrors DRS control plane models (read-only references)
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Table, ForeignKey,Text,Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship, declarative_base
from sqlalchemy.sql import func

ControlBase = declarative_base()

user_vessel_link = Table(
    "user_vessel_link",
    ControlBase.metadata,
    Column("user_id", UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True),
    Column("vessel_imo", String(7), ForeignKey("vessels.imo"), primary_key=True),
)

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

class Vessel(ControlBase):
    __tablename__ = "vessels"

    imo = Column(String(7), primary_key=True, index=True)
    name = Column(String, nullable=False)
    vessel_type = Column(String, nullable=True)
    vessel_email = Column(String, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    vessel_report_url = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    created_by = Column(UUID(as_uuid=True), nullable=True)  # FK removed — cross-DB
    module_status = Column(JSONB, nullable=False, server_default='{}')
    last_push_at = Column(DateTime(timezone=True), nullable=True)
    last_pull_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_success = Column(Boolean, default=True, nullable=False)
    last_sync_error = Column(Text, nullable=True)
    module_error_counts = Column(JSONB, nullable=False, server_default='{}')
    total_error_count = Column(Integer, nullable=False, default=0, server_default='0')
    vessel_telemetry = Column(JSONB, nullable=False, server_default='{}')

    users = relationship("User", secondary=user_vessel_link, back_populates="vessels")