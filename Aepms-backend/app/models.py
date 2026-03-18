# app/models.py (FINAL FULL REPLACEMENT - Added IMO/Name to WIDE Alerts & Fixed Dynamic Columns)
from datetime import datetime, date, time
from typing import Optional
from decimal import Decimal
import json
from sqlalchemy import (
    Column, Integer, String, DECIMAL, DATE, TIME, TIMESTAMP, TEXT,
    Boolean, ForeignKey, CheckConstraint, UniqueConstraint, func, Index, DateTime, Float
)
from sqlalchemy.orm import relationship, validates
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base

# =====================================================
# CORE UTILITIES FOR WIDE DEVIATION TABLES
# =====================================================

# 1. List of Core Metrics (Must match what is processed)
MAIN_ME_DEVIATION_METRICS = [
    "SFOC", "Pmax", "Turbospeed", "EngSpeed", "ScavAir", 
    "Exh_T_C_inlet", "Exh_Cylinder_outlet", "Exh_T_C_outlet", 
    "FIPI", "FOC"
]

def create_wide_alert_columns_spec(metric_list):
    """
    Creates a dictionary mapping column names to the **specifications** 
    needed to create the Column objects.
    """
    columns = {}
    for metric in metric_list:
        # Clean up metric name for DB (sfoc, pmax, exh_t_c_inlet)
        db_metric = metric.lower().replace('/', '_').replace('.', '').replace('-', '_')
        
        # Store a tuple of (type, kwargs)
        columns[f'{db_metric}_actual'] = (Float, {'nullable': True, 'comment': f"{metric} Actual Value"})
        columns[f'{db_metric}_baseline'] = (Float, {'nullable': True, 'comment': f"{metric} Baseline Value"})
        columns[f'{db_metric}_deviation'] = (Float, {'nullable': True, 'comment': f"{metric} Actual - Baseline"})
        columns[f'{db_metric}_deviation_pct'] = (Float, {'nullable': True, 'comment': f"{metric} Deviation %"})
        
    return columns

# 2. Generate the Column Specification Dictionary
ME_WIDE_DEVIATION_COLUMNS_SPEC = create_wide_alert_columns_spec(MAIN_ME_DEVIATION_METRICS)


# Helper function to assign the columns to the class safely
def _assign_wide_columns(cls_locals):
    """Assigns dynamically created Column objects to the class locals."""
    for name, spec in ME_WIDE_DEVIATION_COLUMNS_SPEC.items():
        # CRITICAL FIX: Create a NEW Column instance for each table
        cls_locals[name] = Column(spec[0], **spec[1])


# JSON serialization helpers for JSONB persistence (UNCHANGED)
class CustomJSONEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle Decimal and datetime objects."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            # Convert Decimal to string to preserve precision
            return str(obj)
        if isinstance(obj, (datetime, date, time)):
            return obj.isoformat()
        return json.JSONEncoder.default(self, obj)

def custom_json_serializer(obj):
    """Serialize Python objects to JSON string with support for Decimal and dates."""
    return json.dumps(obj, cls=CustomJSONEncoder)

# =====================================================
# MASTER DATA TABLES 
# =====================================================

class Organization(Base):
    __tablename__ = "organizations"
    
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False)
    domain = Column(String, unique=True, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationship
    users = relationship("User", back_populates="organization")

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String, nullable=False)
    email = Column(String, unique=True, nullable=False)
    job_title = Column(String, nullable=True, comment="e.g., Master, Chief Engineer, Superintendent")
    access_type = Column(String, default="SHORE", comment="VESSEL, SHORE, or ADMIN")
    assigned_vessels = Column(JSONB, nullable=True, comment="List of IMO numbers this user can see/manage")
    role = Column(String, default="user")
    organization_id = Column(Integer, ForeignKey('organizations.id'), nullable=True)
    organization = relationship("Organization", back_populates="users")
    is_active = Column(Boolean, default=True)
    auth_type = Column(String, default="microsoft")
    last_login = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String, nullable=True)
    permissions = Column(JSONB(none_as_null=True, astext_type=TEXT), nullable=True, comment="JSON permissions for page access")
    password_hash = Column(String, nullable=True, comment="Hashed password for local users")

class RolePermission(Base):
    __tablename__ = "role_permissions"
    id = Column(Integer, primary_key=True)
    role = Column(String, unique=True)
    can_view_performance = Column(Boolean, default=False)
    can_manage_users = Column(Boolean, default=False)
    can_edit_reports = Column(Boolean, default=False)
    can_access_admin_page = Column(Boolean, default=False)


class VesselInfo(Base):
    """Master data for vessels and their main engine."""
    __tablename__ = 'vessel_info'

    imo_number = Column(Integer, primary_key=True, comment="International Maritime Organization number (e.g., 9481697). Stored as integer as per data source.")
    vessel_id = Column(Integer, unique=True, autoincrement=True, nullable=True)
    display_order = Column(Integer, default=1000, nullable=True, comment="Custom integer for sorting vessels in fleet lists (1, 2, 3...)") 
    vessel_name = Column(String(100), nullable=False)
    engine_no = Column(String(50), unique=True, nullable=False, index=True, comment="Unique identifier for the engine within the system (e.g., STX S60MC-C No. 12345 or E<IMO>-ME1)")

    hull_no = Column(String(50), nullable=True)
    owner = Column(String(100), nullable=True)
    shipyard = Column(String(100), nullable=True)
    engine_maker = Column(String(50), nullable=True)
    engine_type = Column(String(50), nullable=True)
    engine_model = Column(String(50), nullable=True)
    number_of_cylinders = Column(Integer, nullable=True)
    propeller_pitch_mm = Column(DECIMAL(8, 2), nullable=True)
    sfoc_target_gm_kwh = Column(DECIMAL(6, 2), nullable=True)
    mcr_power_kw = Column(DECIMAL(8, 2), nullable=True)
    mcr_rpm = Column(DECIMAL(6, 2), nullable=True)
    mcr_limit_kw = Column(DECIMAL(10, 2), nullable=True, comment="MCR Power Limit in kW (after EPL/JMC)")
    mcr_limit_percentage = Column(DECIMAL(5, 2), nullable=True, comment="MCR Power Limit as a percentage of total MCR")
    csr_power_kw = Column(DECIMAL(8, 2), nullable=True, comment="Contracted Service Rating Power (kW) from STR.") 
    barred_speed_rpm_start = Column(DECIMAL(6, 2), nullable=True, comment="Start of the main engine barred speed range (rpm) from TVC.") 
    barred_speed_rpm_end = Column(DECIMAL(6, 2), nullable=True, comment="End of the main engine barred speed range (rpm) from TVC.") 
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    # Relationships
    shop_trial_sessions = relationship(
        "ShopTrialSession",
        back_populates="vessel",
        cascade="all, delete-orphan",
        lazy="select"
    )

    monthly_reports = relationship(
        "MonthlyReportHeader",
        back_populates="vessel",
        cascade="all, delete-orphan",
        lazy="select"
    )
    baseline_performance_data = relationship(
        "BaselinePerformanceData",
        back_populates="vessel",
        cascade="all, delete-orphan",
        lazy="select"
    )
    monthly_iso_performance_data = relationship(
        "MonthlyISOPerformanceData",
        back_populates="vessel",
        cascade="all, delete-orphan",
        lazy="select"
    )
    # FIX: Include the required relationship here
    generators = relationship(
        "VesselGenerator", 
        back_populates="vessel", 
        cascade="all, delete-orphan", 
        lazy="select"
    )

    # Constraints and Indexes
    __table_args__ = (
        CheckConstraint('mcr_power_kw > 0', name='ck_positive_mcr_power'),
        CheckConstraint('mcr_rpm > 0', name='ck_positive_mcr_rpm'),
        CheckConstraint('number_of_cylinders > 0', name='ck_positive_cylinders'),
        Index('ix_vessel_name', 'vessel_name'),
        CheckConstraint('imo_number > 0', name='ck_positive_imo_number')
    )

    def __repr__(self):
        return f"<VesselInfo(imo_number={self.imo_number}, vessel_name='{self.vessel_name}', engine_no='{self.engine_no}')>"

# =====================================================
# SHOP TRIAL DATA TABLES (UNCHANGED)
# =====================================================

class ShopTrialSession(Base):
    """Header for each Shop Trial Report."""
    __tablename__ = 'shop_trial_session'

    session_id = Column(Integer, primary_key=True, autoincrement=True)
    engine_no = Column(String(50), ForeignKey('vessel_info.engine_no', ondelete='CASCADE'), nullable=False, index=True)
    trial_date = Column(DATE, nullable=False)
    trial_type = Column(String(20), default='SHOP_TRIAL', nullable=False)
    conducted_by = Column(String(100), nullable=True)
    document_title = Column(String(100), nullable=True)
    document_reference = Column(String(50), nullable=True)
    room_temp_cold_condition_c = Column(DECIMAL(4, 1), nullable=True)
    lub_oil_temp_hot_condition_c = Column(DECIMAL(4, 1), nullable=True)
    lub_oil_temp_overall_c = Column(DECIMAL(4, 1), nullable=True)
    remarks = Column(TEXT, nullable=True)
    status = Column(String(20), default='COMPLETED', nullable=False)
    raw_report_url = Column(String, nullable=True, comment="URL to the raw Shop Trial PDF stored in Azure")
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    # Relationships
    vessel = relationship("VesselInfo", back_populates="shop_trial_sessions")
    performance_data = relationship(
        "ShopTrialPerformanceData",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="select"
    )

    # Constraints and Indexes
    __table_args__ = (
        CheckConstraint("trial_type IN ('SHOP_TRIAL', 'SEA_TRIAL', 'PERFORMANCE_TEST')", name='ck_trial_type'),
        CheckConstraint("status IN ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')", name='ck_status'),
        UniqueConstraint('engine_no', 'trial_date', name='uq_engine_trial_date'),
        Index('ix_session_engine_trial', 'engine_no', 'trial_date'),
        Index('ix_session_status', 'status'),
    )

    @validates('trial_type')
    def validate_trial_type(self, key, trial_type):
        allowed = ['SHOP_TRIAL', 'SEA_TRIAL', 'PERFORMANCE_TEST']
        if trial_type not in allowed:
            raise ValueError(f"trial_type must be one of {allowed}")
        return trial_type

    def __repr__(self):
        return f"<ShopTrialSession(engine_no='{self.engine_no}', trial_date='{self.trial_date}')>"

class ShopTrialPerformanceData(Base):
    """Detailed Performance Readings per Load Point."""
    __tablename__ = 'shop_trial_performance_data'

    performance_data_id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(Integer, ForeignKey('shop_trial_session.session_id', ondelete='CASCADE'), nullable=False, index=True)
    load_percentage = Column(DECIMAL(5, 1), nullable=False)
    test_sequence = Column(Integer, nullable=False, comment="Sequence number for multiple readings at the same load point if applicable")
    engine_output_kw = Column(DECIMAL(8, 0), nullable=False)

    # Environmental Conditions (Measured During Shop Trial)
    engine_speed_rpm = Column(DECIMAL(5, 1), nullable=True)
    room_temperature_c = Column(DECIMAL(4, 1), nullable=True)
    room_humidity_percent = Column(DECIMAL(4, 1), nullable=True)
    barometer_pressure_mbar = Column(DECIMAL(4, 0), nullable=True)
    tc_inlet_temp_c = Column(DECIMAL(3, 0), nullable=True)
    scav_air_temperature_c = Column(DECIMAL(3, 0), nullable=True)
    tc_outlet_back_press_mmaq = Column(DECIMAL(4, 0), nullable=True)

    # Cylinder Performance
    max_combustion_pressure_bar = Column(DECIMAL(5, 1), nullable=True)
    compression_pressure_bar = Column(DECIMAL(5, 1), nullable=True)
    mean_effective_pressure_bar = Column(DECIMAL(6, 2), nullable=True)
    fuel_injection_pump_index_mm = Column(DECIMAL(6, 1), nullable=True)

    # Temperature Measurements
    exh_temp_cylinder_outlet_ave_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_tc_inlet_c = Column(DECIMAL(4, 0), nullable=True)
    exh_temp_tc_outlet_c = Column(DECIMAL(4, 0), nullable=True)

    # Turbocharger Performance
    turbocharger_speed_x1000_rpm = Column(DECIMAL(4, 1), nullable=True)
    scav_air_pressure_bar = Column(DECIMAL(4, 2), nullable=True)
    turbocharger_gas_inlet_press_kg_cm2 = Column(DECIMAL(4, 2), nullable=True)

    # Fuel System
    fuel_oil_temperature_c = Column(DECIMAL(3, 0), nullable=True)
    fuel_oil_consumption_kg_h = Column(DECIMAL(7, 1), nullable=True)
    fuel_oil_consumption_g_kwh = Column(DECIMAL(5, 1), nullable=True)

    # ISO Corrected Values (from Shop Trial)
    max_combustion_pressure_iso_bar = Column(DECIMAL(5, 1), nullable=True)
    compression_pressure_iso_bar = Column(DECIMAL(5, 1), nullable=True)
    scav_air_pressure_iso_kg_cm2 = Column(DECIMAL(4, 2), nullable=True) # Shop trial also uses kg/cm2
    exh_temp_tc_inlet_iso_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_tc_outlet_iso_c = Column(DECIMAL(5, 1), nullable=True)
    turbocharger_speed_x1000_iso_rpm = Column(DECIMAL(4, 1), nullable=True)
    fuel_oil_consumption_iso_g_kwh = Column(DECIMAL(5, 1), nullable=True)

    # ISO Reference Conditions (These are the *load-dependent* values from the ISO Correction Data table)
    barometer_pressure_ref_mbar = Column(DECIMAL(4, 0), nullable=True)
    tc_inlet_temp_ref_c = Column(DECIMAL(3, 0), nullable=True)
    scav_air_temperature_ref_c = Column(DECIMAL(4, 1), nullable=True)
    tc_outlet_back_press_ref_mmaq = Column(DECIMAL(4, 0), nullable=True)

    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    # Relationships
    session = relationship("ShopTrialSession", back_populates="performance_data")

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint('session_id', 'load_percentage', 'test_sequence', name='uq_session_load_sequence'),
        CheckConstraint('load_percentage >= 0 AND load_percentage <= 110', name='ck_valid_load_percentage'),
        CheckConstraint('engine_output_kw > 0', name='ck_positive_power'),
        CheckConstraint('fuel_oil_consumption_g_kwh > 0', name='ck_positive_sfoc'),
        Index('ix_perf_session_load', 'session_id', 'load_percentage'),
        Index('ix_perf_load_sequence', 'load_percentage', 'test_sequence'),
    )

    @validates('load_percentage')
    def validate_load_percentage(self, key, load_percentage):
        if not (0 <= load_percentage <= 110):
            raise ValueError("Load percentage must be between 0 and 110")
        return load_percentage

    @validates('fuel_oil_consumption_g_kwh')
    def validate_sfoc(self, key, sfoc):
        if sfoc is not None and sfoc <= 0:
            raise ValueError("SFOC must be positive")
        if sfoc is not None and sfoc > 300: # Arbitrary high limit
            raise ValueError("SFOC seems unrealistically high (>300 g/kWh)")
        return sfoc

    def __repr__(self):
        return f"<ShopTrialPerformanceData(session_id={self.session_id}, load_percentage={self.load_percentage}%)>"

# =====================================================
# MONTHLY PERFORMANCE DATA TABLES (UPDATED with WIDE relationships)
# =====================================================

class MonthlyReportHeader(Base):
    """Key KPIs and identifying info from Monthly Sheet, including raw extracted data."""
    __tablename__ = 'monthly_report_header'

    report_id = Column(Integer, primary_key=True, autoincrement=True)

    imo_number = Column(Integer, ForeignKey('vessel_info.imo_number', ondelete='CASCADE'), nullable=False, index=True, comment="IMO number linking to VesselInfo. Stored as integer as per data source.")

    engine_identifier = Column(String(50), nullable=True, comment="Engine specific identifier from the report (e.g., 'E<IMO>-ME1'), if different from VesselInfo.engine_no")

    report_month = Column(String(20), nullable=False, comment="Format: 'YYYY-MM' e.g., '2025-03' for consistent sorting")
    report_date = Column(DATE, nullable=False)

    # Engine Operation Data
    engine_run_hrs = Column(DECIMAL(12, 2), nullable=True)
    epl_implemented = Column(Boolean, default=False, nullable=False)
    max_power_limit_kw = Column(DECIMAL(10, 2), nullable=True)
    max_load_limit_percent_after_epl = Column(DECIMAL(10, 2), nullable=True)
    load_percent = Column(DECIMAL(5, 2), nullable=True)
    rpm_percent = Column(DECIMAL(5, 2), nullable=True)
    rpm = Column(DECIMAL(6, 2), nullable=True) # Raw Engine Speed (RPM)

    # Power and Performance
    engine_indicated_power_kw = Column(DECIMAL(8, 2), nullable=True)
    effective_power_kw = Column(DECIMAL(8, 2), nullable=True)
    shaft_power_kw = Column(DECIMAL(8, 2), nullable=True)
    load_indicator = Column(DECIMAL(5, 2), nullable=True)

    # Engine Systems - Core Measured Averages (Raw Inputs for ISO Correction & Graphing)
    max_comb_pr_avg_bar = Column(DECIMAL(6, 2), nullable=True, comment="Average Max Combustion Pressure (PMax_m from JSON data)")
    comp_pr_avg_bar = Column(DECIMAL(6, 2), nullable=True, comment="Average Compression Pressure (PComp_m from JSON data)")
    scavenge_temp_c = Column(DECIMAL(4, 1), nullable=True)
    scavenge_pr_bar = Column(DECIMAL(4, 2), nullable=True) # Scavenge Pressure (Bar)

    tc_exhaust_gas_temp_in_c = Column(DECIMAL(5, 1), nullable=True, comment="T/C Inlet Exhaust Gas Temperature (Texh,inl_m from JSON data)")
    tc_exhaust_gas_temp_out_c = Column(DECIMAL(5, 1), nullable=True, comment="T/C Outlet Exhaust Gas Temperature (Texh,out_m from JSON data)")
    turbocharger_rpm_avg = Column(DECIMAL(8, 2), nullable=True, comment="Average Turbocharger RPM (TCrpm_m from JSON data)") # Raw Turbocharger RPM
    tc_air_inlet_temp_c = Column(DECIMAL(4, 1), nullable=True, comment="T/C Air Inlet Temperature (Tini_m from JSON data)")
    tc_filter_dp_mmh2o = Column(DECIMAL(6, 2), nullable=True, comment="T/C Filter Pressure Drop (Pback_m from JSON data), stored in mmH2O")

    sfoc_measured_g_kwh = Column(DECIMAL(6, 2), nullable=True, comment="Specific Fuel Oil Consumption - Measured from JSON data") # Raw SFOC (g/kWh)
    sfoc_calculated_g_kwh = Column(DECIMAL(7, 3), nullable=True, comment="Specific Fuel Oil Consumption - Calculated from JSON data")
    fo_consumption_mt_hr = Column(DECIMAL(6, 3), nullable=True, comment="Total Fuel Oil Consumption (MT/hr) from monthly report") # Raw Total FO Consumption (MT/hr)
    fuel_injection_pump_index_mm = Column(DECIMAL(6, 1), nullable=True, comment="Fuel Injection Pump Index (mm)") # Raw Fuel Injection Pump Index (mm)
    exh_temp_cylinder_outlet_ave_c = Column(DECIMAL(5, 1), nullable=True, comment="Exhaust Temp Cylinder Outlet Average (C)") # Raw Cyl Outlet Exh Temp (C)

    # Exhaust Gas Boiler
    egb_pressure_drop_mmh2o = Column(DECIMAL(10, 2), nullable=True) 
    # Vessel Conditions
    ship_condition = Column(String(50), nullable=True)
    displacement_mt = Column(DECIMAL(10, 2), nullable=True)
    draft_f = Column(DECIMAL(5, 2), nullable=True)
    draft_a = Column(DECIMAL(5, 2), nullable=True)
    trim_mtr = Column(DECIMAL(5, 2), nullable=True)

    cylinder_readings = Column(JSONB, nullable=True, comment="Stores 6 cylinder values for Pmax, Pcomp, Fuel Index, and Exh Temp")

    # Environmental and Operational
    wind_force = Column(String(50), nullable=True)
    sea_state = Column(String(50), nullable=True)
    weather = Column(String(50), nullable=True)
    location = Column(String(100), nullable=True)
    barometric_pressure_mmh2o = Column(DECIMAL(8, 3), nullable=True) # Stored in mmH2O (as per PDF label)
    sea_water_temp_c = Column(DECIMAL(4, 1), nullable=True)
    engine_room_temp_c = Column(DECIMAL(4, 1), nullable=True)

    # Navigation Data
    speed_gps_kn = Column(DECIMAL(5, 2), nullable=True)
    speed_log_kn = Column(DECIMAL(5, 2), nullable=True)
    speed_by_pitch_kn = Column(DECIMAL(5, 2), nullable=True)
    slip_percent = Column(DECIMAL(5, 2), nullable=True)

    # Test Session Data
    time_start = Column(TIME, nullable=True)
    time_finish = Column(TIME, nullable=True)
    revolution_counter_start = Column(DECIMAL(15, 2), nullable=True)
    revolution_counter_finish = Column(DECIMAL(15, 2), nullable=True)

    # Documentation
    measured_by = Column(String(100), nullable=True)
    chief_engineer_name = Column(String(100), nullable=True)
    tech_form_no = Column(String(100), nullable=True)
    edition_no = Column(Integer, nullable=True)
    revision_no = Column(Integer, nullable=True)
    revision_date = Column(DATE, nullable=True)
    raw_report_url = Column(String, nullable=True)       # Store Raw PDF URL
    generated_report_url = Column(String, nullable=True) # Store Analysis PDF URL

    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    # Relationships
    vessel = relationship("VesselInfo", back_populates="monthly_reports")
    details = relationship(
        "MonthlyReportDetailsJsonb",
        back_populates="header",
        cascade="all, delete-orphan",
        lazy="select"
    )
    iso_corrected_data = relationship(
        "MonthlyISOPerformanceData",
        back_populates="monthly_report_header",
        cascade="all, delete-orphan",
        lazy="select"
    )


    # Constraints and Indexes
    __table_args__ = (
        # UniqueConstraint('imo_number', 'report_date', name='uq_vessel_report_month'),
        CheckConstraint('engine_run_hrs >= 0', name='ck_positive_run_hours'),
        CheckConstraint('load_percent >= 0 AND load_percent <= 100', name='ck_valid_monthly_load'),
        Index('ix_monthly_imo_month', 'imo_number', 'report_month'),
        Index('ix_monthly_report_date', 'report_date'),
    )

    def __repr__(self):
        return f"<MonthlyReportHeader(imo_number={self.imo_number}, report_month='{self.report_month}')>"

class MonthlyReportDetailsJsonb(Base):
    """Flexible storage for detailed sections using JSONB."""
    __tablename__ = 'monthly_report_details_jsonb'

    detail_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, index=True)
    section_name = Column(String(100), nullable=False)
    data_jsonb = Column(JSONB(none_as_null=True, astext_type=TEXT), nullable=False, comment="JSONB column to store flexible, detailed data for a section")
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)

    # Relationships
    header = relationship("MonthlyReportHeader", back_populates="details")

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint('report_id', 'section_name', name='uq_report_section'),
        Index('ix_details_section', 'section_name'),
    )

    def __repr__(self):
        return f"<MonthlyReportDetailsJsonb(report_id={self.report_id}, section_name='{self.section_name}')>"

class MonthlyISOPerformanceData(Base):
    """Stores ISO corrected performance data for each monthly report, including values adjusted for common graph plotting units."""
    __tablename__ = 'monthly_iso_performance_data'

    iso_data_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, index=True)
    imo_number = Column(Integer, ForeignKey('vessel_info.imo_number', ondelete='CASCADE'), nullable=False, index=True)
    load_percentage = Column(DECIMAL(5, 2), nullable=False)
    correction_date = Column(DATE, nullable=False, comment="Date when the ISO correction was performed, typically report_date")

    # ISO Corrected Performance Values - UPDATED PRECISION
    max_combustion_pressure_iso_bar = Column(DECIMAL(8, 4), nullable=True)  # Changed from (6,4) to (8,4)
    compression_pressure_iso_bar = Column(DECIMAL(8, 4), nullable=True)     # Changed from (6,4) to (8,4)
    scav_air_pressure_iso_bar = Column(DECIMAL(6, 4), nullable=True)        # Changed from (4,4) to (6,4)
    exh_temp_tc_inlet_iso_c = Column(DECIMAL(7, 4), nullable=True)          # Changed from (5,4) to (7,4)
    exh_temp_tc_outlet_iso_c = Column(DECIMAL(7, 4), nullable=True)         # Changed from (5,4) to (7,4)
    turbocharger_speed_x1000_iso_rpm = Column(DECIMAL(7, 4), nullable=True) # Changed from (5,4) to (7,4)

    # Plotting-Ready Values - UPDATED PRECISION
    engine_speed_graph_rpm = Column(DECIMAL(6, 2), nullable=True, comment="Raw Measured Engine Speed (RPM) for plotting")
    scav_air_pressure_graph_kg_cm2 = Column(DECIMAL(6, 4), nullable=True, comment="ISO corrected Scavenge Air Pressure, converted to kg/cm2 for plotting")  # Changed from (4,4)
    cyl_exhaust_gas_temp_outlet_graph_c = Column(DECIMAL(5, 1), nullable=True, comment="Raw Measured Cylinder Outlet Exhaust Gas Temp (C) for plotting")
    fuel_consumption_total_graph_kg_h = Column(DECIMAL(8, 2), nullable=True, comment="Raw Measured Total Fuel Consumption (MT/hr converted to kg/h) for plotting")
    turbocharger_speed_graph_x1000_rpm_scaled = Column(DECIMAL(7, 4), nullable=True, comment="Raw Measured T/C Speed (RPM scaled by /1000) for plotting")  # Changed from (5,4)
    sfoc_graph_g_kwh = Column(DECIMAL(6, 2), nullable=True, comment="Raw Measured Specific Fuel Oil Consumption (g/kWh) for plotting")
    fuel_inj_pump_index_graph_mm = Column(DECIMAL(6, 1), nullable=True, comment="Raw Measured Fuel Injection Pump Index (mm) for plotting")
    propeller_margin_percent = Column(DECIMAL(6, 2), nullable=True, comment="Propeller Margin Percentage: (Actual Power / Service Power) * 100")
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    monthly_report_header = relationship("MonthlyReportHeader", back_populates="iso_corrected_data")
    vessel = relationship("VesselInfo", back_populates="monthly_iso_performance_data")

    __table_args__ = (
        UniqueConstraint('report_id', name='uq_monthly_iso_report_id'),
        CheckConstraint('load_percentage >= 0 AND load_percentage <= 110', name='ck_iso_valid_load'),
        Index('ix_iso_report_id', 'report_id'),
        Index('ix_iso_imo_load', 'imo_number', 'load_percentage'),
    )

    def __repr__(self):
        return f"<MonthlyISOPerformanceData(report_id={self.report_id}, load={self.load_percentage}%)>"


# =====================================================
# BASELINE/REFERENCE DATA (No change from last update)
# =====================================================

class BaselinePerformanceData(Base):
    """Baseline performance data (typically ISO corrected from shop trial) for comparison."""
    __tablename__ = 'baseline_performance_data'

    baseline_id = Column(Integer, primary_key=True, autoincrement=True)
    engine_no = Column(String(50), ForeignKey('vessel_info.engine_no', ondelete='CASCADE'), nullable=False, index=True)
    load_percentage = Column(DECIMAL(5, 1), nullable=False)
    baseline_type = Column(String(20), default='SHOP_TRIAL_ISO', nullable=False) # Changed default to reflect ISO corrected
    effective_date = Column(DATE, nullable=False, comment="The date from which this baseline is considered effective")

    # Reference Performance Values (ISO corrected from shop trial, for direct comparison)
    # These fields should directly map to the plotting-ready fields in MonthlyISOPerformanceData
    engine_speed_rpm = Column(DECIMAL(6, 2), nullable=True) # Aligned with graph axis
    fuel_oil_consumption_g_kwh = Column(DECIMAL(6, 2), nullable=True) # Aligned with graph axis
    max_combustion_pressure_bar = Column(DECIMAL(6, 4), nullable=True) # Aligned with graph axis (ISO corrected)
    compression_pressure_bar = Column(DECIMAL(6, 4), nullable=True) # ISO corrected
    scav_air_pressure_bar = Column(DECIMAL(4, 4), nullable=True) # ISO corrected in Bar
    scav_air_pressure_graph_kg_cm2 = Column(DECIMAL(4, 4), nullable=True) # ISO corrected and kg/cm2
    turbocharger_speed_x1000_rpm = Column(DECIMAL(5, 4), nullable=True) # ISO corrected (x1000 RPM)
    cyl_exhaust_gas_temp_outlet_c = Column(DECIMAL(5, 1), nullable=True) # Raw (from shop trial data)
    exh_temp_tc_inlet_c = Column(DECIMAL(5, 4), nullable=True) # ISO corrected
    exh_temp_tc_outlet_c = Column(DECIMAL(5, 4), nullable=True) # ISO corrected
    fuel_consumption_total_kg_h = Column(DECIMAL(8, 2), nullable=True) # Raw (from shop trial data)
    fuel_inj_pump_index_mm = Column(DECIMAL(6, 1), nullable=True) # Raw (from shop trial data)


    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)

    # Relationships
    vessel = relationship("VesselInfo", back_populates="baseline_performance_data")

    # Constraints and Indexes
    __table_args__ = (
        UniqueConstraint('engine_no', 'load_percentage', 'baseline_type', name='uq_baseline_engine_load'),
        CheckConstraint('load_percentage >= 0 AND load_percentage <= 110', name='ck_baseline_valid_load'),
        Index('ix_baseline_engine_load', 'engine_no', 'load_percentage'),
        CheckConstraint("baseline_type IN ('SHOP_TRIAL_ISO')", name='ck_baseline_type_allowed'), # Restrict baseline_type
    )

    def __repr__(self):
        return f"<BaselinePerformanceData(engine_no='{self.engine_no}', load={self.load_percentage}%)>"

class MEBaseAlert(Base):
    """Abstract base class for ME alert categorization"""
    __abstract__ = True
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, index=True, nullable=False)
    metric_name = Column(String(100), nullable=False)
    baseline_value = Column(Float, nullable=False)
    actual_value = Column(Float, nullable=False)
    deviation = Column(Float, nullable=False)
    deviation_pct = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class MENormalStatus(MEBaseAlert):
    """Main Engine metrics with normal deviation (≤5%)"""
    __tablename__ = "me_normal_status"


class MEWarningAlert(MEBaseAlert):
    """Main Engine metrics with warning deviation (>5% and ≤15%)"""
    __tablename__ = "me_warning_alert"


class MECriticalAlert(MEBaseAlert):
    """Main Engine metrics with critical deviation (>15%)"""
    __tablename__ = "me_critical_alert"
    
class MEAlertSummary(Base):
    """
    Precomputed summary of ME performance alerts per report.
    Stores counts and dominant status for fast dashboard queries.
    """
    __tablename__ = "me_alert_summary"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey("monthly_report_header.report_id", ondelete="CASCADE"), 
                      unique=True, nullable=False, index=True)
    
    # Vessel identification (denormalized for fast queries)
    vessel_name = Column(String(255), nullable=False)
    imo_number = Column(Integer, nullable=False, index=True)
    report_date = Column(DATE, nullable=False, index=True)
    report_month = Column(String(20), nullable=False, index=True)
    
    # Alert counts
    normal_count = Column(Integer, default=0, nullable=False)
    warning_count = Column(Integer, default=0, nullable=False)
    critical_count = Column(Integer, default=0, nullable=False)
    
    # Dominant status: 'Normal' | 'Warning' | 'Critical'
    dominant_status = Column(String(50), nullable=False, index=True)
    
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Constraints
    __table_args__ = (
        CheckConstraint("dominant_status IN ('Normal', 'Warning', 'Critical')", 
                       name='ck_valid_dominant_status'),
        CheckConstraint('normal_count >= 0', name='ck_positive_normal_count'),
        CheckConstraint('warning_count >= 0', name='ck_positive_warning_count'),
        CheckConstraint('critical_count >= 0', name='ck_positive_critical_count'),
        Index('ix_summary_status_date', 'dominant_status', 'report_date'),
        Index('ix_summary_imo_month', 'imo_number', 'report_month'),
    )
    
    def __repr__(self):
        return f"<MEAlertSummary(report_id={self.report_id}, status={self.dominant_status}, " \
               f"N={self.normal_count}, W={self.warning_count}, C={self.critical_count})>"
# Add this entire class after MEAlertSummary in models.py

class MEDeviationHistory(Base):
    """
    Stores historical deviation data for Main Engine performance metrics.
    Tracks actual vs baseline values with percentage deviations for trend analysis.
    Implements cylinder-wise analysis for Pmax, Pcomp, and Exhaust Temps.
    """
    __tablename__ = "me_deviation_history"

    # Primary Key
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Foreign Keys and Identifiers
    report_id = Column(Integer, ForeignKey('monthly_report_header.report_id', ondelete='CASCADE'), 
                      nullable=False, index=True, unique=True,
                      comment="Links to the monthly report")
    imo_number = Column(Integer, ForeignKey('vessel_info.imo_number', ondelete='CASCADE'), 
                       nullable=False, index=True)
    
    # Operating Conditions
    load_percentage = Column(DECIMAL(5, 2), nullable=True, comment="Engine load %")
    load_kw = Column(DECIMAL(8, 2), nullable=True, comment="Engine load in kW")
    engine_rpm_actual = Column(DECIMAL(6, 2), nullable=True, comment="Engine speed RPM")
    engine_rpm_baseline = Column(DECIMAL(6, 2), nullable=True)
    engine_rpm_dev = Column(DECIMAL(6, 2), nullable=True)
    engine_rpm_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # === CYLINDER-BASED METRICS (Worst Cylinder After Averaging) ===
    
    # Pmax (Maximum Combustion Pressure)
    pmax_actual = Column(DECIMAL(6, 2), nullable=True, comment="Worst cylinder Pmax (bar)")
    pmax_baseline = Column(DECIMAL(6, 2), nullable=True, comment="Interpolated baseline Pmax (bar)")
    pmax_dev = Column(DECIMAL(6, 2), nullable=True, comment="Pmax deviation (bar)")
    pmax_dev_pct = Column(DECIMAL(6, 2), nullable=True, comment="Pmax deviation %")

    # 2. AVERAGE (Global Engine Value) - NEW COLUMNS
    pmax_avg_actual = Column(DECIMAL(6, 2), nullable=True, comment="Average Pmax across all cylinders (ISO)") # <--- NEW
    pmax_avg_dev = Column(DECIMAL(6, 2), nullable=True) # <--- NEW
    pmax_avg_dev_pct = Column(DECIMAL(6, 2), nullable=True) # <--- NEW
    
    # Pcomp (Compression Pressure)
    pcomp_actual = Column(DECIMAL(6, 2), nullable=True, comment="Worst cylinder Pcomp (bar)")
    pcomp_baseline = Column(DECIMAL(6, 2), nullable=True, comment="Interpolated baseline Pcomp (bar)")
    pcomp_dev = Column(DECIMAL(6, 2), nullable=True, comment="Pcomp deviation (bar)")
    pcomp_dev_pct = Column(DECIMAL(6, 2), nullable=True, comment="Pcomp deviation %")

    # 2. AVERAGE - NEW COLUMNS
    pcomp_avg_actual = Column(DECIMAL(6, 2), nullable=True, comment="Average Pcomp across all cylinders (ISO)") # <--- NEW
    pcomp_avg_dev = Column(DECIMAL(6, 2), nullable=True) # <--- NEW
    pcomp_avg_dev_pct = Column(DECIMAL(6, 2), nullable=True) # <--- NEW
    
    # Exhaust Temperature (Cylinder Outlet)
    exhaust_cyl_actual = Column(DECIMAL(5, 1), nullable=True, comment="Worst cylinder exhaust temp (°C)")
    exhaust_cyl_baseline = Column(DECIMAL(5, 1), nullable=True, comment="Interpolated baseline exhaust temp (°C)")
    exhaust_cyl_dev = Column(DECIMAL(5, 1), nullable=True, comment="Exhaust temp deviation (°C)")
    exhaust_cyl_dev_pct = Column(DECIMAL(6, 2), nullable=True, comment="Exhaust temp deviation %")
    
    # === SINGLE-VALUE METRICS (Normal Deviation) ===
    
    # Scavenge Pressure
    scavenge_pressure_actual = Column(DECIMAL(4, 2), nullable=True, comment="Scavenge pressure (bar)")
    scavenge_pressure_baseline = Column(DECIMAL(4, 2), nullable=True)
    scavenge_pressure_dev = Column(DECIMAL(4, 2), nullable=True)
    scavenge_pressure_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # Turbocharger RPM
    turbo_rpm_actual = Column(DECIMAL(8, 2), nullable=True, comment="Turbocharger RPM")
    turbo_rpm_baseline = Column(DECIMAL(8, 2), nullable=True)
    turbo_rpm_dev = Column(DECIMAL(8, 2), nullable=True)
    turbo_rpm_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # T/C Outlet Temperature
    tc_out_actual = Column(DECIMAL(5, 1), nullable=True, comment="T/C outlet temp (°C)")
    tc_out_baseline = Column(DECIMAL(5, 1), nullable=True)
    tc_out_dev = Column(DECIMAL(5, 1), nullable=True)
    tc_out_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # T/C Inlet Temperature
    tc_in_actual = Column(DECIMAL(5, 1), nullable=True, comment="T/C inlet temp (°C)")
    tc_in_baseline = Column(DECIMAL(5, 1), nullable=True)
    tc_in_dev = Column(DECIMAL(5, 1), nullable=True)
    tc_in_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # Exhaust Average Temperature
    exhaust_avg_actual = Column(DECIMAL(5, 1), nullable=True, comment="Avg exhaust temp (°C)")
    exhaust_avg_baseline = Column(DECIMAL(5, 1), nullable=True)
    exhaust_avg_dev = Column(DECIMAL(5, 1), nullable=True)
    exhaust_avg_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # SFOC (Specific Fuel Oil Consumption)
    sfoc_actual = Column(DECIMAL(6, 2), nullable=True, comment="SFOC (g/kWh)")
    sfoc_baseline = Column(DECIMAL(6, 2), nullable=True)
    sfoc_dev = Column(DECIMAL(6, 2), nullable=True)
    sfoc_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # FOC (Fuel Oil Consumption)
    foc_actual = Column(DECIMAL(6, 3), nullable=True, comment="FOC (MT/hr)")
    foc_baseline = Column(DECIMAL(6, 3), nullable=True)
    foc_dev = Column(DECIMAL(6, 3), nullable=True)
    foc_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # Fuel Index (Pump Mark)
    fuel_index_actual = Column(DECIMAL(6, 1), nullable=True, comment="Fuel pump index (mm)")
    fuel_index_baseline = Column(DECIMAL(6, 1), nullable=True)
    fuel_index_dev = Column(DECIMAL(6, 1), nullable=True)
    fuel_index_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    # Propeller Margin
    propeller_margin_actual = Column(DECIMAL(6, 2), nullable=True, comment="Propeller margin %")
    propeller_margin_baseline = Column(DECIMAL(6, 2), nullable=True, comment="From shop trial if available")
    propeller_margin_dev = Column(DECIMAL(6, 2), nullable=True)
    propeller_margin_dev_pct = Column(DECIMAL(6, 2), nullable=True)
    
    
    # Timestamps
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Constraints and Indexes
    __table_args__ = (
        CheckConstraint('load_percentage >= 0 AND load_percentage <= 110', 
                       name='ck_me_dev_valid_load'),
        Index('ix_me_dev_report', 'report_id'),
        Index('ix_me_dev_imo_created', 'imo_number', 'created_at'),
    )
    
    def __repr__(self):
        return f"<MEDeviationHistory(report_id={self.report_id}, imo={self.imo_number}, load={self.load_percentage}%)>"

