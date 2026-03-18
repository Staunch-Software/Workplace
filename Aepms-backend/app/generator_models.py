# app/generator_models.py
# âœ… CORRECT VERSION - Matches actual database schema from Image 2

from sqlalchemy import (
    Column, Integer, String, DECIMAL, DATE, TIMESTAMP, TEXT,
    ForeignKey, CheckConstraint, UniqueConstraint, Index, func,JSON
)
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import JSONB

from .database import Base

class VesselGenerator(Base):
    """Master data for each of a vessel's auxiliary engines (generators)."""
    __tablename__ = 'vessel_generator'

    generator_id = Column(Integer, primary_key=True, autoincrement=True)
    imo_number = Column(Integer, ForeignKey('vessel_info.imo_number', ondelete='CASCADE'), nullable=False, index=True)
    engine_no = Column(String(50), unique=True, nullable=False, index=True)
    designation = Column(String(50), nullable=False)
    
    # âœ… CORRECT: These match your actual database columns (Image 2)
    engine_maker = Column(String(100), nullable=True, default='YANMAR')
    engine_model = Column(String(100), nullable=True, default='6EY18ALW')
    
    num_of_cylinders = Column(Integer, nullable=True, default=6)
    mcr_power_kw = Column(DECIMAL(8, 2), nullable=True)
    mcr_rpm = Column(DECIMAL(6, 2), nullable=True)
    shop_trial_report_url = Column(String, nullable=True) # <--- Add this line

    vessel = relationship("VesselInfo", back_populates="generators")
    baseline_data = relationship(
        "GeneratorBaselineData",
        back_populates="generator",
        cascade="all, delete-orphan",
        lazy="select"
    )
    monthly_reports = relationship(
        "GeneratorMonthlyReportHeader",
        back_populates="generator",
        cascade="all, delete-orphan",
        lazy="select"
    )

    reference_curves = relationship(
        "GeneratorReferenceCurve",
        back_populates="generator",
        cascade="all, delete-orphan",
        lazy="select"
    )

    __table_args__ = (
        UniqueConstraint('imo_number', 'designation', name='uq_vessel_generator_designation'),
    )


class GeneratorBaselineData(Base):
    """
    Stores shop trial baseline curve FOR EACH SPECIFIC GENERATOR.
    ðŸ”¥ KEY ISSUE: Must filter by generator_id, not just imo_number!
    """
    __tablename__ = 'generator_baseline_data'

    baseline_id = Column(Integer, primary_key=True, autoincrement=True)
    
    # ðŸ”¥ CRITICAL: generator_id is the primary filter key
    generator_id = Column(
        Integer, 
        ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), 
        nullable=False, 
        index=True,
        comment="Links baseline to specific generator (AE1, AE2, AE3, etc.)"
    )
    
    # Keep imo_number for convenience queries
    imo_number = Column(Integer, ForeignKey('vessel_info.imo_number', ondelete='CASCADE'), nullable=False, index=True)
    
    load_percentage = Column(DECIMAL(5, 1), nullable=False)
    load_kw = Column(DECIMAL(8, 2), nullable=False)

    # Baseline columns (matching your DB schema)
    pmax_raw_mpa = Column(DECIMAL(6, 2), nullable=True)
    pmax_graph_bar = Column(DECIMAL(6, 2), nullable=True)
    boost_air_pressure_raw_mpa = Column(DECIMAL(5, 3), nullable=True)
    boost_air_pressure_graph_bar = Column(DECIMAL(5, 2), nullable=True)
    exh_temp_tc_inlet_graph_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_cyl_outlet_avg_graph_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_tc_outlet_graph_c = Column(DECIMAL(5, 1), nullable=True)
    fuel_pump_index_graph = Column(DECIMAL(6, 2), nullable=True)
    sfoc_graph_g_kwh = Column(DECIMAL(6, 2), nullable=True)
    fuel_consumption_total_graph_kg_h = Column(DECIMAL(8, 2), nullable=True)
    
    # Additional columns for API compatibility
    engine_output_kw = Column(DECIMAL(8, 2), nullable=True)
    engine_speed_rpm = Column(DECIMAL(6, 2), nullable=True)
    max_combustion_pressure_bar = Column(DECIMAL(6, 2), nullable=True)
    compression_pressure_bar = Column(DECIMAL(6, 2), nullable=True)
    scav_air_pressure_bar = Column(DECIMAL(5, 2), nullable=True)
    turbocharger_speed_rpm = Column(DECIMAL(7, 1), nullable=True)
    exhaust_gas_temp_before_tc_c = Column(DECIMAL(5, 1), nullable=True)
    exhaust_gas_temp_after_tc_c = Column(DECIMAL(5, 1), nullable=True)
    fuel_rack_position_mm = Column(DECIMAL(6, 2), nullable=True)
    sfoc_g_kwh = Column(DECIMAL(6, 2), nullable=True)
    fuel_consumption_total_kg_h = Column(DECIMAL(8, 2), nullable=True)
    cylinder_readings = Column(JSON, nullable=True)
    
    vessel = relationship("VesselInfo")
    generator = relationship("VesselGenerator", back_populates="baseline_data")

    __table_args__ = (
        UniqueConstraint('generator_id', 'load_percentage', name='uq_generator_baseline_load_pct'),
        UniqueConstraint('generator_id', 'load_kw', name='uq_generator_baseline_load_kw'),
    )

class GeneratorReferenceCurve(Base):
    """
    Stores reference curve points (interpolated baselines) for specific parameters.
    """
    __tablename__ = "generator_reference_curves"

    curve_id = Column(Integer, primary_key=True, autoincrement=True)
    generator_id = Column(Integer, ForeignKey("vessel_generator.generator_id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Example values: 'pmax_bar', 'scav_air_pressure_bar'
    parameter_name = Column(String(100), nullable=False) 
    
    # Example: 25, 50, 75
    load_percent = Column(DECIMAL(5, 2), nullable=False) 
    
    # The value at that load
    value = Column(DECIMAL(10, 2), nullable=False)       

    # Relationship back to generator (using 'reference_curves' defined in VesselGenerator)
    generator = relationship("VesselGenerator", back_populates="reference_curves")

    __table_args__ = (
        UniqueConstraint('generator_id', 'parameter_name', 'load_percent', name='uq_gen_curve_point'),
    )
    
class GeneratorMonthlyReportHeader(Base):
    __tablename__ = 'generator_monthly_report_header'

    report_id = Column(Integer, primary_key=True, autoincrement=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), nullable=False, index=True)
    report_date = Column(DATE, nullable=False)
    report_month = Column(String(20), nullable=False)
    total_engine_run_hrs = Column(DECIMAL(10, 2), nullable=True)
    remarks = Column(TEXT, nullable=True)
    measured_by = Column(String(100), nullable=True)
    chief_engineer_name = Column(String(100), nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)

    generator = relationship("VesselGenerator", back_populates="monthly_reports")
    details_json = relationship("GeneratorMonthlyReportDetailsJsonb", back_populates="header", uselist=False, cascade="all, delete-orphan")
    graph_data = relationship("GeneratorPerformanceGraphData", back_populates="header", uselist=False, cascade="all, delete-orphan")
    raw_report_url = Column(String, nullable=True)
    generated_report_url = Column(String, nullable=True)
    cylinder_readings = Column(JSON, nullable=True)
    __table_args__ = (
        # UniqueConstraint('generator_id', 'report_date', name='uq_gen_report_date'),
        # Keep existing indexes
        Index('ix_gen_monthly_id_month', 'generator_id', 'report_month'),
    )
   

class GeneratorMonthlyReportDetailsJsonb(Base):
    __tablename__ = 'generator_monthly_report_details_jsonb'

    detail_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, unique=True)
    data_jsonb = Column(JSONB, nullable=False)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)

    header = relationship("GeneratorMonthlyReportHeader", back_populates="details_json")


class GeneratorPerformanceGraphData(Base):
    __tablename__ = 'generator_performance_graph_data'

    graph_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, unique=True)
    
    load_percentage = Column(DECIMAL(5, 2), nullable=True)
    load_kw = Column(DECIMAL(8, 2), nullable=True)
    
    pmax_graph_bar = Column(DECIMAL(6, 2), nullable=True)
    boost_air_pressure_graph_bar = Column(DECIMAL(5, 2), nullable=True)
    exh_temp_tc_inlet_graph_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_cyl_outlet_avg_graph_c = Column(DECIMAL(5, 1), nullable=True)
    exh_temp_tc_outlet_graph_c = Column(DECIMAL(5, 1), nullable=True)
    fuel_pump_index_graph = Column(DECIMAL(6, 2), nullable=True)
    
    engine_output_kw = Column(DECIMAL(8, 2), nullable=True)
    engine_speed_rpm = Column(DECIMAL(6, 2), nullable=True)
    max_combustion_pressure_bar = Column(DECIMAL(6, 2), nullable=True)
    compression_pressure_bar = Column(DECIMAL(6, 2), nullable=True)
    scav_air_pressure_bar = Column(DECIMAL(5, 2), nullable=True)
    turbocharger_speed_rpm = Column(DECIMAL(7, 1), nullable=True)
    exhaust_gas_temp_before_tc_c = Column(DECIMAL(5, 1), nullable=True)
    exhaust_gas_temp_after_tc_c = Column(DECIMAL(5, 1), nullable=True)
    fuel_rack_position_mm = Column(DECIMAL(6, 2), nullable=True)
    sfoc_g_kwh = Column(DECIMAL(6, 2), nullable=True)
    fuel_consumption_total_kg_h = Column(DECIMAL(8, 2), nullable=True)



    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)

    header = relationship("GeneratorMonthlyReportHeader", back_populates="graph_data")


# Alert Models
class AENormalStatus(Base):
    __tablename__ = 'ae_normal_status'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, index=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False)
    baseline_value = Column(DECIMAL(10, 2), nullable=True)
    actual_value = Column(DECIMAL(10, 2), nullable=True)
    deviation = Column(DECIMAL(10, 2), nullable=True)
    deviation_pct = Column(DECIMAL(6, 2), nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)


class AEWarningAlert(Base):
    __tablename__ = 'ae_warning_alert'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, index=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False)
    baseline_value = Column(DECIMAL(10, 2), nullable=True)
    actual_value = Column(DECIMAL(10, 2), nullable=True)
    deviation = Column(DECIMAL(10, 2), nullable=True)
    deviation_pct = Column(DECIMAL(6, 2), nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)


class AECriticalAlert(Base):
    __tablename__ = 'ae_critical_alert'
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, index=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), nullable=False, index=True)
    metric_name = Column(String(100), nullable=False)
    baseline_value = Column(DECIMAL(10, 2), nullable=True)
    actual_value = Column(DECIMAL(10, 2), nullable=True)
    deviation = Column(DECIMAL(10, 2), nullable=True)
    deviation_pct = Column(DECIMAL(6, 2), nullable=True)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)


class AEAlertSummary(Base):
    __tablename__ = 'ae_alert_summary'
    
    summary_id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), nullable=False, unique=True, index=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'), nullable=False, index=True)
    vessel_name = Column(String(100), nullable=False)
    generator_designation = Column(String(50), nullable=False)
    imo_number = Column(Integer, nullable=False, index=True)
    report_date = Column(DATE, nullable=False, index=True)
    report_month = Column(String(20), nullable=False, index=True)
    normal_count = Column(Integer, default=0, nullable=False)
    warning_count = Column(Integer, default=0, nullable=False)
    critical_count = Column(Integer, default=0, nullable=False)
    dominant_status = Column(String(20), nullable=False)
    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
    updated_at = Column(TIMESTAMP, default=func.current_timestamp(), onupdate=func.current_timestamp(), nullable=False)
class AEDeviationHistory(Base):
    __tablename__ = "ae_deviation_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    report_id = Column(Integer, ForeignKey('generator_monthly_report_header.report_id', ondelete='CASCADE'), 
                       nullable=False, index=True)
    generator_id = Column(Integer, ForeignKey('vessel_generator.generator_id', ondelete='CASCADE'),
                          nullable=False, index=True)

    # Load
    load_percentage = Column(DECIMAL(5, 2), nullable=False)
    load_kw = Column(DECIMAL(8, 2), nullable=False)

    # Actual & Baseline & Deviations for each parameter
    pmax_actual = Column(DECIMAL(8,2))
    pmax_baseline = Column(DECIMAL(8,2))
    pmax_dev = Column(DECIMAL(8,2))
    pmax_dev_pct = Column(DECIMAL(8,2))

     # 2. AVERAGE (New)
    pmax_avg_actual = Column(DECIMAL(8,2), comment="Average of all cylinders") # <--- NEW
    pmax_avg_baseline = Column(DECIMAL(8,2))
    pmax_avg_dev = Column(DECIMAL(8,2))        # <--- NEW
    pmax_avg_dev_pct = Column(DECIMAL(8,2))    # <--- NEW

    
    pcomp_actual = Column(DECIMAL(8,2))
    pcomp_baseline = Column(DECIMAL(8,2))
    pcomp_dev = Column(DECIMAL(8,2))
    pcomp_dev_pct = Column(DECIMAL(8,2))

    scav_air_actual = Column(DECIMAL(8,2))
    scav_air_baseline = Column(DECIMAL(8,2))
    scav_air_dev = Column(DECIMAL(8,2))
    scav_air_dev_pct = Column(DECIMAL(8,2))

    tc_in_actual = Column(DECIMAL(8,2))
    tc_in_baseline = Column(DECIMAL(8,2))
    tc_in_dev = Column(DECIMAL(8,2))
    tc_in_dev_pct = Column(DECIMAL(8,2))

    tc_out_actual = Column(DECIMAL(8,2))
    tc_out_baseline = Column(DECIMAL(8,2))
    tc_out_dev = Column(DECIMAL(8,2))
    tc_out_dev_pct = Column(DECIMAL(8,2))

    exh_cyl_out_actual = Column(DECIMAL(8,2))
    exh_cyl_out_baseline = Column(DECIMAL(8,2))
    exh_cyl_out_dev = Column(DECIMAL(8,2))
    exh_cyl_out_dev_pct = Column(DECIMAL(8,2))

    turbo_speed_actual = Column(DECIMAL(8,2))
    turbo_speed_baseline = Column(DECIMAL(8,2))
    turbo_speed_dev = Column(DECIMAL(8,2))
    turbo_speed_dev_pct = Column(DECIMAL(8,2))

    fuel_rack_actual = Column(DECIMAL(8,2))
    fuel_rack_baseline = Column(DECIMAL(8,2))
    fuel_rack_dev = Column(DECIMAL(8,2))
    fuel_rack_dev_pct = Column(DECIMAL(8,2))

    sfoc_actual = Column(DECIMAL(8,2))
    sfoc_baseline = Column(DECIMAL(8,2))
    sfoc_dev = Column(DECIMAL(8,2))
    sfoc_dev_pct = Column(DECIMAL(8,2))

    foc_actual = Column(DECIMAL(8,2))
    foc_baseline = Column(DECIMAL(8,2))
    foc_dev = Column(DECIMAL(8,2))
    foc_dev_pct = Column(DECIMAL(8,2))

    created_at = Column(TIMESTAMP, default=func.current_timestamp(), nullable=False)
