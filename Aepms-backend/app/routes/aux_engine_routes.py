# app/routes/aux_engine_routes.py - FINAL CORRECTED VERSION
import logging
import io
from decimal import Decimal
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.database import get_db
from app.ae_report_processor import save_ae_monthly_report_from_pdf
from app.generator_models import GeneratorPerformanceGraphData, GeneratorMonthlyReportHeader, VesselGenerator, GeneratorBaselineData
from app.models import VesselInfo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/aux", tags=["Auxiliary Engine"])

# --- HELPER FUNCTION ---
def model_to_dict(model_instance, exclude_keys=None):
    """Converts a SQLAlchemy model instance to a dictionary, handling Decimals."""
    if not model_instance:
        return {}
    if exclude_keys is None:
        exclude_keys = []
    
    data = {}
    for col in model_instance.__table__.columns:
        if col.name not in exclude_keys:
            value = getattr(model_instance, col.name)
            if isinstance(value, Decimal):
                data[col.name] = float(value) if value is not None else None
            else:
                data[col.name] = value
    return data

@router.post("/upload")
async def upload_aux_report(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db)
):
    """Upload AE monthly PDF and return full graph data."""
    
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed.")
    
    try:
        contents = await file.read()
        # The processor now returns a more detailed result
        result = await save_ae_monthly_report_from_pdf(io.BytesIO(contents), file.filename, db)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to process the PDF report.")
        
        # --- Fetch all necessary data for the response ---
        res = await db.execute(
            select(VesselGenerator).where(VesselGenerator.generator_id == result['generator_id'])
        )
        generator = res.scalar_one_or_none()

        if not generator:
            raise HTTPException(status_code=404, detail=f"Generator with ID {result['generator_id']} not found.")

        # ✅ CORRECT: Fetch baseline data and convert dynamically
        res = await db.execute(
            select(GeneratorBaselineData)
            .where(GeneratorBaselineData.generator_id == generator.generator_id)
            .order_by(GeneratorBaselineData.load_percentage)
        )
        baseline_records = res.scalars().all()
        
        shop_trial_baseline = [
            model_to_dict(record, exclude_keys=['baseline_id', 'imo_number']) 
            for record in baseline_records
        ]
        
        # ✅ CORRECT: Fetch the full monthly performance data
        res = await db.execute(
            select(GeneratorPerformanceGraphData).where(
                GeneratorPerformanceGraphData.report_id == result['report_id']
            )
        )
        graph_data_record = res.scalar_one_or_none()

        monthly_performance = model_to_dict(graph_data_record, exclude_keys=['graph_id', 'report_id'])

        # ✅ ADDED: Frontend configuration blocks
        available_metrics = [
            {"key": "pmax_graph_bar", "name": "Max Combustion Pressure", "unit": "Bar"},
            {"key": "boost_air_pressure_graph_bar", "name": "Boost Air Pressure", "unit": "Bar"},
            {"key": "exh_temp_tc_inlet_graph_c", "name": "T/C Inlet Exhaust Temp", "unit": "°C"},
            {"key": "exh_temp_cyl_outlet_avg_graph_c", "name": "Cylinder Outlet Exhaust Temp", "unit": "°C"},
            {"key": "exh_temp_tc_outlet_graph_c", "name": "T/C Outlet Exhaust Temp", "unit": "°C"},
            {"key": "fuel_pump_index_graph", "name": "Fuel Pump Index", "unit": "index"},
            {"key": "sfoc_graph_g_kwh", "name": "SFOC", "unit": "g/kWh"},
            {"key": "fuel_consumption_total_graph_kg_h", "name": "Total Fuel Consumption", "unit": "kg/h"}
        ]
        

        chart_config = {
            "x_axis_options": [
                {"key": "load_kw", "label": "Load (kW)"},
                {"key": "load_percentage", "label": "Load (%)"}
            ],
            "default_x_axis": "load_kw",
            "default_metric": "pmax_graph_bar"
        }

        # --- Build the final, complete JSON response ---
        return {
            "message": "Report is a duplicate, returning existing data." if result.get('is_duplicate') else "New report saved successfully.",
            "report_id": result['report_id'],
            "is_duplicate": result.get('is_duplicate', False),
            "graph_data": {
                "generator_info": {
                    "vessel_name": vessel.vessel_name if vessel else None,
                    "imo_number": generator.imo_number,
                    "generator_id": generator.generator_id,
                    "engine_no": generator.engine_no,
                    "designation": generator.designation,
                    "maker": generator.engine_maker,   # ✅
                    "model": generator.engine_model,
                    "rated_engine_output_kw": float(generator.rated_engine_output_kw) if generator.rated_engine_output_kw else None
                },
                "report_info": {
                    "report_id": result['report_id'],
                    "report_month": result['report_month'],
                    "report_date": result['report_date'].isoformat() if result.get('report_date') else None
                },
                "shop_trial_baseline": shop_trial_baseline,
                "monthly_performance": monthly_performance,
                "available_metrics": available_metrics,
                "chart_config": chart_config
            }
        }
        
    except Exception as e:
        logger.error(f"Error during AE report upload: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {e}")


@router.get("/performance/{generator_id}")
async def get_aux_performance_by_generator_id(generator_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get the latest performance data for a specific generator, formatted for graphing.
    """
    res = await db.execute(select(VesselGenerator).where(VesselGenerator.generator_id == generator_id))
    generator = res.scalar_one_or_none()
    if not generator:
        raise HTTPException(status_code=404, detail="Generator not found")

    # The rest of the logic is identical to the upload response, so we can reuse it
    res = await db.execute(
        select(GeneratorMonthlyReportHeader)
        .where(GeneratorMonthlyReportHeader.generator_id == generator_id)
        .order_by(GeneratorMonthlyReportHeader.report_date.desc())
    )
    latest_report = res.scalars().first()

    if not latest_report:
        raise HTTPException(status_code=404, detail="No monthly reports found for this generator.")

    # Now, we can reuse the same logic as the upload endpoint to build the full response
    # (This could be refactored into a shared function)
    
    res = await db.execute(
        select(GeneratorBaselineData)
        .where(GeneratorBaselineData.generator_id == generator_id)
        .order_by(GeneratorBaselineData.load_percentage)
    )
    baseline_records = res.scalars().all()
    
    shop_trial_baseline = [
        model_to_dict(record, exclude_keys=['baseline_id', 'imo_number']) 
        for record in baseline_records
    ]
    
    res = await db.execute(
        select(GeneratorPerformanceGraphData).where(
            GeneratorPerformanceGraphData.report_id == latest_report.report_id
        )
    )
    graph_data_record = res.scalar_one_or_none()

    monthly_performance = model_to_dict(graph_data_record, exclude_keys=['graph_id', 'report_id'])

    # (Copy the available_metrics and chart_config from the upload endpoint)
    available_metrics = [
        {"key": "pmax_graph_bar", "name": "Max Combustion Pressure", "unit": "Bar"},
        # ... add all other metrics here ...
    ]
    chart_config = {
        "x_axis_options": [
            {"key": "load_kw", "label": "Load (kW)"},
            {"key": "load_percentage", "label": "Load (%)"}
        ],
        "default_x_axis": "load_kw",
        "default_metric": "pmax_graph_bar"
    }

    return {
        "message": "Latest performance data retrieved.",
        "report_id": latest_report.report_id,
        "graph_data": {
            "generator_info": model_to_dict(generator, exclude_keys=['vessel']),
            "report_info": model_to_dict(latest_report, exclude_keys=['generator_id', 'generator']),
            "shop_trial_baseline": shop_trial_baseline,
            "monthly_performance": monthly_performance,
            "available_metrics": available_metrics,
            "chart_config": chart_config
        }
    }