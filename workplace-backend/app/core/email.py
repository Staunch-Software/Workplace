import httpx
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

async def get_graph_token() -> str:
    url = f"https://login.microsoftonline.com/{settings.AZURE_TENANT_ID}/oauth2/v2.0/token"
    async with httpx.AsyncClient() as client:
        res = await client.post(url, data={
            "grant_type": "client_credentials",
            "client_id": settings.AZURE_CLIENT_ID,
            "client_secret": settings.AZURE_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
        })
        res.raise_for_status()
        return res.json()["access_token"]


async def send_welcome_email(
    to_email: str,
    full_name: str,
    password: str,
    role: str,
    assigned_vessels: list[str],
    permissions: dict,
    created_by: str,
):
    try:
        token = await get_graph_token()

        # Build module list
        module_names = {
            "drs": "Defect Reporting System",
            "jira": "JIRA Integration",
            "voyage": "Voyage Management",
            "lubeoil": "Lubeoil Analysis",
            "engine_performance": "Engine Performance",
        }
        enabled_modules = [
            module_names[k] for k, v in permissions.items() if v and k in module_names
        ]
        modules_html = "".join(f"<li>{m}</li>" for m in enabled_modules) or "<li>None assigned</li>"
        vessels_html = "".join(f"<li>{v}</li>" for v in assigned_vessels) or "<li>None assigned</li>"

        html_body = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9f9f9;">
            <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                <h1 style="color: #1a1a2e; font-size: 24px; margin-bottom: 8px;">Welcome to Workplace 👋</h1>
                <p style="color: #666; font-size: 15px;">Hi <strong>{full_name}</strong>, your account has been created by <strong>{created_by}</strong>.</p>

                <div style="background: #f0f4ff; border-radius: 8px; padding: 16px; margin: 24px 0;">
                    <h3 style="margin: 0 0 12px; color: #333; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Your Login Credentials</h3>
                    <p style="margin: 4px 0; font-size: 14px;"><strong>URL:</strong> <a href="https://{settings.PLATFORM_URL}" style="color: #4f6ef7;">https://{settings.PLATFORM_URL}</a></p>
                    <p style="margin: 4px 0; font-size: 14px;"><strong>Email:</strong> {to_email}</p>
                    <p style="margin: 4px 0; font-size: 14px;"><strong>Password:</strong> {password}</p>
                    <p style="margin: 4px 0; font-size: 14px;"><strong>Role:</strong> {role}</p>
                </div>

                <div style="margin: 20px 0;">
                    <h3 style="color: #333; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Assigned Vessels</h3>
                    <ul style="color: #555; font-size: 14px; padding-left: 20px;">
                        {vessels_html}
                    </ul>
                </div>

                <div style="margin: 20px 0;">
                    <h3 style="color: #333; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px;">Module Access</h3>
                    <ul style="color: #555; font-size: 14px; padding-left: 20px;">
                        {modules_html}
                    </ul>
                </div>

                <div style="background: #fff8e1; border-left: 4px solid #f5a623; padding: 12px 16px; border-radius: 4px; margin-top: 24px;">
                    <p style="margin: 0; font-size: 13px; color: #555;">
                        Please change your password after your first login. If you have any issues, contact your system administrator.
                    </p>
                </div>

                <p style="margin-top: 32px; font-size: 12px; color: #aaa; text-align: center;">
                    This is an automated message from Workplace Platform · Ozellar Global
                </p>
            </div>
        </div>
        """

        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"https://graph.microsoft.com/v1.0/users/{settings.MAIL_SENDER}/sendMail",
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json={
                    "message": {
                        "subject": f"Welcome to Workplace Platform — {full_name}",
                        "body": {"contentType": "HTML", "content": html_body},
                        "toRecipients": [{"emailAddress": {"address": to_email}}],
                    },
                    "saveToSentItems": False,
                },
            )
            res.raise_for_status()
            logger.info(f"✅ Welcome email sent to {to_email}")

    except Exception as e:
        logger.error(f"❌ Failed to send welcome email to {to_email}: {e}")