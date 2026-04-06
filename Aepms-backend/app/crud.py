# app/crud.py

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.models import VesselInfo
import logging

logger = logging.getLogger(__name__)

async def get_or_create_vessel(session: AsyncSession,
                        vessel_name_from_pdf: str = None, 
                        imo_number_from_pdf: str = None,
                        engine_type_from_pdf: str = None,
                        engine_model_from_pdf: str = None,
                        engine_maker_from_pdf: str = None,
                        number_of_cylinders_from_pdf: int = None
                        ) -> VesselInfo:
    """
    Get or create a VesselInfo record based on PDF data.
    Now uses imo_number as INTEGER primary key as per new model structure.
    """
    
    # Validate and convert IMO number to integer
    if not imo_number_from_pdf:
        raise ValueError("IMO number is required but not found in PDF")
    
    try:
        # Clean and convert IMO to integer
        imo_clean = str(imo_number_from_pdf).strip()
        # Remove any non-numeric characters that might be in the IMO
        import re
        imo_numeric = re.sub(r'[^\d]', '', imo_clean)
        if not imo_numeric:
            raise ValueError(f"IMO number '{imo_number_from_pdf}' contains no numeric characters")
        imo_int = int(imo_numeric)
    except (ValueError, TypeError) as e:
        raise ValueError(f"Invalid IMO number '{imo_number_from_pdf}': {e}")
    
    if not vessel_name_from_pdf:
        raise ValueError("Vessel name is required but not found in PDF")
    
    # Try to find existing vessel by IMO number (primary key)
    result = await session.execute(
        select(VesselInfo).where(VesselInfo.imo_number == imo_int)
    )
    existing_vessel = result.scalar_one_or_none()
    
    if existing_vessel:
        logger.info(f"Found existing vessel with IMO {imo_int}: {existing_vessel.vessel_name}")
        
        # Update vessel info if new data is available
        updated = False
        if vessel_name_from_pdf and existing_vessel.vessel_name != vessel_name_from_pdf:
            existing_vessel.vessel_name = vessel_name_from_pdf
            updated = True
        if engine_type_from_pdf and existing_vessel.engine_type != engine_type_from_pdf:
            existing_vessel.engine_type = str(engine_type_from_pdf) if engine_type_from_pdf is not None else None
            updated = True
        if engine_model_from_pdf and existing_vessel.engine_model != engine_model_from_pdf:
            existing_vessel.engine_model = engine_model_from_pdf
            updated = True
        if engine_maker_from_pdf and existing_vessel.engine_maker != engine_maker_from_pdf:
            existing_vessel.engine_maker = engine_maker_from_pdf
            updated = True
        if number_of_cylinders_from_pdf and existing_vessel.number_of_cylinders != number_of_cylinders_from_pdf:
            existing_vessel.number_of_cylinders = number_of_cylinders_from_pdf
            updated = True
            
        if updated:
            await session.flush()
            logger.info(f"Updated vessel info for IMO {imo_int}")
            
        return existing_vessel
    
    else:
        # Create new vessel record
        # Generate engine_no using the new format: E<IMO>-ME1
        engine_no = f"E{imo_int}-ME1"
        
        new_vessel = VesselInfo(
            imo_number=imo_int,  # Primary key is now imo_number as integer
            vessel_name=vessel_name_from_pdf,
            engine_no=engine_no,  # Generated engine identifier
            engine_type=str(engine_type_from_pdf) if engine_type_from_pdf is not None else None,
            engine_model=engine_model_from_pdf,
            engine_maker=engine_maker_from_pdf,
            number_of_cylinders=number_of_cylinders_from_pdf
        )
        
        session.add(new_vessel)
        await session.flush()  # Get the auto-generated vessel_id
        
        logger.info(f"Created new vessel: IMO {imo_int}, Name: {vessel_name_from_pdf}, Engine No: {engine_no}")
        return new_vessel