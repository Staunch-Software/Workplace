import os
import httpx       # <-- Replaced requests
import asyncio     # <-- Replaced schedule and time
import logging
import io
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv

# Load .env from lub_backend root (one level up from app/)
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

# --- Azure AD (Microsoft Graph) --- from .env
AZURE_TENANT_ID     = os.getenv("AZURE_TENANT_ID")
AZURE_CLIENT_ID     = os.getenv("AZURE_CLIENT_ID")
AZURE_CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")

# --- Mailbox that receives Shell LubeAnalyst reports --- from .env
MAILBOX_EMAIL       = os.getenv("MAILBOX_EMAIL", "techdevops@ozellar.com")


# --- FastAPI Backend URLs --- 
FASTAPI_UPLOAD_BASE = "http://localhost:8002"  # Lub_backend for uploading
FASTAPI_AUTH_BASE   = "http://localhost:8003"  # Workplace_backend for login

# Update the ports for their respective tasks:
FASTAPI_LOGIN_URL   = f"{FASTAPI_AUTH_BASE}/api/v1/login/access-token"
FASTAPI_UPLOAD_URL  = f"{FASTAPI_UPLOAD_BASE}/api/upload-luboil-report/"

# --- Backend Admin Credentials --- from .env
BACKEND_ADMIN_EMAIL    = os.getenv("BACKEND_ADMIN_EMAIL")
BACKEND_ADMIN_PASSWORD = os.getenv("BACKEND_ADMIN_PASSWORD")

# --- Validate all values loaded correctly ---
for _key, _val in {
    "AZURE_TENANT_ID":        AZURE_TENANT_ID,
    "AZURE_CLIENT_ID":        AZURE_CLIENT_ID,
    "AZURE_CLIENT_SECRET":    AZURE_CLIENT_SECRET,
    "BACKEND_ADMIN_EMAIL":    BACKEND_ADMIN_EMAIL,
    "BACKEND_ADMIN_PASSWORD": BACKEND_ADMIN_PASSWORD,
}.items():
    if not _val:
        raise RuntimeError(f"❌ Missing env variable: {_key} — check lub_backend/.env")

# --- Schedule Time (24-hour format) ---
RUN_TIME = "08:00"

# ============================================================
#  FILTER RULES
#  Emails must match ALL of these to be processed:
#    1. Unread
#    2. Has a PDF attachment
#    3. Sender contains "ShellLubeAnalyst" OR "LubeAnalyst"
#    4. Subject contains at least ONE keyword below
# ============================================================
SENDER_KEYWORDS  = [
    "shelllubeanalyst",
    "shell lubeanalyst",
    "goguldev28", 
    "lubeanalyst",
    "shell lube",
    "noreply",
    "no-reply",
    "no reply"
]
SUBJECT_KEYWORDS = [
    "lubeanalyst",
    "lube analyst",
    "sample reports",
    "luboil",
    "lube oil",
    "oil analysis",
    "shell",        # catches "Shell LubeAnalyst" in subject
    "action",       # catches "0 Action, 0 Attention" in subject
    "attention",    # catches "0 Attention" in subject
    "normal"        # catches "10 Normal" in subject
]

# ============================================================
#  LOGGING SETUP
#  Logs appear in console AND in luboil_upload.log
# ============================================================
log_formatter = logging.Formatter(
    fmt="[%(asctime)s] %(levelname)-8s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)

logger = logging.getLogger("LuboilAutoUpload")
logger.setLevel(logging.DEBUG)

# Console handler
console_handler = logging.StreamHandler(sys.stdout)
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(log_formatter)
logger.addHandler(console_handler)

# File handler (creates/appends luboil_upload.log in same folder)
file_handler = logging.FileHandler("luboil_upload.log", encoding="utf-8")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(log_formatter)
logger.addHandler(file_handler)


# ============================================================
#  STEP 1 — GET MICROSOFT GRAPH ACCESS TOKEN
# ============================================================
async def get_graph_token() -> str:
    """
    Authenticates with Azure AD using Client Credentials flow.
    Returns a Bearer token for Microsoft Graph API calls.
    """
    url = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token"

    payload = {
        "grant_type":    "client_credentials",
        "client_id":     AZURE_CLIENT_ID,
        "client_secret": AZURE_CLIENT_SECRET,
        "scope":         "https://graph.microsoft.com/.default"
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, data=payload, timeout=30.0)
            response.raise_for_status()
            token = response.json().get("access_token")
            if not token:
                raise ValueError("No access_token in response")
            logger.debug("✅ Microsoft Graph token obtained successfully.")
            return token

    except httpx.RequestError as e:
        logger.error(f"❌ Failed to get Graph token: {e}")
        raise
    except ValueError as e:
        logger.error(f"❌ Token parsing error: {e}")
        raise


# ============================================================
#  STEP 2 — FETCH EMAILS FROM INBOX (LAST 24 HOURS ONLY)
# ============================================================
async def fetch_recent_luboil_emails(graph_token: str) -> list:
    """
    Queries the Outlook inbox for emails from the last 24 hours that:
      - Come from ShellLubeAnalyst sender
      - Have a PDF attachment
      - Subject matches LubeAnalyst keywords

    Returns a list of matching email message dicts.
    """
    headers = {
        "Authorization": f"Bearer {graph_token}",
        "Content-Type":  "application/json",
        "ConsistencyLevel": "eventual"  # Required for advanced filtering
    }

    # Calculate exact time 24 hours ago in UTC format required by Graph API
    time_24h_ago = datetime.now(timezone.utc) - timedelta(hours=24)
    time_filter_str = time_24h_ago.strftime("%Y-%m-%dT%H:%M:%SZ")

    # Graph API: Get up to 999 messages with attachments from the last 24 hours (Read or Unread)
    url = (
        f"https://graph.microsoft.com/v1.0/users/{MAILBOX_EMAIL}/mailFolders/inbox/messages"
        f"?$filter=hasAttachments eq true and receivedDateTime ge {time_filter_str}"
        f"&$select=id,subject,from,receivedDateTime,hasAttachments"
        f"&$top=999"
    )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=30.0)
            response.raise_for_status()
            all_messages = response.json().get("value", [])
            logger.info(f"📬 Found {len(all_messages)} email(s) with attachments from the last 24 hours.")

    except httpx.RequestError as e:
        logger.error(f"❌ Failed to fetch emails: {e}")
        return []

    # ---- APPLY SENDER + SUBJECT FILTER ----
    matched_emails = []
    for msg in all_messages:
        sender_name    = msg.get("from", {}).get("emailAddress", {}).get("name", "").lower()
        sender_address = msg.get("from", {}).get("emailAddress", {}).get("address", "").lower()
        subject = (msg.get("subject") or "").lower()
        
        # Kept your exact logging
        # logger.info(f"📧 EMAIL → Sender: '{sender_name}' | '{sender_address}' | Subject: '{subject[:60]}'")
        
        # Check sender matches any keyword
        sender_match = any(kw in sender_name or kw in sender_address for kw in SENDER_KEYWORDS)

        # Check subject matches any keyword
        subject_match = any(kw in subject for kw in SUBJECT_KEYWORDS)

        if sender_match or subject_match:
            logger.info(
                f"✅ MATCHED email | Subject: '{msg.get('subject')}' | "
                f"From: '{msg.get('from', {}).get('emailAddress', {}).get('name')}' | "
                f"Received: {msg.get('receivedDateTime')}"
            )
            matched_emails.append(msg)
        else:
            logger.debug(
                f"⏭ SKIPPED email | Subject: '{msg.get('subject')}' | "
                f"Sender: '{sender_name}'"
            )

    logger.info(f"🎯 {len(matched_emails)} LubeAnalyst email(s) matched the filter.")
    return matched_emails


# ============================================================
#  STEP 3 — GET PDF ATTACHMENTS FROM AN EMAIL (IN MEMORY)
# ============================================================
async def get_pdf_attachments(graph_token: str, message_id: str) -> list:
    """
    Fetches all PDF attachments from a specific email message.
    Returns list of dicts: [{'filename': str, 'content': bytes}, ...]
    Files are kept IN MEMORY — nothing is saved to disk.
    """
    headers = {
        "Authorization": f"Bearer {graph_token}",
        "Content-Type":  "application/json"
    }

    url = (
        f"https://graph.microsoft.com/v1.0/users/{MAILBOX_EMAIL}"
        f"/messages/{message_id}/attachments"
    )

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=60.0)
            response.raise_for_status()
            attachments = response.json().get("value", [])

    except httpx.RequestError as e:
        logger.error(f"❌ Failed to fetch attachments for message {message_id}: {e}")
        return []

    pdf_attachments = []
    for attachment in attachments:
        att_name        = attachment.get("name", "")
        att_type        = attachment.get("@odata.type", "")
        content_type    = attachment.get("contentType", "")
        content_bytes   = attachment.get("contentBytes")  # Base64 encoded

        # Only process PDF files
        is_pdf = (
            att_name.lower().endswith(".pdf") or
            "pdf" in content_type.lower()
        )

        if not is_pdf:
            logger.debug(f"⏭ Skipping non-PDF attachment: {att_name} ({content_type})")
            continue

        if not content_bytes:
            logger.warning(f"⚠️  PDF attachment '{att_name}' has no content bytes. Skipping.")
            continue

        # Decode base64 → raw bytes (in memory, no disk write)
        import base64
        try:
            pdf_bytes = base64.b64decode(content_bytes)
            pdf_attachments.append({
                "filename": att_name,
                "content":  pdf_bytes,  # Raw bytes in RAM
                "size_kb":  round(len(pdf_bytes) / 1024, 1)
            })
            logger.info(f"📎 PDF ready in memory: '{att_name}' ({round(len(pdf_bytes)/1024, 1)} KB)")

        except Exception as e:
            logger.error(f"❌ Failed to decode attachment '{att_name}': {e}")
            continue

    return pdf_attachments


# ============================================================
#  STEP 4 — GET FASTAPI BEARER TOKEN
# ============================================================
async def get_fastapi_token() -> str:
    """
    Logs in to your FastAPI backend using admin credentials.
    Returns a Bearer token for authenticated API calls.
    """
    # MUST be 'username' key (matches LoginRequest BaseModel)
    payload = {
        "username": BACKEND_ADMIN_EMAIL, 
        "password": BACKEND_ADMIN_PASSWORD
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                FASTAPI_LOGIN_URL,
                json=payload,  # MUST be json=payload
                timeout=30.0
            )
            response.raise_for_status()

            token = (
                response.json().get("access_token") or
                response.json().get("token")
            )

            if not token:
                raise ValueError(f"No token in login response: {response.json()}")

            logger.debug("✅ FastAPI Bearer token obtained successfully.")
            return token

    except httpx.ConnectError:
        logger.error(f"❌ Cannot connect to FastAPI at {FASTAPI_LOGIN_URL}. Is the server running?")
        raise
    except httpx.HTTPStatusError as e:
        logger.error(f"❌ FastAPI login failed. Status: {e.response.status_code}, Detail: {e.response.text}")
        raise
    except httpx.RequestError as e:
        logger.error(f"❌ FastAPI request error: {e}")
        raise
    except ValueError as e:
        logger.error(f"❌ Token parsing error: {e}")
        raise


# ============================================================
#  STEP 5 — UPLOAD PDF TO FASTAPI ENDPOINT
# ============================================================
async def upload_pdf_to_fastapi(bearer_token: str, pdf_bytes: bytes, filename: str) -> dict:
    """
    POSTs the PDF (from memory) to /api/upload-luboil-report/.
    Returns the API response as a dict.

    The PDF is sent as multipart/form-data with field name 'file',
    exactly as your frontend does via the Upload button.
    """
    headers = {
        "Authorization": f"Bearer {bearer_token}"
        # Note: Do NOT set Content-Type manually — httpx sets it
        # automatically with the correct boundary for multipart
    }

    # Wrap bytes in a tuple for httpx multipart/form-data format
    files = {
        "file": (filename, pdf_bytes, "application/pdf")
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                FASTAPI_UPLOAD_URL,
                headers=headers,
                files=files,
                timeout=120.0  # 2 minutes — PDFs can be large
            )
            response.raise_for_status()
            result = response.json()
            return result

    except httpx.ConnectError:
        logger.error(f"❌ Cannot connect to FastAPI upload endpoint at {FASTAPI_UPLOAD_URL}")
        raise
    except httpx.TimeoutException:
        logger.error(f"❌ Upload timed out for '{filename}' after 120 seconds")
        raise
    except httpx.HTTPStatusError as e:
        logger.error(
            f"❌ Upload HTTP error for '{filename}': "
            f"{e.response.status_code} — {e.response.text[:300]}"
        )
        raise
    except httpx.RequestError as e:
        logger.error(f"❌ Upload failed for '{filename}': {e}")
        raise


# ============================================================
#  STEP 6 — MARK EMAIL AS READ
# ============================================================
# async def mark_email_as_read(graph_token: str, message_id: str) -> bool:
#     
#     headers = {
#         "Authorization": f"Bearer {graph_token}",
#         "Content-Type":  "application/json"
#     }
# 
#     url = (
#         f"https://graph.microsoft.com/v1.0/users/{MAILBOX_EMAIL}"
#         f"/messages/{message_id}"
#     )
# 
#     payload = {"isRead": True}
# 
#     try:
#         async with httpx.AsyncClient() as client:
#             response = await client.patch(url, headers=headers, json=payload, timeout=30.0)
#             response.raise_for_status()
#             logger.info(f"✅ Email marked as READ. (ID: ...{message_id[-12:]})")
#             return True
# 
#     except httpx.RequestError as e:
#         logger.error(f"❌ Failed to mark email as read: {e}")
#         return False


# ============================================================
#  MAIN JOB — Processes emails from the last 24 hours
# ============================================================
async def run_luboil_email_upload_job():
    run_start = datetime.now()
    logger.info("=" * 60)
    logger.info(f"🚀 LUBOIL AUTO-UPLOAD JOB STARTED — {run_start.strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info("=" * 60)

    # Counters for summary report
    emails_found        = 0
    pdfs_found          = 0
    uploads_success     = 0
    uploads_duplicate   = 0
    uploads_failed      = 0

    try:
        # ── STEP 1: Get Microsoft Graph token ──────────────────
        logger.info("🔐 STEP 1: Authenticating with Microsoft Graph API...")
        graph_token = await get_graph_token()

        # ── STEP 2: Find matching emails (Last 24 Hours) ────────
        logger.info("📬 STEP 2: Scanning inbox for LubeAnalyst emails (Last 24 hours)...")
        matched_emails = await fetch_recent_luboil_emails(graph_token)
        emails_found = len(matched_emails)

        if not matched_emails:
            logger.info("💤 No recent LubeAnalyst emails found. Job complete.")
            logger.info("=" * 60)
            return

        # ── STEP 3: Get FastAPI Bearer token ────────────────────
        logger.info("🔑 STEP 3: Logging in to FastAPI backend...")
        bearer_token = await get_fastapi_token()

        # ── STEP 4: Process each email ──────────────────────────
        for idx, email_msg in enumerate(matched_emails, start=1):
            email_subject    = email_msg.get("subject", "No Subject")
            email_id         = email_msg.get("id")
            email_received   = email_msg.get("receivedDateTime", "Unknown")

            logger.info(f"\n── Processing Email {idx}/{emails_found} ──────────────────")
            logger.info(f"   Subject  : {email_subject}")
            logger.info(f"   Received : {email_received}")

            # Get PDF attachments (in memory)
            pdf_list = await get_pdf_attachments(graph_token, email_id)

            if not pdf_list:
                logger.warning(f"⚠️  Email has no PDF attachments. Skipping. Subject: '{email_subject}'")
                continue

            pdfs_found += len(pdf_list)

            # Upload each PDF
            for pdf in pdf_list:
                filename  = pdf["filename"]
                pdf_bytes = pdf["content"]
                size_kb   = pdf["size_kb"]

                logger.info(f"📤 Uploading: '{filename}' ({size_kb} KB) → {FASTAPI_UPLOAD_URL}")

                try:
                    result = await upload_pdf_to_fastapi(bearer_token, pdf_bytes, filename)

                    is_duplicate  = result.get("is_duplicate", False)
                    vessel        = result.get("vessel", "Unknown")
                    report_date   = result.get("report_date", "Unknown")
                    alert_summary = result.get("alert_summary", "N/A")
                    sample_count  = result.get("sample_count", 0)

                    if is_duplicate:
                        uploads_duplicate += 1
                        logger.info(
                            f"♻️  DUPLICATE (already exists) | "
                            f"Vessel: {vessel} | Date: {report_date} | "
                            f"Samples: {sample_count} | Summary: {alert_summary}"
                        )
                    else:
                        uploads_success += 1
                        logger.info(
                            f"✅ UPLOAD SUCCESS | "
                            f"Vessel: {vessel} | Date: {report_date} | "
                            f"Samples: {sample_count} | Summary: {alert_summary}"
                        )

                except Exception as upload_err:
                    uploads_failed += 1
                    logger.error(f"❌ UPLOAD FAILED for '{filename}': {upload_err}")

    except Exception as fatal_err:
        logger.error(f"💥 FATAL ERROR in job: {fatal_err}", exc_info=True)

    # ── SUMMARY REPORT ──────────────────────────────────────────
    run_end      = datetime.now()
    elapsed_secs = round((run_end - run_start).total_seconds(), 1)

    logger.info("\n" + "=" * 60)
    logger.info("📊 JOB SUMMARY (Last 24 Hours)")
    logger.info("=" * 60)
    logger.info(f"   Emails found & matched  : {emails_found}")
    logger.info(f"   PDF attachments found   : {pdfs_found}")
    logger.info(f"   ✅ Uploads successful   : {uploads_success}")
    logger.info(f"   ♻️  Duplicates skipped   : {uploads_duplicate}")
    logger.info(f"   ❌ Uploads failed       : {uploads_failed}")
    logger.info(f"   ⏱  Time taken           : {elapsed_secs}s")
    logger.info("=" * 60)


# ============================================================
#  SCHEDULER — Runs job twice a day at 08:00 and 17:00
# ============================================================
async def start_async_email_scheduler():
    logger.info("=" * 60)
    logger.info("  ASYNC LUBOIL AUTO-UPLOAD SCHEDULER STARTED")
    logger.info("  Scheduled run times: 08:00 AM and 05:00 PM (17:00) daily")
    logger.info(f"  Watching mailbox   : {MAILBOX_EMAIL}")
    logger.info(f"  FastAPI backend    : {FASTAPI_UPLOAD_BASE}")
    logger.info("=" * 60)

    # Optional: Also run immediately on startup
    logger.info("▶️  Running immediate check on startup...")
    await run_luboil_email_upload_job()

    last_run_time = None

    # Keep the scheduler alive asynchronously
    logger.info(f"\n⏰ Scheduler active. Waiting for next scheduled time.\n")
    while True:
        try:
            # Check the current time
            now_str = datetime.now().strftime("%H:%M")
            
            if now_str in ["08:00", "16:00"] and last_run_time != now_str:
                await run_luboil_email_upload_job()
                last_run_time = now_str  # Mark as run so it doesn't run repeatedly this minute
            
            # Reset the flag when the minute passes
            if now_str not in ["08:00", "16:00"]:
                last_run_time = None

        except Exception as e:
            logger.error(f"Scheduler loop error prevented crash: {e}")

        # Sleep asynchronously for 60 seconds (does NOT block FastAPI)
        await asyncio.sleep(60)


# ============================================================
#  ENTRY POINT
# ============================================================
if __name__ == "__main__":
    # If you want a ONE-TIME run (for testing), call:
    #   python luboil_email_auto_upload.py --once
    #
    # For normal scheduled operation:
    #   python luboil_email_auto_upload.py

    if "--once" in sys.argv:
        logger.info("🔄 Running single one-time check (--once mode)...")
        asyncio.run(run_luboil_email_upload_job())
    else:
        asyncio.run(start_async_email_scheduler())