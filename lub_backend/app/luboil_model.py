from sqlalchemy import (
    Column, Integer, String, DECIMAL, DATE, TIME, TIMESTAMP, TEXT,
    Boolean, ForeignKey, CheckConstraint, UniqueConstraint, func, Index, DateTime, Float
)
from sqlalchemy.orm import relationship, validates
from sqlalchemy.dialects.postgresql import JSONB # <--- Crucial for the full_json_data column
from app.database import Base
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base
# from app.models.control.users import User
# =====================================================
# LUBE OIL ANALYSIS TABLES
# =====================================================
class LuboilVessel(Base):
    """
    Independent Header table for Lube Oil module. 
    """
    __tablename__ = 'luboil_vessel'

    imo_number = Column(Integer, primary_key=True, autoincrement=False)
    vessel_name = Column(String(100), nullable=False, index=True)
    vessel_short_name = Column(String(50), nullable=True)
    is_active = Column(Boolean, default=True)
    lab_customer_code = Column(String(50), nullable=True)
    vessel_report_url = Column(String(500), nullable=True)

    # CHANGE HERE: Set back_populates to "vessel"
    reports = relationship("LuboilReport", back_populates="luboil_vessel",
                      primaryjoin="cast(LuboilVessel.imo_number, String) == foreign(LuboilReport.imo_number)",
                      foreign_keys="[LuboilReport.imo_number]",
                      cascade="all, delete-orphan")
    configs = relationship("LuboilVesselConfig", back_populates="luboil_vessel",
                      primaryjoin="cast(LuboilVessel.imo_number, String) == foreign(LuboilVesselConfig.imo_number)",
                      foreign_keys="[LuboilVesselConfig.imo_number]",
                      cascade="all, delete-orphan")

    def __repr__(self):
        return f"<LuboilVessel(imo={self.imo_number}, name='{self.vessel_name}')>"
class LuboilReport(Base):
    """
    Parent table for Lube Oil Analysis Reports.
    Stores metadata and the complete extracted JSON data for historical backup.
    """
    __tablename__ = 'luboil_report'

    report_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Link to Vessel Master Data
    imo_number = Column(String(7), nullable=False, index=True) 
    
    # Report Metadata
    file_name = Column(String(255), nullable=False, comment="Original PDF filename (e.g., 'GCL GANGA -96.pdf')")
    lab_name = Column(String(100), nullable=True, comment="Lab provider name (e.g., 'Shell LubeAnalyst')")
    report_date = Column(DATE, nullable=False, comment="Date printed on the report")
    oil_source = Column(String(100), nullable=True, comment="Extracted Oil Brand e.g., 'SHELL', 'CASTROL'")
    # The Full Data Dump (Stores the entire JSON extraction for detailed chemistry lookup)
    full_json_data = Column(JSONB(none_as_null=True, astext_type=TEXT), nullable=True, comment="Complete raw JSON structure including all chemical elements")
    
    uploaded_at = Column(DateTime(timezone=True), default=func.current_timestamp(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)
    report_url = Column(String(500), nullable=True, comment="Azure Blob URL for the raw PDF")
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    
    # Relationships
    luboil_vessel = relationship("LuboilVessel", back_populates="reports",
                          primaryjoin="foreign(LuboilReport.imo_number) == cast(LuboilVessel.imo_number, String)",
                          foreign_keys="[LuboilReport.imo_number]")
    
    samples = relationship("LuboilSample", back_populates="report", cascade="all, delete-orphan")

    overdue_remarks = Column(TEXT, nullable=True, comment="Stores the justification text")
    is_overdue_accepted = Column(Boolean, nullable=True, comment="True=Accepted, False=Declined, NULL=Pending")

    # Constraints and Indexes
    __table_args__ = (
        Index('ix_luboil_report_date', 'report_date'),
        Index('ix_luboil_report_imo', 'imo_number'),
    )

    def __repr__(self):
        return f"<LuboilReport(report_id={self.report_id}, imo={self.imo_number}, date='{self.report_date}')>"


class LuboilSample(Base):
    """
    Child table for individual machinery samples.
    Updated to store full chemical analysis required for Trend Graphs.
    """
    __tablename__ = 'luboil_sample'

    sample_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('luboil_report.report_id', ondelete='CASCADE'), nullable=False, index=True)
    
    # Identity
    machinery_name = Column(String(255), nullable=False, comment="Component name (e.g., 'Main Engine - System')")
    equipment_code = Column(String(50), ForeignKey('luboil_equipment_type.code', ondelete='SET NULL'), nullable=True, index=True, comment="Linked Code (e.g. 'ME.SYS')")
    sample_number = Column(String(50), nullable=True, index=True, comment="Unique Lab Sample ID (e.g., '60500539')")
    
    # Core Data for Backend Logic (Status + Date + Hours)
    sample_date = Column(DATE, nullable=False, comment="The anchor date for calculating next due date")
    status = Column(String(50), nullable=False, comment="Condition: 'Normal', 'Warning', 'Action', 'Critical'")
    
    # Operational Data
    equipment_hours = Column(DECIMAL(12, 2), nullable=True, comment="Running hours at time of sample (for usage-based intervals)")
    
    # --- PHYSICAL CHARACTERISTICS (Graph 1) ---
    viscosity_40c = Column(DECIMAL(10, 2), nullable=True, comment="Viscosity @ 40C (cSt)")
    viscosity_100c = Column(DECIMAL(10, 2), nullable=True, comment="Viscosity @ 100C (cSt)")
    tan = Column(DECIMAL(10, 2), nullable=True, comment="Total Acid Number (mg KOH/g)")
    tbn = Column(DECIMAL(10, 2), nullable=True, comment="Total Base Number (mg KOH/g)")
    flash_point = Column(DECIMAL(10, 2), nullable=True, comment="Flash Point (C)")

    # --- WEAR METALS in ppm (Graph 2) ---
    iron = Column(Integer, nullable=True, comment="Iron (Fe)")
    chromium = Column(Integer, nullable=True, comment="Chromium (Cr)")
    tin = Column(Integer, nullable=True, comment="Tin (Sn)")
    lead = Column(Integer, nullable=True, comment="Lead (Pb)")
    copper = Column(Integer, nullable=True, comment="Copper (Cu)")
    aluminium = Column(Integer, nullable=True, comment="Aluminium (Al)")
    vanadium = Column(Integer, nullable=True, comment="Vanadium (V)")
    nickel = Column(Integer, nullable=True, comment="Nickel (Ni)")
    wpi_index = Column(Integer, nullable=True, comment="Wear Particle Index")

    # --- CONTAMINATION (Graph 3) ---
    water_content_pct = Column(DECIMAL(5, 2), nullable=True, comment="Water Content %")
    sodium = Column(Integer, nullable=True, comment="Sodium (Na) ppm")
    silicon = Column(Integer, nullable=True, comment="Silicon (Si) ppm")
    soot_pct = Column(DECIMAL(5, 2), nullable=True, comment="Soot/Insolubles %")
    ic_index = Column(DECIMAL(5, 2), nullable=True, comment="Index of Contamination")

    # --- ADDITIVES (Graph 4) ---
    calcium = Column(DECIMAL(10, 3), nullable=True, comment="Calcium %")
    zinc = Column(DECIMAL(10, 3), nullable=True, comment="Zinc %")
    phosphorus = Column(DECIMAL(10, 3), nullable=True, comment="Phosphorus %")
    magnesium = Column(Integer, nullable=True, comment="Magnesium (Mg) ppm")
    boron = Column(Integer, nullable=True, comment="Boron (B) ppm")
    molybdenum = Column(Integer, nullable=True, comment="Molybdenum (Mo) ppm")
    barium = Column(Integer, nullable=True, comment="Barium (Ba) ppm")
    summary_error = Column(String(500), nullable=True, comment="Short technical summary of the warning (e.g., 'Lead (Pb) ppm is 15')")
    is_image_required = Column(Boolean, default=False)
    is_resampling_required = Column(Boolean, default=False)
    is_approval_pending = Column(Boolean, default=False, comment="True if vessel requested close but shore hasn't accepted")
    attachment_url = Column(String, nullable=True)
    pdf_page_index = Column(Integer, nullable=True, comment="The 0-based index of the page in the PDF")
    # Remarks & Logging
    lab_diagnosis = Column(TEXT, nullable=True, comment="Extracted diagnosis text from the lab report PDF")
    officer_remarks = Column(TEXT, nullable=True, comment="Remarks from the Officer on board")
    office_remarks = Column(TEXT, nullable=True, comment="Remarks from the Office/Superintendent")
    internal_remarks = Column(TEXT, nullable=True, comment="Private notes for Shore/Office team only")
    status_change_log = Column(TEXT, nullable=True, comment="[Date] User: Status Change Message")
    is_resolved = Column(Boolean, default=False, comment="True if the Document Resolution process is completed")
    resolution_remarks = Column(TEXT, nullable=True, comment="The 50+ character maintenance/correction narrative")
    
    created_at = Column(DateTime(timezone=True), default=func.current_timestamp(), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)
    
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)

    # Relationships
    report = relationship("LuboilReport", back_populates="samples")

    # Constraints and Indexes
    __table_args__ = (
        Index('ix_luboil_sample_status', 'status'),
        Index('ix_luboil_machinery', 'machinery_name'),
        # Broad constraint to handle various lab terminologies
        CheckConstraint("status IN ('Normal', 'Warning', 'Critical', 'Alert', 'Action', 'Caution')", name='ck_luboil_valid_status'),
    )

    def __repr__(self):
        return f"<LuboilSample(machinery='{self.machinery_name}', status='{self.status}', date='{self.sample_date}')>"


class LuboilEquipmentType(Base):
    """
    TABLE 1: THE MASTER RULES (Reference Table)
    Defines the standard columns for your Dashboard (e.g., 'ME SYS', 'AE #1').
    """
    __tablename__ = 'luboil_equipment_type'

    code = Column(String(50), primary_key=True, comment="Internal Code (e.g., 'ME.SYS', 'AE.SYS.01')")
    ui_label = Column(String(100), nullable=False, comment="Dashboard Header (e.g., 'Main Engine', 'AE #1')")
    category = Column(String(50), nullable=False, comment="Grouping (e.g., 'Main Engine', 'Aux Engine')")
    default_interval_months = Column(Integer, default=3, nullable=False, comment="Standard Interval (e.g., 3 or 6)")
    sort_order = Column(Integer, default=999, comment="Order of columns in the UI (1, 2, 3...)")

    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    
    # Relationships
    configs = relationship("LuboilVesselConfig", back_populates="equipment_type")
    mappings = relationship("LuboilNameMapping", back_populates="equipment_type")
    # Link back to samples to easily query history for a specific equipment type
    samples = relationship("LuboilSample", backref="equipment_type")

    def __repr__(self):
        return f"<LuboilEquipmentType(code='{self.code}', label='{self.ui_label}')>"


class LuboilVesselConfig(Base):
    """
    TABLE 2: THE CHECKLIST (Configuration Table)
    Defines which ship has which equipment. (The 'X' marks in Excel).
    """
    __tablename__ = 'luboil_vessel_config'

    config_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Link to Vessel (in models.py)
    imo_number = Column(String(7), nullable=False, index=True)  
    
    # Link to Master Equipment (in this file)
    equipment_code = Column(String(50), ForeignKey('luboil_equipment_type.code', ondelete='CASCADE'), nullable=False)
    
    is_active = Column(Boolean, default=True, comment="1 = Active (X), 0 = Inactive (-)")

    lab_analyst_code = Column(String, nullable=True)

    # Relationships
    luboil_vessel = relationship("LuboilVessel", back_populates="configs",
                          primaryjoin="foreign(LuboilVesselConfig.imo_number) == cast(LuboilVessel.imo_number, String)",
                          foreign_keys="[LuboilVesselConfig.imo_number]")
    equipment_type = relationship("LuboilEquipmentType", back_populates="configs")

    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    # Constraints: One config per equipment per vessel
    __table_args__ = (
        UniqueConstraint('imo_number', 'equipment_code', name='uq_vessel_equip_config'),
    )

    def __repr__(self):
        return f"<LuboilVesselConfig(imo={self.imo_number}, code='{self.equipment_code}')>"


class LuboilNameMapping(Base):
    """
    TABLE 3: THE TRANSLATOR (Mapping Table)
    Maps the messy names found in PDF reports to the Clean Codes in Master Table.
    """
    __tablename__ = 'luboil_name_mapping'

    mapping_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # The messy string from the Lab Report (PDF)
    lab_raw_string = Column(String(255), unique=True, nullable=False, comment="Exact string found in PDF (e.g. 'Aux Diesel No.1 - Crankcase')")
    
    # The Clean Code it maps to
    equipment_code = Column(String(50), ForeignKey('luboil_equipment_type.code', ondelete='CASCADE'), nullable=False)

    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    
    # Relationships
    equipment_type = relationship("LuboilEquipmentType", back_populates="mappings")

    def __repr__(self):
        return f"<LuboilNameMapping('{self.lab_raw_string}' -> '{self.equipment_code}')>"

class Notification(Base):
    __tablename__ = 'notification'
    id = Column(Integer, primary_key=True, autoincrement=True)
    recipient_id = Column(UUID(as_uuid=True), nullable=False)  # FK dropped — cross-DB
    sender_name = Column(String(100))
    message = Column(String(500), nullable=False)
    notification_type = Column(String(50))  # 'mention', 'mandatory', 'status_change'
    imo = Column(String(7), nullable=True)
    equipment_code = Column(String(50), nullable=True)
    is_read = Column(Boolean, default=False)
    is_hidden = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP, default=func.current_timestamp())
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)

    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)

# Add to your models file
class LuboilEvent(Base):
    """Stores high-priority fleet-wide events for the Live Feed."""
    __tablename__ = 'luboil_event'

    event_id = Column(Integer, primary_key=True, autoincrement=True)
    vessel_name = Column(String(100))
    imo = Column(String(7))
    machinery_name = Column(String(100))
    equipment_code = Column(String(50))
    event_type = Column(String(50)) # 'STATUS_CHANGE', 'NEW_REPORT', 'EVIDENCE_UPLOAD', 'OVERDUE', 'MANDATORY'
    priority = Column(String(20)) # 'CRITICAL', 'WARNING', 'INFO', 'SUCCESS'
    message = Column(String(500))
    sample_id = Column(Integer, nullable=True) # For deep navigation
    recipient_id = Column(UUID(as_uuid=True), nullable=True, index=True)  # FK dropped — cross-DB
    created_at = Column(DateTime(timezone=True), default=func.current_timestamp())
    updated_at = Column(DateTime(timezone=True), default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)
    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    
class LuboilEventReadState(Base):
    """Tracks if a specific user has read a specific fleet event."""
    __tablename__ = 'luboil_event_read_state'

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(Integer, ForeignKey('luboil_event.event_id', ondelete='CASCADE'))
    user_id = Column(UUID(as_uuid=True), nullable=True)  # FK dropped — cross-DB
    is_read = Column(Boolean, default=False)
    read_at = Column(DateTime, nullable=True)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=True)

    version = Column(Integer, default=1, nullable=False)
    origin = Column(String(20), default="CLOUD", nullable=True)
    
    __table_args__ = (UniqueConstraint('event_id', 'user_id', name='uq_user_event_read'),)