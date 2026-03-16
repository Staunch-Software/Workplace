# create_azure_container.py
import asyncio
from azure.storage.blob.aio import BlobServiceClient
from dotenv import load_dotenv
import os

load_dotenv()

async def create_container():
    connection_string = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    container_name = os.getenv("AZURE_CONTAINER_NAME", "ozellar-attachments")

    print(f"Connecting to Azure...")

    async with BlobServiceClient.from_connection_string(connection_string) as client:
        # Force create WITHOUT public access
        try:
            await client.create_container(container_name)  # no public_access
            print(f"\n✅ Container '{container_name}' CREATED!")
        except Exception as e:
            if "ContainerAlreadyExists" in str(e):
                print(f"\n✅ Container '{container_name}' already exists!")
            else:
                print(f"\n❌ Failed: {e}")

        # List to confirm
        print("\nAll containers:")
        async for c in client.list_containers():
            print(f"  - {c['name']}")

asyncio.run(create_container())