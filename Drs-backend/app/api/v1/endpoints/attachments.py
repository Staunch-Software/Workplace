# app/api/v1/endpoints/attachments.py
from fastapi import APIRouter, HTTPException , Query
from pydantic import BaseModel
from typing import Optional
from app.core.blob_storage import generate_read_sas_url, generate_write_sas_url
import logging

logger = logging.getLogger(__name__)

router = APIRouter()

class AttachmentUrlRequest(BaseModel):
    blob_path: str

class AttachmentUrlResponse(BaseModel):
    url: str
    blob_path: str
    expiry_hours: int

@router.post("/signed-url", response_model=AttachmentUrlResponse)
async def get_attachment_signed_url(request: AttachmentUrlRequest):
    """
    Generate a fresh SAS URL for viewing/downloading an attachment.
    This ensures URLs don't expire when users reload the page.
    
    Args:
        request: Contains blob_path (e.g., "defects/123/attachments/file.pdf")
    
    Returns:
        Fresh signed URL with 24-hour expiry
    """
    try:
        if not request.blob_path:
            raise HTTPException(status_code=400, detail="blob_path is required")
        
        logger.info(f"Generating signed URL for: {request.blob_path}")
        
        # Generate fresh 24-hour SAS URL
        signed_url = generate_read_sas_url(request.blob_path)
        
        logger.info(f"✅ Signed URL generated successfully")
        
        return AttachmentUrlResponse(
            url=signed_url,
            blob_path=request.blob_path,
            expiry_hours=24
        )
    
    except Exception as e:
        logger.error(f"❌ Failed to generate signed URL: {str(e)}")
        raise HTTPException(
            status_code=500, 
            detail=f"Failed to generate signed URL: {str(e)}"
        )

@router.post("/batch-signed-urls")
async def get_batch_attachment_urls(blob_paths: list[str]):
    """
    Generate signed URLs for multiple attachments at once.
    Useful for loading entire thread conversations efficiently.
    """
    try:
        signed_urls = []
        
        for blob_path in blob_paths:
            try:
                url = generate_read_sas_url(blob_path)
                signed_urls.append({
                    "blob_path": blob_path,
                    "url": url,
                    "success": True
                })
            except Exception as e:
                logger.error(f"Failed to generate URL for {blob_path}: {str(e)}")
                signed_urls.append({
                    "blob_path": blob_path,
                    "url": None,
                    "success": False,
                    "error": str(e)
                })
        
        return {"urls": signed_urls}
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Batch URL generation failed: {str(e)}"
        )
@router.get("/upload-url")
async def get_upload_sas_url(blobName: str = Query(..., description="Path where file will be uploaded")):
    """
    Generate write-enabled SAS URL for uploading files.
    This matches your existing frontend call: api.get('/defects/sas', { params: { blobName } })
    """
    try:
        if not blobName:
            raise HTTPException(status_code=400, detail="blobName parameter is required")
        
        logger.info(f"Generating upload URL for: {blobName}")
        
        # Generate upload URL with write permissions
        upload_url = generate_write_sas_url(blobName)
        
        logger.info(f"✅ Upload URL generated successfully")
        
        return {
            "url": upload_url,
            "blob_path": blobName
        }
    
    except Exception as e:
        logger.error(f"❌ Failed to generate upload URL: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate upload URL: {str(e)}")