import os
import msal
import httpx
import re
from jinja2 import Environment, FileSystemLoader
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload
from app.core.database import SessionLocal
from app.models.user import User
from app.models.vessel import Vessel
from app.models.enums import UserRole

load_dotenv()

# --- 1. AZURE CONFIGURATION ---
TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
MAIL_FROM = os.getenv("MAIL_FROM")
GRAPH_ENDPOINT = f"https://graph.microsoft.com/v1.0/users/{MAIL_FROM}/sendMail"

# --- 2. TEMPLATE SETUP ---
BASE_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_FOLDER = Path(BASE_DIR, "templates")
env = Environment(loader=FileSystemLoader(str(TEMPLATE_FOLDER)))

# --- 3. HELPER: Get Token ---
def get_access_token():
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        client_credential=CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    if "access_token" in result:
        return result["access_token"]
    else:
        print(f"❌ OAuth Token Error: {result.get('error_description')}")
        raise Exception("Could not acquire Azure Token")

# --- 4. HELPER: Valid Email Check ---
def is_valid_email(email: str) -> bool:
    if not email: return False
    regex = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(regex, email): return False
    if email.split('@')[-1] in ["example.com", "test.com", "localhost"]: return False
    return True

# --- 5. HELPER: Get Recipients from DB ---
async def get_recipients_for_vessel(vessel_imo: str) -> list[str]:
    recipients = set()
    async with SessionLocal() as db:
        # A. Linked Vessel Users
        stmt_vessel = select(Vessel).where(Vessel.imo == vessel_imo).options(selectinload(Vessel.users))
        result_vessel = await db.execute(stmt_vessel)
        vessel = result_vessel.scalars().first()
        
        if vessel:
            if is_valid_email(vessel.vessel_email): recipients.add(vessel.vessel_email)
            for user in vessel.users:
                if is_valid_email(user.email) and user.is_active:
                    recipients.add(user.email)

        # B. Admin/Shore Users
        target_roles = []
        # Handle Enum vs String safely
        if hasattr(UserRole.ADMIN, 'value'):
            target_roles = [UserRole.ADMIN.value, UserRole.SHORE.value]
        else:
            target_roles = ["ADMIN", "SHORE"]

        stmt_admins = select(User).where(User.role.in_(target_roles), User.is_active == True)
        result_admins = await db.execute(stmt_admins)
        admins = result_admins.scalars().all()
        
        for admin in admins:
            if is_valid_email(admin.email): recipients.add(admin.email)
            
    return list(recipients)

# --- 6. CORE: Send via Graph API ---
async def send_graph_email(subject: str, recipients: list[str], html_content: str):
    token = get_access_token()
    
    to_recipients = [{"emailAddress": {"address": email}} for email in recipients]
    
    payload = {
        "message": {
            "subject": subject,
            "body": {
                "contentType": "HTML",
                "content": html_content
            },
            "toRecipients": to_recipients
        },
        "saveToSentItems": "true"
    }
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    async with httpx.AsyncClient() as client:
        response = await client.post(GRAPH_ENDPOINT, json=payload, headers=headers)
        
        if response.status_code == 202:
            print(f"✅ OAuth Email Sent to {len(recipients)} recipients.")
        else:
            print(f"❌ Graph API Error: {response.status_code} - {response.text}")

# --- 7. EXPORTED FUNCTION ---
async def send_defect_email(defect_data: dict, event_type: str):
    print(f"🚀 Processing Email for: {defect_data.get('title')}")
    
    # 1. Find who to send to
    recipients = await get_recipients_for_vessel(defect_data['vessel_imo'])
    
    if not recipients:
        print("⚠️ No recipients found. Skipping email.")
        return

    # 2. Prepare HTML
    defect_data["event_type"] = event_type
    try:
        template = env.get_template("defect_notification.html")
        html_content = template.render(**defect_data)
    except Exception as e:
        print(f"❌ HTML Template Error: {e}")
        return

    # 3. Prepare Subject (Updated with REMOVED)
    subject_map = {
        "CREATED": f"🚨 New Defect: {defect_data['title']}",
        "UPDATED": f"📝 Defect Updated: {defect_data['title']}",
        "CLOSED": f"✅ Defect Closed: {defect_data['title']}",
        "REMOVED": f"🗑️ Defect Removed: {defect_data['title']}"  # <--- ADDED THIS
    }
    subject = f"[{defect_data['vessel_imo']}] {subject_map.get(event_type, 'Notification')}"

    # 4. Fire and Forget
    await send_graph_email(subject, recipients, html_content)