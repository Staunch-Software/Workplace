# test_sas.py - Run this to test SAS generation
import os
from datetime import datetime, timedelta, timezone
from azure.storage.blob import generate_blob_sas, BlobSasPermissions
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def test_sas_generation():
    # Parse connection string
    conn_str = os.getenv('AZURE_STORAGE_CONNECTION_STRING')
    print(f"🔍 Connection String Length: {len(conn_str)} characters")
    
    conn_str_dict = dict(item.split('=', 1) for item in conn_str.split(';') if item)
    account_name = conn_str_dict.get('AccountName') or conn_str_dict.get('accountname')
    account_key = conn_str_dict.get('AccountKey') or conn_str_dict.get('accountkey')
    container_name = os.getenv('AZURE_CONTAINER_NAME', 'pdf-repository')
    
    print(f"📦 Account Name: {account_name}")
    print(f"📦 Container Name: {container_name}")
    print(f"🔑 Account Key (first 10 chars): {account_key[:10]}...")
    
    # Test blob path
    test_blob_path = "defects/test123/attachments/test_file.pdf"
    
    try:
        # Generate SAS token with explicit version
        now = datetime.now(timezone.utc)
        
        print(f"\n⏰ Current Time (UTC): {now}")
        print(f"⏰ Expiry Time (UTC): {now + timedelta(hours=24)}")
        
        sas_token = generate_blob_sas(
            account_name=account_name,
            account_key=account_key,
            container_name=container_name,
            blob_name=test_blob_path,
            permission=BlobSasPermissions(read=True),
            expiry=now + timedelta(hours=24),
            version="2021-06-08"
        )
        
        # Construct full URL
        full_url = f"https://{account_name}.blob.core.windows.net/{container_name}/{test_blob_path}?{sas_token}"
        
        print(f"\n✅ SAS Token Generated Successfully!")
        print(f"\n📝 SAS Token (first 50 chars): {sas_token[:50]}...")
        print(f"\n🔗 Full URL (first 100 chars): {full_url[:100]}...")
        
        # Check if version is in the SAS token
        if "sv=" in sas_token:
            version_param = [param for param in sas_token.split('&') if param.startswith('sv=')]
            if version_param:
                print(f"\n✅ Version Parameter Found: {version_param[0]}")
        else:
            print("\n⚠️ WARNING: No version parameter (sv=) found in SAS token!")
        
        # Check other important parameters
        important_params = ['sp=', 'se=', 'sig=']
        for param in important_params:
            if param in sas_token:
                print(f"✅ {param} parameter found")
            else:
                print(f"❌ {param} parameter MISSING!")
        
        return full_url
        
    except Exception as e:
        print(f"\n❌ ERROR Generating SAS Token:")
        print(f"   {type(e).__name__}: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == "__main__":
    print("=" * 60)
    print("🧪 TESTING SAS TOKEN GENERATION")
    print("=" * 60)
    test_sas_generation()