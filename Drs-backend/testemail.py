import smtplib
import os
from dotenv import load_dotenv

# Load env variables
load_dotenv()

user = os.getenv("MAIL_USERNAME")
password = os.getenv("MAIL_PASSWORD")
server = os.getenv("MAIL_SERVER")
port = int(os.getenv("MAIL_PORT", 587))

print(f"--- EMAIL DEBUGGER ---")
print(f"Server:   '{server}'")
print(f"Port:     {port}")
print(f"User:     '{user}'")
# We print the length to check for hidden spaces
print(f"Password: {len(password)} characters long (Hidden)") 

print("\n[1/3] Connecting to server...")
try:
    # Try connecting
    smtp = smtplib.SMTP(server, port)
    smtp.set_debuglevel(1) # This prints the raw server conversation
    print("✅ Connected.")

    print("[2/3] Starting TLS...")
    smtp.starttls()
    print("✅ TLS Established.")

    print("[3/3] Logging in...")
    smtp.login(user, password)
    print("✅ LOGIN SUCCESS! Your .env is correct.")
    smtp.quit()

except smtplib.SMTPAuthenticationError:
    print("\n❌ AUTHENTICATION FAILED (535)")
    print("   1. Check if 'MAIL_SERVER' is correct (smtp.gmail.com vs mail.ozellar.com)")
    print("   2. Check if 'MAIL_PASSWORD' has hidden spaces in .env")
    print("   3. If Gmail/Workspace, ensure you are using an APP PASSWORD.")
except Exception as e:
    print(f"\n❌ CONNECTION ERROR: {e}")