# app/services/mail_service.py
import base64
import logging
import asyncio
import httpx
import zipfile
import io
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.blob_storage import download_blob_bytes
from app.models.report import ReportAttachment, EmailStatus, Report

logger = logging.getLogger(__name__)

async def process_and_email_pending_attachments(db: AsyncSession):
    """
    Queries all PENDING attachments, zips them up by report name,
    emails them, and updates the database to SENT or FAILED.
    """
    tenant_id = getattr(settings, "AZURE_TENANT_ID", "")
    client_id = getattr(settings, "AZURE_CLIENT_ID", "")
    client_secret = getattr(settings, "AZURE_CLIENT_SECRET", "")
    mail_from = getattr(settings, "MAIL_FROM", "")
    notification_email = getattr(settings, "NOTIFICATION_EMAIL", "")

    if not all([tenant_id, client_id, client_secret, mail_from, notification_email]):
        logger.warning("Missing Graph API email configuration. Skipping pending attachments check.")
        return

    # Find pending attachments
    stmt = select(ReportAttachment).join(Report).where(ReportAttachment.email_status == EmailStatus.PENDING).options(selectinload(ReportAttachment.report))
    result = await db.execute(stmt)
    pending_attachments = result.scalars().all()

    if not pending_attachments:
        logger.info("No PENDING attachments found to email.")
        return

    try:
        # 1. Authenticate with Graph API
        token_url = f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token"
        token_data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials"
        }
        
        async with httpx.AsyncClient() as client:
            token_res = await client.post(token_url, data=token_data)
            if token_res.status_code != 200:
                logger.error(f"Failed to get Graph API token for email: {token_res.text}")
                return
            token_json = token_res.json()
            token = token_json.get("access_token")

        # 2. Download and Zip
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for att in pending_attachments:
                try:
                    file_bytes = await asyncio.get_running_loop().run_in_executor(
                        None, download_blob_bytes, att.blob_path
                    )
                    # Structure: Vessel_Name / Report_Name / file_name
                    vessel_folder = att.report.vessel_name.replace("/", "_").replace("\\", "_") if att.report and att.report.vessel_name else "Unknown_Vessel"
                    report_folder = att.report.report_name.replace("/", "_").replace("\\", "_") if att.report and att.report.report_name else "Unknown_Report"
                    file_name = att.file_name.replace("/", "_").replace("\\", "_")
                    zip_path = f"{vessel_folder}/{report_folder}/{file_name}"
                    
                    zip_file.writestr(zip_path, file_bytes)
                except Exception as e:
                    logger.error(f"Failed to add {att.blob_path} to zip: {e}")
        
        zip_buffer.seek(0)
        b64_zip = base64.b64encode(zip_buffer.read()).decode('utf-8')

        # 3. Construct email
        unique_vessels = list(set([att.report.vessel_name for att in pending_attachments if att.report and att.report.vessel_name]))
        vessel_list_str = ", ".join(unique_vessels) if unique_vessels else "Unknown Vessels"
        
        email_body_html = f"<h3>New Reports uploaded</h3>"
        email_body_html += f"<p>New reports are uploaded for following vessel(s): <b>{vessel_list_str}</b>.</p>"
        email_body_html += f"<p>Attached is a ZIP file containing a total of <b>{len(pending_attachments)}</b> new reports.</p>"
        
        graph_attachments = [{
            "@odata.type": "#microsoft.graph.fileAttachment",
            "name": "New_Reports.zip",
            "contentBytes": b64_zip
        }]
        
        send_mail_url = f"https://graph.microsoft.com/v1.0/users/{mail_from}/sendMail"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        
        email_list = [email.strip() for email in notification_email.split(",") if email.strip()]
        to_recipients = [{"emailAddress": {"address": email}} for email in email_list]

        payload = {
            "message": {
                "subject": f"[Report Tracker] New Reports uploaded ({len(pending_attachments)} files)",
                "body": {
                    "contentType": "HTML",
                    "content": email_body_html
                },
                "toRecipients": to_recipients,
                "attachments": graph_attachments
            },
            "saveToSentItems": "false"
        }
        
        # 4. Send email
        async with httpx.AsyncClient() as client:
            mail_res = await client.post(send_mail_url, headers=headers, json=payload, timeout=60.0)
            
            if mail_res.status_code not in (200, 202):
                logger.error(f"Failed to send email via Graph API: {mail_res.text}")
                # Mark as FAILED
                for att in pending_attachments:
                    att.email_status = EmailStatus.FAILED
            else:
                logger.info(f"Successfully sent batch ZIP email for {len(pending_attachments)} attachments.")
                # Mark as SENT
                for att in pending_attachments:
                    att.email_status = EmailStatus.SENT

        await db.commit()

    except Exception as e:
        logger.error(f"Exception during process_and_email_pending_attachments: {e}")
