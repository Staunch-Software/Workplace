# Trimmed shadow copy of workplace-backend's control Vessel model — only the columns
# this service reads (see workplace-backend/app/models/control/vessel.py).
from sqlalchemy import Column, String, Boolean
from sqlalchemy.orm import relationship
from app.core.database_control import ControlBase
from app.models.control.associations import user_vessel_link


class Vessel(ControlBase):
    __tablename__ = "vessels"
    __table_args__ = {"extend_existing": True}

    imo = Column(String(7), primary_key=True, index=True)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    users = relationship("User", secondary=user_vessel_link, back_populates="vessels")
