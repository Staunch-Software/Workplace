# app/ae_alert_processor.py
"""
Auxiliary Engine Alert Processor
Calculates deviations from baseline and categorizes alerts into Normal/Warning/Critical
based on the thresholds defined in the reference documentation.
"""

import logging
from decimal import Decimal
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func

from app.generator_models import (
    VesselGenerator,
    GeneratorBaselineData,
    GeneratorMonthlyReportHeader,
    GeneratorPerformanceGraphData,
    AENormalStatus,
    AEWarningAlert,
    AECriticalAlert,
    AEAlertSummary
)
from app.models import VesselInfo

logger = logging.getLogger(__name__)

# =================================================================
# THRESHOLD CONFIGURATION (from reference image)
# =================================================================

# THRESHOLDS = {
#     'pmax_graph_bar': {
#         'name': 'Pmax (Bar)',
#         'normal_max': 3.0,      # ≤3%
#         'warning_max': 5.0,     # 3%-5%
#         'critical_min': 5.0,    # ≥5%
#         'deviation_type': 'two_sided'
#     },
#     'boost_air_pressure_graph_bar': {
#         'name': 'Boost Air Pressure (Bar)',
#         'normal_max': 3.0,
#         'warning_max': 5.0,
#         'critical_min': 5.0,
#         'deviation_type': 'two_sided'
#     },
#     'exh_temp_tc_inlet_graph_c': {
#         'name': 'Exh T/C Inlet (°C)',
#         'normal_max': 3.0,
#         'warning_max': 5.0,
#         'critical_min': 5.0,
#         'deviation_type': 'positive_only'
#     },
#     'exh_temp_cyl_outlet_avg_graph_c': {
#         'name': 'Exh Cylinder Outlet (°C)',
#         'normal_max': 3.0,
#         'warning_max': 5.0,
#         'critical_min': 5.0,
#         'deviation_type': 'positive_only'
#     },
#     'exh_temp_tc_outlet_graph_c': {
#         'name': 'Exh T/C Outlet (°C)',
#         'normal_max': 3.0,
#         'warning_max': 5.0,
#         'critical_min': 5.0,
#         'deviation_type': 'positive_only'
#     },
#     'fuel_pump_index_graph': {
#         'name': 'FIPI (Index)',
#         'normal_max': 2.0,      # baseline+2
#         'warning_max': 3.5,     # baseline+2 to baseline+3.5
#         'critical_min': 3.5,    # ≥baseline+3.5
#         'deviation_type': 'absolute'  # Special handling - compare against baseline+offset
#     }
# }
THRESHOLDS = {
    # --- GROUP A: Pressures & Speeds (Amber @ 3%, Red @ 5%) ---
    'pmax_graph_bar': {'name': 'Pmax', 'type': 'percent_3_5'},
    'compression_pressure_bar': {'name': 'Pcomp', 'type': 'percent_3_5'},
    'engine_speed_rpm': {'name': 'EngSpeed', 'type': 'percent_3_5'},

    # --- TURBO GROUP: Absolute RPM (Amber @ 500, Red @ 1000) ---
    'turbocharger_speed_rpm': {
        'name': 'TurboSpeed', 
        'type': 'absolute_500_1000' # Changed from percent
    },

    # --- GROUP B: Scavenge, Index, SFOC (Amber @ 5%, Red @ 10%) ---
    # Note: Ensure this key matches your DB column (boost_air_pressure vs scav_air_pressure)
    'boost_air_pressure_graph_bar': {'name': 'ScavAir', 'type': 'percent_5_10'},
    'fuel_pump_index_graph': {'name': 'Fuel Index', 'type': 'percent_5_10'},
    'sfoc_graph_g_kwh': {'name': 'SFOC', 'type': 'percent_5_10'},

    # --- TEMPERATURE GROUP: Absolute Degrees (Amber @ 40°C, Red @ 60°C) ---
    'exh_temp_tc_inlet_graph_c': {'name': 'Exh T/C In', 'type': 'temperature_40_60'},
    'exh_temp_tc_outlet_graph_c': {'name': 'Exh T/C Out', 'type': 'temperature_40_60'},
    'exh_temp_cyl_outlet_avg_graph_c': {'name': 'Exh Cyl Out', 'type': 'temperature_40_60'}
}

# =================================================================
# CORE CALCULATION FUNCTIONS
# =================================================================

def calculate_deviation(baseline: Decimal, actual: Decimal, deviation_type: str) -> Dict[str, Optional[Decimal]]:
    """
    Calculate deviation based on type.
    
    Args:
        baseline: Baseline value from shop trial
        actual: Actual measured value
        deviation_type: 'two_sided', 'positive_only', or 'absolute'
    
    Returns:
        Dict with 'deviation' (absolute) and 'deviation_pct' (percentage)
    """
    if baseline is None or actual is None or baseline == Decimal('0'):
        return {'deviation': None, 'deviation_pct': None}
    
    deviation = actual - baseline
    
    if deviation_type == 'positive_only':
        # Only consider positive deviations (increases)
        if deviation < 0:
            return {'deviation': Decimal('0'), 'deviation_pct': Decimal('0')}
        deviation_pct = (deviation / baseline * Decimal('100')).quantize(Decimal('0.01'))
        
    elif deviation_type == 'two_sided':
        # Consider both positive and negative deviations
        deviation_pct = (abs(deviation) / baseline * Decimal('100')).quantize(Decimal('0.01'))
        
    elif deviation_type == 'absolute':
        # For FIPI - deviation is just the absolute difference (not percentage)
        deviation_pct = deviation.quantize(Decimal('0.01'))
    
    else:
        return {'deviation': None, 'deviation_pct': None}
    
    return {
        'deviation': deviation.quantize(Decimal('0.01')),
        'deviation_pct': deviation_pct
    }


def classify_alert(deviation_pct: Decimal, absolute_diff: Decimal, metric_config: Dict) -> str:
    if deviation_pct is None or absolute_diff is None:
        return 'Normal'
    
    abs_diff = abs(absolute_diff)
    abs_dev = abs(deviation_pct)
    logic_type = metric_config['type']

    # 1. Turbo Logic (Absolute RPM)
    if logic_type == 'absolute_500_1000':
        if abs_diff >= Decimal('1000.0'): return 'Critical'
        if abs_diff >= Decimal('500.0'): return 'Warning'
        return 'Normal'

    # 2. Exhaust Temperature Logic (Absolute Degrees)
    elif logic_type == 'temperature_40_60':
        if abs_diff > Decimal('60.0'): return 'Critical'
        if abs_diff >= Decimal('40.0'): return 'Warning'
        return 'Normal'

    # 3. Group A Logic (3% / 5% Percentage)
    elif logic_type == 'percent_3_5':
        if abs_dev > Decimal('5.0'): return 'Critical'
        if abs_dev >= Decimal('3.0'): return 'Warning'
        return 'Normal'

    # 4. Group B Logic (5% / 10% Percentage)
    elif logic_type == 'percent_5_10':
        if abs_dev > Decimal('10.0'): return 'Critical'
        if abs_dev >= Decimal('5.0'): return 'Warning'
        return 'Normal'

    return 'Normal'

def interpolate_baseline(baseline_low, baseline_high, load_pct, metric_key):
    """
    Linear interpolation of baseline values between two nearest load points.
    """
    low_load = baseline_low.load_percentage
    high_load = baseline_high.load_percentage

    # If load matches exactly, return that baseline value
    if low_load == high_load:
        return getattr(baseline_low, metric_key)

    low_val = getattr(baseline_low, metric_key)
    high_val = getattr(baseline_high, metric_key)

    if low_val is None or high_val is None:
        return None

    # Linear interpolation formula
    return low_val + ((load_pct - low_load) / (high_load - low_load)) * (high_val - low_val)

# =================================================================
# MAIN ALERT PROCESSING FUNCTION
# =================================================================

def process_ae_alerts(session: Session, report_id: int) -> Dict[str, Any]:
    """
    Main function to process AE alerts for a given report.
    
    Process:
    1. Fetch baseline data (shop trial)
    2. Fetch actual data (monthly report)
    3. Calculate deviations for each metric
    4. Classify into Normal/Warning/Critical
    5. Store in respective tables
    6. Update summary table
    
    Args:
        session: SQLAlchemy session
        report_id: Generator report ID
    
    Returns:
        Dict with alert counts and status
    """
    logger.info(f"🔍 Processing AE alerts for report_id={report_id}")
    
    try:
        # 1. Get report header and generator info
        header = session.query(GeneratorMonthlyReportHeader).filter_by(
            report_id=report_id
        ).first()
        
        if not header:
            raise ValueError(f"Report {report_id} not found")
        
        generator = session.query(VesselGenerator).filter_by(
            generator_id=header.generator_id
        ).first()
        
        if not generator:
            raise ValueError(f"Generator {header.generator_id} not found")
        
        vessel = session.query(VesselInfo).filter_by(
            imo_number=generator.imo_number
        ).first()
        
        if not vessel:
            raise ValueError(f"Vessel with IMO {generator.imo_number} not found")
        
        # 2. Get actual performance data
        actual_data = session.query(GeneratorPerformanceGraphData).filter_by(
            report_id=report_id
        ).first()
        
        if not actual_data:
            raise ValueError(f"No graph data found for report {report_id}")
        
        # 3. Get baseline data at matching load percentage
        load_pct = actual_data.load_percentage
        if not load_pct:
            raise ValueError(f"Load percentage not found in report {report_id}")
        
        # Find nearest lower and higher baseline load points
        baseline_low = session.query(GeneratorBaselineData).filter(
            GeneratorBaselineData.generator_id == generator.generator_id, # MUST BE generator_id
            GeneratorBaselineData.load_percentage <= load_pct
        ).order_by(GeneratorBaselineData.load_percentage.desc()).first()

        baseline_high = session.query(GeneratorBaselineData).filter(
            GeneratorBaselineData.generator_id == generator.generator_id, # MUST BE generator_id
            GeneratorBaselineData.load_percentage >= load_pct
        ).order_by(GeneratorBaselineData.load_percentage.asc()).first()

        if not baseline_low or not baseline_high:
            raise ValueError(f"Not enough baseline points to interpolate at load {load_pct}%")

        logger.info(f"✓ Load interpolation between {baseline_low.load_percentage}% and {baseline_high.load_percentage}% for actual {load_pct}%")

        # 4. Clear existing alerts for this report
        session.query(AENormalStatus).filter_by(report_id=report_id).delete()
        session.query(AEWarningAlert).filter_by(report_id=report_id).delete()
        session.query(AECriticalAlert).filter_by(report_id=report_id).delete()
        
        # 5. Process each metric
        alert_counts = {'normal': 0, 'warning': 0, 'critical': 0}
        
        for metric_key, metric_config in THRESHOLDS.items():
            baseline_value = interpolate_baseline(baseline_low, baseline_high, load_pct, metric_key)
            actual_value = getattr(actual_data, metric_key, None)
            logger.debug(
             f"Interpolated baseline for {metric_key}: {baseline_value} using loads "
             f"{baseline_low.load_percentage}% / {baseline_high.load_percentage}% for actual load {load_pct}%"
            )
            
            if baseline_value is None or actual_value is None:
                logger.debug(f"⊘ Skipping {metric_key} - missing data")
                continue
            
            # Calculate deviation
            dev_result = calculate_deviation(
                baseline_value,
                actual_value,
                'two_sided' # Frontend uses absDiff / absDev, so two_sided is correct
            )
            
            if dev_result['deviation_pct'] is None:
                continue
            
            # Classify alert
            alert_level = classify_alert(
                deviation_pct=dev_result['deviation_pct'], 
                absolute_diff=dev_result['deviation'], 
                metric_config=metric_config
            )
            
            # Prepare common data
            alert_data = {
                'report_id': report_id,
                'generator_id': generator.generator_id,
                'metric_name': metric_config['name'],
                'baseline_value': baseline_value,
                'actual_value': actual_value,
                'deviation': dev_result['deviation'],
                'deviation_pct': dev_result['deviation_pct']
            }
            
            # Store in appropriate table
            if alert_level == 'Normal':
                session.add(AENormalStatus(**alert_data))
                alert_counts['normal'] += 1
                logger.debug(f"✓ Normal: {metric_config['name']} = {dev_result['deviation_pct']}%")
                
            elif alert_level == 'Warning':
                session.add(AEWarningAlert(**alert_data))
                alert_counts['warning'] += 1
                logger.warning(f"⚠ Warning: {metric_config['name']} = {dev_result['deviation_pct']}%")
                
            elif alert_level == 'Critical':
                session.add(AECriticalAlert(**alert_data))
                alert_counts['critical'] += 1
                logger.error(f"🔴 Critical: {metric_config['name']} = {dev_result['deviation_pct']}%")
        
        # 6. Update summary table
        update_ae_alert_summary(
            session=session,
            report_id=report_id,
            generator_id=generator.generator_id,
            vessel_name=vessel.vessel_name,
            generator_designation=generator.designation,
            imo_number=generator.imo_number,
            report_date=header.report_date,
            report_month=header.report_month,
            alert_counts=alert_counts
        )
        
        session.commit()
        logger.info(f"✅ Alert processing complete: {alert_counts}")
        
        return {
            'success': True,
            'report_id': report_id,
            'generator_designation': generator.designation,
            'alert_counts': alert_counts,
            'dominant_status': _determine_dominant_status(alert_counts)
        }
        
    except Exception as e:
        logger.error(f"❌ Error processing AE alerts: {e}", exc_info=True)
        session.rollback()
        raise


# =================================================================
# SUMMARY UPDATE FUNCTION
# =================================================================

def update_ae_alert_summary(
    session: Session,
    report_id: int,
    generator_id: int,
    vessel_name: str,
    generator_designation: str,
    imo_number: int,
    report_date,
    report_month: str,
    alert_counts: Dict[str, int]
):
    """Update or create AE alert summary for fast dashboard queries."""
    
    dominant_status = _determine_dominant_status(alert_counts)
    
    # Check if summary exists
    summary = session.query(AEAlertSummary).filter_by(report_id=report_id).first()
    
    if summary:
        # Update existing
        summary.normal_count = alert_counts['normal']
        summary.warning_count = alert_counts['warning']
        summary.critical_count = alert_counts['critical']
        summary.dominant_status = dominant_status
        logger.info(f"📝 Updated AE alert summary for report {report_id}")
    else:
        # Create new
        summary = AEAlertSummary(
            report_id=report_id,
            generator_id=generator_id,
            vessel_name=vessel_name,
            generator_designation=generator_designation,
            imo_number=imo_number,
            report_date=report_date,
            report_month=report_month,
            normal_count=alert_counts['normal'],
            warning_count=alert_counts['warning'],
            critical_count=alert_counts['critical'],
            dominant_status=dominant_status
        )
        session.add(summary)
        logger.info(f"✨ Created AE alert summary for report {report_id}")


def _determine_dominant_status(alert_counts: Dict[str, int]) -> str:
    """
    Determine overall status based on alert counts.
    Priority: Critical > Warning > Normal
    """
    if alert_counts['critical'] > 0:
        return 'Critical'
    elif alert_counts['warning'] > 0:
        return 'Warning'
    else:
        return 'Normal'


# =================================================================
# API HELPER FUNCTIONS
# =================================================================

def get_ae_alerts_by_report(session: Session, report_id: int) -> Dict[str, Any]:
    """
    Fetch all AE alerts for a specific report (for API endpoint).
    """
    try:
        normal_alerts = session.query(AENormalStatus).filter_by(report_id=report_id).all()
        warning_alerts = session.query(AEWarningAlert).filter_by(report_id=report_id).all()
        critical_alerts = session.query(AECriticalAlert).filter_by(report_id=report_id).all()
        
        def alert_to_dict(alert):
            return {
                "id": alert.id,
                "metric_name": alert.metric_name,
                "baseline_value": float(alert.baseline_value) if alert.baseline_value else None,
                "actual_value": float(alert.actual_value) if alert.actual_value else None,
                "deviation": float(alert.deviation) if alert.deviation else None,
                "deviation_pct": float(alert.deviation_pct) if alert.deviation_pct else None,
                "created_at": alert.created_at.isoformat() if alert.created_at else None
            }
        
        return {
            "report_id": report_id,
            "total_alerts": len(normal_alerts) + len(warning_alerts) + len(critical_alerts),
            "normal": [alert_to_dict(a) for a in normal_alerts],
            "warning": [alert_to_dict(a) for a in warning_alerts],
            "critical": [alert_to_dict(a) for a in critical_alerts]
        }
        
    except Exception as e:
        logger.error(f"Error fetching AE alerts: {e}", exc_info=True)
        raise


def get_ae_alert_summary(session: Session, report_id: int) -> Dict[str, Any]:
    """
    Fetch precomputed AE alert summary (O(1) query for dashboard).
    """
    try:
        summary = session.query(AEAlertSummary).filter_by(report_id=report_id).first()
        
        if not summary:
            raise ValueError(f"No AE alert summary found for report {report_id}")
        
        return {
            "report_id": summary.report_id,
            "generator_designation": summary.generator_designation,
            "vessel_name": summary.vessel_name,
            "imo_number": summary.imo_number,
            "report_date": summary.report_date.isoformat(),
            "report_month": summary.report_month,
            "alert_counts": {
                "normal": summary.normal_count,
                "warning": summary.warning_count,
                "critical": summary.critical_count,
                "total": summary.normal_count + summary.warning_count + summary.critical_count
            },
            "dominant_status": summary.dominant_status,
            "created_at": summary.created_at.isoformat(),
            "updated_at": summary.updated_at.isoformat()
        }
        
    except Exception as e:
        logger.error(f"Error fetching AE alert summary: {e}", exc_info=True)
        raise