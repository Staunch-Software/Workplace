import uuid
from datetime import date
from typing import Optional
from sqlalchemy import String, Text, Float, Date, Boolean, Integer, ForeignKey
from sqlalchemy.orm import mapped_column, Mapped
from sqlalchemy.dialects.postgresql import UUID, JSONB
from app.models.base import Base, TimestampMixin

class OrbEntry(Base, TimestampMixin):
    __tablename__ = "orb_entries"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    upload_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("orb_uploads.id"), nullable=False, index=True)
    vessel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("vessels.id"), nullable=False, index=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    
    orb_code: Mapped[str] = mapped_column(String(5), nullable=False)
    item_number: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    operation_description: Mapped[str] = mapped_column(Text, nullable=False)
    
    tank_location: Mapped[Optional[str]] = mapped_column(String(300), nullable=True)
    time_start: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    time_stop: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    position_start: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    position_stop: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    officer_1_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    officer_1_rank: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    officer_2_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    officer_2_rank: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    raw_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    confidence_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    master_signature_present: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    has_erasure: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    page_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    has_gap_before: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Officer-in-charge signature for THIS entry (alert 30). NULL = not read (older uploads): never alerted.
    officer_signature_present: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Position of the entry on its page in the order the extractor returned it (alert 31). NULL = older uploads.
    entry_seq: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # Language the page was written in (alert 36). NULL = older uploads.
    page_language: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    # Row-by-row transcription of the block as written: [{"item": "11.2" | None, "text": "..."}].
    # item is exactly what the Item column held (None = the cell was blank). NULL for
    # entries extracted before this column existed, or whose lines could not be tied
    # to their item numbers -- the item-number check skips those.
    item_lines: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)