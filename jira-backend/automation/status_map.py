# automation/status_map.py
MODULE_MAP = {
    "Accounts":"Accounts","Admin":"Admin","Certification":"Certification",
    "Chartering":"Chartering","Crewing":"Crewing","Dashboard":"Dashboard",
    "Data Library":"Data Library","Financial Reporting":"Financial Reporting",
    "LPSQ/HSEQ":"LPSQ/HSEQ","LiveFleet":"LiveFleet","MDM":"MDM",
    "New Applicant":"New Applicant","PMS / Maintenance":"PMS / Maintenance",
    "Payroll":"Payroll","Purchase":"Purchase","QDMS":"QDMS",
    "Replication":"Replication","Sea Roster":"Sea Roster",
    "Ticketing":"Ticketing","Training":"Training","Voyage":"Voyage",
    "SmartOps":"Admin","Maintenance":"PMS / Maintenance","Crew":"Crewing",
    "Safety":"LPSQ/HSEQ","Navigation":"LiveFleet","Inventory":"Purchase",
    "HSQE":"LPSQ/HSEQ","Dry Dock":"PMS / Maintenance","Other":"Admin",
}
ENVIRONMENT_MAP = {
    "Office":"Office","Vessel":"Vessel","Both":"Both",
    "Production":"Vessel","Staging":"Office","UAT":"Office","Development":"Office",
}
PRIORITY_TO_REQUEST_TYPE = {"Critical":"1889","Major":"1889","Minor":"1890"}
CLOSED_STATUSES = {"Cancelled","Closed","Resolved"}
KNOWN_VESSELS_FALLBACK = [
    "GCL GANGA","GCL YAMUNA","GCL SARASWATI","GCL SABARMATI",
    "GCL NARMADA","GCL TAPI","GCL FOS",
    "AM KIRTI","AM TARANG","AM UMANG",
    "AMNS POLAR","AMNS TUFMAX","AMNS MAXIMUS","AMNS STALLION",
]


def map_module(m): return MODULE_MAP.get(m, m)
def map_environment(e): return ENVIRONMENT_MAP.get(e, "Vessel")
def get_request_type_id(p): return PRIORITY_TO_REQUEST_TYPE.get(p, "1890")
def build_jira_summary(vessel, summary):
    return summary if summary.upper().startswith(vessel.upper()) else f"{vessel} - {summary}"


async def detect_vessel_from_text(text: str) -> str | None:
    if not text: return None
    vessel_names = []
    try:
        from db.database import SessionLocal
        from models.schema import Vessel
        from sqlalchemy import select
        async with SessionLocal() as session:
            rows = (await session.execute(select(Vessel.name).where(Vessel.isActive == True))).fetchall()
            vessel_names = [r[0] for r in rows if r[0]]
    except Exception as e:
        print(f"[VesselDetect] DB failed, using fallback: {e}")
        vessel_names = KNOWN_VESSELS_FALLBACK
    if not vessel_names:
        vessel_names = KNOWN_VESSELS_FALLBACK
    upper = text.upper()
    for v in sorted(vessel_names, key=len, reverse=True):
        if v.upper() in upper: return v
    return None


def extract_reference_num(reference: str | None) -> int | None:
    if not reference: return None
    import re
    m = re.search(r"-(\d+)$", reference)
    return int(m.group(1)) if m else None
