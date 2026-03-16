# models/control.py — mirrors DRS control plane models (read-only references)
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Table, ForeignKey
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
    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email        = Column(String, unique=True, index=True, nullable=False)
    full_name    = Column(String, nullable=False)
    job_title    = Column(String)
    role         = Column(String, nullable=False)
    is_active    = Column(Boolean, default=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    permissions  = Column(JSONB, nullable=False, server_default='{}')
    vessels      = relationship("Vessel", secondary=user_vessel_link, back_populates="users", lazy="selectin")

class Vessel(ControlBase):
    __tablename__ = "vessels"
    imo          = Column(String(7), primary_key=True, index=True)
    name         = Column(String, nullable=False)
    vessel_type  = Column(String)
    vessel_email = Column(String, nullable=True)
    is_active    = Column(Boolean, default=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    users        = relationship("User", secondary=user_vessel_link, back_populates="vessels")