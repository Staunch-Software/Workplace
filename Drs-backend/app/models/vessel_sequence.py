from sqlalchemy import Column, String, Integer
from app.core.database import Base

class VesselDefectSequence(Base):
    __tablename__ = "vessel_defect_sequences"

    vessel_imo = Column(String(10), primary_key=True)
    next_seq = Column(Integer, nullable=False, default=1)