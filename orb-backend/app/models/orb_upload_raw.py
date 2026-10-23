import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import mapped_column, Mapped
from app.models.base import Base


class OrbUploadRaw(Base):
    """What the extractor returned for an upload, BEFORE any post-processing or saving.

    Gemini is the expensive part of an upload; everything after it (repairs, de-duplication,
    checks, saving) is cheap and changes often. Keeping the raw result lets a post-processing fix
    be applied to an existing upload without calling Gemini again.
    """
    __tablename__ = "orb_upload_raw"

    upload_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orb_uploads.id", ondelete="CASCADE"), primary_key=True)
    entries: Mapped[list] = mapped_column(JSONB, nullable=False)
    failed_pages: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)   # {"pages": [..], "reasons": {"5": ".."}}
    usage: Mapped[Optional[dict]] = mapped_column(JSONB, nullable=True)           # token usage / cost estimate of the run
    model: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.orb_utc_now(), nullable=False)
