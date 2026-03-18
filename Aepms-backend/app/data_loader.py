# app/data_loader.py (REFINED)
# app/data_loader.py (OPTIMIZED)
import logging
import re
from typing import Dict, List, Any, Optional, Tuple, Set
from datetime import datetime, date
from dataclasses import dataclass, field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy import and_, select, exists
from sqlalchemy.dialects.postgresql import insert
from .database import get_db_session_context
from .models import (
    VesselInfo, 
    ShopTrialSession, 
    ShopTrialPerformanceData,
    MonthlyReportHeader,
    MonthlyReportDetailsJsonb,
    BaselinePerformanceData
)

logger = logging.getLogger(__name__)

@dataclass
class LoadingStats:
    """Statistics tracking for data loading operations."""
    vessels_inserted: int = 0
    vessels_updated: int = 0
    sessions_inserted: int = 0
    sessions_updated: int = 0
    performance_records_inserted: int = 0
    performance_records_updated: int = 0
    deflection_records_inserted: int = 0
    bearing_records_inserted: int = 0
    monthly_headers_inserted: int = 0
    monthly_headers_updated: int = 0
    monthly_details_inserted: int = 0
    monthly_details_updated: int = 0
    errors: List[Dict[str, str]] = field(default_factory=list)
    
    def add_error(self, message: str, context: str = "", record_info: str = ""):
        """Add an error to the tracking list."""
        error_entry = {
            'timestamp': datetime.now().isoformat(),
            'message': message,
            'context': context,
            'record_info': record_info
        }
        self.errors.append(error_entry)
        logger.error(f"[{context}] {message} | Record: {record_info}")
    
    def get_summary(self) -> str:
        """Get a formatted summary of loading statistics."""
        total_inserted = (self.vessels_inserted + self.sessions_inserted + 
                         self.performance_records_inserted + self.deflection_records_inserted +
                         self.bearing_records_inserted + self.monthly_headers_inserted +
                         self.monthly_details_inserted)
        
        total_updated = (self.vessels_updated + self.sessions_updated + 
                        self.performance_records_updated + self.monthly_headers_updated +
                        self.monthly_details_updated)
        
        return f"""
╔══════════════════════════════════════════════════════════════════════════════╗
║                            DATA LOADING SUMMARY                              ║
╠══════════════════════════════════════════════════════════════════════════════╣
║ VESSELS:                                                                     ║
║   • Inserted: {self.vessels_inserted:6d}    • Updated: {self.vessels_updated:6d}                                     ║
║                                                                              ║
║ SHOP TRIAL DATA:                                                             ║
║   • Sessions Inserted: {self.sessions_inserted:6d}    • Sessions Updated: {self.sessions_updated:6d}                  ║
║   • Performance Records Inserted: {self.performance_records_inserted:6d}                                ║
║   • Performance Records Updated:   {self.performance_records_updated:6d}                                ║
║   • Deflection Records: {self.deflection_records_inserted:6d}                                           ║
║   • Bearing Records:    {self.bearing_records_inserted:6d}                                           ║
║                                                                              ║
║ MONTHLY REPORTS:                                                             ║
║   • Headers Inserted: {self.monthly_headers_inserted:6d}    • Headers Updated: {self.monthly_headers_updated:6d}                 ║
║   • Details Inserted: {self.monthly_details_inserted:6d}    • Details Updated: {self.monthly_details_updated:6d}                 ║
║                                                                              ║
║ TOTALS:                                                                      ║
║   • Total Inserted: {total_inserted:6d}                                                     ║
║   • Total Updated:  {total_updated:6d}                                                     ║
║   • Total Errors:   {len(self.errors):6d}                                                     ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""

class EfficientDataLoader:
    """Optimized data loader with batch operations and improved performance."""
    
    def __init__(self):
        self.stats = LoadingStats()
        # Caches for faster lookups
        self.session_id_cache: Dict[str, int] = {}
        self.report_id_cache: Dict[str, int] = {}
        self.engine_to_imo_map: Dict[str, int] = {}
        self.imo_to_engine_map: Dict[int, str] = {}
        self.existing_vessels: Dict[int, VesselInfo] = {}
        self.existing_sessions: Dict[Tuple[str, date], ShopTrialSession] = {}
        self.engine_default_session_id: Dict[str, int] = {}  # First session per engine (by earliest date)
        
        # Batch processing settings
        self.batch_size = 1000
        
    def load_all_data(self, extracted_data: Dict[str, List[Dict]]) -> LoadingStats:
        """
        Optimized data loading with batch operations and reduced database calls.
        """
        logger.info("Starting optimized data loading process...")
        
        try:
            with get_db_session_context() as session:
                # Pre-load existing data for efficient lookups
                self._preload_existing_data(session)
                
                # Load data in dependency order with batch operations
                self._load_vessels_batch(session, extracted_data.get('vessels', []))
                self._load_sessions_batch(session, extracted_data.get('sessions', []))
                self._load_performance_data_batch(session, extracted_data.get('performance_data', []))
                self._load_monthly_headers_batch(session, extracted_data.get('monthly_headers', []))
                self._load_monthly_details_batch(session, extracted_data.get('monthly_details', []))
                
                logger.info("Optimized data loading completed successfully")
                
        except Exception as e:
            self.stats.add_error(str(e), "load_all_data", "Critical error during loading")
            raise
        
        return self.stats
    
    def _preload_existing_data(self, session: Session) -> None:
        """Pre-load existing data to minimize database queries during processing."""
        logger.info("Pre-loading existing data for efficient processing...")
        
        # Load all existing vessels
        vessels = session.query(VesselInfo).all()
        for vessel in vessels:
            self.existing_vessels[vessel.imo_number] = vessel
            if vessel.engine_no:
                self.engine_to_imo_map[vessel.engine_no] = vessel.imo_number
                if vessel.imo_number not in self.imo_to_engine_map:
                    self.imo_to_engine_map[vessel.imo_number] = vessel.engine_no
        
        # Load existing sessions
        sessions = session.query(ShopTrialSession).all()
        for session_obj in sessions:
            key = (session_obj.engine_no, session_obj.trial_date)
            self.existing_sessions[key] = session_obj
            session_key = f"{session_obj.engine_no}_{session_obj.trial_date}"
            self.session_id_cache[session_key] = session_obj.session_id
        # Build default session per engine (earliest date)
        engine_to_sessions: Dict[str, List[ShopTrialSession]] = {}
        for (eng, _), s in self.existing_sessions.items():
            engine_to_sessions.setdefault(eng, []).append(s)
        for eng, sess_list in engine_to_sessions.items():
            earliest = min(sess_list, key=lambda s: s.trial_date)
            self.engine_default_session_id[eng] = earliest.session_id
        
        # Load existing monthly report headers
        headers = session.query(MonthlyReportHeader).all()
        for header in headers:
            report_key = f"{header.imo_number}_{header.report_month}"
            self.report_id_cache[report_key] = header.report_id
        
        logger.info(f"Pre-loaded: {len(self.existing_vessels)} vessels, "
                   f"{len(self.existing_sessions)} sessions, "
                   f"{len(self.report_id_cache)} monthly headers")
    
    def _load_vessels_batch(self, session: Session, vessels_data: List[Dict[str, Any]]) -> None:
        """Load vessels using batch upsert operations."""
        if not vessels_data:
            return
            
        logger.info(f"Loading {len(vessels_data)} vessels...")
        
        # Prepare data for batch upsert
        vessels_to_insert = []
        vessels_to_update = []
        
        for vessel_data in vessels_data:
            try:
                imo_number = vessel_data.get('imo_number')
                engine_no = vessel_data.get('engine_no')
                
                if imo_number is None:
                    self.stats.add_error("Missing imo_number (Primary Key)", "vessel_loading", str(vessel_data))
                    continue
                
                clean_data = self._clean_vessel_data(vessel_data)
                
                if imo_number in self.existing_vessels:
                    # Update existing vessel
                    existing_vessel = self.existing_vessels[imo_number]
                    self._update_vessel_fields(existing_vessel, clean_data)
                    vessels_to_update.append(existing_vessel)
                    self.stats.vessels_updated += 1
                else:
                    # Prepare for insert
                    vessels_to_insert.append(clean_data)
                    self.stats.vessels_inserted += 1
                
                # Update caches
                if engine_no:
                    self.engine_to_imo_map[engine_no] = imo_number
                    if imo_number not in self.imo_to_engine_map:
                        self.imo_to_engine_map[imo_number] = engine_no
                        
            except Exception as e:
                self.stats.add_error(str(e), "vessel_loading", f"imo: {imo_number}")
                continue
        
        # Batch insert new vessels
        if vessels_to_insert:
            try:
                session.bulk_insert_mappings(VesselInfo, vessels_to_insert)
                # Update cache with newly inserted vessels
                for vessel_data in vessels_to_insert:
                    imo_number = vessel_data['imo_number']
                    vessel = session.query(VesselInfo).filter_by(imo_number=imo_number).first()
                    if vessel:
                        self.existing_vessels[imo_number] = vessel
            except Exception as e:
                session.rollback()
                self.stats.add_error(f"Batch insert failed: {e}", "vessel_loading", "batch operation")
        
        session.commit()
        logger.info(f"Vessel loading completed: {self.stats.vessels_inserted} inserted, {self.stats.vessels_updated} updated")
    
    def _load_sessions_batch(self, session: Session, sessions_data: List[Dict[str, Any]]) -> None:
        """Load sessions using batch operations."""
        if not sessions_data:
            return
            
        logger.info(f"Loading {len(sessions_data)} sessions...")
        
        sessions_to_insert = []
        sessions_to_update = []
        
        for session_data in sessions_data:
            try:
                engine_no = session_data.get('engine_no')
                trial_date = session_data.get('trial_date') or date.today()
                
                if not engine_no:
                    self.stats.add_error("Missing engine_no", "session_loading", str(session_data))
                    continue
                
                session_key_tuple = (engine_no, trial_date)
                session_key_str = f"{engine_no}_{trial_date}"
                
                clean_data = self._clean_session_data({**session_data, 'trial_date': trial_date})
                
                if session_key_tuple in self.existing_sessions:
                    # Update existing session
                    existing_session = self.existing_sessions[session_key_tuple]
                    self._update_session_fields(existing_session, clean_data)
                    sessions_to_update.append(existing_session)
                    self.stats.sessions_updated += 1
                    self.session_id_cache[session_key_str] = existing_session.session_id
                else:
                    # Prepare for insert
                    sessions_to_insert.append(clean_data)
                    self.stats.sessions_inserted += 1
                    
            except Exception as e:
                self.stats.add_error(str(e), "session_loading", f"engine: {engine_no}")
                continue
        
        # Batch insert new sessions
        if sessions_to_insert:
            try:
                session.bulk_insert_mappings(ShopTrialSession, sessions_to_insert)
                session.flush()
                
                # Update cache with newly inserted sessions
                for session_data in sessions_to_insert:
                    engine_no = session_data['engine_no']
                    trial_date = session_data['trial_date']
                    session_obj = session.query(ShopTrialSession).filter_by(
                        engine_no=engine_no, trial_date=trial_date
                    ).first()
                    if session_obj:
                        key_tuple = (engine_no, trial_date)
                        key_str = f"{engine_no}_{trial_date}"
                        self.existing_sessions[key_tuple] = session_obj
                        self.session_id_cache[key_str] = session_obj.session_id
                        
            except Exception as e:
                session.rollback()
                self.stats.add_error(f"Batch insert failed: {e}", "session_loading", "batch operation")
        
        session.commit()
        # Rebuild session caches so performance resolver can find newly inserted sessions
        self._rebuild_session_cache(session)
        logger.info(f"Session loading completed: {self.stats.sessions_inserted} inserted, {self.stats.sessions_updated} updated")

    def _rebuild_session_cache(self, session: Session) -> None:
        """Rebuild in-memory caches for sessions after inserts/updates."""
        self.existing_sessions.clear()
        self.session_id_cache.clear()
        self.engine_default_session_id.clear()
        sessions = session.query(ShopTrialSession).all()
        for session_obj in sessions:
            key = (session_obj.engine_no, session_obj.trial_date)
            self.existing_sessions[key] = session_obj
            session_key = f"{session_obj.engine_no}_{session_obj.trial_date}"
            self.session_id_cache[session_key] = session_obj.session_id
        # Default per engine (earliest date)
        engine_to_sessions: Dict[str, List[ShopTrialSession]] = {}
        for (eng, _), s in self.existing_sessions.items():
            engine_to_sessions.setdefault(eng, []).append(s)
        for eng, sess_list in engine_to_sessions.items():
            earliest = min(sess_list, key=lambda s: s.trial_date)
            self.engine_default_session_id[eng] = earliest.session_id
    
    def _load_performance_data_batch(self, session: Session, performance_data: List[Dict[str, Any]]) -> None:
        """Load performance data using batch operations with auto-session creation."""
        if not performance_data:
            return
            
        logger.info(f"Loading {len(performance_data)} performance records...")
        
        # Group performance data by batches
        performance_to_insert = []
        performance_to_update = []
        
        for perf_data in performance_data:
            try:
                session_id = self._resolve_session_id(perf_data)
                if not session_id:
                    self.stats.add_error("Could not resolve session_id", "performance_loading", str(perf_data))
                    continue
                
                perf_data['session_id'] = session_id
                load_percentage = perf_data.get('load_percentage')
                test_sequence = perf_data.get('test_sequence', 1)
                
                if load_percentage is None:
                    self.stats.add_error("Missing load_percentage", "performance_loading", str(perf_data))
                    continue
                
                # Check if performance record exists
                existing_perf = session.query(ShopTrialPerformanceData).filter(
                    and_(
                        ShopTrialPerformanceData.session_id == session_id,
                        ShopTrialPerformanceData.load_percentage == load_percentage,
                        ShopTrialPerformanceData.test_sequence == test_sequence
                    )
                ).first()
                
                clean_data = self._clean_performance_data(perf_data)
                
                if existing_perf:
                    self._update_performance_fields(existing_perf, clean_data)
                    performance_to_update.append(existing_perf)
                    self.stats.performance_records_updated += 1
                else:
                    performance_to_insert.append(clean_data)
                    self.stats.performance_records_inserted += 1
                    
            except Exception as e:
                engine_no = perf_data.get('engine_no', 'unknown')
                self.stats.add_error(str(e), "performance_loading", f"engine: {engine_no}")
                continue
        
        # Batch insert new performance records
        if performance_to_insert:
            try:
                # Process in smaller batches to avoid memory issues
                for i in range(0, len(performance_to_insert), self.batch_size):
                    batch = performance_to_insert[i:i + self.batch_size]
                    session.bulk_insert_mappings(ShopTrialPerformanceData, batch)
                    session.flush()
            except Exception as e:
                session.rollback()
                self.stats.add_error(f"Batch insert failed: {e}", "performance_loading", "batch operation")
        
        session.commit()
        logger.info(f"Performance data loading completed: {self.stats.performance_records_inserted} inserted, "
                   f"{self.stats.performance_records_updated} updated")
    
    def _load_monthly_headers_batch(self, session: Session, headers_data: List[Dict[str, Any]]) -> None:
        """Load monthly headers using batch operations."""
        if not headers_data:
            return
            
        logger.info(f"Loading {len(headers_data)} monthly headers...")
        
        headers_to_insert = []
        headers_to_update = []
        
        for header_data in headers_data:
            try:
                imo_number = header_data.get('imo_number')
                report_month = header_data.get('report_month')
                
                if imo_number is None or not report_month:
                    self.stats.add_error("Missing imo_number or report_month", "monthly_header_loading", str(header_data))
                    continue
                
                if imo_number not in self.existing_vessels:
                    self.stats.add_error(f"Vessel with IMO {imo_number} not found", "monthly_header_loading", str(header_data))
                    continue
                
                report_key = f"{imo_number}_{report_month}"
                clean_data = self._clean_monthly_header_data(header_data)
                
                if report_key in self.report_id_cache:
                    # Update existing header
                    existing_header = session.query(MonthlyReportHeader).filter_by(
                        imo_number=imo_number, report_month=report_month
                    ).first()
                    if existing_header:
                        self._update_monthly_header_fields(existing_header, clean_data)
                        headers_to_update.append(existing_header)
                        self.stats.monthly_headers_updated += 1
                else:
                    # Prepare for insert
                    vessel = self.existing_vessels[imo_number]
                    engine_identifier = header_data.get('engine_identifier') or vessel.engine_no or f"UNKNOWN_ENGINE_FOR_IMO_{imo_number}"
                    clean_data['engine_identifier'] = engine_identifier
                    headers_to_insert.append(clean_data)
                    self.stats.monthly_headers_inserted += 1
                    
            except Exception as e:
                self.stats.add_error(str(e), "monthly_header_loading", f"imo: {imo_number}")
                continue
        
        # Batch insert new headers
        if headers_to_insert:
            try:
                session.bulk_insert_mappings(MonthlyReportHeader, headers_to_insert)
                session.flush()
                
                # Update cache with newly inserted headers
                for header_data in headers_to_insert:
                    imo_number = header_data['imo_number']
                    report_month = header_data['report_month']
                    header_obj = session.query(MonthlyReportHeader).filter_by(
                        imo_number=imo_number, report_month=report_month
                    ).first()
                    if header_obj:
                        report_key = f"{imo_number}_{report_month}"
                        self.report_id_cache[report_key] = header_obj.report_id
                        
            except Exception as e:
                session.rollback()
                self.stats.add_error(f"Batch insert failed: {e}", "monthly_header_loading", "batch operation")
        
        session.commit()
        logger.info(f"Monthly header loading completed: {self.stats.monthly_headers_inserted} inserted, "
                   f"{self.stats.monthly_headers_updated} updated")
    
    def _load_monthly_details_batch(self, session: Session, details_data: List[Dict[str, Any]]) -> None:
        """Load monthly details using batch operations."""
        if not details_data:
            return
            
        logger.info(f"Loading {len(details_data)} monthly details...")
        
        details_to_insert = []
        details_to_update = []
        
        for detail_data in details_data:
            try:
                report_id = self._resolve_report_id(detail_data)
                if not report_id:
                    self.stats.add_error("Could not resolve report_id", "monthly_detail_loading", str(detail_data))
                    continue
                
                section_name = detail_data.get('section_name')
                if not section_name:
                    self.stats.add_error("Missing section_name", "monthly_detail_loading", str(detail_data))
                    continue
                
                detail_data['report_id'] = report_id
                clean_data = self._clean_monthly_detail_data(detail_data)
                
                # Check if detail exists
                existing_detail = session.query(MonthlyReportDetailsJsonb).filter_by(
                    report_id=report_id, section_name=section_name
                ).first()
                
                if existing_detail:
                    existing_detail.data_jsonb = clean_data.get('data_jsonb', {})
                    details_to_update.append(existing_detail)
                    self.stats.monthly_details_updated += 1
                else:
                    details_to_insert.append(clean_data)
                    self.stats.monthly_details_inserted += 1
                    
            except Exception as e:
                self.stats.add_error(str(e), "monthly_detail_loading", f"section: {detail_data.get('section_name')}")
                continue
        
        # Batch insert new details
        if details_to_insert:
            try:
                session.bulk_insert_mappings(MonthlyReportDetailsJsonb, details_to_insert)
            except Exception as e:
                session.rollback()
                self.stats.add_error(f"Batch insert failed: {e}", "monthly_detail_loading", "batch operation")
        
        session.commit()
        logger.info(f"Monthly detail loading completed: {self.stats.monthly_details_inserted} inserted, "
                   f"{self.stats.monthly_details_updated} updated")
    
    # Removed auto-creation of sessions and vessels to avoid unintended data
    
    # Helper methods for ID resolution
    def _resolve_session_id(self, data: Dict[str, Any]) -> Optional[int]:
        """Resolve session_id for performance data."""
        engine_no = data.get("engine_no")
        # Strategy 1: Exact date match if provided
        session_date = data.get('trial_date') or data.get('report_date')
        if session_date:
            session_key = f"{engine_no}_{session_date}"
            if session_key in self.session_id_cache:
                return self.session_id_cache[session_key]
        # Strategy 2: Use default (earliest) session for this engine
        if engine_no in self.engine_default_session_id:
            return self.engine_default_session_id[engine_no]
        # Strategy 3: Fallback DB lookup (earliest session)
        try:
            # Late import to avoid cycles
            from .models import ShopTrialSession as _STS
            with get_db_session_context() as s:
                row = s.query(_STS).filter(_STS.engine_no == engine_no).order_by(_STS.trial_date.asc()).first()
                if row:
                    self.engine_default_session_id[engine_no] = row.session_id
                    return row.session_id
        except Exception:
            pass
        return None
    
    def _resolve_report_id(self, data: Dict[str, Any]) -> Optional[int]:
        """Resolve report_id for monthly details."""
        imo_number = data.get('imo_number')
        report_month = data.get('report_month')
        
        if imo_number is not None and report_month:
            report_key = f"{imo_number}_{report_month}"
            return self.report_id_cache.get(report_key)
        
        # Fallback: single header in cache
        if len(self.report_id_cache) == 1:
            return next(iter(self.report_id_cache.values()))
        
        return None
    
    # Helper methods for field updates
    def _update_vessel_fields(self, vessel: VesselInfo, vessel_data: Dict[str, Any]) -> None:
        """Update vessel fields efficiently."""
        excluded_fields = {'imo_number', 'created_at', 'updated_at'}
        for field, value in vessel_data.items():
            if field not in excluded_fields and value is not None and hasattr(vessel, field):
                setattr(vessel, field, value)
    
    def _update_session_fields(self, session_obj: ShopTrialSession, session_data: Dict[str, Any]) -> None:
        """Update session fields efficiently."""
        excluded_fields = {'engine_no', 'trial_date', 'session_id', 'created_at', 'updated_at'}
        for field, value in session_data.items():
            if field not in excluded_fields and value is not None and hasattr(session_obj, field):
                setattr(session_obj, field, value)
    
    def _update_performance_fields(self, perf_obj: ShopTrialPerformanceData, perf_data: Dict[str, Any]) -> None:
        """Update performance data fields efficiently."""
        excluded_fields = {'session_id', 'load_percentage', 'test_sequence', 'performance_data_id', 'created_at', 'updated_at'}
        for field, value in perf_data.items():
            if field not in excluded_fields and value is not None and hasattr(perf_obj, field):
                setattr(perf_obj, field, value)
    
    def _update_monthly_header_fields(self, header_obj: MonthlyReportHeader, header_data: Dict[str, Any]) -> None:
        """Update monthly header fields efficiently."""
        excluded_fields = {'imo_number', 'report_month', 'report_id', 'created_at', 'updated_at', 'vessel'}
        for field, value in header_data.items():
            if field not in excluded_fields and value is not None and hasattr(header_obj, field):
                setattr(header_obj, field, value)
    
    # Data cleaning methods (same as before but optimized)
    def _clean_vessel_data(self, vessel_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean vessel data for database insertion."""
        allowed_fields = {
            'imo_number', 'vessel_name', 'engine_no', 'hull_no', 'owner', 'shipyard',
            'engine_maker', 'engine_type', 'engine_model', 'number_of_cylinders',
            'propeller_pitch_mm', 'sfoc_target_gm_kwh', 'mcr_power_kw', 'mcr_rpm','csr_power_kw',
            'barred_speed_rpm_start',
            'barred_speed_rpm_end', 'mcr_limit_kw', 'mcr_limit_percentage'
        }
        return {k: v for k, v in vessel_data.items() if v is not None and k in allowed_fields}
    
    def _clean_session_data(self, session_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate session data for database insertion."""
        allowed_fields = [
            'engine_no', 'trial_date', 'trial_type', 'conducted_by', 'document_title',
            'document_reference', 'room_temp_cold_condition_c', 'lub_oil_temp_hot_condition_c',
            'lub_oil_temp_overall_c', 'remarks', 'status'
        ]
        return {k: v for k, v in session_data.items() if v is not None and k in allowed_fields}
    
    def _clean_performance_data(self, perf_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate performance data for database insertion."""
        allowed_fields = [
            'session_id', 'load_percentage', 'test_sequence', 'engine_output_kw',
            'engine_speed_rpm', 'room_temperature_c', 'room_humidity_percent',
            'barometer_pressure_mbar', 'tc_inlet_temp_c', 'scav_air_temperature_c',
            'tc_outlet_back_press_mmaq', 'max_combustion_pressure_bar', 'compression_pressure_bar',
            'mean_effective_pressure_bar', 'fuel_injection_pump_index_mm', 'exh_temp_cylinder_outlet_ave_c',
            'exh_temp_tc_inlet_c', 'exh_temp_tc_outlet_c', 'turbocharger_speed_x1000_rpm',
            'scav_air_pressure_bar', 'turbocharger_gas_inlet_press_kg_cm2', 'fuel_oil_temperature_c',
            'fuel_oil_consumption_kg_h', 'fuel_oil_consumption_g_kwh', 'max_combustion_pressure_iso_bar',
            'compression_pressure_iso_bar', 'scav_air_pressure_iso_kg_cm2', 'exh_temp_tc_inlet_iso_c',
            'exh_temp_tc_outlet_iso_c', 'turbocharger_speed_x1000_iso_rpm', 'fuel_oil_consumption_iso_g_kwh',
            'barometer_pressure_ref_mbar', 'tc_inlet_temp_ref_c', 'scav_air_temperature_ref_c',
            'tc_outlet_back_press_ref_mmaq'
        ]
        # 'engine_no' is NOT in the DB model for performance data, handled by session_id
        return {k: v for k, v in perf_data.items() if v is not None and k in allowed_fields}
    
    def _clean_monthly_header_data(self, header_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate monthly header data for database insertion."""
        # Ensure all fields from MonthlyReportHeader model are handled for constructor
        allowed_fields = [
            'imo_number', 'engine_identifier', 'report_month', 'report_date', 'engine_run_hrs', 'epl_implemented',
            'max_power_limit_kw', 'max_load_limit_percent_after_epl', 'load_percent', 'rpm_percent', 'rpm',
            'engine_indicated_power_kw', 'effective_power_kw', 'shaft_power_kw', 'load_indicator',
            # New ISO-related fields
            'max_comb_pr_avg_bar', 'comp_pr_avg_bar', 'scavenge_temp_c', 'scavenge_pr_bar',
            'tc_exhaust_gas_temp_in_c', 'tc_exhaust_gas_temp_out_c', 'turbocharger_rpm_avg',
            'tc_air_inlet_temp_c', 'tc_filter_dp_mmh2o', 'sfoc_measured_g_kwh', 'sfoc_calculated_g_kwh',
            'egb_pressure_drop_mmh2o',
            'ship_condition', 'displacement_mt', 'draft_f', 'draft_a', 'trim_mtr',
            'wind_force', 'sea_state', 'weather', 'location', 'barometric_pressure_mmh2o',
            'sea_water_temp_c', 'engine_room_temp_c', 'speed_gps_kn', 'speed_log_kn',
            'speed_by_pitch_kn', 'slip_percent', 'time_start', 'time_finish',
            'revolution_counter_start', 'revolution_counter_finish', 'measured_by',
            'chief_engineer_name', 'tech_form_no', 'edition_no', 'revision_no', 'revision_date'
        ]
        cleaned_data = {k: v for k, v in header_data.items() if v is not None and k in allowed_fields}
        return cleaned_data # Note: 'vessel' relationship is added *after* this cleaning
    
    def _clean_monthly_detail_data(self, detail_data: Dict[str, Any]) -> Dict[str, Any]:
        """Clean and validate monthly detail data for database insertion."""
        allowed_fields = ['report_id', 'section_name', 'data_jsonb']
        # Add 'imo_number' and 'report_month' here if you expect them in the details sheet
        # allowed_fields.extend(['imo_number', 'report_month'])
        return {k: v for k, v in detail_data.items() if v is not None and k in allowed_fields}


def load_data_to_database(extracted_data: Dict[str, List[Dict]]) -> LoadingStats:
    """
    Main function to load extracted Excel data into PostgreSQL database.
    
    Args:
        extracted_data: Dictionary containing all extracted data from Excel
        
    Returns:
        LoadingStats: Comprehensive statistics about the loading operation
    """
    loader = EfficientDataLoader()
    return loader.load_all_data(extracted_data)