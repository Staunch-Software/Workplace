import uuid
from datetime import date, datetime
from typing import Optional
from sqlalchemy import String, Text, Float, Boolean, Integer, Date, DateTime, ForeignKey, func
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID
from app.models.base import Base, TimestampMixin


class AlertConfig(Base):
    """One row per alert of the review's register. A withdrawn alert is disabled, never deleted."""
    __tablename__ = "orb_alert_config"

    alert_code: Mapped[str] = mapped_column(String(50), primary_key=True)
    alert_no: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(60), nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    scope: Mapped[str] = mapped_column(String(30), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    in_alerts_filter: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    built: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    updated_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    updated_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ThresholdParam(Base):
    """A threshold. vessel_id NULL is the default value, a row with a vessel overrides it for that vessel."""
    __tablename__ = "orb_threshold_params"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    param_code: Mapped[str] = mapped_column(String(60), nullable=False)
    alert_code: Mapped[str] = mapped_column(String(50), ForeignKey("orb_alert_config.alert_code"), nullable=False)
    label: Mapped[str] = mapped_column(String(300), nullable=False)
    comparator: Mapped[str] = mapped_column(String(4), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    vessel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id", ondelete="CASCADE"), nullable=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False, server_default=func.current_date())
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    approved_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ThresholdHistory(Base):
    __tablename__ = "orb_threshold_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    param_code: Mapped[str] = mapped_column(String(60), nullable=False)
    vessel_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    old_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    new_value: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    changed_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    changed_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class Equipment(Base, TimestampMixin):
    """Pumps, OWS and the 15 ppm monitor of a vessel. The rated capacity has no system default."""
    __tablename__ = "orb_equipment"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id", ondelete="CASCADE"), nullable=False, index=True)
    equipment_type: Mapped[str] = mapped_column(String(20), nullable=False)      # BILGE_PUMP | OWS | OCM
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    make_model: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    serial_no: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rated_capacity_m3_hr: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    linked_tank_id: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), ForeignKey("vessel_tanks.id", ondelete="SET NULL"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class OcmImport(Base):
    """One file of 15 ppm bilge alarm / oil content monitor data imported for a vessel (alert 23)."""
    __tablename__ = "orb_ocm_imports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id", ondelete="CASCADE"), nullable=False, index=True)
    filename: Mapped[str] = mapped_column(String(300), nullable=False)
    row_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    period_from: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    period_to: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    imported_by: Mapped[Optional[uuid.UUID]] = mapped_column(UUID(as_uuid=True), nullable=True)
    imported_by_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class OcmRecord(Base):
    """One stored record of the monitor: when, whether it was discharging overboard, and the raw status text.
    recorded_at is ship local time, the same clock as the Oil Record Book entries."""
    __tablename__ = "orb_ocm_records"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id", ondelete="CASCADE"), nullable=False, index=True)
    import_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orb_ocm_imports.id", ondelete="CASCADE"), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    discharging: Mapped[bool] = mapped_column(Boolean, nullable=False)
    ppm: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    status_text: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
