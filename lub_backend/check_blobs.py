# check_blobs.py
import sys
import os

# Ensure we can import from the 'app' directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.blob_storage import get_blob_service_client, CONTAINER_NAME

def list_container_files():
    print(f"🔌 Connecting to Azure Container: '{CONTAINER_NAME}'...")
    
    try:
        # 1. Get the client
        blob_service_client = get_blob_service_client()
        container_client = blob_service_client.get_container_client(CONTAINER_NAME)

        # 2. List all blobs
        blobs_list = list(container_client.list_blobs())

        if not blobs_list:
            print("📭 The container is empty.")
            return

        print(f"\n📦 Found {len(blobs_list)} files:\n" + "="*50)
        
        # 3. Print details
        for blob in blobs_list:
            # blob.name is the full path (e.g., main_engine/raw/9481685/...)
            print(f"📄 Name: {blob.name}")
            print(f"   Size: {blob.size / 1024:.2f} KB")
            print(f"   Type: {blob.content_settings.content_type}")
            print("-" * 50)

    except Exception as e:
        print(f"❌ Error listing blobs: {e}")

if __name__ == "__main__":
    list_container_files()