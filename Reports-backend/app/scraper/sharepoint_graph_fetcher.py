import re
import logging
import requests
from datetime import datetime, timedelta
import calendar
from uuid import uuid4
from urllib.parse import quote

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete as sa_delete

from app.core.config import settings
from app.utils.report_date import extract_report_period
from app.core.blob_storage import upload_pdf_to_blob
from app.models.report import Report, ScrapeStatus, VerifyStatus, ReportConfig, ReportAttachment

logger = logging.getLogger("sharepoint_fetcher")

# Target vessels
TARGET_VESSELS = ["tufmax", "fos"]

# SharePoint folder -> frequency tag mapping
REPORT_TYPES = {
    "01. Weekly Reports":    "WEEKLY",
    "02. Monthly Reports":   "MONTHLY",
    "03. Quarterly Reports": "QUARTERLY"
}


def _normalize(text: str) -> str:
    """Strip everything except alphanumerics, lowercase."""
    return re.sub(r'[^a-z0-9]', '', text.lower())


def _match_file_to_config(file_name: str, configs: list) -> ReportConfig | None:
    """
    Match a SharePoint filename to the closest ReportConfig entry using:
    0. Keyword-based priority matching using verified attachment patterns.
    1. Exact tech-code extraction (e.g. TECH-07, OPR-06) + sub-variant (AE-1/AE-2/AE-3)
    2. Fuzzy name similarity fallback.
    Returns the best matching ReportConfig, or None if nothing scores above threshold.
    """
    import difflib

    fname_lower = file_name.lower()

    # Step 0: keyword-based priority matching using verified SmartPAL attachment patterns.
    # Each entry is (list_of_required_keywords, partial_report_code_fragment).
    # ALL keywords in the list must appear in the filename (case-insensitive).
    # Ordered from most-specific to least-specific so the first match wins.
    KEYWORD_RULES = [

        # ── WEEKLY REPORTS ──────────────────────────────────────────────────────

        # WEEKLY-01: DECK WEEKLY WORKDONE REPORT
        (['deck', 'weekly', 'work'],                      'DECK_WEEKLY_WORK'),
        (['deck', 'weekly', 'done'],                      'DECK_WEEKLY_WORK'),
        (['deck', 'weekly'],                              'DECK_WEEKLY_WORK'),
        (['deck', 'week'],                                'DECK_WEEKLY_WORK'),
        (['deck', 'daily', 'work'],                       'DECK_WEEKLY_WORK'),
        (['deck', 'daily'],                               'DECK_WEEKLY_WORK'),

        # WEEKLY-02: ENG WEEKLY WORKDONE REPORT
        (['engine', 'weekly', 'work'],                    'ENG_WEEKLY_WORKD'),
        (['engine', 'weekly', 'done'],                    'ENG_WEEKLY_WORKD'),
        (['engine', 'weekly'],                            'ENG_WEEKLY_WORKD'),
        (['engine', 'week'],                              'ENG_WEEKLY_WORKD'),
        (['eng', 'weekly'],                               'ENG_WEEKLY_WORKD'),
        (['engine', 'daily', 'work'],                     'ENG_WEEKLY_WORKD'),
        (['engine', 'daily'],                             'ENG_WEEKLY_WORKD'),
        (['eng', 'daily'],                                'ENG_WEEKLY_WORKD'),

        # WEEKLY-03: ELECTRICAL WEEKLY WORKDONE REPORT
        (['electrical', 'weekly'],                        'ELECTRICAL__WEEK'),
        (['electrical', 'week'],                          'ELECTRICAL__WEEK'),

        # WEEKLY-04: DECK CORROSION MAINTENANCE PLAN
        (['corrosion', 'maintenance'],                    'DECK_CORROSION'),
        (['corrosion', 'plan'],                           'DECK_CORROSION'),

        # WEEKLY-05: WEEKLY BUNKER REPORT
        (['bunker', 'report'],                            'WEEKLY_BUNKER_RE'),
        (['bunker', 'sounding'],                          'WEEKLY_BUNKER_RE'),
        (['bunker', 'tank'],                              'WEEKLY_BUNKER_RE'),

        # WEEKLY-06: BOILER AND COOLER WATER REPORT
        (['waterproof'],                                  'BOILER_AND_COOLE'),
        (['boiler', 'cooling'],                           'BOILER_AND_COOLE'),
        (['boiler', 'cooler'],                            'BOILER_AND_COOLE'),
        (['boiler', 'water'],                             'BOILER_AND_COOLE'),
        (['cooling', 'water', 'test'],                    'BOILER_AND_COOLE'),
        (['cooling', 'test'],                             'BOILER_AND_COOLE'),

        # WEEKLY-08: TECH-57 ONBOARD LO WEEKLY ANALYSIS REPORT
        (['tech', '57'],                                  'TECH_-_57'),
        (['te-57'],                                       'TECH_-_57'),
        (['te', '57', 'lo'],                              'TECH_-_57'),

        # WEEKLY-09: TECH-02 PMS (ONLY FOR TUFMAX)
        (['tech-02', 'pms'],                              'TECH_-_02_-_WEEKLY'),
        (['tech', '02', 'pms'],                           'TECH_-_02_-_WEEKLY'),

        # ── MONTHLY REPORTS ─────────────────────────────────────────────────────

        # MO-01: TECH-07 ME PERFORMANCE SHEET
        (['tech', '07', 'performance'],                   'TECH-07_ME_PERFOR'),
        (['tech', '07', 'me'],                            'TECH-07_ME_PERFOR'),
        (['me', 'performance', 'sheet'],                  'TECH-07_ME_PERFOR'),
        (['main', 'engine', 'performance', 'sheet'],      'TECH-07_ME_PERFOR'),

        # MO-02: TECH-06 ENGINE PERFORMANCE TREND
        (['tech', '06', 'performance'],                   'TECH-06_ENGINE_PE'),
        (['engine', 'performance', 'trend'],              'TECH-06_ENGINE_PE'),

        # MO-03: TECH-12 AE-1 PERFORMANCE SHEET
        (['tech', '12', 'ae', '1'],                       'TECH-12_AE-1_PERF'),
        (['ae', '1', 'performance', 'sheet'],             'TECH-12_AE-1_PERF'),
        (['ae1', 'performance'],                          'TECH-12_AE-1_PERF'),
        (['ae-1', 'performance'],                         'TECH-12_AE-1_PERF'),
        (['ae #1', 'performance'],                        'TECH-12_AE-1_PERF'),

        # MO-04: TECH-12 AE-2 PERFORMANCE SHEET
        (['tech', '12', 'ae', '2'],                       'TECH-12_AE-2_PERF'),
        (['ae', '2', 'performance', 'sheet'],             'TECH-12_AE-2_PERF'),
        (['ae2', 'performance'],                          'TECH-12_AE-2_PERF'),
        (['ae-2', 'performance'],                         'TECH-12_AE-2_PERF'),
        (['ae #2', 'performance'],                        'TECH-12_AE-2_PERF'),

        # MO-05: TECH-12 AE-3 PERFORMANCE SHEET
        (['tech', '12', 'ae', '3'],                       'TECH-12_AE-3_PERF'),
        (['ae', '3', 'performance', 'sheet'],             'TECH-12_AE-3_PERF'),
        (['ae3', 'performance'],                          'TECH-12_AE-3_PERF'),
        (['ae-3', 'performance'],                         'TECH-12_AE-3_PERF'),
        (['ae #3', 'performance'],                        'TECH-12_AE-3_PERF'),

        # MO-06: TECH-08A SCAVENGE PORT INSPECTION
        (['scavenge', 'port'],                            'TECH-08A_SCAVENGE'),
        (['tech', '08a'],                                 'TECH-08A_SCAVENGE'),
        (['te', '08', 'scavenge'],                        'TECH-08A_SCAVENGE'),

        # MO-07: TECH-55 SCRAPE DOWN ANALYSIS
        (['scrape', 'down'],                              'TECH-55_SCRAPE_DO'),
        (['tech', '55'],                                  'TECH-55_SCRAPE_DO'),

        # MO-08: TECH-13 AUXILIARY ENGINE PERFORMANCE TREND
        (['auxiliary', 'engine', 'performance'],          'TECH-13_AUXILIARY'),
        (['tech', '13', 'auxiliary'],                     'TECH-13_AUXILIARY'),
        (['tech', '13', 'performance'],                   'TECH-13_AUXILIARY'),

        # MO-09: TECH-56 MONTHLY LO CONSUMPTION REPORT
        (['tech', '56', 'lo'],                            'TECH-56_MONTHLY_L'),
        (['tech', '56', 'consumption'],                   'TECH-56_MONTHLY_L'),
        (['lo', 'consumption', 'report'],                 'TECH-56_MONTHLY_L'),
        (['lub', 'oil', 'consumption'],                   'TECH-56_MONTHLY_L'),
        (['monthy', 'lo', 'consumption'],                 'TECH-56_MONTHLY_L'),
        (['monthly', 'lo', 'consumption'],                'TECH-56_MONTHLY_L'),

        # MO-10: TECH-11 CHEMICAL CONSUMPTION RECORD
        (['tech', '11', 'chemical'],                      'TECH-11_CHEMICAL_'),
        (['chemical', 'consumption', 'record'],           'TECH-11_CHEMICAL_'),

        # MO-11: WATERPROOF REPORT - BOILER AND COOLING WATER TEST (Monthly)
        (['waterproof', 'report'],                        'WATERPROOF_REPORT'),

        # MO-12: MONTHLY - 05 LIST OF PRECISION TOOLS
        (['precision', 'tools'],                          'LIST_OF_PRECISION'),
        (['precision', 'instruments'],                    'LIST_OF_PRECISION'),

        # MO-13: TECH-10 VIBRATION ANALYSIS REPORT
        (['vibration', 'analysis'],                       'TECH-10_VIBRATION'),
        (['tech', '10', 'vibration'],                     'TECH-10_VIBRATION'),

        # MO-14: MONTHLY - 04 MONTHLY PARAMETERS
        (['monthly', 'parameters'],                       'MONTHLY_PARAMETER'),
        (['monthly', 'engine', 'abstract'],               'MONTHLY_PARAMETER'),

        # MO-15: MONTHLY - 03 ENGINE MONTH END REPORT REVIEW
        (['month', 'end', 'report'],                      'ENGINE_MONTH_E'),
        (['month', 'end', 'review'],                      'ENGINE_MONTH_E'),
        (['oth', '10', 'month', 'end'],                   'ENGINE_MONTH_E'),
        (['oth-10', 'month'],                             'ENGINE_MONTH_E'),
        (['engine', 'room', 'month', 'end'],              'ENGINE_MONTH_E'),

        # MO-16: OPR-06 MONTHLY PAINT CONSUMPTION REPORT
        (['paint', 'consumption'],                        'OPR-06_MONTHLY_PA'),
        (['paint', 'stock'],                              'OPR-06_MONTHLY_PA'),
        (['opr', '06', 'paint'],                          'OPR-06_MONTHLY_PA'),

        # MO-17: TECH-01 CORROSION MAINTENANCE TOOL
        (['oth', '01', 'corrosion'],                      'TECH-01_CORROSION'),
        (['oth-01', 'corrosion'],                         'TECH-01_CORROSION'),
        (['tech', '01', 'corrosion'],                     'TECH-01_CORROSION'),
        (['corrosion', 'maintenance', 'tool'],            'TECH-01_CORROSION'),

        # MO-18: TECH-48 ICCP LOG
        (['iccp', 'log'],                                 'TECH-48_ICCP_LOG'),
        (['tech', '48', 'iccp'],                          'TECH-48_ICCP_LOG'),
        (['te', '48', 'iccp'],                            'TECH-48_ICCP_LOG'),

        # MO-19: TECH-49 MGPS LOG
        (['mgps', 'log'],                                 'TECH-49_MGPS_LOG'),
        (['tech', '49', 'mgps'],                          'TECH-49_MGPS_LOG'),
        (['te', '49', 'mgps'],                            'TECH-49_MGPS_LOG'),

        # MO-20: MONTHLY - 06 BATTERY LOG
        (['battery', 'log'],                              'BATTERY_LOG'),
        (['oth', '02', 'battery'],                        'BATTERY_LOG'),
        (['oth-02', 'battery'],                           'BATTERY_LOG'),

        # MO-21: TECH-02 MONTHLY PMS (non-Tufmax)
        (['tech', '02', 'pms'],                           'TECH_-_02'),
        (['tech-02', 'pms'],                              'TECH_-_02'),

        # MO: MONTHLY LO CONSUMPTION (alt code)
        (['monthly', 'lube', 'oil'],                      'TECH-56_MONTHLY_L'),

        # MO: BWTS OPERATIONAL DATA DUMP RECORD
        (['bwts'],                                        'BWTS_OPERATIONA'),
        (['ballast', 'water', 'treatment'],               'BWTS_OPERATIONA'),

        # ── QUARTERLY REPORTS ───────────────────────────────────────────────────

        # QT: TECH-15 ME CRANKWEB DEFLECTION REPORT
        (['crankweb', 'deflection', 'me'],                'TECH-15_ME_CRANK'),
        (['crankweb', 'deflection'],                      'TECH-15_ME_CRANK'),
        (['te', '15', 'crankweb'],                        'TECH-15_ME_CRANK'),
        (['tech', '15', 'crankweb'],                      'TECH-15_ME_CRANK'),

        # QT: TECH-16 MAIN ENGINE BEARING CLEARANCES
        (['bearing', 'clearances'],                       'TECH_-16_MAIN_ENG'),
        (['tech', '16', 'bearing'],                       'TECH_-16_MAIN_ENG'),
        (['te', '16', 'bearing'],                         'TECH_-16_MAIN_ENG'),
        (['main', 'engine', 'bearing'],                   'TECH_-16_MAIN_ENG'),
    ]

    for keywords, code_fragment in KEYWORD_RULES:
        if all(kw in fname_lower for kw in keywords):
            matched = [c for c in configs if code_fragment.upper() in c.report_code.upper()]
            if matched:
                return matched[0]




    # Step 1: extract report code pattern from filename (e.g. "TECH-07", "OPR-06", "OTH-10")
    code_match = re.search(
        r'\b([A-Z]{2,5})\s*[-_]\s*(\d{2}[A-Za-z]?)\b', file_name, re.IGNORECASE
    )

    # Also try to extract a sub-variant like AE-1, AE-2, AE-3 from the filename
    # e.g. "TECH - 12 AE-2 Performance Sheet" -> ae2
    variant_match = re.search(r'\bAE[-_\s]?(\d)\b', file_name, re.IGNORECASE)
    variant_suffix = f"ae{variant_match.group(1)}" if variant_match else None

    if code_match:
        extracted = _normalize(code_match.group(1) + code_match.group(2))  # e.g. "tech12"

        # Collect all configs that match the primary code
        candidates = [
            cfg for cfg in configs
            if extracted in _normalize(cfg.report_code) or extracted in _normalize(cfg.report_name)
        ]

        if candidates:
            # If we have a sub-variant, prefer the config that also contains it
            if variant_suffix:
                variant_candidates = [
                    cfg for cfg in candidates
                    if variant_suffix in _normalize(cfg.report_name)
                    or variant_suffix in _normalize(cfg.report_code)
                ]
                if variant_candidates:
                    return variant_candidates[0]
            # No variant or variant not found in any candidate — return first match
            return candidates[0]

    # Step 2: fuzzy matching on alphanumeric core of filename vs report_name
    norm_file = _normalize(file_name)
    # Strip file-level noise: extensions, dates, months, years, vessel names, filler words
    for noise in ['pdf', 'xlsx', 'xlsm', 'xls', 'doc', 'docx',
                  'jul', 'july', 'jun', 'june', 'aug', 'august',
                  'sep', 'sept', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may',
                  '2024', '2025', '2026', '2027',
                  'recovered', 'sheet', 'actual', 'checks', 'updated',
                  'amns', 'tufmax', 'fos', 'gcl', 'narmada', 'yamuna', 'tarang',
                  'mv', 'mvanmns',
                  'defect', 'pms', 'checklist', 'list',
                  'oth', 'daily', 'work', 'done', 'review', 'deck', 'engine',
                  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
                  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
                  '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31']:
        norm_file = norm_file.replace(noise, '')

    # If after stripping there's nothing meaningful left, skip fuzzy match
    if len(norm_file.strip()) < 4:
        return None

    # Detect frequency keywords present in filename for mismatch guard
    raw_lower = file_name.lower()
    file_is_weekly    = any(w in raw_lower for w in ['weekly', 'wk', 'week'])
    file_is_monthly   = any(w in raw_lower for w in ['monthly', 'month end', 'month-end'])
    file_is_quarterly = any(w in raw_lower for w in ['quarterly', 'quarter'])
    file_is_daily     = 'daily' in raw_lower

    best_cfg = None
    best_score = 0.0
    for cfg in configs:
        cfg_freq = (cfg.frequency or '').lower()  # e.g. 'weekly', 'monthly', 'quarterly'

        # Frequency mismatch guard: reject cross-frequency matches
        if file_is_weekly and cfg_freq in ('monthly', 'quarterly'):
            continue
        if file_is_monthly and cfg_freq in ('weekly', 'quarterly'):
            continue
        if file_is_quarterly and cfg_freq in ('weekly', 'monthly'):
            continue
        if file_is_daily and cfg_freq in ('weekly', 'monthly', 'quarterly'):
            continue

        norm_name = _normalize(cfg.report_name)
        for noise in ['weekly', 'monthly', 'quarterly', 'report', 'sheet', 'log', 'record',
                      'workdone', 'work', 'done', 'analysis', 'deck', 'engine']:
            norm_name = norm_name.replace(noise, '')
        score = difflib.SequenceMatcher(None, norm_file, norm_name).ratio()
        if score > best_score:
            best_score = score
            best_cfg = cfg

    if best_score >= 0.65:
        return best_cfg

    return None



async def run_sharepoint_fetcher(
    db: AsyncSession,
    target_vessels=None,
    target_month=None,
    target_year=None,
    target_report_types=None
):
    logger.info("Starting SharePoint Graph API Fetcher...")

    tenant_id    = settings.AZURE_TENANT_ID
    client_id    = settings.AZURE_CLIENT_ID
    client_secret = settings.AZURE_CLIENT_SECRET

    if not all([tenant_id, client_id, client_secret]):
        logger.error("Missing Azure credentials in configuration. Aborting.")
        return

    # Apply defaults
    vessels_to_fetch = target_vessels or TARGET_VESSELS

    now = datetime.now()
    current_year         = target_year  or now.strftime("%Y")
    current_month_folder = target_month or now.strftime("%m. %b %Y").upper()   # e.g. "09. SEP 2026"

    types_to_fetch = {}
    if target_report_types:
        for t in target_report_types:
            if t in REPORT_TYPES:
                types_to_fetch[t] = REPORT_TYPES[t]
    else:
        types_to_fetch = REPORT_TYPES

    # 1. Authenticate
    token_url  = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
    token_data = {
        "client_id":     client_id,
        "client_secret": client_secret,
        "scope":         "https://graph.microsoft.com/.default",
        "grant_type":    "client_credentials"
    }
    token_res = requests.post(token_url, data=token_data)
    if token_res.status_code != 200:
        logger.error(f"Failed to get Graph API token: {token_res.text}")
        return
    token   = token_res.json().get("access_token")
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    # 2. Get Site ID
    site_res = requests.get(
        "https://graph.microsoft.com/v1.0/sites/ozellarmarine.sharepoint.com:/sites/OZM",
        headers=headers
    )
    if site_res.status_code != 200:
        logger.error(f"Failed to get Site ID: {site_res.text}")
        return
    site_id = site_res.json().get("id")

    # 3. Find 'Documents' drive
    drives_res = requests.get(
        f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives", headers=headers
    )
    if drives_res.status_code != 200:
        logger.error(f"Failed to get Drives: {drives_res.text}")
        return

    documents_drive_id = next(
        (d['id'] for d in drives_res.json().get("value", []) if d['name'] == 'Documents'),
        None
    )
    if not documents_drive_id:
        logger.error("Could not find 'Documents' library in OZM site.")
        return

    # 4. Build vessel -> (imo, all_configs) map
    vessel_data: dict[str, dict] = {}   # vessel_match_key -> {imo, vessel_name, configs}
    for v_name in vessels_to_fetch:
        res = await db.execute(
            select(ReportConfig).where(ReportConfig.vessel_name.ilike(f"%{v_name}%"))
        )
        configs = res.scalars().all()
        if configs:
            vessel_data[v_name] = {
                "imo":         configs[0].vessel_imo,
                "vessel_name": configs[0].vessel_name,
                "configs":     list(configs),
            }
        else:
            logger.warning(f"No ReportConfig rows found for vessel '{v_name}'. Skipping.")

    # 5. Traverse SharePoint folder tree
    for sp_folder, freq_tag in types_to_fetch.items():
        logger.info(f"Checking {sp_folder}...")

        year_path = f"008. Reports/4. Technical Report/{sp_folder}/{current_year}"
        year_url = (
            f"https://graph.microsoft.com/v1.0/drives/{documents_drive_id}"
            f"/root:/{quote(year_path)}:/children"
        )
        res = requests.get(year_url, headers=headers)
        if res.status_code != 200:
            logger.info(f"  Path not found or empty: {year_path}")
            continue
            
        month_folders = res.json().get("value", [])
        month_folder_id = None
        # Normalise to a short prefix for matching regardless of whether
        # the real folder has a year suffix ("09. SEP 2026") or not ("09. SEP").
        # We match the first 6 chars, e.g. "09. SE" which is unique per month.
        target_prefix = current_month_folder[:6].lower()
        for mf in month_folders:
            if 'folder' not in mf: continue
            if mf['name'][:6].lower() == target_prefix:
                month_folder_id = mf['id']
                logger.info(f"  Found month folder: {mf['name']}")
                break
                
        if not month_folder_id:
            logger.info(f"  Could not find month folder matching {current_month_folder}")
            continue

        month_url = f"https://graph.microsoft.com/v1.0/drives/{documents_drive_id}/items/{month_folder_id}/children"
        res = requests.get(month_url, headers=headers)
        if res.status_code != 200:
            logger.info(f"  Failed to get contents of month folder")
            continue

        vessel_folders = res.json().get("value", [])
        
        expanded_vessel_folders = []
        for f in vessel_folders:
            if 'folder' not in f:
                continue
            fname_lower = f['name'].lower()
            if "week" in fname_lower or "wk " in fname_lower or "wk" in fname_lower:
                logger.info(f"  Diving into subfolder: {f['name']}")
                week_res = requests.get(
                    f"https://graph.microsoft.com/v1.0/drives/{documents_drive_id}/items/{f['id']}/children",
                    headers=headers
                )
                if week_res.status_code == 200:
                    for child in week_res.json().get("value", []):
                        if 'folder' in child:
                            expanded_vessel_folders.append(child)
            else:
                expanded_vessel_folders.append(f)

        for vf in expanded_vessel_folders:
            if 'folder' not in vf:
                continue

            folder_name  = vf['name']
            target_match = next(
                (tv for tv in vessels_to_fetch if tv.lower() in folder_name.lower()),
                None
            )
            if not target_match or target_match not in vessel_data:
                continue

            vd          = vessel_data[target_match]
            vessel_imo  = vd["imo"]
            all_configs = vd["configs"]
            logger.info(f"  Found vessel folder: {folder_name}")

            # 6. List files
            files_res = requests.get(
                f"https://graph.microsoft.com/v1.0/drives/{documents_drive_id}/items/{vf['id']}/children",
                headers=headers
            )
            if files_res.status_code != 200:
                logger.error(f"  Failed to list files in {folder_name}")
                continue

            # Group files by matched report_code; unmatched go into a fallback bucket
            matched: dict[str, list] = {}    # report_code -> [{file_name, blob_path, cfg}]
            unmatched: list = []

            date_str = now.strftime("%Y-%m-%d")

            for file_item in files_res.json().get("value", []):
                if 'file' not in file_item:
                    continue

                file_name    = file_item['name']
                download_url = file_item.get("@microsoft.graph.downloadUrl")
                if not download_url:
                    continue

                safe_fname = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', file_name).strip() or "report.pdf"
                logger.info(f"    Downloading {file_name}...")

                dl_res = requests.get(download_url)
                if dl_res.status_code != 200:
                    logger.error(f"    Download failed for {file_name}")
                    continue

                pdf_bytes = dl_res.content

                # Extract the report period date from the file content (same as manual upload)
                report_date = None
                report_date_source = "SharePoint upload"
                try:
                    result = extract_report_period(pdf_bytes, file_name)
                    if result:
                        report_date, date_src = result   # returns (datetime, source_str)
                        report_date_source = f"{date_src} (SharePoint)"
                        logger.info(f"    Report date extracted: {report_date.strftime('%b %Y')} (via {date_src})")
                except Exception as e:
                    logger.warning(f"    Could not extract report date from {file_name}: {e}")

                # Fallback: parse the upload date (lastModifiedDateTime) in SharePoint
                if report_date is None:
                    sp_date_str = file_item.get('lastModifiedDateTime') or file_item.get('createdDateTime')
                    if sp_date_str:
                        try:
                            report_date = datetime.fromisoformat(sp_date_str.replace('Z', '+00:00')).replace(tzinfo=None)
                            logger.info(f"    Report date fallback from SP upload date: {report_date.strftime('%Y-%m-%d')}")
                        except Exception as e:
                            logger.warning(f"    Failed to parse SP date {sp_date_str}: {e}")
                            
                    if report_date is None:
                        # Fallback to the month folder name if SP date is missing
                        try:
                            m = re.search(r'(\d{2})\.\s+([A-Z]{3})\s+(\d{4})', current_month_folder)
                            if m:
                                report_date = datetime(int(m.group(3)), int(m.group(1)), 1)
                                logger.info(f"    Report date fallback from folder name: {report_date.strftime('%b %Y')}")
                        except Exception:
                            pass

                # Try to match this file to an existing report config
                matched_cfg = _match_file_to_config(file_name, all_configs)

                if matched_cfg:
                    r_code    = matched_cfg.report_code
                    blob_name = f"reports/{vessel_imo}/{r_code}/{date_str}_{file_item['id']}_{safe_fname}"
                else:
                    # fallback bucket: store under SP-{freq_tag} generic code
                    r_code    = f"SP-{freq_tag}"
                    blob_name = f"reports/{vessel_imo}/{r_code}/{date_str}_{file_item['id']}_{safe_fname}"
                    unmatched.append({"file_name": file_name, "blob_path": blob_name, "cfg": None, "report_date": report_date})

                try:
                    upload_pdf_to_blob(pdf_bytes, blob_name)
                    logger.info(f"    Uploaded to blob: {blob_name}")
                except Exception as e:
                    logger.error(f"    Blob upload failed for {file_name}: {e}")
                    continue

                if matched_cfg:
                    matched.setdefault(r_code, []).append({
                        "file_name":          file_name,
                        "blob_path":          blob_name,
                        "cfg":                matched_cfg,
                        "report_date":        report_date,
                        "report_date_source": report_date_source,
                    })

            # 7. Save each matched report_code+date as its own unique DB row.

            #    Group by (report_code, report_date) so that two files with the
            #    same code but different dates (e.g. Bunker 09-07 and 16-07 both
            #    in the same WK folder) each get their own row.
            date_grouped: dict[tuple, list] = {}   # (report_code, date_key) -> [{...}]
            for r_code, file_list in matched.items():
                for file_entry in file_list:
                    rd = file_entry.get("report_date")
                    date_key = rd.strftime('%Y%m%d') if rd else now.strftime('%Y%m')
                    group_key = (r_code, date_key)
                    date_grouped.setdefault(group_key, []).append(file_entry)

            for (r_code, date_key), file_list in date_grouped.items():
                cfg = file_list[0]["cfg"]
                best_report_date = next(
                    (f["report_date"] for f in file_list if f.get("report_date")), None
                )
                best_date_source = next(
                    (f.get("report_date_source", "SharePoint upload") for f in file_list if f.get("report_date")),
                    "SharePoint upload"
                )
                job_order_no = f"SP-{date_key}"

                await _upsert_report(db, {
                    "vessel_imo":        vessel_imo,
                    "vessel_name":       cfg.vessel_name,
                    "report_code":       cfg.report_code,
                    "report_name":       cfg.report_name,
                    "department":        cfg.department or "ENGINE",
                    "frequency":         cfg.frequency,
                    "job_order_no":      job_order_no,
                    "job_status":        "COMPLETED",
                    "job_date":          best_report_date or now,
                    "report_date":       best_report_date,
                    "report_date_source": best_date_source,
                    "job_start_date":    best_report_date or now,
                    "job_end_date":      best_report_date or now,
                    "files":             [{"file_name": f["file_name"], "blob_path": f["blob_path"]} for f in file_list],
                })
                logger.info(f"    Saved {len(file_list)} file(s) -> {cfg.report_code} ({cfg.report_name}) [date={best_report_date}]")

            # 8. Skip unmatched files instead of saving them to a generic fallback row
            if unmatched:
                logger.info(f"    Skipped {len(unmatched)} unmatched file(s)")


    logger.info("SharePoint Graph API Fetcher COMPLETE.")


async def _upsert_report(db: AsyncSession, data: dict):
    """
    Insert or update a Report row and replace its attachments.
    Mirrors the same field-set used by SmartPAL _save_report and manual-upload
    so all 3 flows produce identical Report rows.
    """
    try:
        result = await db.execute(
            select(Report).where(
                Report.vessel_imo   == data["vessel_imo"],
                Report.report_code  == data["report_code"],
                Report.job_order_no == data["job_order_no"],
            )
        )
        existing = result.scalars().first()
        now = datetime.utcnow()

        if existing:
            # ── update all fields exactly like SmartPAL _save_report ──
            existing.report_name        = data["report_name"]
            existing.department         = data.get("department") or existing.department
            existing.frequency          = data.get("frequency") or existing.frequency
            existing.job_status         = data["job_status"]
            existing.job_type           = data.get("job_type", "SharePoint")
            existing.approved_by        = data.get("approved_by")
            existing.job_date           = data.get("job_date")
            existing.job_start_date     = data.get("job_start_date")
            existing.job_end_date       = data.get("job_end_date")
            existing.report_date        = data.get("report_date")
            existing.report_date_source = data.get("report_date_source", "SharePoint upload")
            existing.scrape_status      = ScrapeStatus.SCRAPED
            existing.verify_status      = VerifyStatus.UNVERIFIED
            existing.updated_at         = now
            # Replace attachments
            await db.execute(sa_delete(ReportAttachment).where(ReportAttachment.report_id == existing.id))
            for f in data["files"]:
                db.add(ReportAttachment(id=uuid4(), report_id=existing.id,
                                        file_name=f["file_name"], blob_path=f["blob_path"]))
            logger.info(f"Updated DB: {data['vessel_imo']}/{data['report_code']} -> {data['job_order_no']}")
        else:
            # ── insert with all fields exactly like SmartPAL _save_report ──
            new_report = Report(
                id                  = uuid4(),
                vessel_imo          = data["vessel_imo"],
                vessel_name         = data["vessel_name"],
                report_code         = data["report_code"],
                report_name         = data["report_name"],
                department          = data.get("department", "ENGINE"),
                frequency           = data.get("frequency"),
                job_order_no        = data["job_order_no"],
                job_status          = data["job_status"],
                job_type            = data.get("job_type", "SharePoint"),
                approved_by         = data.get("approved_by"),
                job_date            = data.get("job_date"),
                job_start_date      = data.get("job_start_date"),
                job_end_date        = data.get("job_end_date"),
                report_date         = data.get("report_date"),
                report_date_source  = data.get("report_date_source", "SharePoint upload"),
                scrape_status       = ScrapeStatus.SCRAPED,
                verify_status       = VerifyStatus.UNVERIFIED,
                created_at          = now,
                updated_at          = now,
            )
            db.add(new_report)
            for f in data["files"]:
                db.add(ReportAttachment(id=uuid4(), report_id=new_report.id,
                                        file_name=f["file_name"], blob_path=f["blob_path"]))
            logger.info(f"Inserted DB: {data['vessel_imo']}/{data['report_code']} -> {data['job_order_no']}")

        await db.commit()
    except Exception as e:
        await db.rollback()
        logger.error(f"DB upsert failed for {data.get('report_code')}: {e}")


# ---------------------------------------------------------------------------
# PUBLIC: Check SharePoint for a specific report before marking as PENDING
# ---------------------------------------------------------------------------

def _sp_get_token(tenant_id: str, client_id: str, client_secret: str) -> str | None:
    """Fetch an Azure AD OAuth2 token for MS Graph."""
    token_res = requests.post(
        f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        data={
            "client_id":     client_id,
            "client_secret": client_secret,
            "scope":         "https://graph.microsoft.com/.default",
            "grant_type":    "client_credentials",
        }
    )
    if token_res.status_code != 200:
        logger.error(f"[SP-CHECK] Token fetch failed: {token_res.text}")
        return None
    return token_res.json().get("access_token")


def _sp_get_drive_id(headers: dict) -> tuple[str | None, str | None]:
    """Return (site_id, documents_drive_id)."""
    site_res = requests.get(
        "https://graph.microsoft.com/v1.0/sites/ozellarmarine.sharepoint.com:/sites/OZM",
        headers=headers
    )
    if site_res.status_code != 200:
        logger.error(f"[SP-CHECK] Site fetch failed: {site_res.text}")
        return None, None
    site_id = site_res.json().get("id")

    drives_res = requests.get(
        f"https://graph.microsoft.com/v1.0/sites/{site_id}/drives", headers=headers
    )
    if drives_res.status_code != 200:
        logger.error(f"[SP-CHECK] Drives fetch failed: {drives_res.text}")
        return site_id, None

    drive_id = next(
        (d["id"] for d in drives_res.json().get("value", []) if d["name"] == "Documents"),
        None
    )
    return site_id, drive_id


def _sp_week_folder_contains_date(folder_name: str, due_date: datetime) -> bool:
    """
    Check if a WK folder name covers the given due_date.
    Folder names look like: "WK 38 (13 SEP - 19 SEP)" or "WK 28 (06 JUL - 12 JUL)"
    We parse the start/end day+month from the folder name and compare.
    """
    month_map = {
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
        "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    # Pattern: (DD MON - DD MON)
    m = re.search(
        r'\(\s*(\d{1,2})\s+([A-Za-z]{3})\s*[-–]\s*(\d{1,2})\s+([A-Za-z]{3})\s*\)',
        folder_name
    )
    if not m:
        return True  # Can't parse → don't filter out, let file-level date decide

    start_day  = int(m.group(1))
    start_mon  = month_map.get(m.group(2).lower(), 0)
    end_day    = int(m.group(3))
    end_mon    = month_map.get(m.group(4).lower(), 0)

    year = due_date.year
    try:
        start_date = datetime(year, start_mon, start_day)
        end_date   = datetime(year, end_mon,   end_day)
        # Handle year wrap (e.g. Dec→Jan)
        if end_date < start_date:
            end_date = end_date.replace(year=year + 1)
        # Give ±1 day buffer
        return (start_date - timedelta(days=1)) <= due_date <= (end_date + timedelta(days=1))
    except ValueError:
        return True  # Malformed date in folder name → don't filter out


async def check_and_fetch_from_sharepoint(
    db: AsyncSession,
    vessel_name: str,
    report_code: str,
    due_date: datetime,
    frequency: str = None,
) -> bool:
    """
    Before marking a report as PENDING, check whether the file already exists in
    SharePoint for the given vessel + report_code + due_date period.

    - WEEKLY    → checks "01. Weekly Reports" → year → month → WK subfolders that
                  cover due_date → vessel subfolder
    - MONTHLY   → checks "02. Monthly Reports" → year → month → vessel subfolder
    - QUARTERLY → checks "03. Quarterly Reports" → year → month → vessel subfolder

    If the file is found and matches the report_code, it is downloaded, uploaded to
    blob storage, and saved to the DB as COMPLETED.  Returns True on success.
    Returns False if not found or on any error (caller should proceed with PENDING).
    """
    logger.info(
        f"[SP-CHECK] Checking SP for vessel='{vessel_name}' "
        f"report='{report_code}' due_date={due_date.date()}"
    )

    # --- Auth ---
    tenant_id     = settings.AZURE_TENANT_ID
    client_id     = settings.AZURE_CLIENT_ID
    client_secret = settings.AZURE_CLIENT_SECRET
    if not all([tenant_id, client_id, client_secret]):
        logger.warning("[SP-CHECK] Azure credentials missing — skipping SP check.")
        return False

    token = _sp_get_token(tenant_id, client_id, client_secret)
    if not token:
        return False
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    _, drive_id = _sp_get_drive_id(headers)
    if not drive_id:
        return False

    # --- Fetch ReportConfig for this vessel + report_code ---
    res = await db.execute(
        select(ReportConfig).where(
            ReportConfig.vessel_name.ilike(f"%{vessel_name}%"),
            ReportConfig.report_code.ilike(f"%{report_code}%"),
        )
    )
    cfg = res.scalars().first()
    if not cfg:
        # Try partial match — maybe report_code is a sub-string (e.g. "TECH-07" in "MO-02-TECH-07_...")
        res2 = await db.execute(
            select(ReportConfig).where(
                ReportConfig.vessel_name.ilike(f"%{vessel_name}%"),
            )
        )
        all_cfgs = res2.scalars().all()
        cfg = next(
            (c for c in all_cfgs if report_code.lower() in c.report_code.lower()
             or report_code.lower() in c.report_name.lower()),
            None
        )
    if not cfg:
        logger.warning(f"[SP-CHECK] No ReportConfig found for vessel='{vessel_name}' code='{report_code}'")
        return False

    vessel_imo  = cfg.vessel_imo
    freq        = (frequency or cfg.frequency or "MONTHLY").upper()

    # --- Determine which SP folder to check based on frequency ---
    freq_folder_map = {
        "WEEKLY":    "01. Weekly Reports",
        "MONTHLY":   "02. Monthly Reports",
        "QUARTERLY": "03. Quarterly Reports",
    }
    sp_folder = freq_folder_map.get(freq, "02. Monthly Reports")

    # --- Build the month folder name from due_date ---
    # Format: "MM. MON YYYY" e.g. "09. SEP 2026"
    month_folder_prefix = due_date.strftime("%m. %b").upper()  # "09. SEP"
    year_str            = due_date.strftime("%Y")               # "2026"

    # --- Navigate year folder ---
    year_path = f"008. Reports/4. Technical Report/{sp_folder}/{year_str}"
    year_url  = (
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}"
        f"/root:/{quote(year_path)}:/children"
    )
    res = requests.get(year_url, headers=headers)
    if res.status_code != 200:
        logger.info(f"[SP-CHECK] Year folder not found: {year_path}")
        return False

    # --- Find the month folder ---
    month_folder_id = None
    for item in res.json().get("value", []):
        if "folder" not in item:
            continue
        name = item["name"]
        # Match "09. SEP" prefix (folder may or may not include the year)
        if name.upper().startswith(month_folder_prefix):
            month_folder_id = item["id"]
            logger.info(f"[SP-CHECK] Found month folder: {name}")
            break

    if not month_folder_id:
        logger.info(f"[SP-CHECK] Month folder '{month_folder_prefix}' not found for {sp_folder}/{year_str}")
        return False

    # --- Get children of month folder ---
    month_res = requests.get(
        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{month_folder_id}/children",
        headers=headers
    )
    if month_res.status_code != 200:
        logger.warning("[SP-CHECK] Failed to list month folder contents.")
        return False

    month_children = month_res.json().get("value", [])

    # --- Build list of (folder_id, folder_name) to search for vessel files ---
    # For WEEKLY: dive into WK subfolders that contain due_date
    # For MONTHLY/QUARTERLY: search the month folder directly for vessel subfolders
    vessel_search_folders: list[tuple[str, str]] = []

    if freq == "WEEKLY":
        # First layer may be WK subfolders OR vessel folders directly
        wk_folders = [
            item for item in month_children
            if "folder" in item
            and (re.search(r'\bwk\b', item["name"], re.IGNORECASE)
                 or re.search(r'\bweek\b', item["name"], re.IGNORECASE))
        ]
        if wk_folders:
            # Filter to only WK folders whose date range covers due_date
            for wk in wk_folders:
                if _sp_week_folder_contains_date(wk["name"], due_date):
                    logger.info(f"[SP-CHECK] Diving into WK folder: {wk['name']}")
                    wk_children_res = requests.get(
                        f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{wk['id']}/children",
                        headers=headers
                    )
                    if wk_children_res.status_code == 200:
                        for child in wk_children_res.json().get("value", []):
                            if "folder" in child:
                                vessel_search_folders.append((child["id"], child["name"]))
        else:
            # No WK subfolders — vessel folders are directly in the month folder
            for item in month_children:
                if "folder" in item:
                    vessel_search_folders.append((item["id"], item["name"]))
    else:
        # MONTHLY / QUARTERLY: vessel folders are direct children of month folder
        for item in month_children:
            if "folder" in item:
                vessel_search_folders.append((item["id"], item["name"]))

    # --- Search each vessel folder for the matching file ---
    for (folder_id, folder_name) in vessel_search_folders:
        # Only process folders that match our vessel name
        if vessel_name.lower() not in folder_name.lower():
            continue

        logger.info(f"[SP-CHECK] Scanning vessel folder: {folder_name}")
        files_res = requests.get(
            f"https://graph.microsoft.com/v1.0/drives/{drive_id}/items/{folder_id}/children",
            headers=headers
        )
        if files_res.status_code != 200:
            continue

        now      = datetime.utcnow()
        date_str = now.strftime("%Y-%m-%d")

        for file_item in files_res.json().get("value", []):
            if "file" not in file_item:
                continue

            file_name    = file_item["name"]
            download_url = file_item.get("@microsoft.graph.downloadUrl")
            if not download_url:
                continue

            # Match file to the specific report config
            matched_cfg = _match_file_to_config(file_name, [cfg])
            if not matched_cfg:
                logger.debug(f"[SP-CHECK]   No match: {file_name}")
                continue

            logger.info(f"[SP-CHECK]   Matched file: {file_name} → {matched_cfg.report_code}")

            # Download the file
            dl_res = requests.get(download_url)
            if dl_res.status_code != 200:
                logger.error(f"[SP-CHECK]   Download failed for {file_name}")
                continue

            pdf_bytes = dl_res.content

            # Extract report date from content
            report_date = None
            try:
                result = extract_report_period(pdf_bytes, file_name)
                if result:
                    period_tuple, source = result
                    report_date = datetime(*period_tuple)
                    logger.info(f"[SP-CHECK]   Report date from content: {report_date.date()} (via {source})")
            except Exception as e:
                logger.warning(f"[SP-CHECK]   Could not extract date from content: {e}")

            # Fallback: SharePoint upload date
            if report_date is None:
                sp_date_str = file_item.get("lastModifiedDateTime") or file_item.get("createdDateTime")
                if sp_date_str:
                    try:
                        report_date = datetime.fromisoformat(
                            sp_date_str.replace("Z", "+00:00")
                        ).replace(tzinfo=None)
                        logger.info(f"[SP-CHECK]   Report date fallback from SP upload: {report_date.date()}")
                    except Exception:
                        pass

            # Fallback: use due_date month
            if report_date is None:
                report_date = due_date.replace(day=1)
                logger.info(f"[SP-CHECK]   Report date fallback to due_date month: {report_date.date()}")

            # Upload to blob
            safe_fname = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', file_name).strip() or "report.pdf"
            blob_name  = (
                f"reports/{vessel_imo}/{matched_cfg.report_code}"
                f"/{date_str}_{file_item['id']}_{safe_fname}"
            )
            try:
                upload_pdf_to_blob(pdf_bytes, blob_name)
                logger.info(f"[SP-CHECK]   Uploaded to blob: {blob_name}")
            except Exception as e:
                logger.error(f"[SP-CHECK]   Blob upload failed: {e}")
                continue

            # Use a stable job_order_no based on the report date so it
            # creates its own row (same key as the main SP fetcher uses)
            job_order_no = f"SP-{report_date.strftime('%Y%m%d')}"

            # Save to DB as COMPLETED
            await _upsert_report(db, {
                "vessel_imo":     vessel_imo,
                "vessel_name":    matched_cfg.vessel_name,
                "report_code":    matched_cfg.report_code,
                "report_name":    matched_cfg.report_name,
                "department":     matched_cfg.department or "ENGINE",
                "frequency":      matched_cfg.frequency,
                "job_order_no":   job_order_no,
                "job_status":     "COMPLETED",
                "job_date":       report_date,
                "report_date":    report_date,
                "job_start_date": report_date,
                "job_end_date":   report_date,
                "files":          [{"file_name": file_name, "blob_path": blob_name}],
            })

            logger.info(
                f"[SP-CHECK] ✅ Saved from SharePoint: {matched_cfg.report_code} "
                f"({matched_cfg.report_name}) report_date={report_date.date()}"
            )
            return True

    logger.info(
        f"[SP-CHECK] ❌ Not found in SharePoint: vessel='{vessel_name}' "
        f"report='{report_code}' due_date={due_date.date()} freq={freq}"
    )
    return False

