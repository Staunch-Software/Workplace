import httpx
import logging
from pathlib import Path
from app.core.config import settings

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).parent / "email_templates"

# ── Token ────────────────────────────────────────────────────────────────────

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


# ── Send helper ───────────────────────────────────────────────────────────────

async def _send_email(to_email: str, subject: str, html_body: str):
    token = await get_graph_token()
    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"https://graph.microsoft.com/v1.0/users/{settings.MAIL_SENDER}/sendMail",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
            },
            json={
                "message": {
                    "subject": subject,
                    "body": {"contentType": "HTML", "content": html_body},
                    "toRecipients": [{"emailAddress": {"address": to_email}}],
                },
                "saveToSentItems": False,
            },
        )
        res.raise_for_status()


# ── Module descriptions ───────────────────────────────────────────────────────

MODULE_INFO = {
    "drs": {
        "name": "DRS (Defect Reporting System)",
        "desc": "Report, track and resolve vessel defects. Communicate seamlessly with the shore team.",
    },
    "jira": {
        "name": "SmartPAL JIRA Portal",
        "desc": "This is a mirror image of the JIRA portal enabling all vessels to get the update status of their tickets (Login &amp; Major issues).",
    },
    "voyage": {
        "name": "Voyage Performance",
        "desc": "Monitor voyage performance, fuel emission.",
    },
    "lubeoil": {
        "name": "Luboil Analysis",
        "desc": "Upload lube oil reports, view lab analysis, review machinery health trends, and communicate with the team via comments.",
    },
    "engine_performance": {
        "name": "Engine Performance",
        "desc": "Track engine metrics, monitor health indicators and performance trends.",
    },
}

# ROLE_RESPONSIBILITIES = {
#     "VESSEL": [
#         "Submit defect reports with photos and descriptions",
#         "Respond to shore team remarks and close resolved defects",
#         "Upload lube oil and performance reports",
#         "Mention specific crew members using @mentions",
#     ],
#     "SHORE": [
#         "Review incoming reports daily",
#         "Add remarks and approve or reject resampling requests",
#         "Mention specific crew members using @mentions",
#     ],
#     "ADMIN": [
#         "Manage users, vessels and module permissions",
#         "Review all reports across the fleet",
#         "Configure system settings and integrations",
#     ],
# }


# ── Welcome Email ─────────────────────────────────────────────────────────────

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
        template = (TEMPLATE_DIR / "welcome.html").read_text()

        # Modules
        enabled = [MODULE_INFO[k] for k, v in permissions.items() if v and k in MODULE_INFO]
        modules_html = ""
        for m in enabled:
            modules_html += f"""
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px;margin-bottom:10px;">
              <tr>
                <td style="padding:14px 18px;">
                  <strong style="font-size:13px;color:#0f172a;">{m['name']}</strong>
                  <p style="margin:4px 0 0;font-size:12px;color:#64748b;line-height:1.5;">{m['desc']}</p>
                </td>
              </tr>
            </table>"""
        if not modules_html:
            modules_html = "<p style='font-size:13px;color:#94a3b8;'>No modules assigned.</p>"

        # Role responsibilities
        login_url = "http://localhost:8080" if role.upper() == "VESSEL" else settings.PLATFORM_URL

        steps = [
            f"Visit <a href='{login_url}' style='color:#2563eb;'>{login_url}</a>",
            "Login with your credentials provided above",
            "<strong>Change your password immediately</strong> upon first login",
            "Explore your assigned modules",
            "You can manage and update your assigned vessels anytime from your profile",
        ]
        if role.upper() == "VESSEL":
            steps.append("The old DRS has been moved to the Workplace platform. Kindly use this link going forward and discontinue use of the old system.")
        getting_started_steps = ""
        for i, step in enumerate(steps, 1):
            getting_started_steps += f"""
            <tr>
              <td style="padding:5px 0;">
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:28px;height:28px;background:#2563eb;border-radius:50%;text-align:center;vertical-align:middle;">
                      <span style="font-size:12px;font-weight:700;color:#fff;">{i}</span>
                    </td>
                    <td style="padding-left:12px;font-size:13px;color:#334155;">{step}</td>
                  </tr>
                </table>
              </td>
            </tr>"""

        # Responsibilities block (role-specific, shown after modules)
        # responsibilities = ROLE_RESPONSIBILITIES.get(role.upper(), [])
        # responsibilities_html = ""
        # if responsibilities:
        #     items = "".join(f"<li>{r}</li>" for r in responsibilities)
        #     responsibilities_html = f"""
        #     <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-bottom:28px;">
        #       <tr>
        #         <td style="padding:16px 20px;">
        #           <strong style="font-size:13px;color:#1e40af;">{role.title()} Team Responsibilities</strong>
        #           <ul style="margin:8px 0 0;padding-left:18px;font-size:13px;color:#1e3a8a;line-height:2;">
        #             {items}
        #           </ul>
        #         </td>
        #       </tr>
        #     </table>"""

        vessels_str = ", ".join(assigned_vessels) if assigned_vessels else "None assigned"
        login_url = "http://localhost:8080" if role.upper() == "VESSEL" else settings.PLATFORM_URL

        html = (template
            .replace("{{full_name}}", full_name)
            .replace("{{email}}", to_email)
            .replace("{{password}}", password)
            .replace("{{role}}", role)
            .replace("{{assigned_vessels}}", vessels_str)
            .replace("{{platform_url}}", login_url)
            .replace("{{getting_started_steps}}", getting_started_steps)
            .replace("{{modules_html}}", modules_html)
        )

        await _send_email(
            to_email=to_email,
            subject=f"Welcome to Workplace Platform — {full_name}",
            html_body=html,
        )
        logger.info(f"✅ Welcome email sent to {to_email}")

    except Exception as e:
        logger.error(f"❌ Failed to send welcome email to {to_email}: {e}")


# ── Password Reset Email ──────────────────────────────────────────────────────

async def send_password_reset_email(to_email: str, full_name: str, token: str):
    try:
        reset_url = f"{settings.PLATFORM_URL}/reset-password?token={token}"
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <h1 style="color:#0f172a;font-size:22px;margin-bottom:8px;">Reset Your Password</h1>
            <p style="color:#475569;font-size:14px;">Hi <strong>{full_name}</strong>, we received a request to reset your Workplace password.</p>
            <div style="text-align:center;margin:32px 0;">
              <a href="{reset_url}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:14px 36px;border-radius:8px;text-decoration:none;">
                Reset Password
              </a>
            </div>
            <p style="color:#94a3b8;font-size:12px;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
            <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">
              Workplace Platform · Ozellar Global
            </p>
          </div>
        </div>
        """
        await _send_email(
            to_email=to_email,
            subject="Reset Your Workplace Password",
            html_body=html_body,
        )
        logger.info(f"✅ Password reset email sent to {to_email}")

    except Exception as e:
        logger.error(f"❌ Failed to send reset email to {to_email}: {e}")


# ── Contact Administrator Email ───────────────────────────────────────────────

async def send_contact_email(name: str, from_email: str, message: str):
    try:
        html_body = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
          <div style="background:white;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <h1 style="color:#0f172a;font-size:20px;margin-bottom:8px;">New Contact Request</h1>
            <p style="color:#475569;font-size:14px;margin-bottom:24px;">A user has submitted a contact request via the Workplace platform login page.</p>
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:8px 0;color:#64748b;font-weight:600;width:100px;">Name</td><td style="padding:8px 0;color:#0f172a;">{name}</td></tr>
              <tr><td style="padding:8px 0;color:#64748b;font-weight:600;">Email</td><td style="padding:8px 0;color:#0f172a;"><a href="mailto:{from_email}" style="color:#2563eb;">{from_email}</a></td></tr>
            </table>
            <div style="margin-top:20px;padding:16px;background:#f8fafc;border-radius:8px;border-left:4px solid #2563eb;">
              <p style="color:#64748b;font-size:12px;font-weight:600;margin:0 0 8px;">MESSAGE</p>
              <p style="color:#0f172a;font-size:14px;margin:0;line-height:1.6;">{message}</p>
            </div>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;"/>
            <p style="margin:0;font-size:11px;color:#94a3b8;text-align:center;">Workplace Platform · Ozellar Global</p>
          </div>
        </div>
        """
        await _send_email(
            to_email="techdevops@ozellar.com",
            subject=f"Workplace Platform - Contact from {name}",
            html_body=html_body,
        )
        logger.info(f"✅ Contact email sent from {from_email}")
    except Exception as e:
        logger.error(f"❌ Failed to send contact email: {e}")
        raise