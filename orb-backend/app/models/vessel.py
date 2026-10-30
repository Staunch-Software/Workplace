import uuid
from typing import Optional
from sqlalchemy import String, Boolean, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.models.base import Base, TimestampMixin


class Vessel(Base, TimestampMixin):
    __tablename__ = "vessels"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    imo_number: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    call_sign: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    created_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)  # workplace user id
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    flag_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    flag_official_language: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    fuel_grades: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
