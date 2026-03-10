import os
import msal
import requests  # We use requests for the test script for simplicity
from dotenv import load_dotenv

# 1. Load Environment Variables
load_dotenv()

TENANT_ID = os.getenv("AZURE_TENANT_ID")
CLIENT_ID = os.getenv("AZURE_CLIENT_ID")
CLIENT_SECRET = os.getenv("AZURE_CLIENT_SECRET")
MAIL_FROM = os.getenv("MAIL_FROM")

print("--- OAUTH DEBUGGER ---")
print(f"Tenant ID: {TENANT_ID}")
print(f"Client ID: {CLIENT_ID}")
print(f"Sender:    {MAIL_FROM}")

# 2. Get the Token
def get_token():
    print("\n[1/2] Acquiring Azure Token...")
    app = msal.ConfidentialClientApplication(
        CLIENT_ID,
        authority=f"https://login.microsoftonline.com/{TENANT_ID}",
        client_credential=CLIENT_SECRET,
    )
    result = app.acquire_token_for_client(scopes=["https://graph.microsoft.com/.default"])
    
    if "access_token" in result:
        print("✅ Token Acquired!")
        return result["access_token"]
    else:
        print(f"❌ Token Failed: {result.get('error_description')}")
        return None

# 3. Send Email
def send_test_email(token):
    print("\n[2/2] Sending Test Email via Graph API...")
    endpoint = f"https://graph.microsoft.com/v1.0/users/{MAIL_FROM}/sendMail"
    
    # CHANGE THIS to your personal email for testing
    TEST_RECIPIENT = "deepalakshmiarasu2306@gmail.com" 
    
    email_msg = {
        "message": {
            "subject": "Microsoft Graph API Test",
            "body": {
                "contentType": "Text",
                "content": "If you are reading this, OAuth2 is working perfectly! 🚀"
            },
            "toRecipients": [
                {"emailAddress": {"address": TEST_RECIPIENT}}
            ]
        },
        "saveToSentItems": "true"
    }
    
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(endpoint, json=email_msg, headers=headers)
    
    if response.status_code == 202:
        print(f"✅ Email Sent Successfully to {TEST_RECIPIENT}")
    else:
        print(f"❌ Send Failed: {response.status_code}")
        print(response.text)

# Run
token = get_token()
if token:
    send_test_email(token)