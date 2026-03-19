import sys  
from pydantic import BaseModel
import asyncio
import multiprocessing 
import shutil
import tempfile
from fastapi.responses import JSONResponse
from pypdf import PdfReader, PdfWriter
from sqlalchemy import Column, Integer, String, Text
import os
import zipfile
from fastapi.responses import StreamingResponse
import io
from app.load_luboil_config import load_luboil_config
from dateutil.relativedelta import relativedelta 
from sqlalchemy import desc
from sqlalchemy.orm import aliased
from fastapi import Query 
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, status, Form
from fastapi.middleware.cors import CORSMiddleware
if sys.platform == 'win32':
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except AttributeError:
        pass
   
    try:
        if multiprocessing.get_start_method(allow_none=True) is None:
            multiprocessing.set_start_method('spawn', force=True)
    except Exception as e:
        print(f"Warning: Could not set multiprocessing start method: {e}")
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select as sa_select
import io
import logging
from typing import BinaryIO, Dict, Any, List, Optional
import re
from datetime import datetime, timedelta, date, timezone
from dateutil.relativedelta import relativedelta
from sqlalchemy import func, distinct, text, desc, and_

import numpy as np
from decimal import Decimal

# Local imports
from app.database import get_db, create_all_tables, run_startup_migrations
from app.core.database_control import SessionControl
from app.field_metadata import FIELD_METADATA_MAPPING
from app.models.control.vessel import Vessel
from app.luboil_model import LuboilVessel, LuboilReport, LuboilSample, LuboilEquipmentType, LuboilVesselConfig, LuboilNameMapping, Notification, LuboilEvent, LuboilEventReadState

from app.routes import auth
# from app.routes import admin 
from app.middleware.permission_check import check_endpoint_permission
from app.blob_storage import upload_file_to_azure, generate_sas_url
from app.blob_storage import generate_sas_url
from app.luboil_report_processor import save_luboil_report
from app.luboil_model import LuboilEquipmentType, LuboilVesselConfig, LuboilNameMapping
from sqlalchemy import case, literal
VESSEL_ORDER_CONFIG = {
    9832925: 1,  # AM KIRTI
    9792058: 2,  # MV AM UMANG
    9832913: 3,  # AM TARANG
    9481659: 4,  # M.V.GCL TAPI
    9481697: 5,  # GCL GANGA
    9481685: 6,  # GCL NARMADA
    9481661: 7,  # GCL SABARMATI
    9481219: 8,  # GCL YAMUNA
}
class NotificationReadResponse(BaseModel):
    id: int
    is_read: bool

def get_allowed_vessel_imos(db, current_user):
    from app.models.control.user import User
    from app.models.control.vessel import Vessel as ControlVessel
    import uuid

    # ✅ Standardized: Read 'id' and 'role' from the JWT payload
    user_id_raw = current_user.get("id") 
    role = str(current_user.get("role") or "").upper()

    logger.info(f"🔍 Resolved Identity - Role: '{role}', ID: {user_id_raw}")

    control_db = SessionControl()
    try:
        # ✅ Standardized Shore Check
        if role in ("ADMIN", "SUPERUSER", "SHORE", "SUPERINTENDENT"):
            all_vessels = control_db.query(ControlVessel.imo).all()
            imos = [v[0] for v in all_vessels]
            return imos, role

        if not user_id_raw:
            return [], role

        # ✅ UUID Conversion for New Table
        try:
            db_user = control_db.query(User).filter(
                User.id == uuid.UUID(str(user_id_raw))
            ).first()
        except Exception as e:
            logger.error(f"❌ UUID conversion error: {e}")
            return [], role

        if not db_user:
            return [], role

        # ✅ Relationship Logic (Many-to-Many)
        imos = [v.imo for v in db_user.vessels]
        return imos, role
    finally:
        control_db.close()

def inject_attachments_to_chat(attachment_string, sample_date, target_list, status_log=None):
    if not attachment_string:
        return
    
    # 1. Default fallback values
    uploader_name = "System"
    upload_time = sample_date.strftime("%Y-%m-%d 00:00")
    
    # 2. Extract real Name and Time from the status_change_log
    if status_log:
        # Regex looks for: [19/02/2026 17:26] <b>Gokul D</b>
        log_match = re.search(r"\[(.*?)\]\s*(?:<b>)?(.*?)(?:</b>)?\s+has successfully uploaded", status_log)
        if log_match:
            raw_time, name = log_match.groups()
            uploader_name = name.strip()
            try:
                # Convert DD/MM/YYYY to YYYY-MM-DD for the UI
                dt = datetime.strptime(raw_time, "%d/%m/%Y %H:%M")
                upload_time = dt.strftime("%Y-%m-%d %H:%M")
            except:
                upload_time = raw_time

    # 3. Process the files
    files = attachment_string.split('|')
    for file_url in files:
        if not file_url: continue
        
        secure_url = generate_sas_url(file_url)
        prefix = "ATTACHED_PDF" if file_url.lower().endswith('.pdf') else "ATTACHED_IMAGE"
        
        # ðŸ”¥ CRITICAL: Format the message so the UI Regex picks up the name
        # UI Regex is: match(/\] (.*?):/)
        formatted_message = f"[{upload_time}] {uploader_name}: {prefix}: {secure_url}"
        
        target_list.append({
            "date": upload_time,
            "role": "System", 
            "message": formatted_message,
            "is_internal": False
        })
def format_vessel_name(name: str) -> str:
    """
    Removes prefixes like 'MV', 'M.V.', 'M.V' from vessel names.
    Example: 'MV AM UMANG' -> 'AM UMANG', 'M.V.GCL TAPI' -> 'GCL TAPI'
    """
    if not name:
        return None
    # Regex explains:
    # ^Start of string
    # (?:...) Non-capturing group for variants: MV, M.V., M.V, M/V
    # \s* Optional whitespace after the prefix
    return re.sub(r'^(?:MV|M\.V\.|M\.V|M/V)\s*', '', name, flags=re.IGNORECASE).strip()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize FastAPI
app = FastAPI(
    title="Luboil Analysis API",
    description="Luboil module API â€” part of Workplace platform."
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://52.172.91.85"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Include routers
# app.include_router(auth.router, prefix="/auth", tags=["Authentication"])
# app.include_router(admin.router, tags=["Admin"])  
from app.routers.sync import router as sync_router
app.include_router(sync_router, prefix="/sync", tags=["Sync"])

# Database Initialization
@app.on_event("startup")
async def startup_event():
    """Event handler that runs when the FastAPI application starts up."""
    logger.info("Application startup: Initializing database...")
    import os, asyncio
    if os.getenv("IS_VESSEL_INSTANCE", "false").lower() == "true":
        from app.services.sync_worker import start_background_sync
        asyncio.create_task(start_background_sync())
        logger.info("Sync worker started (vessel instance).")
    # try:
    #     create_all_tables()
    #     logger.info("Database tables checked/created successfully.")
    #     run_startup_migrations()
    #     from app.database import SessionLocal
    #     from app.core.database_control import SessionControl
    #     db = SessionLocal()
    #     try:
    #         from app.database import create_superuser_if_not_exists
    #         # from app.core.database_control import SessionControl
    #         create_superuser_if_not_exists(db)
    #     finally:
    #         db.close()
    # except Exception as e:
    #     logger.error(f"Failed to initialize database on startup: {e}", exc_info=True)


# ============================================
# ðŸ”¥ NEW: UPLOAD GENERATED ANALYSIS PDF
# ============================================
@app.post("/api/reports/upload-generated", summary="Upload frontend-generated PDF to Azure")
async def upload_generated_report(
    file: UploadFile = File(...),
    report_type: str = Form(...), 
    report_id: Optional[int] = Form(None), # Made Optional for Luboil if ID isn't passed
    db: AsyncSession = Depends(get_db)
):
    try:
        file_content = await file.read()
        
        # 1. Determine Logic based on Report Type
        model = None
        pk_field = None
        folder_base = ""
        imo_number = "unknown"
        report_month = "unknown"

        if report_type == 'mainEngine':
            model = MonthlyReportHeader
            pk_field = MonthlyReportHeader.report_id
            folder_base = "main_engine/analytical"
        elif report_type == 'auxiliaryEngine':
            model = GeneratorMonthlyReportHeader
            pk_field = GeneratorMonthlyReportHeader.report_id
            folder_base = "aux_engine/analytical"
        elif report_type == 'lubeOilAnalysis':
            # Special Case: Lube Oil usually doesn't have a single "Report ID" 
            # passed from the frontend for the whole fleet view.
            # We store it in a general fleet folder unless a specific ID is provided.
            folder_base = "lube_oil/history"
            # Attempt to extract date from filename for organization
            import re
            date_match = re.search(r'\d{4}-\d{2}-\d{2}', file.filename)
            report_month = date_match.group(0) if date_match else datetime.now().strftime("%Y-%m-%d")
        else:
            raise HTTPException(status_code=400, detail="Invalid report_type")

        # 2. Fetch Report Details (If report_id is provided)
        if report_id and model:
            result = await db.execute(sa_select(model).where(pk_field == report_id))
            report = result.scalars().first()
            if report:
                if report_type == 'mainEngine':
                    imo_number = report.imo_number
                    report_month = report.report_month
                elif report_type == 'auxiliaryEngine':
                    imo_number = report.generator.imo_number
                    report_month = report.report_month

        # 3. Construct Path
        if report_type == 'lubeOilAnalysis':
            # Simple path for Lube Oil History
            folder_path = f"{folder_base}/{report_month}"
        else:
            # Structured path for Engines
            folder_path = f"{folder_base}/{imo_number}/{report_month}"
        
        # 4. Upload to Azure
        blob_url = upload_file_to_azure(
            file_data=file_content,
            filename=file.filename,
            folder_path=folder_path
        )

        if blob_url:
            # Update DB URL if linked to a specific report
            if report_id and model and report:
                report.generated_report_url = blob_url
                await db.commit()
            
            # For Lube Oil, we might just log it or save to a History Log table if you have one
            logger.info(f"âœ… Uploaded {report_type} to {blob_url}")
            return {"status": "success", "url": blob_url}
        else:
            raise HTTPException(status_code=500, detail="Azure upload returned no URL")

    except Exception as e:
        logger.error(f"Error saving generated report: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))






# ============================================
# NEW: GET RAW LUBOIL REPORTS (For Filtering)
# ============================================
@app.get("/api/luboil/reports/{imo_number}", tags=["Lube Oil"])
async def get_luboil_reports(
    imo_number: int, 
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    """
    Get raw list of Luboil Reports/Samples with SECURE SAS LINKS.
    Restricted: Admin sees all, Users see only assigned vessels.
    """
    try:
        # --- ðŸ”¥ SECURITY GATE ---
        allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
        if str(imo_number) not in [str(x) for x in allowed_imos]:
            logger.warning(f"ðŸš« Unauthorized access attempt to IMO {imo_number}")
            raise HTTPException(
                status_code=403, 
                detail="Access Denied: You are not assigned to this vessel's data."
            )
        # --- ðŸ”¥ END OF SECURITY GATE ---

        # Fetch samples joined with report info (Source preserved exactly)
        from sqlalchemy import select as sa_select
        stmt = (
            sa_select(
                LuboilReport.report_id,
                LuboilReport.file_name,
                LuboilReport.report_url,
                LuboilReport.report_date
            )
            .where(LuboilReport.imo_number == str(imo_number))
            .order_by(desc(LuboilReport.report_date))
            .limit(20)
        )
        results = (await db.execute(stmt)).all()

        data = []
        seen_ids = set()
        for r in results:
            if r.report_id in seen_ids:
                continue
            seen_ids.add(r.report_id)

            secure_url = None
            if r.report_url:
                secure_url = generate_sas_url(r.report_url)

            data.append({
                "report_date": r.report_date.isoformat() if r.report_date else None,
                "report_id": r.report_id,
                "file_name": r.file_name,
                "report_url": secure_url
            })

        return data

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Error fetching luboil reports for IMO {imo_number}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# In app/api.py

@app.post("/api/upload-luboil-report/", tags=["Lube Oil"])
async def upload_luboil_report(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    logger.info(f"Received Lube Oil upload: {file.filename}")

    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")

    try:
        # 1. Read content into memory (Read ONCE, use everywhere)
        contents = await file.read()
        
        # Create a stream for the parser (Parser needs a file-like object)
        pdf_stream = io.BytesIO(contents)

        # 2. Process Data (Extract values to DB)
        logger.info(" Parsing PDF Data...")
        result = save_luboil_report(
            pdf_file_stream=pdf_stream,
            filename=file.filename,
            session=db
        )
        
        report_id = result.get("report_id")
        if not report_id:
            logger.error("Parser failed to return a Report ID.")
            raise HTTPException(status_code=500, detail="Report saved but ID not returned.")

        logger.info(f"DB Record Created with ID: {report_id}")

        # 3. Upload Raw File to Azure Blob
        blob_url = None
        report_record = None # Initialize for use in Feed Trigger
        try:
            # Clean filename (Replace spaces with underscores to prevent URL issues)
            clean_filename = file.filename.replace(" ", "_").replace("(", "").replace(")", "")
            
            # Create path: lube_oil/raw/YYYY-MM
            folder_path = f"lube_oil/raw/{datetime.now().strftime('%Y-%m')}"
            
            logger.info(f"â˜ï¸ Uploading to Azure: {folder_path}/{clean_filename}")
            
            blob_url = upload_file_to_azure(
                file_data=contents, # Send the bytes we read earlier
                filename=clean_filename,
                folder_path=folder_path
            )
            
            if blob_url:
                logger.info(f"ðŸŽ‰ Azure Upload Success. URL: {blob_url}")
                
                # 4. UPDATE THE DATABASE RECORD WITH THE URL
                res = await db.execute(sa_select(LuboilReport).where(LuboilReport.report_id == report_id))
                report_record = res.scalars().first()

                if report_record:
                    report_record.report_url = blob_url
                    await db.commit()
                    await db.refresh(report_record)
                    logger.info(f"ðŸ’¾ Database Updated with URL for Report ID: {report_id}")
                else:
                    logger.error(f"âŒ Critical: Report ID {report_id} not found in DB during update.")
            else:
                logger.error("âŒ Azure upload returned None (No URL). Check Azure Credentials in .env")

        except Exception as blob_err:
            logger.error(f"âŒ Exception during Azure Upload: {blob_err}", exc_info=True)

        # =========================================================
        # ðŸ”¥ IMPROVED LIVE FEED TRIGGER (Multi-line Structured Message)
        # =========================================================
        try:
            vessel_name = result.get("vessel", "Unknown Vessel")
            report_date = result.get("report_date", "Unknown Date")
            sample_count = result.get("sample_count", 0)
            alert_summary = result.get("alert_summary", "N/A")
            is_duplicate = result.get("is_duplicate", False)
            imo_val = report_record.imo_number if report_record else 0

            # 1. Determine Title and Priority based on Duplication status
            if is_duplicate:
                line_1 = f"REPORT ALREADY EXISTED - {vessel_name}"
                event_priority = "INFO" # Blue/Neutral color
            else:
                line_1 = f"NEW REPORT UPLOADED - {vessel_name}"
                event_priority = "SUCCESS" # Green color

            # 2. Line 2 contains the processing details
            line_2 = f"Lab results for {report_date} processed ({sample_count} samples). Health Summary -> {alert_summary}"
            line_3 = f"Report Date: {report_date} | Health Summary: {alert_summary}"


            # 3. Line 3 contains the Health summary (Normal/Warning/Critical counts)
            # line_3 = f"Health Summary -> {alert_summary}"

            # Combine using newlines (\n)
            full_structured_message = f"{line_1}\n{line_2}\n{line_3}"

            new_event = LuboilEvent(
                vessel_name=vessel_name,
                imo=imo_val,
                machinery_name="Multiple", 
                event_type="NEW_REPORT",
                priority=event_priority,
                message=full_structured_message,
                created_at=datetime.utcnow() 
            )
            db.add(new_event)
            await db.commit()
            logger.info(f"ðŸ“¡ Live Feed updated for {vessel_name} (Duplicate: {is_duplicate})")
        except Exception as feed_err:
            logger.error(f"âš ï¸ Failed to add upload event to Live Feed: {feed_err}")
        # =========================================================

        # --- UPDATED RETURN BLOCK ---
        return {
            "message": "Lube Oil Report processed successfully.",
            "is_duplicate": result.get("is_duplicate"),
            "vessel": result.get("vessel"),
            "report_date": result.get("report_date"),
            "alert_summary": result.get("alert_summary"),
            "sample_count": result.get("sample_count"),
            "report_id": report_id,
            "file_url": blob_url, 
            "status": "Success" if blob_url else "Partial Success (No File Backup)"
        }

    except ValueError as e:
        logger.error(f"Validation Error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"System Error processing Lube Oil PDF: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error during processing.")

        
# Request Schema for updating remarks
class LuboilRemarksRequest(BaseModel):
    vessel_name: str
    machinery_name: str # Note: The frontend sends the 'Code' (e.g., ME.SYS) here
    sample_date: str 
    sample_id: Optional[int] = None
    officer_remarks: Optional[str] = None
    office_remarks: Optional[str] = None
    internal_remarks: Optional[str] = None
    status: Optional[str] = None 
    status: Optional[str] = None 
    status_change_msg: Optional[str] = None 
    is_image_required: Optional[bool] = None
    is_resampling_required: Optional[bool] = None
    user_name: Optional[str] = None # Added based on your frontend payload
    attachment_url: Optional[str] = None
    is_resolved: Optional[bool] = None
    resolution_remarks: Optional[str] = None
    is_approval_pending: Optional[bool] = None
    approval_action: Optional[str] = None
def sign_luboil_url(msg_text):
    if "ATTACHED_IMAGE:" in msg_text:
        try:
            parts = msg_text.split("ATTACHED_IMAGE: ")
            if len(parts) > 1:
                # Get the URL and strip any existing SAS tokens (?sv=...)
                raw_url = parts[1].strip().split('?')[0]
                # Generate a fresh 24-hour SAS token
                signed_url = generate_sas_url(raw_url)
                return f"ATTACHED_IMAGE: {signed_url}"
        except Exception as e:
            logger.error(f"Error signing image: {e}")
    return msg_text

@app.post("/api/luboil/remarks/update", tags=["Lube Oil"])
async def update_luboil_remarks(
    request: LuboilRemarksRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(auth.get_current_user) 
):
    # Local imports to prevent potential circular dependency crashes
    from app.models.control.user import User
    from app.luboil_model import Notification, LuboilSample, LuboilReport, LuboilEvent
    import re
    from datetime import datetime
    from sqlalchemy import desc, and_

    try:
        # 1. Find Vessel using control DB
        from app.models.control.vessel import Vessel as ControlVessel
        control_db = SessionControl()
        try:
            vessel = control_db.query(ControlVessel).filter(
                ControlVessel.name.ilike(f"%{request.vessel_name}%")
            ).first()
        finally:
            control_db.close()

        if not vessel:
            logger.error(f"❌ Vessel matching '{request.vessel_name}' not found in DB.")
            raise HTTPException(status_code=404, detail=f"Vessel '{request.vessel_name}' not found")

        allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
        if str(vessel.imo) not in [str(x) for x in allowed_imos]:
            raise HTTPException(status_code=403, detail="Access Denied")
        # 2. TARGET THE SPECIFIC SAMPLE
        sample = None
        if request.sample_id:
            res = await db.execute(sa_select(LuboilSample).where(LuboilSample.sample_id == request.sample_id))
            sample = res.scalars().first()

        if not sample:
            base_stmt = (
                sa_select(LuboilSample)
                .join(LuboilReport, LuboilSample.report_id == LuboilReport.report_id)
                .where(LuboilReport.imo_number == str(vessel.imo))
                .where(LuboilSample.sample_date == request.sample_date)
            )
            res = await db.execute(base_stmt.where(LuboilSample.equipment_code == request.machinery_name))
            sample = res.scalars().first()
            if not sample:
                res = await db.execute(base_stmt.where(LuboilSample.machinery_name == request.machinery_name))
                sample = res.scalars().first()

        if not sample: 
            logger.error(f"âŒ Sample for IMO {str(vessel.imo)} on {request.sample_date} not found.")
            raise HTTPException(status_code=404, detail="Sample record not found")

        # --- TRACK CHANGES & ROLE DETECTION ---
        status_changed = False
        if request.status is not None and request.status != sample.status:
            status_changed = True

        # --- SAFER ROLE DETECTION (Fixes 'NoneType' Error) ---
        userData = current_user.get('user') if isinstance(current_user, dict) and 'user' in current_user else current_user
        
        uRole = ""
        if isinstance(userData, dict):
            uRole = str(userData.get('role') or userData.get('uRole') or "").upper()
            if not uRole:
                roles_list = userData.get('roles', [])
                uRole = str(roles_list[0]).upper() if roles_list else ""
        else:
            uRole = str(getattr(userData, 'role', "") or getattr(userData, 'uRole', "") or "").upper()

        is_shore_user = uRole in ("SHORE", "ADMIN", "SUPERUSER", "SUPERINTENDENT", "SUPER")
        
        # Log this to verify in your terminal
        logger.info(f"👤 Detected Role: '{uRole}' | Is Shore: {is_shore_user}")
        

        # 3. Apply Update Fields
        if request.officer_remarks is not None:
            sample.officer_remarks = request.officer_remarks
        
        if request.office_remarks is not None:
            sample.office_remarks = request.office_remarks

        if request.internal_remarks is not None:
            sample.internal_remarks = request.internal_remarks
            
        if request.status is not None:
            sample.status = request.status

        if request.is_image_required is not None:
            sample.is_image_required = request.is_image_required
            
        if request.is_resampling_required is not None:
            sample.is_resampling_required = request.is_resampling_required

        if request.attachment_url is not None:
            sample.attachment_url = request.attachment_url

        # =========================================================
        # ðŸ”¥ ENHANCED RESOLUTION WORKFLOW (TWO-STEP VERIFICATION)
        # =========================================================
        feed_msg = None
        feed_priority = "INFO"
        feed_event_type = "COMMUNICATION"
        approval_notif_msg = None

        # CASE A: Vessel User is submitting a close request
        if not is_shore_user and request.is_resolved is True:
            # Restrictions check (Safety layer)
            evidence_exists = sample.attachment_url and len(sample.attachment_url.strip()) > 0
            if sample.is_image_required and not evidence_exists:
                raise HTTPException(status_code=400, detail="Cannot request closure: Mandatory image missing.")
            
            sample.is_resolved = False # Block direct closure
            if hasattr(sample, 'is_approval_pending'):
                sample.is_approval_pending = True # Move to In-Progress state
            
            sample.resolution_remarks = request.resolution_remarks
            
            approval_notif_msg = f"ðŸš¢ Vessel {vessel.name} requested closure for {request.machinery_name}. Verification required."
            
            line_1 = f"â³ APPROVAL REQUIRED - {vessel.name}"
            line_2 = f"Vessel submitted corrective actions for {request.machinery_name}."
            line_3 = f"Status: Awaiting Shore Verification | Date: {request.sample_date}"
            feed_msg = f"{line_1}\n{line_2}\n{line_3}"
            feed_priority = "WARNING"
            feed_event_type = "APPROVAL_REQUEST"

        # CASE B: Shore User is making a decision (ACCEPT/DECLINE)
        elif is_shore_user and getattr(request, 'approval_action', None):
            if request.approval_action == 'ACCEPT':
                sample.is_resolved = True
                if hasattr(sample, 'is_approval_pending'):
                    sample.is_approval_pending = False
                
                approval_notif_msg = f"âœ… Shore verified and CLOSED the issue for {request.machinery_name} on {vessel.name}."
                
                line_1 = f"âœ… RESOLUTION ACCEPTED - {vessel.name}"
                line_2 = f"Shore verified corrective actions for {request.machinery_name}."
                line_3 = "Issue is now officially CLOSED."
                feed_msg = f"{line_1}\n{line_2}\n{line_3}"
                feed_priority = "SUCCESS"
                feed_event_type = "STATUS_CHANGE"
                
            elif request.approval_action == 'DECLINE':
                sample.is_resolved = False
                if hasattr(sample, 'is_approval_pending'):
                    sample.is_approval_pending = False
                
                # Auto-append decline note to chat
                timestamp_str = datetime.now().strftime("%d/%m/%Y %H:%M")
                decline_note = f"\n[{timestamp_str}] System: Shore declined resolution request. Issue remains OPEN."
                sample.office_remarks = (sample.office_remarks or "") + decline_note
                
                approval_notif_msg = f"âŒ Shore DECLINED the resolution request for {request.machinery_name} on {vessel.name}."
                
                line_1 = f"âŒ RESOLUTION DECLINED - {vessel.name}"
                line_2 = f"Shore declined the closure request for {request.machinery_name}."
                line_3 = "Vessel action still required."
                feed_msg = f"{line_1}\n{line_2}\n{line_3}"
                feed_priority = "CRITICAL"
                feed_event_type = "APPROVAL_DECLINED"

        # CASE C: Shore User closes directly (Bypass)
        elif is_shore_user and request.is_resolved is True:
            sample.is_resolved = True
            if hasattr(sample, 'is_approval_pending'):
                sample.is_approval_pending = False 
            sample.resolution_remarks = request.resolution_remarks
            
            line_1 = f"âœ… ISSUE CLOSED BY SHORE - {vessel.name}"
            line_2 = f"Direct resolution documented for {request.machinery_name}."
            line_3 = f"Remarks: {request.resolution_remarks[:100]}..."
            feed_msg = f"{line_1}\n{line_2}\n{line_3}"
            feed_priority = "SUCCESS"
            feed_event_type = "STATUS_CHANGE"

        # CASE D: Default status logic for non-resolution changes
        elif status_changed and not request.is_resolved:
            if request.status in ['Critical', 'Action']:
                line_1 = f"ðŸš¨ CRITICAL STATUS ALERT - {vessel.name}"
                feed_priority = "CRITICAL"
            else:
                line_1 = f"âš ï¸ STATUS CHANGE ALERT - {vessel.name}"
                feed_priority = "WARNING"
            line_2 = f"{request.machinery_name} has moved to {request.status} status."
            line_3 = f"Report Date: {request.sample_date} | Status: {sample.status}"
            feed_msg = f"{line_1}\n{line_2}\n{line_3}"
            feed_event_type = "STATUS_CHANGE"

        # CASE E: Shore User is REOPENING a previously closed issue
        elif is_shore_user and request.is_resolved is False and sample.is_resolved is True:
            sample.is_resolved = False
            if hasattr(sample, 'is_approval_pending'):
                sample.is_approval_pending = False
            
            # Prepare Reopen message for Chat History
            now = datetime.now()
            timestamp = now.strftime("%d/%m/%Y %H:%M")
            sender_name = userData.get('full_name', 'User') if isinstance(userData, dict) else getattr(userData, 'full_name', 'User')
            
            # This preserves old remarks and simply appends the new "REOPENED" status line
            reopen_msg = f"\n[{timestamp}] ðŸ”“ ISSUE REOPENED BY {sender_name}: Follow-up required."
            sample.office_remarks = (sample.office_remarks or "") + reopen_msg
            
            # --- TRIGGER LIVE FEED ---
            line_1 = f"ðŸ”“ ISSUE REOPENED - {vessel.name}"
            line_2 = f"{request.machinery_name} has been reopened by {sender_name} for further action."
            line_3 = f"Original Report: {request.sample_date} | Status: {sample.status}"
            feed_msg = f"{line_1}\n{line_2}\n{line_3}"
            feed_priority = "INFO" # Blue color in feed
            feed_event_type = "STATUS_CHANGE"

        if request.is_image_required is not None or request.is_resampling_required is not None:
            # If this was a fresh toggle (not part of a close/open)
            if not feed_msg:
                try:
                    line_1 = f"REQUIREMENT UPDATED - {vessel.name}"
                    line_2 = f"Requirements updated for {request.machinery_name}."
                    line_3 = f"Image: {'Required' if sample.is_image_required else 'Optional'} | Resample: {'Required' if sample.is_resampling_required else 'Optional'}"
                    feed_msg = f"{line_1}\n{line_2}\n{line_3}"
                    feed_priority = "WARNING"
                    feed_event_type = "MANDATORY"
                except Exception as req_err:
                    logger.error(f"Failed to build requirement feed message: {req_err}")


        if request.status_change_msg:
            current_log = sample.status_change_log or ""
            sample.status_change_log = (current_log + "\n" + request.status_change_msg).strip()

        # =========================================================
        # NOTIFICATION & MY FEED TRIGGER LOGIC (CONFLICT-FREE)
        # =========================================================
        sender_id = userData.get('id') if isinstance(userData, dict) else getattr(userData, 'id', None)
        sender_name = (
            userData.get('full_name') or 
            userData.get('name') or 
            userData.get('username') or
            'User'
        ) if isinstance(userData, dict) else (
            getattr(userData, 'full_name', None) or 
            getattr(userData, 'name', None) or 
            getattr(userData, 'username', None) or 
            'User'
        )
        
        if not sender_name or sender_name == 'User':
            try:
                _name_ctrl = SessionControl()
                try:
                    from app.models.control.user import User as ControlUser
                    import uuid
                    _u = _name_ctrl.query(ControlUser).filter(
                        ControlUser.id == uuid.UUID(str(sender_id))
                    ).first()
                    if _u:
                        sender_name = (
                            _u.full_name or
                            _u.username or
                            _u.first_name or
                            'User'
                        )
                        logger.info(f"Resolved sender_name from DB: {sender_name}")
                    else:
                        logger.warning(f"No user found in control DB for id: {sender_id}")
                finally:
                    _name_ctrl.close()
            except Exception as name_err:
                logger.error(f"Could not fetch sender name: {name_err}", exc_info=True)

        def get_new_message_line(text):
            if not text: return ""
            lines = text.strip().split('\n')
            return lines[-1] if lines else ""

        processed_uids = set()
        try:
            context_data = [
                {'text': get_new_message_line(request.internal_remarks), 'side': 'SHORE'},
                {'text': get_new_message_line(request.office_remarks), 'side': 'VESSEL'}, 
                {'text': get_new_message_line(request.officer_remarks), 'side': 'SHORE'}  
            ]

            for entry in context_data:
                if not entry['text'] or '@' not in entry['text']: continue
                mention_parts = entry['text'].split('@')
                for part in mention_parts[1:]:
                    words = part.split()
                    if not words: continue
                    matched_user = None
                    for length in range(min(len(words), 4), 0, -1):
                        potential_full_name = " ".join(words[:length]).rstrip('.,!?;:')
                        _ctrl = SessionControl()
                        try:
                            user_query = _ctrl.query(User).filter(User.full_name == potential_full_name, User.id != sender_id)
                            if entry['side'] == 'SHORE':
                                user_match = user_query.filter(User.role == 'SHORE').first()
                            else:
                                user_match = user_query.filter(User.role == 'VESSEL', User.vessels.any(Vessel.imo == str(vessel.imo))).first()
                            if not user_match:
                                user_match = user_query.filter(User.vessels.any(Vessel.imo == str(vessel.imo))).first()
                                if not user_match: user_match = user_query.first()
                            if user_match:
                                matched_user = user_match
                        finally:
                            _ctrl.close()
                        if matched_user:
                            break
                    if matched_user and matched_user.id != sender_id and matched_user.id not in processed_uids:
                        db.add(Notification(recipient_id=matched_user.id, sender_name=sender_name, message=f"{sender_name} mentioned you in {request.machinery_name} ({vessel.name})", notification_type="mention", imo=str(vessel.imo), equipment_code=request.machinery_name, is_read=False, created_at=datetime.utcnow()))
                        try:
                            line_1 = f"YOU WERE MENTIONED BY {sender_name.upper()}"
                            msg_snippet = entry['text'].split(': ')[1] if ': ' in entry['text'] else entry['text']
                            line_2 = f"{sender_name} tagged you in a comment for {request.machinery_name}."
                            line_3 = f"Comment: \"{msg_snippet[:100]}...\" | Vessel: {vessel.name}"
                            db.add(LuboilEvent(vessel_name=vessel.name, imo=str(vessel.imo), machinery_name=sample.machinery_name, equipment_code=request.machinery_name, event_type="MENTION", recipient_id=matched_user.id, priority="INFO", message=f"{line_1}\n{line_2}\n{line_3}", sample_id=sample.sample_id, created_at=datetime.utcnow()))
                        except Exception: pass
                        processed_uids.add(matched_user.id)

        except Exception as mention_err:
            logger.error(f"Mention processing failed (non-fatal): {mention_err}", exc_info=True)

        # WORKFLOW NOTIFICATIONS (Approval/Decisions)
        # WORKFLOW NOTIFICATIONS (Approval/Decisions)
        _notif_ctrl = SessionControl()
        try:
            if approval_notif_msg:
                if not is_shore_user:
                    assigned_shore = _notif_ctrl.query(User).filter(
                        User.role == "SHORE",
                        User.vessels.any(Vessel.imo == str(vessel.imo))
                    ).all()
                    for staff in assigned_shore:
                        db.add(Notification(recipient_id=staff.id, sender_name=sender_name, message=approval_notif_msg, notification_type="status_change", imo=str(vessel.imo), equipment_code=request.machinery_name, is_read=False, created_at=datetime.utcnow()))
                else:
                    assigned_vessel = _notif_ctrl.query(User).filter(
                        User.role == "VESSEL",
                        User.vessels.any(Vessel.imo == str(vessel.imo))
                    ).all()
                    for staff in assigned_vessel:
                        db.add(Notification(recipient_id=staff.id, sender_name=sender_name, message=approval_notif_msg, notification_type="status_change", imo=str(vessel.imo), equipment_code=request.machinery_name, is_read=False, created_at=datetime.utcnow()))

            if request.is_image_required is True:
                vessel_staff = _notif_ctrl.query(User).filter(
                    User.role == "VESSEL",
                    User.vessels.any(Vessel.imo == str(vessel.imo))
                ).all()
                for staff in vessel_staff:
                    if str(staff.id) != str(sender_id):
                        db.add(Notification(recipient_id=staff.id, sender_name=sender_name, message=f"Mandatory Image requested: {request.machinery_name} ({vessel.name})", notification_type="mandatory", imo=str(vessel.imo), equipment_code=request.machinery_name, is_read=False, created_at=datetime.utcnow()))

            if request.is_resampling_required is True:
                vessel_staff = _notif_ctrl.query(User).filter(
                    User.role == "VESSEL",
                    User.vessels.any(Vessel.imo == str(vessel.imo))
                ).all()
                for staff in vessel_staff:
                    if str(staff.id) != str(sender_id):
                        db.add(Notification(recipient_id=staff.id, sender_name=sender_name, message=f"Mandatory Resample requested: {request.machinery_name} ({vessel.name})", notification_type="mandatory", imo=str(vessel.imo), equipment_code=request.machinery_name, is_read=False, created_at=datetime.utcnow()))
        except Exception as notif_err:
            logger.error(f"Notification dispatch failed (non-fatal): {notif_err}", exc_info=True)
        finally:
            _notif_ctrl.close()

        # Live Feed Commitment
        if feed_msg:
            try:
                db.add(LuboilEvent(
                    vessel_name=vessel.name,
                    imo=str(vessel.imo),
                    machinery_name=sample.machinery_name or request.machinery_name,
                    equipment_code=request.machinery_name,
                    event_type=feed_event_type,
                    priority=feed_priority,
                    message=feed_msg,
                    sample_id=sample.sample_id,
                    created_at=datetime.utcnow()
                ))
            except Exception as feed_err:
                logger.error(f"Live feed commit failed (non-fatal): {feed_err}", exc_info=True)

        await db.commit()

        # 4. REBUILD HISTORY
        res = await db.execute(sa_select(LuboilSample).where(LuboilSample.sample_id == sample.sample_id))
        history_sample = res.scalars().first()
        updated_conversation = []
        unique_tracker = set()

        def extract_messages(raw_text, role, default_date_obj, is_internal=False):
            if not raw_text: return
            for line in raw_text.split('\n'):
                clean = line.strip()
                if not clean: continue
                match = re.match(r"^\[(.*?)\]\s*(.*)", clean)
                msg_text = clean
                msg_date_str = default_date_obj.strftime("%Y-%m-%d 00:00")
                if match:
                    date_part, text_part = match.groups()
                    msg_text = text_part
                    for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                        try:
                            d = datetime.strptime(date_part, fmt)
                            msg_date_str = d.strftime("%Y-%m-%d %H:%M")
                            break
                        except ValueError: continue
                if "ATTACHED_IMAGE:" in msg_text:
                    try:
                        parts = msg_text.split("ATTACHED_IMAGE: ")
                        if len(parts) > 1:
                            raw_blob_url = parts[1].strip().split('?')[0]
                            from app.blob_storage import generate_sas_url
                            signed_url = generate_sas_url(raw_blob_url)
                            msg_text = f"ATTACHED_IMAGE: {signed_url}"
                    except Exception: pass
                unique_key = f"{msg_date_str}|{role}|{msg_text}"
                if unique_key not in unique_tracker:
                    unique_tracker.add(unique_key)
                    updated_conversation.append({"date": msg_date_str, "role": role, "message": msg_text, "is_internal": is_internal})

        if history_sample:
            extract_messages(history_sample.officer_remarks, "Vessel", history_sample.sample_date, is_internal=False)
            extract_messages(history_sample.office_remarks, "Office", history_sample.sample_date, is_internal=False)
            extract_messages(history_sample.internal_remarks, "Office", history_sample.sample_date, is_internal=True)
            extract_messages(history_sample.status_change_log, "System", history_sample.sample_date, is_internal=False)
            if history_sample.attachment_url:
                from app.api import inject_attachments_to_chat
                inject_attachments_to_chat(history_sample.attachment_url, history_sample.sample_date, updated_conversation, history_sample.status_change_log)

        updated_conversation.sort(key=lambda x: x['date'])

        return {
            "message": "Remarks updated successfully",
            "updated_conversation": updated_conversation,
            "is_resolved": sample.is_resolved,
            "is_approval_pending": getattr(sample, 'is_approval_pending', False)
        }

    except HTTPException as he: raise he
    except Exception as e:
        logger.error(f"âŒ [DB ERROR] update failed: {e}", exc_info=True)
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/fleet/luboil-overview", tags=["Lube Oil"])
async def get_luboil_fleet_overview(
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) # ðŸ”¥ ADD THIS LINE HERE
):
    """
    Returns Fleet Matrix with DYNAMIC ROWS & COLUMNS.
    âœ… UPDATED: Each history item now contains its own remarks/attachments to isolate chats.
    âœ… UPDATED: Machine-level conversation is isolated to the latest sample only.
    âœ… NEW: Per-equipment automatic overdue (15 days) & resampling triggers (15 days).
    """
    from collections import defaultdict
    import re
    from datetime import datetime, timedelta  # Ensure timedelta is imported
    
    try:
        # ðŸ”¥ SECURITY GATE: Determine which IMOs this user is allowed to see
        allowed_imos, user_role = get_allowed_vessel_imos(db, current_user)
        logger.info(f"DEBUG allowed_imos: {allowed_imos}, role: {user_role}")

        from app.core.database_control import SessionControl, engine_control
        logger.info(f"DEBUG control DB URL: {engine_control.url}")
        control_db = SessionControl()
        try:
            test = control_db.execute(text("SELECT current_database()")).scalar()
            logger.info(f"DEBUG control DB name: {test}")
        finally:
            control_db.close()
        if not allowed_imos:
            return {
                "columns": [],
                "column_labels": {},
                "data": {}
            }
        # 1. Fetch Master Data & Vessels (RESTRICTED)
        from app.core.database_control import SessionControl
        from app.models.control.vessel import Vessel as ControlVessel
        control_db = SessionControl()
        try:
            vessels = control_db.query(ControlVessel).filter(
                ControlVessel.imo.in_(allowed_imos)
            ).order_by(ControlVessel.name).all()
        finally:
            control_db.close()

        res = await db.execute(sa_select(LuboilEquipmentType).order_by(LuboilEquipmentType.sort_order))
        all_master_equipment = res.scalars().all()

        res = await db.execute(
            sa_select(LuboilVesselConfig.imo_number, LuboilVesselConfig.equipment_code, LuboilVesselConfig.lab_analyst_code)
            .where(LuboilVesselConfig.is_active == True)
            .where(LuboilVesselConfig.imo_number.in_(allowed_imos))
        )
        active_configs = res.all()
        
        config_map = {
            (r.imo_number, r.equipment_code): r.lab_analyst_code 
            for r in active_configs
        }

        # Filter Columns based on Usage
        active_codes_global = {r.equipment_code for r in active_configs}
        
        # ðŸ”¥ FIX: Use the 'role' variable we captured above
        if user_role in ["admin", "superuser"]:
            visible_equipment = all_master_equipment
        else:
            visible_equipment = [eq for eq in all_master_equipment if eq.code in active_codes_global]
        
        # Fallback if list is empty
        if not visible_equipment:
            visible_equipment = all_master_equipment

        # 3. Fetch ALL Samples (RESTRICTED via Join)
        res = await db.execute(
            sa_select(
                LuboilReport.imo_number,
                LuboilReport.report_url,
                LuboilSample.equipment_code,
                LuboilSample.machinery_name,
                LuboilSample.status,
                LuboilSample.sample_date,
                LuboilReport.report_date,
                LuboilSample.sample_id,
                LuboilSample.officer_remarks,
                LuboilSample.office_remarks,
                LuboilSample.internal_remarks,
                LuboilSample.status_change_log,
                LuboilSample.viscosity_100c,
                LuboilSample.water_content_pct,
                LuboilSample.lab_diagnosis,
                LuboilSample.summary_error,
                LuboilSample.attachment_url,
                LuboilSample.is_image_required,
                LuboilSample.is_resampling_required,
                LuboilSample.is_resolved,
                LuboilSample.resolution_remarks,
                LuboilSample.is_approval_pending,
                LuboilSample.pdf_page_index,
                LuboilSample.viscosity_40c,
                LuboilSample.tan,
                LuboilSample.tbn
            )
            .join(LuboilReport, LuboilSample.report_id == LuboilReport.report_id)
            .where(LuboilReport.imo_number.in_(allowed_imos))
            .order_by(LuboilSample.sample_date.desc())
        )
        raw_samples = res.all()

        # 4. Group Samples
        sample_map = defaultdict(list)
        for s in raw_samples:
            if s.equipment_code:
                sample_map[(s.imo_number, s.equipment_code)].append(s)

        # Robust Conversation Builder
        def build_full_conversation(history_list):
            conversation_list = []
            unique_tracker = set()

            def extract_messages(raw_text, role, default_date_obj, is_internal=False):
                if not raw_text: return
                lines = raw_text.split('\n')
                for line in lines:
                    clean = line.strip()
                    if not clean: continue
                    
                    match = re.match(r"^\[(.*?)\]\s*(.*)", clean)
                    msg_text = clean
                    msg_date_str = None

                    if match:
                        date_part, text_part = match.groups()
                        msg_text = text_part
                        for fmt in ("%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                            try:
                                d = datetime.strptime(date_part, fmt)
                                msg_date_str = d.strftime("%Y-%m-%d %H:%M")
                                break
                            except ValueError:
                                continue
                    
                    if not msg_date_str:
                        msg_date_str = default_date_obj.strftime("%Y-%m-%d 00:00")

                    if "ATTACHED_IMAGE:" in msg_text:
                        try:
                            parts = msg_text.split("ATTACHED_IMAGE: ")
                            if len(parts) > 1:
                                raw_blob_url = parts[1].strip().split('?')[0]
                                secure_url = generate_sas_url(raw_blob_url)
                                msg_text = f"ATTACHED_IMAGE: {secure_url}"
                        except Exception as e:
                            logger.error(f"Failed to sign image: {e}")

                    unique_key = f"{msg_date_str}|{role}|{msg_text}"
                    if unique_key not in unique_tracker:
                        unique_tracker.add(unique_key)
                        conversation_list.append({
                            "date": msg_date_str,
                            "role": role,
                            "message": msg_text,
                            "is_internal": is_internal
                        })

            for sample in history_list:
                extract_messages(sample.officer_remarks, "Vessel", sample.sample_date)
                extract_messages(sample.office_remarks, "Office", sample.sample_date)
                extract_messages(sample.status_change_log, "System", sample.sample_date)
                extract_messages(sample.internal_remarks, "Office", sample.sample_date, is_internal=True)

                if sample.attachment_url:
                    inject_attachments_to_chat(sample.attachment_url, sample.sample_date, conversation_list, sample.status_change_log)

            conversation_list.sort(key=lambda x: x['date'])
            return conversation_list

        # 5. Build the Matrix
        matrix_rows = {}
        columns_list = [eq.code for eq in visible_equipment]
        column_labels = {eq.code: eq.code for eq in visible_equipment}

        for v in vessels:
            row_data = {
                "imo": v.imo, # imo_number -> imo
                "vessel_report_url": getattr(v, 'vessel_report_url', None),
                "machineries": {}
            }
            vessel_has_data = False

            for eq in visible_equipment:
                code = eq.code
                is_configured = (v.imo, code) in config_map
                history_list = sample_map.get((v.imo, code), [])
                latest_sample = history_list[0] if history_list else None
                analyst_code = config_map.get((v.imo, code))

                cell_data = {
                    "code": code,
                    "analyst_code": analyst_code,
                    "imo": v.imo,    
                    "name": eq.code,
                    "description": eq.ui_label,
                    "interval": eq.default_interval_months,
                    "is_configured": is_configured,
                    "history": [],
                    "report_url": None
                }

                if not is_configured:
                    cell_data["status"] = "N/A"
                    cell_data["has_report"] = False
                elif latest_sample:
                    vessel_has_data = True 

                    # =========================================================
                    # ðŸ”¥ UPDATED: AUTOMATIC 15-DAY RECURRING FEED TRIGGERS
                    # =========================================================
                    interval_months = eq.default_interval_months or 3
                    limit_days = interval_months * 30
                    warning_threshold = limit_days + 30  
                    critical_threshold = limit_days + 60 

                    days_elapsed = (datetime.now().date() - latest_sample.sample_date).days
                    excess_days = days_elapsed - limit_days

                    # --- 1. OVERDUE LOGIC (Every 15 Days) ---
                    target_priority = None
                    if days_elapsed > critical_threshold:
                        target_priority = "CRITICAL"
                    elif days_elapsed > warning_threshold:
                        target_priority = "WARNING"

                    if target_priority:
                        # CHANGE: Set cooldown to 15 days
                        cooldown_overdue = datetime.utcnow() - timedelta(days=15)
                        
                        res = await db.execute(
                            sa_select(LuboilEvent)
                            .where(LuboilEvent.imo == v.imo)
                            .where(LuboilEvent.equipment_code == code)
                            .where(LuboilEvent.event_type == "SCHEDULE_ALERT")
                            .where(LuboilEvent.created_at >= cooldown_overdue)
                        )
                        existing_alert = res.scalars().first()

                        if not existing_alert:
                            clean_v_name = format_vessel_name(v.name)
                            line_1 = f"SCHEDULE ALERT ({target_priority}) - {clean_v_name.upper()}" 
                            status_text = "CRITICAL OVERDUE (>60 days)" if target_priority == "CRITICAL" else "OVERDUE (>30 days)"
                            line_2 = f"{eq.ui_label} is now {status_text} (Overdue by {excess_days} days)."
                            line_3 = f"Report Date: {latest_sample.sample_date} | Status: {latest_sample.status}"
                            
                            db.add(LuboilEvent(
                                vessel_name=v.name,
                                imo=v.imo,
                                machinery_name=eq.ui_label,
                                equipment_code=code,
                                event_type="SCHEDULE_ALERT",
                                priority=target_priority,
                                message=f"{line_1}\n{line_2}\n{line_3}",
                                sample_id=latest_sample.sample_id,
                                created_at=datetime.utcnow()
                            ))
                            await db.commit()

                    # --- 2. RESAMPLING MANDATORY REMINDER (Every 15 Days until Resolved) ---
                    if latest_sample.is_resampling_required and not latest_sample.is_resolved:
                        # Set cooldown to 15 days
                        cooldown_resample = datetime.utcnow() - timedelta(days=15)
                        
                        res = await db.execute(
                            sa_select(LuboilEvent)
                            .where(LuboilEvent.imo == v.imo)
                            .where(LuboilEvent.equipment_code == code)
                            .where(LuboilEvent.event_type == "RESAMPLE_REMINDER")
                            .where(LuboilEvent.created_at >= cooldown_resample)
                        )
                        existing_resample = res.scalars().first()

                        if not existing_resample:
                            clean_v_name = format_vessel_name(v.name)
                            line_1 = f"ðŸ”„ RESAMPLE REMINDER - {clean_v_name.upper()}"
                            line_2 = f"A mandatory resampling for {eq.ui_label} is still PENDING."
                            line_3 = f"Last Report: {latest_sample.sample_date} | Instruction: Provide follow-up sample."
                            
                            db.add(LuboilEvent(
                                vessel_name=v.name,
                                imo=v.imo,
                                machinery_name=eq.ui_label,
                                equipment_code=code,
                                event_type="RESAMPLE_REMINDER",
                                priority="WARNING",
                                message=f"{line_1}\n{line_2}\n{line_3}",
                                sample_id=latest_sample.sample_id,
                                created_at=datetime.utcnow()
                            ))
                            await db.commit()
                    # =========================================================
                    
                    processed_history = [
                        {
                            "date": h.sample_date.strftime("%Y-%m-%d"), 
                            "report_date": h.report_date.strftime("%Y-%m-%d") if h.report_date else None,
                            "status": h.status,
                            "sample_id": h.sample_id,
                            "officer_remarks": h.officer_remarks,
                            "office_remarks": h.office_remarks,
                            "internal_remarks": h.internal_remarks,
                            "status_change_log": h.status_change_log,
                            "attachment_url": h.attachment_url,
                            "diagnosis": h.lab_diagnosis,
                            "is_image_required": h.is_image_required, 
                            "is_resolved": h.is_resolved,
                            "is_approval_pending": h.is_approval_pending,
                            "is_resampling_required": h.is_resampling_required,
                            "summary_error": h.summary_error,
                            "pdf_page_index": h.pdf_page_index,
                            "viscosity": float(h.viscosity_100c) if h.viscosity_100c else None,
                            "water": float(h.water_content_pct) if h.water_content_pct else None,
                            "report_url": generate_sas_url(h.report_url) if h.report_url else None
                        } for h in history_list[:10]
                    ]

                    secure_report_url = generate_sas_url(latest_sample.report_url) if latest_sample.report_url else None
                    full_conversation = build_full_conversation([latest_sample])

                    cell_data.update({
                        "sample_id": latest_sample.sample_id,
                        "status": latest_sample.status,
                        "diagnosis": latest_sample.lab_diagnosis,
                        "summary_error": latest_sample.summary_error, 
                        "last_sample": latest_sample.sample_date.strftime("%Y-%m-%d"),
                        "report_date": latest_sample.report_date.strftime("%Y-%m-%d") if latest_sample.report_date else None,
                        "has_report": True,
                        "report_url": secure_report_url,
                        "officer_remarks": latest_sample.officer_remarks,
                        "office_remarks": latest_sample.office_remarks,
                        "internal_remarks": latest_sample.internal_remarks,
                        "status_change_log": latest_sample.status_change_log,
                        "attachment_url": latest_sample.attachment_url,
                        "viscosity": float(latest_sample.viscosity_100c) if latest_sample.viscosity_100c else None,
                        "water": float(latest_sample.water_content_pct) if latest_sample.water_content_pct else None,
                        "conversation": full_conversation,
                        "history": processed_history,
                        "is_image_required": latest_sample.is_image_required,
                        "is_resampling_required": latest_sample.is_resampling_required,
                        "is_resolved": latest_sample.is_resolved,
                        "resolution_remarks": latest_sample.resolution_remarks,
                        "is_approval_pending": latest_sample.is_approval_pending
                    })
                else:
                    cell_data.update({
                        "status": "Missing",
                        "has_report": False,
                        "last_sample": None,
                        "history": []
                    })
                row_data["machineries"][code] = cell_data

            matrix_rows[format_vessel_name(v.name)] = row_data 


        return {
            "columns": columns_list,
            "column_labels": column_labels,
            "data": matrix_rows
        }

    except Exception as e:
        logger.error(f"Error generating Luboil Fleet Overview: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")

    
# ============================================
# ADMIN DATA SYNC ENDPOINT
# ============================================
@app.post("/api/admin/data-sync", tags=["Admin"])
def admin_data_sync(
    file: UploadFile = File(...),
    engine_type: str = Form(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin endpoint to sync Excel data.
    """
    logger.info(f"Admin Data Sync initiated for {engine_type} with file: {file.filename}")
    
    if not file.filename.lower().endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only Excel files allowed.")

    temp_file_path = None
    try:
        # 1. Save uploaded file to temp disk
        suffix = ".xlsx" if file.filename.endswith(".xlsx") else ".xls"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            shutil.copyfileobj(file.file, tmp)
            temp_file_path = tmp.name

        # 2. Run the Loader Script Logic
        success = False
        
        if engine_type == 'mainEngine':
            # create_tables=False prevents "Table already exists" errors
            success = load_excel_to_database(
                excel_path=temp_file_path,
                ae_excel_path=None,
                create_tables=False, 
                dry_run=False
            )
        elif engine_type == 'auxiliaryEngine':
            success = load_excel_to_database(
                excel_path=None,
                ae_excel_path=temp_file_path,
                create_tables=False, 
                dry_run=False
            )
        elif engine_type == 'luboilConfig':
            success = load_luboil_config(temp_file_path)
        else:
            raise HTTPException(status_code=400, detail="Invalid engine type.")

        # --- SAFETY CHECK ---
        # If the script ran but forgot to return True (returns None), treat it as success to avoid 500 Error
        if success is None:
            logger.warning(f"Script for {engine_type} finished but returned None. Assuming success.")
            success = True

        if success:
            logger.info(f"âœ… Data Sync Successful for {engine_type}")
            return {"message": f"âœ… Successfully synced {engine_type} data."}
        else:
            logger.error("âŒ Data sync script returned explicit False.")
            raise HTTPException(status_code=500, detail="Script failed to load data (returned False). Check logs.")

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Sync Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        # 3. Cleanup temp file (Windows Safe)
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.remove(temp_file_path)
            except Exception as e:
                # Log warning but do NOT crash the request
                logger.warning(f"Windows file lock prevented deleting temp file: {e}")


# --- Add this to app/api.py ---
class BatchDownloadRequest(BaseModel):
    report_ids: List[int]
    engine_type: str

@app.post("/api/performance/batch-raw-download-links")
async def get_batch_raw_download_links(
    request: BatchDownloadRequest,
    db: AsyncSession = Depends(get_db)
):
    """Fetches multiple secure SAS URLs at once."""
    results = []
    model = MonthlyReportHeader if request.engine_type == 'mainEngine' else GeneratorMonthlyReportHeader
    
    res = await db.execute(sa_select(model).where(model.report_id.in_(request.report_ids)))
    reports = res.scalars().all()
    
    for r in reports:
        if r.raw_report_url:
            # Determine filename
            v_name = "Ship"
            if request.engine_type == 'mainEngine':
                v_name = r.vessel.name if r.vessel else "ME"
            else:
                v_name = r.generator.designation if r.generator else "AE"
            
            clean_filename = f"{v_name.replace(' ', '_')}_Report_{r.report_id}.pdf"
            secure_url = generate_sas_url(r.raw_report_url, download_name=clean_filename)
            results.append(secure_url)
            
    return {"urls": results}

@app.post("/api/performance/batch-download-zip")
async def download_reports_zip(
    request: BatchDownloadRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) # ðŸ”¥ ADD THIS
):
    allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
    # 1. Determine the Model (Expanded to support all 3 types)
    if request.engine_type == 'mainEngine':
        model = MonthlyReportHeader
    elif request.engine_type == 'auxiliaryEngine':
        model = GeneratorMonthlyReportHeader
    elif request.engine_type == 'lubeOil':
        model = LuboilReport
    else:
        raise HTTPException(status_code=400, detail="Invalid engine type")

    res = await db.execute(sa_select(model).where(model.report_id.in_(request.report_ids)))
    reports = res.scalars().all()

    if request.engine_type == 'lubeOil':
        for r in reports:
            if str(r.imo_number) not in [str(x) for x in allowed_imos]:
                raise HTTPException(status_code=403, detail=f"Unauthorized to download report for IMO {r.imo_number}")


    if not reports:
        raise HTTPException(status_code=404, detail="No reports found")

    zip_buffer = io.BytesIO()
    
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for r in reports:
            # 2. Extract the correct URL attribute
            # Main/Aux Engine use 'raw_report_url', Lube Oil uses 'report_url'
            url = getattr(r, 'raw_report_url', None) or getattr(r, 'report_url', None)

            if url:
                try:
                    from app.blob_storage import download_blob_bytes 
                    file_bytes = download_blob_bytes(url)
                    
                    # 3. Differentiated Filename Logic per Engine Type
                    if request.engine_type == 'mainEngine':
                        v_name = r.vessel.name if r.vessel else f"Vessel_{r.imo_number}"
                        clean_vname = v_name.replace(' ', '_').replace('/', '-')
                        filename = f"{clean_vname}_ME_Report_{r.report_month}.pdf"
                    
                    elif request.engine_type == 'auxiliaryEngine':
                        v_name = r.generator.designation if r.generator else f"Gen_{r.generator_id}"
                        clean_vname = v_name.replace(' ', '_').replace('/', '-')
                        filename = f"{clean_vname}_AE_Report_{r.report_month}.pdf"

                    elif request.engine_type == 'lubeOil':
                            v_name = f"IMO_{r.imo_number}"
                            report_date_str = r.report_date.strftime("%Y-%m-%d") if r.report_date else "unknown"
                            filename = f"{v_name}_LubeReport_{report_date_str}.pdf"
                    
                    zip_file.writestr(filename, file_bytes)
                except Exception as e:
                    logger.error(f"Failed to add {url} to zip: {e}")

    zip_buffer.seek(0)
    # Use a dynamic name for the zip itself
    zip_name = f"Reports_Batch_{datetime.now().strftime('%Y%m%d')}.zip"
    
    return StreamingResponse(
        zip_buffer,
        media_type="application/x-zip-compressed",
        headers={"Content-Disposition": f"attachment; filename={zip_name}"}
    )


@app.get("/api/v1/luboil/trend/{imo}/{equipment_code}", tags=["Lube Oil"])
async def get_luboil_machinery_trend(
    imo: int, 
    equipment_code: str, 
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) # ðŸ”¥ ADD THIS
):
    """
    Fetches historical chemistry data for a specific machinery over the last year.
    """

    allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
    if str(imo) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")

    three_years_ago = datetime.now() - timedelta(days=1095) 
    
    res = await db.execute(
        sa_select(LuboilSample)
        .join(LuboilReport, LuboilSample.report_id == LuboilReport.report_id)
        .where(LuboilReport.imo_number == str(imo))
        .where(LuboilSample.equipment_code == equipment_code)
        .where(LuboilSample.sample_date >= three_years_ago)
        .order_by(LuboilSample.sample_date.asc())
    )
    results = res.scalars().all()

    # Format the data for charting libraries
    history = []
    for s in results:
        history.append({
            "date": s.sample_date.isoformat(),
            "status": s.status,
            # Physical
            "viscosity_40c": float(s.viscosity_40c) if s.viscosity_40c else None,
            "tan": float(s.tan) if s.tan else None,
            "tbn": float(s.tbn) if s.tbn else None,
            # Wear
            "iron": s.iron,
            "copper": s.copper,
            "aluminium": s.aluminium,
            "wpi_index": s.wpi_index,
            # Contamination
            "water": float(s.water_content_pct) if s.water_content_pct else 0,
            "sodium": s.sodium,
            "silicon": s.silicon,
            # Additives
            "calcium": float(s.calcium) if s.calcium else None,
            "zinc": float(s.zinc) if s.zinc else None,
            "magnesium": s.magnesium
        })
    
    return history

@app.post("/api/luboil/upload-attachment")
async def upload_luboil_attachment(
    file: UploadFile = File(...),
    imo: int = Form(...),
    equipment_code: str = Form(...),
    sample_date: str = Form(...),
    sample_id: Optional[int] = Form(None), # Targeted Sample ID from Frontend
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) # ðŸ”¥ Added uploader dependency
):

    allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
    if str(imo) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")
    try:
        contents = await file.read()
        
        if len(contents) > 1 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds the 1MB limit.")
        # Create a clean folder path
        folder_path = f"lube_oil/attachments/{imo}/{equipment_code}"
        
        # Clean the filename to prevent issues with special characters
        clean_filename = file.filename.replace(" ", "_").replace("(", "").replace(")", "")
        filename = f"{sample_date}_{clean_filename}"
        
        # 1. Upload to Azure (returns the raw private URL)
        blob_url = upload_file_to_azure(contents, filename, folder_path)
        
        if not blob_url:
            raise HTTPException(status_code=500, detail="Failed to upload file to Azure Storage")

        # 2. Find the specific machinery sample record
        sample = None
        if sample_id:
            res = await db.execute(sa_select(LuboilSample).where(LuboilSample.sample_id == sample_id))
            sample = res.scalars().first()

        if not sample:
            res = await db.execute(
                sa_select(LuboilSample)
                .join(LuboilReport)
                .where(LuboilReport.imo_number == str(imo))
                .where(LuboilSample.equipment_code == equipment_code)
                .where(LuboilSample.sample_date == sample_date)
            )
            sample = res.scalars().first()
        
        if sample:
            # 3. Store the raw URL in the database (APPEND logic for multiple files)
            if sample.attachment_url:
                existing_urls = sample.attachment_url.split('|')
                if blob_url not in existing_urls:
                    sample.attachment_url = f"{sample.attachment_url}|{blob_url}"
            else:
                sample.attachment_url = blob_url
            
            # Clear the mandatory requirement flag
            # sample.is_image_required = False 

            # =========================================================
            # ðŸ”¥ RESTRUCTURED LIVE FEED TRIGGER
            # =========================================================
            try:
                # Identify uploader name from current_user
                sender_name = current_user.get('full_name', 'User') if isinstance(current_user, dict) else getattr(current_user, 'full_name', 'User')
                
                vessel_name = "Vessel"
                if sample.report and sample.report.vessel:
                    vessel_name = sample.report.vessel.name
                
                # Create the two-line structure (Header \n Body)
                line_1 = f"ðŸ“Ž EVIDENCE UPLOADED BY {sender_name.upper()}"
                line_2 = f"New evidence provided for {equipment_code} on {vessel_name}."
                full_feed_msg = f"{line_1}\n{line_2}" 

                db.add(LuboilEvent(
                    vessel_name=vessel_name,
                    imo=imo,
                    machinery_name=sample.machinery_name or equipment_code,
                    equipment_code=equipment_code,
                    event_type="EVIDENCE_UPLOAD",
                    priority="SUCCESS",
                    message=full_feed_msg, # Restructured message
                    sample_id=sample.sample_id,
                    created_at=datetime.utcnow()
                ))
                logger.info(f"ðŸ“¡ Live Feed triggered for evidence upload by {sender_name}")
            except Exception as feed_err:
                logger.error(f"âš ï¸ Failed to add evidence event to Live Feed: {feed_err}")
            
            await db.commit()
            
            # 4. Generate a signed SAS URL for the file just uploaded
            signed_url = generate_sas_url(blob_url)
            
            logger.info(f"âœ… Attachment uploaded and linked to Sample ID {sample.sample_id}: {filename}")
            
            return {
                "status": "success",
                "url": signed_url,
                "sample_id": sample.sample_id,
                "message": "File uploaded and added to evidence."
            }
        else:
            logger.error(f"âŒ Sample not found for SampleID: {sample_id} or IMO: {imo}, Code: {equipment_code}, Date: {sample_date}")
            raise HTTPException(status_code=404, detail="Machinery sample record not found")
                
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"âŒ Upload attachment failed: {str(e)}", exc_info=True)
        await db.rollback() 
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/api/blob/freshen-url")
async def freshen_blob_url(blob_url: str, db: AsyncSession = Depends(get_db)):
    """Generate a fresh SAS token for an existing Azure Blob URL (used when cached tokens expire)"""
    try:
        # Strip any existing expired SAS token (?sv=...) - keep only the base blob URL
        base_url = blob_url.split('?')[0]
        
        if not base_url.startswith("https://"):
            raise HTTPException(status_code=400, detail="Invalid blob URL")
        
        fresh_url = generate_sas_url(base_url)
        
        if not fresh_url:
            raise HTTPException(status_code=500, detail="Could not generate signed URL")
        
        return {"signed_url": fresh_url}
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error freshening blob URL: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/luboil/view-specific-page/{sample_id}")
async def get_specific_page_pdf(
    sample_id: int, 
    db: AsyncSession = Depends(get_db)
):
    # 1. DATA RETRIEVAL (No Auth/Token logic needed)
    res = await db.execute(sa_select(LuboilSample).where(LuboilSample.sample_id == sample_id))
    sample = res.scalars().first()
    if not sample or sample.pdf_page_index is None:
        raise HTTPException(status_code=404, detail="Sample or Page Index not found")

    res = await db.execute(sa_select(LuboilReport).where(LuboilReport.report_id == sample.report_id))
    report = res.scalars().first()
    if not report:
        raise HTTPException(status_code=404, detail="Report file not found")

    # 2. PDF PROCESSING (Preserved exactly as before)
    try:
        from app.blob_storage import download_blob_bytes 
        full_pdf_bytes = download_blob_bytes(report.report_url)
        
        reader = PdfReader(io.BytesIO(full_pdf_bytes))
        writer = PdfWriter()
        
        # Add the specific page (0-based index)
        writer.add_page(reader.pages[sample.pdf_page_index]) 
        
        output_stream = io.BytesIO()
        writer.write(output_stream)
        output_stream.seek(0)

        return StreamingResponse(
            output_stream,
            media_type="application/pdf",
            headers={"Content-Disposition": "inline"}
        )
    except Exception as e:
        logger.error(f"Slicing error: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to process PDF")


# --- ADD THIS TO app/api.py ---

@app.get("/api/luboil/mentions/{imo}", tags=["Lube Oil"])
async def get_vessel_mentions(
    imo: int, 
    chat_mode: str = "external", # "external" or "internal"
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user) # ðŸ”¥ Added auth dependency
):
    """
    Returns users assigned to a specific vessel for tagging, 
    excluding the currently logged-in user.
    """

    allowed_imos, _ = get_allowed_vessel_imos(db, current_user)
    if str(imo) not in [str(x) for x in allowed_imos]:
        raise HTTPException(status_code=403, detail="Access Denied")

    from app.models.control.user import User
    
    # 1. Robustly extract the current user's ID (handles both object and dict types)
    current_user_id = None
    if hasattr(current_user, 'id'):
        current_user_id = current_user.id
    elif isinstance(current_user, dict):
        current_user_id = current_user.get('id') or current_user.get('sub') or current_user.get('user_id')

        # 2. Query control DB for users assigned to this vessel
    from app.models.control.associations import user_vessel_link
    control_db = SessionControl()
    try:
        query = control_db.query(User).join(
            user_vessel_link, User.id == user_vessel_link.c.user_id
        ).filter(user_vessel_link.c.vessel_imo == str(imo))

        # 3. Exclude self
        if current_user_id is not None:
            query = query.filter(User.id != current_user_id)

        # 4. Internal mode: shore only
        if chat_mode == "internal":
            # Match the exact roles from your new table data
            query = query.filter(User.role.in_(["SHORE", "ADMIN", "SUPERUSER", "SUPERINTENDENT"]))


        users = query.all()
    finally:
        control_db.close()

    # 5. Return formatted list
    return [
        {
            "id": u.id,
            "full_name": u.full_name,
            "job_title": getattr(u, 'job_title', None) or "Staff",
            "role": u.role
        } for u in users
    ]

@app.get("/api/notifications", tags=["Notifications"])
async def get_notifications(
    db: AsyncSession = Depends(get_db), 
    current_user: Any = Depends(auth.get_current_user)
):
    from app.luboil_model import Notification
    
    # ðŸ”¥ FIX: Robust ID detection (Handles both Object and Dictionary)
    user_id = None
    if hasattr(current_user, 'id'):
        user_id = current_user.get("id")
    elif isinstance(current_user, dict):
        user_id = current_user.get('id') or current_user.get('sub') or current_user.get('user_id')

    if user_id is None:
        logger.error(f"âŒ Could not find ID in current_user. Type: {type(current_user)}")
        return {"notifications": [], "unread_count": 0}

    # Ensure it is an integer for the database query
    user_id = str(user_id)

    # Query notifications for Seenu (or whoever is logged in)
    res = await db.execute(
        sa_select(Notification)
        .where(Notification.recipient_id == user_id)
        .where(Notification.is_hidden == False)
        .order_by(desc(Notification.created_at))
    )
    notif_records = res.scalars().all()

    res = await db.execute(
        sa_select(func.count()).select_from(Notification)
        .where(Notification.recipient_id == user_id)
        .where(Notification.is_read == False)
        .where(Notification.is_hidden == False)
    )
    unread_count = res.scalar()

    # Explicit conversion to clean JSON list
    formatted_notifs = []
    for n in notif_records:
        formatted_notifs.append({
            "id": n.id,
            "sender_name": n.sender_name,
            "message": n.message,
            "notification_type": n.notification_type,
            "imo": n.imo,
            "equipment_code": n.equipment_code,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat() if n.created_at else None
        })
    
    return {
        "notifications": formatted_notifs,
        "unread_count": unread_count
    }

@app.patch("/api/notifications/{notif_id}/read", tags=["Notifications"])
async def mark_notification_read(notif_id: int, db: AsyncSession = Depends(get_db)):
    """Clear the notification badge by marking it as read."""
    res = await db.execute(sa_select(Notification).where(Notification.id == notif_id))
    notif = res.scalars().first()
    if notif:
        notif.is_read = True
        await db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Notification not found")

@app.get("/api/luboil/live-feed", tags=["Lube Oil"])
async def get_luboil_live_feed(
    feed_mode: str = "FLEET",  # "FLEET" or "MY_FEED"
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    # 1. ROBUST USER ID EXTRACTION
    user_id = None
    if hasattr(current_user, 'id'):
        user_id = current_user.get("id")
    elif isinstance(current_user, dict):
        user_id = current_user.get('id') or current_user.get('user_id') or current_user.get('sub')

    if user_id is None:
        logger.error(f"âŒ User ID not found in current_user context")
        return []

    try:
        user_id = str(user_id)
    except (ValueError, TypeError):
        logger.error(f"âŒ Could not cast User ID {user_id} to integer")
        return []

    # --- ðŸ”¥ DETERMINING ALLOWED VESSELS BASED ON ROLE ---
    allowed_imos, _ = get_allowed_vessel_imos(db, current_user)

    # 2. BASE QUERY CONSTRUCTION
    stmt = (
        sa_select(LuboilEvent, LuboilEventReadState.is_read)
        .outerjoin(
            LuboilEventReadState,
            and_(
                LuboilEventReadState.event_id == LuboilEvent.event_id,
                LuboilEventReadState.user_id == user_id
            )
        )
        .where(LuboilEvent.imo.in_(allowed_imos))
    )

    if feed_mode == "MY_FEED":
        stmt = stmt.where(LuboilEvent.recipient_id == user_id)
    else:
        stmt = stmt.where(LuboilEvent.recipient_id == None)

    stmt = stmt.order_by(desc(LuboilEvent.created_at))
    results = (await db.execute(stmt)).all()

    events = []
    for event, is_read in results:
        events.append({
            "id": event.event_id,
            "vessel_name": format_vessel_name(event.vessel_name),
            "machinery_name": event.machinery_name,
            "equipment_code": event.equipment_code,
            "priority": event.priority,
            "message": event.message,
            "event_type": event.event_type,
            "is_read": is_read if is_read is not None else False,
            "created_at": event.created_at.isoformat(),
            "sample_id": event.sample_id,
            "imo": event.imo,
            "recipient_id": event.recipient_id 
        })
    
    return events

@app.patch("/api/luboil/live-feed/{event_id}/read")
async def mark_event_read(
    event_id: int, 
    db: AsyncSession = Depends(get_db), 
    current_user: Any = Depends(auth.get_current_user)
):
    # ROBUST USER ID EXTRACTION
    user_id = None
    if hasattr(current_user, 'id'):
        user_id = current_user.get("id")
    elif isinstance(current_user, dict):
        user_id = current_user.get('id') or current_user.get('sub') or current_user.get('user_id')

    if user_id is None:
        raise HTTPException(status_code=401, detail="User session invalid")

    user_id = str(user_id)
    
    res = await db.execute(
        sa_select(LuboilEventReadState)
        .where(LuboilEventReadState.event_id == event_id)
        .where(LuboilEventReadState.user_id == user_id)
    )
    read_state = res.scalars().first()
    if not read_state:
        read_state = LuboilEventReadState(event_id=event_id, user_id=user_id, is_read=True, read_at=datetime.utcnow())
        db.add(read_state)
    else:
        read_state.is_read = True
        read_state.read_at = datetime.utcnow()

    await db.commit()
    return {"status": "success"}

@app.patch("/api/notifications/{notif_id}/hide", tags=["Notifications"])
async def hide_notification(notif_id: int, db: AsyncSession = Depends(get_db)):
    """Permanently hide a notification from the user's view (soft delete)."""
    res = await db.execute(sa_select(Notification).where(Notification.id == notif_id))
    notif = res.scalars().first()
    if notif:
        notif.is_hidden = True
        await db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Notification not found")

@app.post("/api/luboil/vessel/manual-upload", tags=["Lube Oil"])
async def upload_vessel_config_report(
    imo: int = Form(...),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: Any = Depends(auth.get_current_user)
):
    # Security: Shore users only
    if isinstance(current_user, dict):
        u_role = str(current_user.get('role') or "").upper()
        if not u_role:
            roles_list = current_user.get('roles', [])
            u_role = str(roles_list[0]).upper() if roles_list else ""
    else:
        u_role = str(getattr(current_user, 'role', "") or "").upper()

    if u_role not in ("SHORE", "ADMIN", "SUPERUSER"):
        raise HTTPException(status_code=403, detail="Unauthorized")

    contents = await file.read()
    # Path: lube_oil/vessel_docs/{imo}/{filename}
    blob_url = upload_file_to_azure(contents, file.filename, f"lube_oil/vessel_docs/{imo}")

    # Save to DB
    res = await db.execute(sa_select(LuboilVessel).where(LuboilVessel.imo_number == imo))
    vessel = res.scalars().first()
    if vessel:
        vessel.vessel_report_url = blob_url
        await db.commit()

    # Save to Control DB vessels table
    control_db = SessionControl()
    try:
        from app.models.control.vessel import Vessel as ControlVessel
        control_vessel = control_db.query(ControlVessel).filter(
            ControlVessel.imo == str(imo)
        ).first()
        if control_vessel:
            control_vessel.vessel_report_url = blob_url
            control_db.commit()
    finally:
        control_db.close()
    
    return {"url": blob_url}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.api:app", host="0.0.0.0", port=8002, reload=True)















