import logging
import json
import re
import difflib  # Standard library for comparison
from typing import BinaryIO, Dict, Any, Optional, Set
from sqlalchemy.orm import Session
from datetime import datetime, timezone
from sqlalchemy import select
from datetime import date as date_type
# Import extractor — Factory auto-routes to Shell / Gulf Marine / Tribocare
from app.services.pdf_extractors.factory import extract_lube_oil_report_data

# Import models
from app.luboil_model import LuboilReport, LuboilSample, LuboilEquipmentType, LuboilNameMapping, LuboilVesselConfig
from app.core.database_control import SessionControl
from app.models.control.vessel import Vessel as ControlVessel
# from app.luboil_model import LuboilReport, LuboilSample, LuboilEquipmentType, LuboilNameMapping

logger = logging.getLogger(__name__)

def standardize_name(text: str) -> str:
    if not text: return ""
    s = text.lower().strip()

    # PASS 0: Normalize punctuation to spaces (critical for stripping out parentheticals like (CRANKCASE))
    s = s.replace("(", " ").replace(")", " ").replace("[", " ").replace("]", " ").replace("-", " ")

    # PASS 1: Directional keywords — MUST run before anything else
    directional = [
        ("before fine filter", "in"),
        ("after fine filter",  "out"),
        ("before fine",        "in"),
        ("after fine",         "out"),
        ("before servo oil",   "in"),
        ("after servo oil",    "out"),
    ]
    for old, new in directional:
        s = s.replace(old, new)

    # PASS 2: Equipment synonyms
    synonyms = [
        ("windlass & mooring winch", "winch"),
        ("windlass",                 "winch"),
        ("mooring winch",            "winch"),
        ("auxiliary diesel engine",  "ae"),
        ("auxiliary engine",         "ae"),
        ("aux engine",               "ae"),
        ("main engine",              "me"),
        ("hydraulic power system",   "hyd"),
        ("hydraulic system",         "hyd"),
        ("hydraulic control",        "hyd"),
        ("steering gear",            "str"),
        ("hose handling crane",      "hose crane"),
        ("deck crane",               "dk crane"),
        ("cargo oil pump",           "cop"),
        ("provision crane",          "prov crane"),
        ("valve remote control",     "rc valve"),
        ("remote control valve",     "rc valve"),
        ("cylinders",                "cyl"),
        ("emergency diesel generator engine", "ge"),
        ("emergency diesel engine",  "ge"),
        ("emergency diesel",         "ge"),
        ("emergency generator",      "ge"),
        ("deck machinery fwd",       "winch fwd"),
        ("deck machinery aft",       "winch aft"),
        ("deck machinery",           "dk machinery"),
    ]
    for old, new in synonyms:
        s = s.replace(old, new)

    # PASS 3: Directional abbreviations using word boundaries
    s = re.sub(r'\bfwd\b', 'fwd', s)
    s = re.sub(r'\baft\b', 'aft', s)

    # PASS 4: Noise removal using word boundaries
    noise_patterns = [
        r'\bsystem\b',
        r'\bunit\b',
        r'\blife\b',
        r'\bbearings\b',
        r'\bseals\b',
        r'\bno[\.\s]*',
        r'\band\b',
        r'#',
        r'\bhps\b',
        r'&\s*',
        r'\bfilter\b',       
        r'\bcrankcase\b',    
        r'\bcylinders\b',
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
        return "ME.HYD.IN", 1.0
    if "after fine" in target_lower and "hydraulic" in target_lower:
        return "ME.HYD.OUT", 1.0
        
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

        # 4. Subset Match Logic
        # Only give the high subset score when the CANDIDATE fully covers the TARGET
        # (i.e., all target tokens exist in the candidate). This prevents a short
        # generic label like "Main Engine" (2 tokens) from scoring 0.95 against a
        # long specific name like "Main Engine Hydraulic Filter Before" (5 tokens).
        # Extra guard: candidate must not be drastically shorter than the target
        # (coverage ratio >= 0.6) to prevent trivial single-word matches.
        candidate_covers_target = target_tokens.issubset(candidate_tokens)
        coverage_ratio = len(candidate_tokens) / len(target_tokens) if target_tokens else 0
        is_subset = candidate_covers_target and coverage_ratio >= 0.6
        subset_score = 0.95 if is_subset else 0.0

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

async def save_luboil_report(
    pdf_file_stream: BinaryIO, 
    filename: str, 
    session: Session
) -> Dict[str, Any]:
    
    # 1. EXTRACT DATA
    try:
        extracted_data = extract_lube_oil_report_data(pdf_file_stream)
    except Exception as e:
        logger.error(f"PDF Extraction Failed: {e}", exc_info=True)
        raise

    if not extracted_data:
        raise ValueError(f"PDF parser returned no data for '{filename}'. The file may be corrupted, password-protected, or in an unsupported format.")

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
            # FIX: Added '\b' for word boundaries, and added 'and', 'gear', 'winch', 'pump' 
            # to handle strings like "Bearings and Seals AM KIRTI"
            noise_words = r'(?i)\b(crankcase|engine|stern|tube|system|bearings|seals|auxiliary|main|and|gear|winch|pump)\b'
            clean_name = re.sub(noise_words, '', vessel_name_extracted).strip()
            
            # Remove any stray punctuation (like dashes or dots) and extra spaces
            clean_name = re.sub(r'[^a-zA-Z0-9\s]', '', clean_name).strip()
            clean_name = " ".join(clean_name.split()) # normalizes spaces
            
            # Fallback: if there are still stray words, vessel names are usually the last 2 words
            if len(clean_name.split()) > 2 and "GCL" not in clean_name and "AM" not in clean_name:
                clean_name = " ".join(clean_name.split()[-2:])
                
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
    result = await session.execute(select(LuboilEquipmentType))
    all_equipment = result.scalars().all()
    equipment_candidates = {eq.ui_label: eq.code for eq in all_equipment}
    oil_source_extracted = meta.get('oil_source', 'UNKNOWN')
    machineries = extracted_data.get('machineries', [])
    report_date_parsed = date_type.fromisoformat(report_date_str)

    # ─────────────────────────────────────────────────────────────────────────
    # 4. DUPLICATE DETECTION — New Rules (User-approved)
    #
    # TRUE DUPLICATE:
    #   Same vessel + same oil_source + same sample numbers → Skip. Do NOT
    #   overwrite anything. It is the exact same lab report uploaded twice.
    #
    # DIFFERENT REPORT, SAME FILENAME:
    #   Different source OR different sample numbers, but filename collides →
    #   This is a genuinely different report (e.g., Gulf & Shell both named
    #   "Stallion.pdf"). Auto-rename the incoming file with a _v2/_v3 suffix
    #   so both reports are stored independently without destroying each other.
    #
    # DIFFERENT REPORT, DIFFERENT FILENAME → Save normally as a new report.
    # ─────────────────────────────────────────────────────────────────────────

    pdf_sample_numbers = [
        str(m.get('sample_info', {}).get('number'))
        for m in machineries if m.get('sample_info', {}).get('number')
    ]
    incoming_sample_numbers = set(pdf_sample_numbers)

    is_duplicate = False
    report = None
    existing_map = {}  # always initialize so sample loop never breaks

    # ── Step 1: Check for TRUE DUPLICATE (source + sample numbers match) ──
    if incoming_sample_numbers:
        existing_samples_result = await session.execute(
            select(LuboilSample)
            .join(LuboilReport, LuboilSample.report_id == LuboilReport.report_id)
            .where(LuboilReport.imo_number == vessel_imo)
            .where(LuboilReport.oil_source == oil_source_extracted)
            .where(LuboilSample.sample_number.in_(pdf_sample_numbers))
        )
        existing_samples = existing_samples_result.scalars().all()

        if existing_samples:
            existing_sample_numbers = {s.sample_number for s in existing_samples}

            if existing_sample_numbers == incoming_sample_numbers:
                # TRUE DUPLICATE — same vessel + same source + same sample numbers
                # Do NOT touch anything. Just reuse the existing report for sample lookup.
                is_duplicate = True
                existing_report_res = await session.execute(
                    select(LuboilReport).where(
                        LuboilReport.report_id == existing_samples[0].report_id
                    )
                )
                report = existing_report_res.scalars().first()
                existing_map = {s.sample_number: s for s in existing_samples}
                logger.info(
                    f"✅ TRUE DUPLICATE detected (source={oil_source_extracted}, "
                    f"samples={incoming_sample_numbers}). Skipping insert. "
                    f"Reusing report_id={report.report_id}"
                )

    # ── Step 2: Not a duplicate — handle filename collision ──
    if not is_duplicate:
        # Resolve a safe filename that doesn't collide with an existing record
        safe_filename = filename
        counter = 2
        while True:
            collision_check = await session.execute(
                select(LuboilReport).where(
                    LuboilReport.imo_number == vessel_imo,
                    LuboilReport.file_name == safe_filename
                )
            )
            collision = collision_check.scalars().first()
            if not collision:
                break  # filename is free — use it
            # Collision found — this is a DIFFERENT report with the same filename
            # Auto-rename: append _v2, _v3, etc. to keep both reports separate
            name_part, _, ext = filename.rpartition('.')
            if not name_part:
                name_part = filename
                ext = ''
            safe_filename = f"{name_part}_v{counter}.{ext}" if ext else f"{name_part}_v{counter}"
            counter += 1
            logger.info(
                f"⚠️ Filename collision: '{filename}' already exists for this vessel. "
                f"Renaming incoming report to '{safe_filename}'"
            )

        report = LuboilReport(
            imo_number=vessel_imo,
            file_name=safe_filename,
            lab_name=meta.get('lab_name', 'Shell LubeAnalyst'),
            report_date=report_date_parsed,
            full_json_data=extracted_data,
            oil_source=oil_source_extracted
        )
        session.add(report)
        logger.info(f"✅ NEW report created for {vessel_display_name} date={report_date_str} file='{safe_filename}'")


    await session.flush()
    
    for machine in machineries:
        raw_name = machine.get("name", "").strip()
        clean_name = re.sub(r'\s+-\s+\d+.*$', '', raw_name).strip()
        clean_name = re.sub(re.escape(vessel_display_name), '', clean_name, flags=re.IGNORECASE).strip().strip('-').strip()

        # Resolve Equipment Code
        equipment_code = None
        lube_analyst_code = machine.get("lube_analyst_code")
        is_shell_source = (oil_source_extracted or "").upper() == "SHELL"

        # ── PRIORITY 1: Match by Lube Analyst Code via VesselConfig ──
        # Direct code lookup — fastest and most accurate path (Shell only)
        if lube_analyst_code and config_imo:
            result = await session.execute(
                select(LuboilVesselConfig).filter(
                    LuboilVesselConfig.imo_number == config_imo,
                    LuboilVesselConfig.lab_analyst_code == lube_analyst_code
                )
            )
            config_match = result.scalars().first()
            if config_match:
                equipment_code = config_match.equipment_code
                logger.info(f"✅ P1 VesselConfig Code Match: '{lube_analyst_code}' → '{equipment_code}'")

        # ── PRIORITY 2 (Shell): Text match against uncoded + completely unconfigured equipment ──
        # If this is a Shell report with an unregistered LubeAnalyst code, we MUST NOT
        # run the generic text match against all equipment — that causes wrong mappings.
        # Search order:
        #   2a. VesselConfig rows for this vessel where lab_analyst_code IS NULL (uncoded slots)
        #   2b. Equipment types with NO VesselConfig row at all for this vessel (unconfigured)
        # When matched from either pool → auto-register the code and create config if needed.
        if not equipment_code and is_shell_source and lube_analyst_code and config_imo:

            # --- 2a: Uncoded VesselConfig slots ---
            uncoded_cfg_result = await session.execute(
                select(LuboilVesselConfig).filter(
                    LuboilVesselConfig.imo_number == config_imo,
                    LuboilVesselConfig.lab_analyst_code == None  # noqa: E711
                )
            )
            uncoded_configs = uncoded_cfg_result.scalars().all()
            uncoded_eq_codes = {cfg.equipment_code for cfg in uncoded_configs}

            # Also get all configured equipment codes (coded + uncoded) to find what's missing
            all_cfg_result = await session.execute(
                select(LuboilVesselConfig).filter(
                    LuboilVesselConfig.imo_number == config_imo
                )
            )
            all_vessel_configs = all_cfg_result.scalars().all()
            all_configured_codes = {cfg.equipment_code for cfg in all_vessel_configs}

            # --- 2b: Completely unconfigured equipment types for this vessel ---
            # Any equipment type in the global list that has no VesselConfig row at all
            fully_unconfigured_codes = {
                code for code in equipment_candidates.values()
                if code not in all_configured_codes
            }

            # Build combined candidate pool: uncoded slots + fully unconfigured types
            available_candidates = {
                label: code
                for label, code in equipment_candidates.items()
                if code in uncoded_eq_codes or code in fully_unconfigured_codes
            }

            if available_candidates:
                shell_code_match, shell_score = find_smart_match(clean_name, available_candidates)
                if shell_code_match:
                    equipment_code = shell_code_match
                    is_new_config = shell_code_match in fully_unconfigured_codes

                    logger.info(
                        f"✅ P2 Shell match: '{clean_name}' → '{equipment_code}' "
                        f"(score: {shell_score:.2f}, lube_code: {lube_analyst_code}, "
                        f"{'NEW config' if is_new_config else 'existing uncoded slot'})"
                    )

                    if is_new_config:
                        # Auto-create a brand new VesselConfig row for this vessel + equipment
                        try:
                            new_cfg = LuboilVesselConfig(
                                imo_number=config_imo,
                                equipment_code=equipment_code,
                                lab_analyst_code=lube_analyst_code,
                                is_active=True,
                            )
                            session.add(new_cfg)
                            await session.flush()
                            logger.info(
                                f"✅ Auto-created VesselConfig[{config_imo}/{equipment_code}] "
                                f"with LubeAnalyst code '{lube_analyst_code}'"
                            )
                        except Exception as e:
                            await session.rollback()
                            logger.warning(f"⚠️ Could not auto-create VesselConfig: {e}")
                    else:
                        # Update the existing uncoded VesselConfig row with the code
                        matched_cfg = next(
                            (c for c in uncoded_configs if c.equipment_code == equipment_code), None
                        )
                        if matched_cfg:
                            matched_cfg.lab_analyst_code = lube_analyst_code
                            if not matched_cfg.is_active:
                                matched_cfg.is_active = True
                                logger.info(f"✅ Auto-activated previously disabled equipment '{equipment_code}'")

                            logger.info(
                                f"✅ Auto-registered LubeAnalyst code '{lube_analyst_code}' "
                                f"→ VesselConfig[{config_imo}/{equipment_code}]"
                            )
                else:
                    logger.warning(
                        f"⚠️ Shell P2: no match found for '{clean_name}' "
                        f"(lube_code={lube_analyst_code}) — saving with null equipment_code"
                    )
            else:
                logger.warning(
                    f"⚠️ Shell P2: no available equipment slots for IMO {config_imo} "
                    f"— saving '{clean_name}' with null equipment_code"
                )

        # ── PRIORITY 3 (Gulf / Tribocare): Name mapping cache ──
        # Only runs for non-Shell sources OR Shell machines without a LubeAnalyst code
        if not equipment_code and not (is_shell_source and lube_analyst_code):
            result = await session.execute(
                select(LuboilNameMapping).filter(
                    LuboilNameMapping.lab_raw_string == clean_name
                )
            )
            mapping = result.scalars().first()
            if mapping:
                equipment_code = mapping.equipment_code
                logger.info(f"✅ P3 Name Mapping cache: '{clean_name}' → '{equipment_code}'")

        # ── PRIORITY 4 (Gulf / Tribocare): Smart name matching ──
        # Only runs for non-Shell sources OR Shell machines without a LubeAnalyst code
        if not equipment_code and not (is_shell_source and lube_analyst_code):
            equipment_code, match_score = find_smart_match(clean_name, equipment_candidates)
            if equipment_code:
                if match_score >= 0.92:
                    try:
                        new_map = LuboilNameMapping(
                            lab_raw_string=clean_name,
                            equipment_code=equipment_code
                        )
                        session.add(new_map)
                        await session.flush()
                    except Exception:
                        await session.rollback()
                logger.info(f"✅ P4 Smart match: '{clean_name}' → '{equipment_code}' (score: {match_score:.2f})")
            else:
                logger.warning(f"⚠️ P4 No match found for: '{clean_name}' — saving with null equipment_code")

        

        # 2. Update the check logic
        m_sample_info = machine.get('sample_info', {})
        chem = machine.get('chemistry', {})
        phys = chem.get('physical', {})
        wear = chem.get('wear', {})
        cont = chem.get('contamination', {})
        adds = chem.get('additives', {})

        # ── FUTURE-DATE GUARD (Shell only) ──────────────────────────────────
        # Shell PDFs can be combined reports containing machines sampled on
        # different dates. If a machine's sample date is AFTER the report date,
        # it does not belong to this report — it will appear in a future PDF.
        # Gulf and Tribocare always have sample dates before the report date
        # (collection date vs issue date), so we only apply this to Shell.
        if is_shell_source and m_sample_info.get('date'):
            try:
                m_sample_date = date_type.fromisoformat(m_sample_info.get('date'))
                if m_sample_date > report_date_parsed:
                    logger.warning(
                        f"⏭️ Skipping Shell sample '{clean_name}' "
                        f"(sample_date={m_sample_date} > report_date={report_date_parsed}) "
                        f"— belongs to a future report."
                    )
                    continue
            except (ValueError, TypeError):
                pass  # If date parse fails, allow it through



        # ── STATUS NORMALIZATION ────────────────────────────────────────────
        def normalize_status(raw_status: str) -> str:
            if not raw_status:
                return 'Warning'  # Safe default if entirely missing
            s = str(raw_status).strip().lower()
            if s in ('action', 'critical'):
                return 'Critical'
            if s in ('attention', 'warning', 'caution', 'alert'):
                return 'Warning'
            if s == 'normal':
                return 'Normal'
            # If it's something entirely weird, default to Warning rather than crashing
            return 'Warning'

        raw_status = machine.get('status', 'Warning')
        normalized_status = normalize_status(raw_status)

        tech_data = {
            "machinery_name": clean_name,
            "sample_number": m_sample_info.get('number'),
            "sample_date": date_type.fromisoformat(m_sample_info.get('date')) if m_sample_info.get('date') else report_date_parsed,
            "status": normalized_status,
            "equipment_hours": m_sample_info.get('hours_equipment'),
            "summary_error": machine.get('summary_error'),
            "pdf_page_index": machine.get('page_index'),
            "lab_diagnosis": machine.get('diagnosis'),
            "viscosity_40c": phys.get('viscosity_40c'),
            "viscosity_100c": phys.get('viscosity_100c'),
            "tan": phys.get('tan'),
            "tbn": phys.get('tbn'),
            "flash_point": phys.get('flash_point'),
            "iron": wear.get('iron'),
            "chromium": wear.get('chromium'),
            "tin": wear.get('tin'),
            "lead": wear.get('lead'),
            "copper": wear.get('copper'),
            "aluminium": wear.get('aluminium'),
            "vanadium": wear.get('vanadium'),
            "nickel": wear.get('nickel'),
            "wpi_index": wear.get('wpi_index'),
            "water_content_pct": cont.get('water_pct'),
            "sodium": cont.get('sodium'),
            "silicon": cont.get('silicon'),
            "soot_pct": cont.get('soot_pct'),
            "ic_index": cont.get('ic_index'),
            "calcium": adds.get('calcium'),
            "zinc": adds.get('zinc'),
            "phosphorus": adds.get('phosphorus'),
            "magnesium": adds.get('magnesium'),
            "boron": adds.get('boron'),
            "molybdenum": adds.get('molybdenum'),
            "barium": adds.get('barium'),
        }

        PROTECTED_FIELDS = {
            'officer_remarks', 'office_remarks', 'internal_remarks',
            'attachment_url', 'is_image_required', 'is_resampling_required',
            'is_resolved', 'resolution_remarks', 'is_approval_pending',
            'status_change_log'
        }

        if is_duplicate:
            # DUPLICATE: search by sample_number scoped to vessel IMO (not just report_id)
            result = await session.execute(
                select(LuboilSample)
                .join(LuboilReport, LuboilSample.report_id == LuboilReport.report_id)
                .where(LuboilReport.imo_number == vessel_imo)
                .where(LuboilSample.sample_number == tech_data["sample_number"])
            )
            existing_sample = result.scalars().first()
            if existing_sample:
                for key, value in tech_data.items():
                    if key not in PROTECTED_FIELDS:
                        setattr(existing_sample, key, value)
                logger.info(f"🔄 Duplicate: updated tech fields for {clean_name}")
            else:
                logger.warning(f"⚠️ Duplicate: sample_number {tech_data['sample_number']} not found for {clean_name}")
        else:
            # NEW report: always insert fresh, protected fields all None/default
            new_sample = LuboilSample(
                report_id=report.report_id,
                equipment_code=equipment_code,
                **tech_data,
                officer_remarks=None,
                office_remarks=None,
                internal_remarks=None,
                attachment_url=None,
                is_image_required=False,
                is_resampling_required=False,
                is_resolved=False,
                resolution_remarks=None,
                is_approval_pending=False,
                status_change_log=None,
            )
            session.add(new_sample)
            logger.info(f"➕ New report: inserted fresh sample for {clean_name}")

            # ── AUTO-CREATE or AUTO-ACTIVATE VesselConfig ──────────
            # This ensures equipment shows in the UI matrix without requiring
            # manual configuration after an upload, regardless of the source.
            if equipment_code:
                try:
                    existing_cfg_res = await session.execute(
                        select(LuboilVesselConfig).where(
                            LuboilVesselConfig.imo_number == vessel_imo,
                            LuboilVesselConfig.equipment_code == equipment_code
                        )
                    )
                    existing_cfg = existing_cfg_res.scalars().first()
                    
                    if not existing_cfg:
                        session.add(LuboilVesselConfig(
                            imo_number=vessel_imo,
                            equipment_code=equipment_code,
                            is_active=True
                        ))
                        logger.info(f"🔧 Auto-created VesselConfig: IMO={vessel_imo} → {equipment_code}")
                    elif not existing_cfg.is_active:
                        existing_cfg.is_active = True
                        logger.info(f"🔧 Auto-activated previously disabled VesselConfig: IMO={vessel_imo} → {equipment_code}")
                except Exception as cfg_err:
                    logger.warning(f"⚠️ Could not auto-create/activate VesselConfig for {equipment_code}: {cfg_err}")


    await session.commit()

    # Calculate Summary for Response
    critical_count = sum(1 for m in machineries if m.get('status') in ['Critical', 'Action'])
    warning_count = sum(1 for m in machineries if m.get('status') in ['Warning', 'Attention'])
    normal_count = sum(1 for m in machineries if m.get('status') == 'Normal')
    
    summary_text = f"{critical_count} Critical, {warning_count} Warning, {normal_count} Normal"

    return {
        "report_id": report.report_id,
        "file_name": report.file_name,
        "vessel": vessel_display_name,
        "sample_count": len(machineries),
        "report_date": report_date_str,
        "is_duplicate": is_duplicate,
        "alert_summary": summary_text,
        "status": "Smart Merge (Preserved Remarks)" if is_duplicate else "Processed"
    }

