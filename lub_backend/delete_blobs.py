import os
from azure.storage.blob import BlobServiceClient

# ================= CONFIGURATION =================
# I have populated these directly from the data you provided
# =================================================

def delete_all_blobs():
    print(f"🔌 Connecting to Azure Container: '{CONTAINER_NAME}'...")
    
    try:
        # Connect to the Client
        blob_service_client = BlobServiceClient.from_connection_string(CONNECTION_STRING)
        container_client = blob_service_client.get_container_client(CONTAINER_NAME)

        # 1. Check if container exists
        if not container_client.exists():
            print(f"❌ Container '{CONTAINER_NAME}' does not exist.")
            return

        # 2. List all files (blobs)
        print("🔍 Scanning for files...")
        blobs_list = list(container_client.list_blobs())
        total_blobs = len(blobs_list)

        if total_blobs == 0:
            print("✅ The container is already empty. No files to delete.")
            return

        print(f"📦 Found {total_blobs} files in '{CONTAINER_NAME}'.")
        
        # 3. SAFETY CONFIRMATION
        print("==================================================")
        confirm = input(f"⚠️  WARNING: Are you sure you want to PERMANENTLY DELETE all {total_blobs} files? (Type 'yes' to confirm): ")
        print("==================================================")
        
        if confirm.lower() != "yes":
            print("🚫 Operation cancelled by user.")
            return

        # 4. Deletion Loop
        print("🚀 Starting deletion process...")
        deleted_count = 0
        
        # Using a batch-like approach for visual feedback
        for blob in blobs_list:
            container_client.delete_blob(blob.name)
            print(f"🗑️  Deleted: {blob.name}")
            deleted_count += 1

        print("==================================================")
        print(f"✅ Success! Deleted {deleted_count} files.")
        print(f"🧹 Container '{CONTAINER_NAME}' is now completely empty.")

    except Exception as e:
        print(f"❌ An error occurred: {str(e)}")

if __name__ == "__main__":
    delete_all_blobs()