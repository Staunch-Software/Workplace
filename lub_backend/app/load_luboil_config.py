import argparse
import pandas as pd
import sys
import os
import logging
import re
from sqlalchemy.orm import Session

# Ensure we can import from 'app'
sys.path.append(os.getcwd())

from app.database import SessionLocal
from app.luboil_model import LuboilVessel, LuboilEquipmentType, LuboilVesselConfig, LuboilNameMapping

# Configure Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def normalize_string(name):
    """
    Cleans names for internal matching. 
    Mirroring API logic: Removes MV prefixes, handles spelling, and special characters.
    """
    if not isinstance(name, str): return ""
    s = str(name).strip().upper()
    # Remove common ship prefixes
    s = re.sub(r'^(?:MV|M\.V\.|M\.V|M/V)\s*', '', s)
    # SPELLING FIX: Handle 'Narmadha' vs 'Narmada'
    s = s.replace('NARMADHA', 'NARMADA')
    # Remove all non-alphanumeric chars and lowercase
    return re.sub(r'[^A-Z0-9]', '', s).lower()

def load_luboil_config(file_path: str):
    logger.info(f"🚀 Starting Import: {file_path}")
    
    try:
        # 1. READ RAW EXCEL TO FIND THE HEADER ROW (Source Preserved)
        df_raw = pd.read_excel(file_path, header=None)
        
        header_idx = -1
        for idx, row in df_raw.iterrows():
            row_vals = [str(v).strip().lower() for v in row.values if pd.notna(v)]
            if "sample id" in row_vals or "sampleid" in row_vals:
                header_idx = idx
                break
        
        if header_idx == -1:
            logger.error("❌ CRITICAL ERROR: Could not find 'Sample ID' column header.")
            return

        # 2. EXTRACT VESSEL NAMES FROM THE ROW ABOVE (Source Preserved)
        vessel_row_raw = df_raw.iloc[header_idx - 1] if header_idx > 0 else pd.Series([None] * len(df_raw.columns))
        vessel_row = vessel_row_raw.ffill() 

        # 3. LOAD DATA (Source Preserved)
        df = pd.read_excel(file_path, header=header_idx)
        
        # 4. MERGE HEADERS & PRE-REGISTER VESSELS (FIX FOR FOREIGN KEY ERROR)
        db: Session = SessionLocal() # Open DB early to register vessels
        column_to_imo = {}
        new_headers = []
        
        for i, col_name in enumerate(df.columns):
            v_raw = vessel_row[i]
            c_name = str(col_name).strip()
            norm_c = normalize_string(c_name)
            
            if norm_c in ['equipment', 'samplename', 'sampleid', 'intervalmonth', 'interval']:
                new_headers.append(c_name)
            elif pd.notna(v_raw) and str(v_raw).strip() != "":
                v_header_str = str(v_raw).strip()
                
                # Split "AM Kirti-9832925"
                if "-" in v_header_str:
                    parts = v_header_str.rsplit('-', 1)
                    v_name_clean = parts[0].strip()
                    imo_str = parts[1].strip()
                    
                    if imo_str.isdigit():
                        imo_val = int(imo_str)
                        column_to_imo[i] = imo_val
                        new_headers.append(v_name_clean)
                        
                        # --- FIX: Ensure Vessel exists in DB immediately ---
                        # vessel = db.query(LuboilVessel).filter_by(imo_number=imo_val).first()
                        # if not vessel:
                        #     logger.info(f"🚢 Auto-Registering vessel from Header: {v_name_clean} (IMO: {imo_val})")
                        #     db.add(LuboilVessel(imo_number=imo_val, vessel_name=v_name_clean, is_active=True))
                        # else:
                        #     vessel.vessel_name = v_name_clean # Keep name synced
                        # db.flush() # Ensure vessel is in the DB for Foreign Key linking
                    else:
                        new_headers.append(v_header_str)
                else:
                    new_headers.append(v_header_str)
            else:
                new_headers.append(c_name)
        
        df.columns = new_headers
        db.commit() # Commit vessel registrations before data processing

        # 5. DYNAMICALLY IDENTIFY KEY METADATA COLUMNS (Source Preserved)
        col_name_map = {normalize_string(c): c for c in df.columns}
        sample_id_real = col_name_map.get('sampleid')
        equipment_real = col_name_map.get('equipment')
        sample_name_real = col_name_map.get('samplename')
        interval_real = col_name_map.get('intervalmonth') or col_name_map.get('interval')

        if equipment_real: df[equipment_real] = df[equipment_real].ffill()
        if interval_real: df[interval_real] = df[interval_real].ffill()
        
        df = df.dropna(subset=[sample_id_real])
        logger.info(f"📊 Identified {len(df)} configuration rows.")

    except Exception as e:
        logger.error(f"❌ Error parsing Excel structure: {e}")
        return

    try:
        # Build Vessel Map from DB (Source Preserved)
        db_vessels = db.query(LuboilVessel).all()
        vessel_map = {normalize_string(v.vessel_name): v.imo_number for v in db_vessels}
        
        meta_keys = [normalize_string(c) for c in [sample_id_real, equipment_real, sample_name_real, interval_real, 'Note', 'Remarks']]
        stats = {"equipment_updated": 0, "mappings_added": 0, "config_set": 0}

        for index, row in df.iterrows():
            code = str(row[sample_id_real]).strip()
            if not code or code.lower() in ['nan', '-']: continue

            category = str(row.get(equipment_real, 'General')).strip()
            name = str(row.get(sample_name_real, code)).strip()
            
            # --- INTERVAL LOGIC (Source Preserved) ---
            interval = 3
            if interval_real:
                try:
                    val = row[interval_real]
                    if pd.notna(val) and str(val).strip() not in ['-', 'nan']:
                        num_match = re.search(r'\d+', str(val))
                        if num_match:
                            interval = int(num_match.group())
                except: pass

            # A. UPSERT MASTER EQUIPMENT (Source Preserved)
            equip = db.query(LuboilEquipmentType).filter_by(code=code).first()
            if not equip:
                equip = LuboilEquipmentType(
                    code=code, category=category, ui_label=name, 
                    default_interval_months=interval, sort_order=stats["equipment_updated"]
                )
                db.add(equip)
            else:
                equip.default_interval_months = interval 
                equip.ui_label = name
                equip.category = category
            stats["equipment_updated"] += 1

            # B. UPSERT NAME MAPPING (Source Preserved)
            if name:
                mapping = db.query(LuboilNameMapping).filter_by(lab_raw_string=name).first()
                if not mapping:
                    db.add(LuboilNameMapping(lab_raw_string=name, equipment_code=code))
                    stats["mappings_added"] += 1

            # C. UPSERT VESSEL CONFIGS (Logic Preserved + Header IMO Priority)
            for i, col_name in enumerate(df.columns):
                norm_col = normalize_string(col_name)
                if not norm_col or norm_col in meta_keys: continue 
                
                raw_cell_val = str(row[col_name]).strip()
                is_active_excel = False
                found_analyst_code = None

                if raw_cell_val.lower() not in ['-', 'nan', '', 'none']:
                    is_active_excel = True
                    if raw_cell_val.upper() != 'X':
                        found_analyst_code = raw_cell_val

                # 1. Use IMO from the pre-registered Header Map
                imo = column_to_imo.get(i)
                
                # 2. Fallback to name matching (Preserved)
                if not imo:
                    imo = vessel_map.get(norm_col)

                # 3. Last Fallback: Auto-Register from cell content (Preserved)
                # if not imo and is_active_excel and found_analyst_code:
                #     imo_match = re.search(r'^\d{6,7}', str(found_analyst_code))
                #     if imo_match:
                #         extracted_imo = int(imo_match.group())
                #         vessel = db.query(LuboilVessel).filter_by(imo_number=extracted_imo).first()
                #         if not vessel:
                #             db.add(LuboilVessel(vessel_name=col_name, imo_number=extracted_imo, is_active=True))
                #         db.flush() 
                #         imo = extracted_imo

                if not imo: continue 

                # 4. UPSERT VESSEL CONFIG
                imo_str = str(imo)
                config = db.query(LuboilVesselConfig).filter_by(imo_number=imo_str, equipment_code=code).first()
                if config:
                    config.is_active = is_active_excel
                    config.lab_analyst_code = found_analyst_code if is_active_excel else None
                elif is_active_excel:
                    db.add(LuboilVesselConfig(
                        imo_number=imo_str, equipment_code=code, is_active=True,
                        lab_analyst_code=found_analyst_code
                    ))
                stats["config_set"] += 1

        db.commit()
        logger.info(f"--- ✅ Import Finished Successfully ---")
        logger.info(f"Vessel Configs Updated: {stats['config_set']}")

    except Exception as e:
        db.rollback()
        logger.error(f"❌ Critical Error during DB sync: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Load Fleet Luboil Config from Excel")
    parser.add_argument("file", help="Path to the Excel file")
    args = parser.parse_args()
    
    if os.path.exists(args.file):
        load_luboil_config(args.file)
    else:
        logger.error(f"❌ File not found: {args.file}")