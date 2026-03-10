# FILE LOCATION: app/services/ae_extraction_service.py

import os
import base64
import logging
import pandas as pd
from pdf2image import convert_from_bytes
from openai import OpenAI
from pydantic import BaseModel, Field
from typing import List, Optional

# ==========================================
# ⚙️ CONFIGURATION
# ==========================================

# 1. SET YOUR OPENAI API KEY
# Recommendation: Use os.getenv("OPENAI_API_KEY") in production
OPENAI_API_KEY = "sk-..." 

# 2. POPPLER PATH (Your specific path)
POPPLER_PATH = r"C:\Users\GOKUL\poppler-25.12.0\Library\bin"

# 3. OUTPUT FILE PATH
OUTPUT_FILE_PATH = "data/ae_shop_trial.xlsx"

# Configure Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize OpenAI Client
client = OpenAI(api_key=OPENAI_API_KEY)

# Exact Database Headers
ALL_HEADERS = [
    "imo_number", "engine_no", "designation", "maker", "model", 
    "num_of_cylinders", "rated_engine_output_kw", "rated_speed_rpm",
    "load_percentage", "load_kw", "pmax_raw_mpa", 
    "boost_air_pressure_raw_mpa", "exh_temp_tc_inlet_graph_c", 
    "exh_temp_cyl_outlet_avg_graph_c", "exh_temp_tc_outlet_graph_c", 
    "fuel_pump_index_graph", "sfoc_graph_g_kwh"
]

# ==========================================
# 🧠 AI DATA SCHEMA (Pydantic)
# ==========================================

class EngineSpecs(BaseModel):
    engine_no: str = Field(..., description="Engine serial number found in header, e.g., DE618Z3128")
    designation: str = Field(..., description="Engine position, e.g., Aux Engine No.1")
    maker: str = Field(..., description="Manufacturer, e.g., DAIHATSU, YANMAR")
    model: str = Field(..., description="Engine Model, e.g., 6DE-18")
    num_of_cylinders: int = Field(..., description="Number of cylinders")
    rated_engine_output_kw: float = Field(..., description="Rated power in kW")
    rated_speed_rpm: int = Field(..., description="Rated Speed in RPM")

class PerformanceRow(BaseModel):
    load_percentage: int = Field(..., description="Load step: 25, 50, 75, 100, or 110")
    load_kw: float = Field(..., description="Generator output/Load in kW")
    pmax_raw_mpa: Optional[float] = Field(None, description="Max combustion pressure (average) in MPa")
    boost_air_pressure_raw_mpa: Optional[float] = Field(None, description="Boost/Scavenge air pressure in MPa")
    exh_temp_tc_inlet_graph_c: Optional[float] = Field(None, description="TC Inlet Temp. If 'Upper' and 'Lower' rows exist, calculate the AVERAGE.")
    exh_temp_cyl_outlet_avg_graph_c: Optional[float] = Field(None, description="Average Cylinder Outlet Temp")
    exh_temp_tc_outlet_graph_c: Optional[float] = Field(None, description="TC Outlet Temp")
    fuel_pump_index_graph: Optional[float] = Field(None, description="Fuel rack position or pump index")
    sfoc_graph_g_kwh: Optional[float] = Field(None, description="Specific Fuel Oil Consumption (SFOC) in g/kWh")

class PageExtraction(BaseModel):
    is_data_page: bool = Field(..., description="Set to True ONLY if the page contains a specific shop trial load table (25%, 50%, etc).")
    specs: Optional[EngineSpecs]
    performance_rows: Optional[List[PerformanceRow]]

# ==========================================
# 🛠️ HELPER FUNCTIONS
# ==========================================

def encode_image(image):
    """Encodes a PIL image to base64 for the API"""
    import io
    buffered = io.BytesIO()
    image.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode('utf-8')

def extract_data_with_llm(image):
    """Sends image to GPT-4o to extract data visually"""
    base64_image = encode_image(image)

    prompt = """
    You are a Marine Engineer. Analyze this shop trial report page.
    
    1. Check if this page contains a "Performance" or "Load Test" table (rows like 25%, 50%, 75%, 100%).
    2. If YES:
       - Extract the Engine Headers (Engine No, Model, Maker, Rated Output).
       - Extract the table rows into the defined structure.
       - IMPORTANT: If 'TC Inlet Temp' is split into 'Upper' and 'Lower' rows, calculate the AVERAGE of the two values for that column.
       - IMPORTANT: Ensure units are correct (e.g. MPa for pressure).
    3. If NO:
       - Set is_data_page to False.
    """

    try:
        response = client.beta.chat.completions.parse(
            model="gpt-4o",  # Using GPT-4o for high-quality vision extraction
            messages=[
                {"role": "system", "content": "You are a precise data extraction assistant."},
                {"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]}
            ],
            response_format=PageExtraction
        )
        return response.choices[0].message.parsed
    except Exception as e:
        logger.error(f"AI Extraction Error: {e}")
        return None

# ==========================================
# 🚀 MAIN FUNCTION
# ==========================================

def extract_and_save_ae_pdf(pdf_file_input, imo_number):
    """
    Main entry point.
    :param pdf_file_input: Bytes of the PDF file.
    :param imo_number: String, the IMO number of the vessel.
    :return: Path to the saved Excel file or None on failure.
    """
    logger.info(f"🚀 Starting AI Extraction for IMO: {imo_number}")

    # 1. Convert PDF Bytes to Images
    try:
        images = convert_from_bytes(pdf_file_input, poppler_path=POPPLER_PATH, dpi=300)
    except Exception as e:
        logger.error(f"❌ PDF Conversion Failed: {e}")
        return None

    all_rows = []

    # 2. Iterate through every page of the PDF
    for i, img in enumerate(images):
        logger.info(f"Processing Page {i+1} of {len(images)}...")
        
        # Send image to AI for extraction
        data: PageExtraction = extract_data_with_llm(img)

        # 3. Process Result
        if data and data.is_data_page and data.performance_rows:
            logger.info(f"✅ Found Data on Page {i+1} for Engine: {data.specs.engine_no}")
            
            # Map the AI object to our flat Database Dictionary
            for row in data.performance_rows:
                flat_data = {
                    "imo_number": imo_number,
                    "engine_no": data.specs.engine_no,
                    "designation": data.specs.designation,
                    "maker": data.specs.maker,
                    "model": data.specs.model,
                    "num_of_cylinders": data.specs.num_of_cylinders,
                    "rated_engine_output_kw": data.specs.rated_engine_output_kw,
                    "rated_speed_rpm": data.specs.rated_speed_rpm,
                    
                    # Performance Data
                    "load_percentage": row.load_percentage,
                    "load_kw": row.load_kw,
                    "pmax_raw_mpa": row.pmax_raw_mpa,
                    "boost_air_pressure_raw_mpa": row.boost_air_pressure_raw_mpa,
                    "exh_temp_tc_inlet_graph_c": row.exh_temp_tc_inlet_graph_c,
                    "exh_temp_cyl_outlet_avg_graph_c": row.exh_temp_cyl_outlet_avg_graph_c,
                    "exh_temp_tc_outlet_graph_c": row.exh_temp_tc_outlet_graph_c,
                    "fuel_pump_index_graph": row.fuel_pump_index_graph,
                    "sfoc_graph_g_kwh": row.sfoc_graph_g_kwh
                }
                all_rows.append(flat_data)
        else:
            logger.debug(f"Page {i+1} skipped (No relevant data found).")

    # 4. Save to Excel
    if all_rows:
        try:
            # Create DataFrame
            new_df = pd.DataFrame(all_rows)
            new_df = new_df.reindex(columns=ALL_HEADERS)

            # Check if file exists to Append vs Create
            if os.path.exists(OUTPUT_FILE_PATH):
                existing_df = pd.read_excel(OUTPUT_FILE_PATH)
                combined_df = pd.concat([existing_df, new_df], ignore_index=True)
                combined_df.to_excel(OUTPUT_FILE_PATH, index=False)
                logger.info(f"🔄 Appended {len(all_rows)} rows to existing file.")
            else:
                os.makedirs(os.path.dirname(OUTPUT_FILE_PATH), exist_ok=True)
                new_df.to_excel(OUTPUT_FILE_PATH, index=False)
                logger.info(f"🆕 Created new file with {len(all_rows)} rows.")

            return OUTPUT_FILE_PATH
        except Exception as e:
            logger.error(f"❌ Error saving Excel: {e}")
            return None
    else:
        logger.warning("❌ Extraction finished but no data rows were found.")
        return None