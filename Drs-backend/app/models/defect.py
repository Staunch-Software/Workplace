from sqlalchemy import Column, String, Integer, Text, DateTime, Boolean, ForeignKey, Enum as SQLEnum, ARRAY, CheckConstraint
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import uuid
from app.core.database import Base
from app.models.enums import DefectPriority, DefectStatus, DefectSource
from typing import Optional
from sqlalchemy import Enum as SQLEnum

class Defect(Base):
    __tablename__ = "defects"
    __table_args__ = (
        CheckConstraint("version >= 1", name="defect_version_positive"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_imo = Column(String, nullable=False, index=True)
    reported_by_id = Column(UUID(as_uuid=True), nullable=False)
    
    # Core defect information
    title = Column(String, nullable=False)
    equipment_name = Column(String, nullable=False)
    description = Column(Text, nullable=False)
    
    # Defect Source
    defect_source = Column(
        SQLEnum(
        DefectSource,
        name="defectsource",
        values_callable=lambda x: [e.value for e in x],
        create_type=True
        ),
        nullable=False,
        default=DefectSource.INTERNAL_AUDIT
    )

    
    # Status and priority
    priority = Column(SQLEnum(DefectPriority, name="defectpriority"), nullable=False)
    status = Column(SQLEnum(DefectStatus, name="defectstatus"), nullable=False)
    responsibility = Column(String, nullable=True)
    pr_status = Column(String, nullable=True, server_default='Not Set')
    
    # Image requirement flags
    before_image_required = Column(Boolean, default=False, nullable=False)
    after_image_required = Column(Boolean, default=False, nullable=False)
    
    # Before/After images uploaded during creation or update
    before_image_path = Column(String, nullable=True)
    after_image_path = Column(String, nullable=True)
    
    # Dates
    date_identified = Column(DateTime(timezone=True), nullable=True)
    target_close_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Sync control fields
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")  
    # VESSEL / SHORE / SYNC

    # Closure information
    closed_at = Column(DateTime(timezone=True), nullable=True)
    closed_by_id = Column(UUID(as_uuid=True), nullable=True)
    closure_remarks = Column(Text, nullable=True)
    closure_image_before = Column(String, nullable=True)
    closure_image_after = Column(String, nullable=True)
    
    # Storage
    json_backup_path = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)
    is_owner = Column(Boolean, default=False, nullable=False)
    # Relationships
    # vessel = relationship("Vessel", back_populates="defects")
    # reporter = relationship(
    #     "User",
    #     foreign_keys=[reported_by_id],
    #     back_populates="reported_defects"
    # )
    # closed_by = relationship("User", foreign_keys=[closed_by_id])
    threads = relationship("Thread", back_populates="defect", cascade="all, delete-orphan")
    pr_entries = relationship("PrEntry", back_populates="defect", cascade="all, delete-orphan")
    
    # ✅ THIS WAS MISSING - Add this relationship to fix the error!
    images = relationship("DefectImage", back_populates="defect", cascade="all, delete-orphan")


class Thread(Base):
    __tablename__ = "threads"
    __table_args__ = (
        CheckConstraint("version >= 1", name="thread_version_positive"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    defect_id = Column(UUID(as_uuid=True), ForeignKey("defects.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    author_role = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    is_system_message = Column(Boolean, default=False)
    tagged_user_ids = Column(ARRAY(String), default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    is_internal = Column(Boolean, default=False, nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )

    defect = relationship("Defect", back_populates="threads")
    # user = relationship("User", foreign_keys=[user_id])
    attachments = relationship("Attachment", back_populates="thread", cascade="all, delete-orphan")


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("version >= 1", name="attachment_version_positive"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    thread_id = Column(UUID(as_uuid=True), ForeignKey("threads.id", ondelete="CASCADE"), nullable=False, index=True)
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, nullable=True)
    content_type = Column(String, nullable=True)
    blob_path = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )
    thread = relationship("Thread", back_populates="attachments")


class PrEntry(Base):
    __tablename__ = "pr_entries"
    __table_args__ = (
        CheckConstraint("version >= 1", name="pr_entry_version_positive"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    defect_id = Column(UUID(as_uuid=True), ForeignKey("defects.id", ondelete="CASCADE"), nullable=False, index=True)
    pr_number = Column(String, nullable=False)
    pr_description = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(UUID(as_uuid=True), nullable=True)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )

    # Relationships
    defect = relationship("Defect", back_populates="pr_entries")
    # creator = relationship("User", foreign_keys=[created_by_id])


class DefectImage(Base):
    __tablename__ = "defect_images"
    __table_args__ = (
        CheckConstraint("version >= 1", name="defect_image_version_positive"),
    )
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    defect_id = Column(UUID(as_uuid=True), ForeignKey("defects.id", ondelete="CASCADE"), nullable=False, index=True)
    image_type = Column(String, nullable=False)  # 'before' or 'after'
    file_name = Column(String, nullable=False)
    file_size = Column(Integer, nullable=True)
    blob_path = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    origin = Column(String(20), nullable=False, default="VESSEL")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now()
    )

    defect = relationship("Defect", back_populates="images")