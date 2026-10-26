import os
import re
import sys

def find_env_value(key, root=r"C:\WORKPLACE"):
    # Check drs_backend first (primary on vessel), then reports_backend, etc.
    for sub in ["drs_backend", "reports_backend", "lub_backend", "Aepms-backend", "orb_backend"]:
        env_path = os.path.join(root, sub, ".env")
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            m = re.search(rf"^{key}\s*=\s*['\"]?(.*?)['\"]?\s*$", content, re.MULTILINE)
            if m and m.group(1).strip():
                return m.group(1).strip(), env_path
    return None, None

def main():
    root = r"C:\WORKPLACE"
    orb_dir = os.path.join(root, "orb_backend")
    os.makedirs(orb_dir, exist_ok=True)
    orb_env_path = os.path.join(orb_dir, ".env")
    
    # 1. Determine IMO
    target_imo = None
    if len(sys.argv) > 1 and sys.argv[1].strip() and sys.argv[1].strip().isdigit() and len(sys.argv[1].strip()) == 7:
        target_imo = sys.argv[1].strip()
        print(f"      Using specified Vessel IMO: {target_imo}")
    else:
        detected_imo, src = find_env_value("VESSEL_IMO", root)
        if detected_imo and detected_imo.isdigit() and len(detected_imo) == 7:
            target_imo = detected_imo
            print(f"      Auto-detected Vessel IMO: {target_imo} (from {src})")
        else:
            try:
                target_imo = input("      Enter 7-digit Vessel IMO number: ").strip()
            except Exception:
                target_imo = "9832913"
    
    if not target_imo or not target_imo.isdigit() or len(target_imo) != 7:
        print(f"      [WARNING] Invalid IMO '{target_imo}'. Defaulting to 9832913.")
        target_imo = "9832913"

    # 2. Extract Cloud Storage Connection String from existing vessel config (DRS/Reports)
    cloud_storage_conn, src_cs = find_env_value("CLOUD_STORAGE_CONNECTION_STRING", root)
    if not cloud_storage_conn:
        cloud_storage_conn = ""

    # 3. Extract Sync API Key
    sync_key, src_sk = find_env_value("SYNC_API_KEY", root)
    if not sync_key:
        sync_key = "PROD_SECURE_SYNC_9922"

    # 4. Construct .env content
    env_content = f"""# ORB backend, vessel side (offline). Same code as the VM; STORAGE_MODE decides the role.
STORAGE_MODE=offline
VESSEL_IMO={target_imo}
SYNC_API_KEY={sync_key}
# The VM's ORB root (nginx /orb/ on the VM)
CLOUD_BASE_URL=https://workplace.ozellar.com/orb
SYNC_INTERVAL_SECONDS=60
SYNC_BATCH_SIZE=50
MAX_SYNC_RETRIES=5
# Set false only behind an SSL-inspecting proxy that breaks certificate checks (DRS does this by default)
SYNC_VERIFY_TLS=false

DATABASE_URL=postgresql+asyncpg://postgres:maritime123@localhost:5432/workplace_orb
CONTROL_DATABASE_URL=postgresql+asyncpg://postgres:maritime123@localhost:5432/workplace_control
SECRET_KEY=your-super-secret-key-must-match-drs-backend
ALGORITHM=HS256
CORS_ORIGINS=http://localhost:8080

# Local Azurite: files are read from here
AZURE_STORAGE_CONNECTION_STRING="DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
AZURE_STORAGE_CONTAINER=iopp-documents
AZURE_STORAGE_ORB_CONTAINER=orb-uploads
AZURE_STORAGE_ORB_CHAT_CONTAINER=orb-chat
# Cloud storage connection (inherited dynamically from vessel DRS config)
CLOUD_STORAGE_CONNECTION_STRING="{cloud_storage_conn}"

# The vessel never extracts: no Gemini key, no poppler needed for sync
USE_MOCK_EXTRACTION=true
UPLOAD_DIR=uploads
MAX_CHAT_ATTACHMENT_MB=10
POPPLER_PATH=

CLOUD_HEALTH_URL=https://workplace.ozellar.com/orb/api/time
NETWORK_TIMEOUT_SECONDS=15.0
"""
    with open(orb_env_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(env_content)
    print(f"      [OK] Successfully configured {orb_env_path} (VESSEL_IMO={target_imo})")

if __name__ == "__main__":
    main()
