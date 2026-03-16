from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from services.azure_blob import upload_file_to_blob
from core.deps import get_current_user

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

@router.post("/upload")
async def upload_attachment(
    file: UploadFile = File(...),
    user = Depends(get_current_user)
):
    try:
        # Read file bytes into memory
        file_bytes = await file.read()
        
        # Upload to Azure (or Azurite if offline)
        attachment_data = await upload_file_to_blob(
            file_bytes=file_bytes,
            original_filename=file.filename,
            content_type=file.content_type
        )
        
        # Returns { "src": "https://...", "filename": "engine.jpg", "alt": "engine.jpg", "mimeType": "image/jpeg" }
        return attachment_data
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")