import logging
import json
import re
import difflib  # Standard library for comparison
from typing import BinaryIO, Dict, Any, Optional, Set
from sqlalchemy.orm import Session
from datetime import datetime

# Import extractor
from app.luboil_pdf_extractor import extract_lube_oil_report_data

# Import models
from app.luboil_model import LuboilReport, LuboilSample, LuboilEquipmentType, LuboilNameMapping, LuboilVesselConfig
from app.core.database_control import SessionControl
from app.models.control.vessel import Vessel as ControlVessel
# from app.luboil_model import LuboilReport, LuboilSample, LuboilEquipmentType, LuboilNameMapping

logger = logging.getLogger(__name__)

def standardize_name(text: str) -> str:
    if not text: return ""
    s = text.lower().strip()

    # PASS 1: Directional keywords — MUST run before anything else
    # Reason: "after" contains "aft" which gets destroyed in synonym pass
    # Longer phrases must come before shorter ones to avoid partial matches
    directional = [
        ("before fine filter", "in"),
        ("after fine filter",  "out"),
        ("before fine",        "in"),
        ("after fine",         "out"),
    ]
    for old, new in directional:
        s = s.replace(old, new)

    # PASS 2: Equipment synonyms
    # Reason: longer/more specific phrases must come before shorter ones
    # e.g. "windlass & mooring winch" before "windlass" and "mooring winch"
    # e.g. "hose handling crane" before "deck crane" 
    synonyms = [
        ("windlass & mooring winch", "winch"),
        ("windlass",                 "winch"),
        ("mooring winch",            "winch"),
        ("auxiliary diesel engine",  "ae"),
        ("aux engine",               "ae"),
        ("main engine",              "me"),
        ("hydraulic power system",   "hyd"),
        ("hydraulic system",         "hyd"),
        ("steering gear",            "str"),
        ("hose handling crane",      "hose crane"),
        ("deck crane",               "dk crane"),
        ("cargo oil pump",           "cop"),
        ("provision crane",          "prov crane"),
        ("remote control valve",     "rc valve"),
        ("cylinders",                "cyl"),
    ]
    for old, new in synonyms:
        s = s.replace(old, new)

    # PASS 3: Directional abbreviations using word boundaries
    # Reason: plain .replace("aft", "aft") would match inside "after", "shaft" etc.
    # We do this AFTER synonyms so "aft" standalone is preserved as a position token
    s = re.sub(r'\bfwd\b', 'fwd', s)
    s = re.sub(r'\baft\b', 'aft', s)

    # PASS 4: Noise removal using word boundaries
    # Reason: plain .replace("no", "") would destroy "normal", "note", "crankcase" etc.
    # "(hps)" stripped here after hydraulic power system already converted to "hyd"
    noise_patterns = [
        r'\bsystem\b',
        r'\bunit\b',
        r'\blife\b',
        r'\bbearings\b',
        r'\bseals\b',
        r'\bno\.\b',
        r'\bno\b',
        r'#',
        r'\(hps\)',
        r'\(hps\s*\)',
        r'-\s*',
        r'&\s*',
    ]
    for pattern in noise_patterns:
        s = re.sub(pattern, ' ', s)

    return " ".join(s.split())

def extract_numbers(text: str) -> set:
    """Strictly extracts numbers to ensure Winch 1 never matches Winch 2."""
    return set(re.findall(r'\d+', text))

def extract_numbers(text: str) -> Set[str]:
    """Extracts all numbers from a string to ensure strict matching of Unit IDs."""
    return set(re.findall(r'\d+', text))

def calculate_token_similarity(str1: str, str2: str) -> float:
    """
    Calculates similarity based on shared words.
    Helps when words are reordered (e.g. 'Steering Gear No.1' vs 'Steering Gear - System No.1')
    """
    # Normalize: lowercase, remove non-alphanumeric, split into set of words
    def tokenize(s):
        s = re.sub(r'[^\w\s]', '', s.lower())
        return set(s.split())

    tokens1 = tokenize(str1)
    tokens2 = tokenize(str2)
    
    if not tokens1 or not tokens2:
        return 0.0
        
    intersection = tokens1.intersection(tokens2)
    union = tokens1.union(tokens2)
    
    return len(intersection) / len(union)

def find_smart_match(target_name: str, candidates: Dict[str, str]) -> Optional[str]:
    """
    FULLY UPDATED: Finds the best matching equipment code.
    PRESERVES original scoring (Subset, Seq, Token) 
    UPDATES Number logic to support "Implicit No. 1" matching.
    """

    target_lower = target_name.lower()
    if "before fine" in target_lower and "hydraulic" in target_lower:
        return "ME.HYD.IN"
    if "after fine" in target_lower and "hydraulic" in target_lower:
        return "ME.HYD.OUT"
        
    best_code = None
    highest_score = 0.0
    
    # 1. Pre-process PDF Name (Preserved from source)
    target_clean = standardize_name(target_name)
    target_tokens = set(target_clean.split())
    target_nums = extract_numbers(target_name)

    for ui_label, code in candidates.items():
        # 2. Pre-process Candidate (Excel) Name (Preserved from source)
        candidate_clean = standardize_name(ui_label)
        candidate_tokens = set(candidate_clean.split())
        candidate_nums = extract_numbers(ui_label)

        # 3. SMART NUMBER LOGIC (Updated to support your Config requirements)
        # Normalize: Convert '01' to '1' so they match
        t_nums_norm = {n.lstrip('0') for n in target_nums}
        c_nums_norm = {n.lstrip('0') for n in candidate_nums}

        if t_nums_norm != c_nums_norm:
            # ALLOW matching if one side is empty and the other is '1'
            # This allows "Steering Gear" to match "Steering Gear No.1"
            is_implicit_one = (
                (not t_nums_norm and c_nums_norm == {'1'}) or 
                (not c_nums_norm and t_nums_norm == {'1'})
            )
            
            # If it's NOT an implicit '1' (e.g., No.1 vs No.2), then block the match
            if not is_implicit_one:
                continue 

        # 4. Subset Match Logic (Preserved exactly from source)
        # If all words in the short PDF name exist in the long Excel name
        is_subset = target_tokens.issubset(candidate_tokens) or candidate_tokens.issubset(target_tokens)
        subset_score = 0.95 if (is_subset and len(target_tokens) > 0) else 0.0

        # 5. Structural Similarity (Preserved exactly from source)
        seq_score = difflib.SequenceMatcher(None, target_clean, candidate_clean).ratio()

        # 6. Word Overlap (Preserved exactly from source)
        intersection = target_tokens.intersection(candidate_tokens)
        union = target_tokens.union(candidate_tokens)
        token_score = len(intersection) / len(union) if union else 0.0

        # 7. Final Scoring (Preserved exactly from source)
        final_score = max(subset_score, seq_score, token_score)

        # Threshold check
        if final_score >= 0.8 and final_score > highest_score:
            highest_score = final_score
            best_code = code

    # Logging (Preserved from source)
    if best_code:
        logger.info(f"   ✅ Smart Match: '{target_name}' mapped to '{best_code}' (Score: {highest_score:.2f})")
    else:
        logger.warning(f"   ⚠️ No match found for machinery: '{target_name}'")
    
    return best_code, highest_score

# --- MAIN PROCESSOR ---

def save_luboil_report(
    pdf_file_stream: BinaryIO, 
    filename: str, 
    session: Session
) -> Dict[str, Any]:
    
    # 1. EXTRACT DATA
    try:
        extracted_data = extract_lube_oil_report_data(pdf_file_stream)
    except Exception as e:
        logger.error(f"Extraction failed for {filename}: {e}")
        raise ValueError("Failed to parse PDF structure.")

    meta = extracted_data.get('metadata', {})
    vessel_name_extracted = meta.get('vessel_name')
    report_date_str = meta.get('report_date')

    if not vessel_name_extracted or not report_date_str:
        raise ValueError("Missing Vessel Name or Date in report.")

    # 2. FIND VESSEL
    control_db = SessionControl()
    try:
        vessel = control_db.query(ControlVessel).filter(
            ControlVessel.name.ilike(f"%{vessel_name_extracted}%"),
            ControlVessel.is_active == True
        ).first()

        if not vessel:
            all_vessels = control_db.query(ControlVessel).filter(ControlVessel.is_active == True).all()
            for v in all_vessels:
                if len(v.name) > 3 and v.name.lower() in vessel_name_extracted.lower():
                    vessel = v
                    break

        if not vessel:
            noise_words = r'(?i)crankcase|engine|stern|tube|system|bearings|seals|auxiliary|main'
            clean_name = re.sub(noise_words, '', vessel_name_extracted).strip().split('-')[0].strip()
            vessel = control_db.query(ControlVessel).filter(
                ControlVessel.name.ilike(f"%{clean_name}%"),
                ControlVessel.is_active == True
            ).first()
    finally:
        control_db.close()

    if not vessel:
        raise ValueError(f"Vessel '{vessel_name_extracted}' not registered in database.")

    vessel_imo = str(vessel.imo)
    vessel_display_name = vessel.name
    vessel_code = meta.get('vessel_code')

    # Always use actual IMO for config lookup — not Shell code
    config_imo = vessel_imo

    logger.info(f"Matched Vessel: {vessel_display_name} (IMO: {vessel_imo}, Shell Code: {vessel_code})")

    # 3. PREPARE MASTER LIST FOR MATCHING
    all_equipment = session.query(LuboilEquipmentType).all()
    equipment_candidates = {eq.ui_label: eq.code for eq in all_equipment}
    machineries = extracted_data.get('machineries', [])
    pdf_sample_numbers = [
        str(m.get('sample_info', {}).get('number')) 
        for m in machineries if m.get('sample_info', {}).get('number')
    ]

    # 4. HANDLE REPORT HEADER (Update without deleting children)
    existing_report = session.query(LuboilReport).filter(LuboilReport.imo_number == vessel_imo,
        LuboilReport.report_date == report_date_str,
        LuboilReport.file_name == filename,
        LuboilSample.sample_number.in_(pdf_sample_numbers)
    ).first()

    is_duplicate = False
    if existing_report:
        logger.info(f"Report exists for {report_date_str}. Performing Smart Merge (preserving remarks).")
        report = existing_report
        report.file_name = filename
        report.full_json_data = extracted_data
        is_duplicate = True
    else:
        report = LuboilReport(
            imo_number=vessel_imo,
            file_name=filename,
            lab_name=meta.get('lab_name', 'Shell LubeAnalyst'),
            report_date=report_date_str,
            full_json_data=extracted_data
        )
        session.add(report)
    
    session.flush() # Ensure report.report_id is available

    # 5. PROCESS SAMPLES (Upsert Logic)
    machineries = extracted_data.get('machineries', [])
    
    for machine in machineries:
        raw_name = machine.get("name", "").strip()
        clean_name = re.sub(r'\s+-\s+\d+.*$', '', raw_name).strip()
        clean_name = re.sub(re.escape(vessel_display_name), '', clean_name, flags=re.IGNORECASE).strip().strip('-').strip()

        # Resolve Equipment Code
        equipment_code = None
        lube_analyst_code = machine.get("lube_analyst_code")

        # ── PRIORITY 1: Match by Lube Analyst Code via VesselConfig ──
        # PRIORITY 1: VesselConfig lookup by lube analyst code
        if lube_analyst_code and config_imo:
            config_match = session.query(LuboilVesselConfig).filter(
                LuboilVesselConfig.imo_number == config_imo,
                LuboilVesselConfig.lab_analyst_code == lube_analyst_code
            ).first()
            if config_match:
                equipment_code = config_match.equipment_code
                logger.info(f"✅ VesselConfig Match: '{lube_analyst_code}' → '{equipment_code}'")
            else:
                logger.warning(f"⚠️ Lube Analyst Code '{lube_analyst_code}' not found in config, falling back.")

        # PRIORITY 2: Name mapping cache
        if not equipment_code:
            mapping = session.query(LuboilNameMapping).filter(
                LuboilNameMapping.lab_raw_string == clean_name
            ).first()
            if mapping:
                equipment_code = mapping.equipment_code
                logger.info(f"✅ Name Mapping cache: '{clean_name}' → '{equipment_code}'")

        # PRIORITY 3: Smart name matching
        if not equipment_code:
            equipment_code, match_score = find_smart_match(clean_name, equipment_candidates)
            if equipment_code:
                if match_score >= 0.92:
                    try:
                        new_map = LuboilNameMapping(
                            lab_raw_string=clean_name,
                            equipment_code=equipment_code
                        )
                        session.add(new_map)
                        session.flush()
                    except Exception:
                        session.rollback()
                logger.info(f"✅ Smart match: '{clean_name}' → '{equipment_code}' (score: {match_score:.2f})")
            else:
                logger.warning(f"⚠️ No match found for: '{clean_name}' — saving with null equipment_code")

        # --- SMART MERGE CHECK ---
        # Check if this specific machinery sample already exists in this report
        existing_sample = session.query(LuboilSample).filter(
            LuboilSample.report_id == report.report_id,
            LuboilSample.equipment_code == equipment_code
        ).first()

        m_sample_info = machine.get('sample_info', {})
        lab_sample_number = m_sample_info.get('number') # This is e.g. "990166001"

        # 2. Update the check logic
        existing_sample = session.query(LuboilSample).filter(
            LuboilSample.report_id == report.report_id,
            LuboilSample.equipment_code == equipment_code,
            LuboilSample.sample_number == lab_sample_number  # ðŸ”¥ ADD THIS LINE
        ).first()

        chem = machine.get('chemistry', {})
        phys = chem.get('physical', {})
        wear = chem.get('wear', {})
        cont = chem.get('contamination', {})
        adds = chem.get('additives', {})

        # Prepare the dictionary of data from PDF
        tech_data = {
            "machinery_name": clean_name,
            "sample_number": m_sample_info.get('number'),
            "sample_date": m_sample_info.get('date') or report_date_str,
            "status": machine.get('status', 'Unknown'),
            "equipment_hours": m_sample_info.get('hours_equipment'),
            "summary_error": machine.get('summary_error'),
            "pdf_page_index": machine.get('page_index'),
            "lab_diagnosis": machine.get('diagnosis'),
            # Physical
            "viscosity_40c": phys.get('viscosity_40c'),
            "viscosity_100c": phys.get('viscosity_100c'),
            "tan": phys.get('tan'),
            "tbn": phys.get('tbn'),
            "flash_point": phys.get('flash_point'),
            # Wear
            "iron": wear.get('iron'),
            "chromium": wear.get('chromium'),
            "tin": wear.get('tin'),
            "lead": wear.get('lead'),
            "copper": wear.get('copper'),
            "aluminium": wear.get('aluminium'),
            "vanadium": wear.get('vanadium'),
            "nickel": wear.get('nickel'),
            "wpi_index": wear.get('wpi_index'),
            # Contamination
            "water_content_pct": cont.get('water_pct'),
            "sodium": cont.get('sodium'),
            "silicon": cont.get('silicon'),
            "soot_pct": cont.get('soot_pct'),
            "ic_index": cont.get('ic_index'),
            # Additives
            "calcium": adds.get('calcium'),
            "zinc": adds.get('zinc'),
            "phosphorus": adds.get('phosphorus'),
            "magnesium": adds.get('magnesium'),
            "boron": adds.get('boron'),
            "molybdenum": adds.get('molybdenum'),
            "barium": adds.get('barium'),
        }

        if existing_sample:
            # UPDATE existing: Loop through tech_data and update attributes
            # This preserves officer_remarks, office_remarks, attachment_url, etc.
            for key, value in tech_data.items():
                setattr(existing_sample, key, value)
            logger.info(f"ðŸ”„ Updated tech data for: {clean_name}")
        else:
            # INSERT new: Create new sample object
            new_sample = LuboilSample(
                report_id=report.report_id,
                equipment_code=equipment_code,
                **tech_data,
                officer_remarks=None # Explicitly new
            )
            session.add(new_sample)
            logger.info(f"âž• Added new sample for: {clean_name}")

    session.commit()

    # Calculate Summary for Response
    critical_count = sum(1 for m in machineries if m.get('status') in ['Critical', 'Action'])
    warning_count = sum(1 for m in machineries if m.get('status') in ['Warning', 'Attention'])
    normal_count = sum(1 for m in machineries if m.get('status') == 'Normal')
    
    summary_text = f"{critical_count} Critical, {warning_count} Warning, {normal_count} Normal"

    return {
        "report_id": report.report_id,
        "vessel": vessel_display_name,
        "sample_count": len(machineries),
        "report_date": report_date_str,
        "is_duplicate": is_duplicate,
        "alert_summary": summary_text,
        "status": "Smart Merge (Preserved Remarks)" if is_duplicate else "Processed"
    }

