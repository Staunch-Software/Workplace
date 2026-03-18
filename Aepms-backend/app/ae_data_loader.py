# app/ae_data_loader.py
import logging
from typing import Dict, List, Any
from decimal import Decimal
from sqlalchemy.orm import Session
from sqlalchemy.orm import joinedload # Added for efficiency in preload
from .database import get_db_session_context
from .generator_models import VesselGenerator, GeneratorBaselineData
from .models import VesselInfo

logger = logging.getLogger(__name__)

class AELoadingStats:
    """Statistics for AE data loading."""
    def __init__(self):
        self.generators_inserted = 0
        self.generators_updated = 0
        self.baseline_inserted = 0
        self.baseline_updated = 0
        self.errors = []
    
    def add_error(self, msg: str, ctx: str = ""):
        self.errors.append({"message": msg, "context": ctx})
        logger.error(f"[{ctx}] {msg}")
    
    def get_summary(self) -> str:
        return f"""
AE DATA LOADING SUMMARY:
  Generators: {self.generators_inserted} inserted, {self.generators_updated} updated
  Baseline: {self.baseline_inserted} inserted, {self.baseline_updated} updated
  Errors: {len(self.errors)}
"""

class AEDataLoader:
    """Loads Auxiliary Engine data to database."""
    
    def __init__(self):
        self.stats = AELoadingStats()
        self.existing_vessels = {}
        self.existing_generators = {}
        self.existing_baseline = {}
    
    def load_all_data(self, extracted_data: Dict[str, List[Dict]]) -> AELoadingStats:
        """Load all AE data."""
        logger.info("Starting AE data loading...")
        
        try:
            with get_db_session_context() as session:
                self._preload_existing_data(session)
                # Load generators first to populate self.existing_generators
                self._load_generators_batch(session, extracted_data.get('vessel_generators', []))
                # Re-preload generators to ensure new ones are included
                self._preload_existing_generators(session) 
                self._load_generator_baseline_batch(session, extracted_data.get('generator_baseline_data', []))
                logger.info("AE data loading completed")
        except Exception as e:
            self.stats.add_error(str(e), "load_all_data")
            raise
        
        return self.stats
    
    def _preload_existing_generators(self, session: Session) -> None:
        """Helper to reload only generators (used after initial generator load)."""
        gens = session.query(VesselGenerator).all()
        self.existing_generators = {g.engine_no: g for g in gens}

    def _preload_existing_data(self, session: Session) -> None:
        """Preload existing data. Baseline key modified to (engine_no, load_percentage)."""
        vessels = session.query(VesselInfo).all()
        self.existing_vessels = {v.imo_number: v for v in vessels}
        
        self._preload_existing_generators(session)
        
        # --- MODIFICATION 1: Change baseline key to use engine_no and load_percentage ---
        # Join with VesselGenerator to get the engine_no for keying
        baselines_query = session.query(
            GeneratorBaselineData, VesselGenerator.engine_no
        ).join(VesselGenerator, GeneratorBaselineData.generator_id == VesselGenerator.generator_id).all()

        for b, engine_no in baselines_query:
            # Key for existing baseline records is (engine_no, load_percentage)
            key = (engine_no, b.load_percentage)
            self.existing_baseline[key] = b
        # ---------------------------------------------------------------------------------
        
        logger.info(f"Preloaded: {len(self.existing_vessels)} vessels, "
                   f"{len(self.existing_generators)} generators, "
                   f"{len(self.existing_baseline)} baseline records")
    
    def _load_generators_batch(self, session: Session, generators_data: List[Dict[str, Any]]) -> None:
        """Load generators using batch operations."""
        if not generators_data:
            return
        
        logger.info(f"Loading {len(generators_data)} generators...")
        
        for gen_data in generators_data:
            try:
                imo = gen_data.get('imo_number')
                engine_no = gen_data.get('engine_no')
                
                if imo not in self.existing_vessels:
                    self.stats.add_error(f"Vessel IMO {imo} not found", "generator_loading")
                    continue
                
                if engine_no in self.existing_generators:
                    existing = self.existing_generators[engine_no]
                    for k, v in gen_data.items():
                        if k not in ['engine_no', 'generator_id'] and v is not None:
                            setattr(existing, k, v)
                    self.stats.generators_updated += 1
                else:
                    new_gen = VesselGenerator(**gen_data)
                    session.add(new_gen)
                    self.stats.generators_inserted += 1
                    
            except Exception as e:
                self.stats.add_error(str(e), f"generator: {engine_no}")
                continue
        
        session.commit()
        logger.info(f"Generators loaded: {self.stats.generators_inserted} inserted, "
                   f"{self.stats.generators_updated} updated")
    
    def _load_generator_baseline_batch(self, session: Session, baseline_data: List[Dict[str, Any]]) -> None:
        """Load baseline data, linking to generator_id via engine_no and performing unit conversions."""
        if not baseline_data:
            return
        
        logger.info(f"Loading {len(baseline_data)} baseline records...")
        
        for data in baseline_data:
            engine_no = None # Initialize outside try-except for error context
            load_pct = None # Initialize outside try-except for error context
            try:
                # --- MODIFICATION 2: Extract key fields ---
                engine_no = data.pop('engine_no', None) # Get engine_no and remove it from data payload
                imo = data.get('imo_number')
                load_pct = data.get('load_percentage')
                # -----------------------------------------

                if imo not in self.existing_vessels:
                    self.stats.add_error(f"Vessel IMO {imo} not found", "baseline_loading")
                    continue
                
                # --- NEW LOGIC: Look up the Generator ID using the engine_no ---
                generator = self.existing_generators.get(engine_no)
                if not generator:
                    self.stats.add_error(f"Engine No {engine_no} not found in VesselGenerator table. Cannot link baseline data.", "baseline_loading")
                    continue
                
                # Add the required Foreign Key to the data payload
                data['generator_id'] = generator.generator_id
                # ------------------------------------------------------------
                
                # Convert MPa to Bar (1 MPa = 10 Bar)
                if data.get('pmax_raw_mpa') is not None:
                    data['pmax_graph_bar'] = data['pmax_raw_mpa'] * Decimal('10')
                
                if data.get('boost_air_pressure_raw_mpa') is not None:
                    data['boost_air_pressure_graph_bar'] = data['boost_air_pressure_raw_mpa'] * Decimal('10')
                
                # --- MODIFICATION 3: Key lookup uses (engine_no, load_pct) ---
                key = (engine_no, load_pct)
                
                if key in self.existing_baseline:
                    existing = self.existing_baseline[key]
                    for k, v in data.items():
                        # Do not try to update the primary key or engine_no
                        if k not in ['baseline_id', 'engine_no'] and v is not None:
                            setattr(existing, k, v)
                    self.stats.baseline_updated += 1
                else:
                    new_baseline = GeneratorBaselineData(**data)
                    session.add(new_baseline)
                    self.stats.baseline_inserted += 1
                    
            except Exception as e:
                self.stats.add_error(str(e), f"baseline: Engine {engine_no}, load {load_pct}%")
                continue
        
        session.commit()
        logger.info(f"Baseline loaded: {self.stats.baseline_inserted} inserted, "
                   f"{self.stats.baseline_updated} updated")

def load_ae_data_to_database(extracted_data: Dict[str, List[Dict]]) -> AELoadingStats:
    """Main function to load AE data to database."""
    loader = AEDataLoader()
    return loader.load_all_data(extracted_data)