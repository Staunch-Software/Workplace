import os
import asyncio
import logging
import json
import tempfile
from google import genai
from google.genai import types
from pydantic import BaseModel
from typing import List, Optional

logger = logging.getLogger(__name__)

# Parse multiple API keys for rotation
keys_env = os.getenv("GEMINI_API_KEYS", os.getenv("GEMINI_API_KEY", ""))
API_KEYS = [k.strip() for k in keys_env.split(",") if k.strip()]

if not API_KEYS:
    raise RuntimeError("GEMINI_API_KEYS not set in environment variables")

current_key_index = 0

def rotate_api_key():
    global current_key_index
    current_key_index = (current_key_index + 1) % len(API_KEYS)
    logger.info(f"🔄 Rotating API Key. Switching to key index: {current_key_index + 1}/{len(API_KEYS)}")

# ---------------------------------------------------------
# DATABASE ALIGNED SCHEMAS (Maintained for downstream compatibility)
# ---------------------------------------------------------
class VesselInfo(BaseModel):
    vessel_name: Optional[str] = None
    imo_number: Optional[str] = None
    engine_no: Optional[str] = None
    hull_no: Optional[str] = None
    owner: Optional[str] = None
    shipyard: Optional[str] = None
    engine_maker: Optional[str] = None
    engine_type: Optional[str] = None
    engine_model: Optional[str] = None
    number_of_cylinders: Optional[str] = None
    mcr_power_kw: Optional[str] = None
    mcr_power_kw_Unit: Optional[str] = None
    mcr_rpm: Optional[str] = None
    mcr_rpm_Unit: Optional[str] = None
    propeller_pitch_mm: Optional[str] = None
    propeller_pitch_mm_Unit: Optional[str] = None
    sfoc_target_g_kwh: Optional[str] = None
    sfoc_target_g_kwh_Unit: Optional[str] = None
    csr_power_kw: Optional[str] = None
    csr_power_kw_Unit: Optional[str] = None
    barred_speed_rpm_start: Optional[str] = None
    barred_speed_rpm_end: Optional[str] = None
    mcr_limit: Optional[str] = None
    mcr_limit_unit: Optional[str] = None
    mcr_limit_percentage: Optional[str] = None

class SessionInfo(BaseModel):
    trial_date: Optional[str] = None
    trial_type: Optional[str] = None
    conducted_by: Optional[str] = None
    remarks: Optional[str] = None
    document_title: Optional[str] = None
    document_reference: Optional[str] = None
    room_temp_cold_condition_c: Optional[str] = None
    room_temp_cold_condition_c_Unit: Optional[str] = None
    lub_oil_temp_hot_condition_c: Optional[str] = None
    lub_oil_temp_hot_condition_c_Unit: Optional[str] = None
    lub_oil_temp_cold_condition_c: Optional[str] = None
    lub_oil_temp_cold_condition_c_Unit: Optional[str] = None
    status: Optional[str] = None

class PerformancePoint(BaseModel):
    load_percentage: Optional[str] = None
    load_percentage_Unit: Optional[str] = None
    test_sequence: Optional[str] = None
    engine_no: Optional[str] = None
    engine_output_kw: Optional[str] = None
    engine_output_kw_Unit: Optional[str] = None
    engine_speed_rpm: Optional[str] = None
    engine_speed_rpm_Unit: Optional[str] = None
    room_temperature_c: Optional[str] = None
    room_temperature_c_Unit: Optional[str] = None
    room_humidity_percent: Optional[str] = None
    room_humidity_percent_Unit: Optional[str] = None
    barometer_pressure_mbar: Optional[str] = None
    barometer_pressure_mbar_Unit: Optional[str] = None
    tc_inlet_temp_c: Optional[str] = None
    tc_inlet_temp_c_Unit: Optional[str] = None
    scav_air_temperature_c: Optional[str] = None
    scav_air_temperature_c_Unit: Optional[str] = None
    tc_outlet_back_press_mmaq: Optional[str] = None
    tc_outlet_back_press_mmaq_Unit: Optional[str] = None
    max_combustion_pressure_bar: Optional[str] = None
    max_combustion_pressure_bar_Unit: Optional[str] = None
    max_combustion_pressure_iso_bar: Optional[str] = None
    max_combustion_pressure_iso_bar_Unit: Optional[str] = None
    compression_pressure_bar: Optional[str] = None
    compression_pressure_bar_Unit: Optional[str] = None
    compression_pressure_iso_bar: Optional[str] = None
    compression_pressure_iso_bar_Unit: Optional[str] = None
    mean_effective_pressure_bar: Optional[str] = None
    mean_effective_pressure_bar_Unit: Optional[str] = None
    fuel_injection_pump_index_mm: Optional[str] = None
    fuel_injection_pump_index_mm_Unit: Optional[str] = None
    exh_temp_cylinder_outlet_ave_c: Optional[str] = None
    exh_temp_cylinder_outlet_ave_c_Unit: Optional[str] = None
    exh_temp_tc_inlet_c: Optional[str] = None
    exh_temp_tc_inlet_c_Unit: Optional[str] = None
    exh_temp_tc_inlet_iso_c: Optional[str] = None
    exh_temp_tc_inlet_iso_c_Unit: Optional[str] = None
    exh_temp_tc_outlet_c: Optional[str] = None
    exh_temp_tc_outlet_c_Unit: Optional[str] = None
    exh_temp_tc_outlet_iso_c: Optional[str] = None
    exh_temp_tc_outlet_iso_c_Unit: Optional[str] = None
    turbocharger_speed_x1000_rpm: Optional[str] = None
    turbocharger_speed_x1000_rpm_Unit: Optional[str] = None
    turbocharger_speed_x1000_iso_rpm: Optional[str] = None
    turbocharger_speed_x1000_iso_rpm_Unit: Optional[str] = None
    scav_air_pressure_bar: Optional[str] = None
    scav_air_pressure_bar_Unit: Optional[str] = None
    scav_air_pressure_iso_kg_cm2: Optional[str] = None
    scav_air_pressure_iso_kg_cm2_Unit: Optional[str] = None
    turbocharger_gas_inlet_press_kg_cm2: Optional[str] = None
    turbocharger_gas_inlet_press_kg_cm2_Unit: Optional[str] = None
    fuel_oil_temperature_c: Optional[str] = None
    fuel_oil_temperature_c_Unit: Optional[str] = None
    fuel_oil_consumption_kg_h: Optional[str] = None
    fuel_oil_consumption_kg_h_Unit: Optional[str] = None
    fuel_oil_consumption_g_kwh: Optional[str] = None
    fuel_oil_consumption_g_kwh_Unit: Optional[str] = None
    fuel_oil_consumption_iso_g_kwh: Optional[str] = None
    fuel_oil_consumption_iso_g_kwh_Unit: Optional[str] = None
    load_kw: Optional[str] = None
    load_kw_Unit: Optional[str] = None
    pmax_raw_mpa: Optional[str] = None
    pmax_raw_mpa_Unit: Optional[str] = None
    boost_air_pressure_raw_mpa: Optional[str] = None
    boost_air_pressure_raw_mpa_Unit: Optional[str] = None
    exh_temp_tc_inlet_graph_c: Optional[str] = None
    exh_temp_tc_inlet_graph_c_Unit: Optional[str] = None
    exh_temp_cyl_outlet_avg_graph_c: Optional[str] = None
    exh_temp_cyl_outlet_avg_graph_c_Unit: Optional[str] = None
    exh_temp_tc_outlet_graph_c: Optional[str] = None
    exh_temp_tc_outlet_graph_c_Unit: Optional[str] = None
    fuel_pump_index_graph: Optional[str] = None
    fuel_pump_index_graph_Unit: Optional[str] = None
    sfoc_graph_g_kwh: Optional[str] = None
    sfoc_graph_g_kwh_Unit: Optional[str] = None
    exhaust_gas_temp_before_tc_c: Optional[str] = None
    exhaust_gas_temp_before_tc_c_Unit: Optional[str] = None
    exhaust_gas_temp_after_tc_c: Optional[str] = None
    exhaust_gas_temp_after_tc_c_Unit: Optional[str] = None
    turbocharger_speed_rpm: Optional[str] = None
    turbocharger_speed_rpm_Unit: Optional[str] = None
    fuel_rack_position_mm: Optional[str] = None
    fuel_rack_position_mm_Unit: Optional[str] = None
    sfoc_g_kwh: Optional[str] = None
    sfoc_g_kwh_Unit: Optional[str] = None
    fuel_consumption_total_kg_h: Optional[str] = None
    fuel_consumption_total_kg_h_Unit: Optional[str] = None
    tc_exhaust_inlet_bank_1_3_c: Optional[str] = None
    tc_exhaust_inlet_bank_1_3_c_Unit: Optional[str] = None
    tc_exhaust_inlet_bank_4_6_c: Optional[str] = None
    tc_exhaust_inlet_bank_4_6_c_Unit: Optional[str] = None

class ExtractionResult(BaseModel):
    vessel_info: VesselInfo
    session_info: SessionInfo
    performance_table: List[PerformancePoint]


# ---------------------------------------------------------
# LEAN EXTRACTION SCHEMAS (Excludes static Unit metadata)
# ---------------------------------------------------------
class VesselInfoExtract(BaseModel):
    vessel_name: Optional[str] = None
    imo_number: Optional[str] = None
    engine_no: Optional[str] = None
    hull_no: Optional[str] = None
    owner: Optional[str] = None
    shipyard: Optional[str] = None
    engine_maker: Optional[str] = None
    engine_type: Optional[str] = None
    engine_model: Optional[str] = None
    number_of_cylinders: Optional[str] = None
    mcr_power_kw: Optional[str] = None
    mcr_rpm: Optional[str] = None
    propeller_pitch_mm: Optional[str] = None
    sfoc_target_g_kwh: Optional[str] = None
    csr_power_kw: Optional[str] = None
    barred_speed_rpm_start: Optional[str] = None
    barred_speed_rpm_end: Optional[str] = None
    mcr_limit: Optional[str] = None
    mcr_limit_unit: Optional[str] = None
    mcr_limit_percentage: Optional[str] = None

class SessionInfoExtract(BaseModel):
    trial_date: Optional[str] = None
    trial_type: Optional[str] = None
    conducted_by: Optional[str] = None
    remarks: Optional[str] = None
    document_title: Optional[str] = None
    document_reference: Optional[str] = None
    room_temp_cold_condition_c: Optional[str] = None
    lub_oil_temp_hot_condition_c: Optional[str] = None
    lub_oil_temp_cold_condition_c: Optional[str] = None
    status: Optional[str] = None

class PerformancePointExtract(BaseModel):
    load_percentage: Optional[str] = None
    test_sequence: Optional[str] = None
    engine_no: Optional[str] = None
    engine_output_kw: Optional[str] = None
    engine_speed_rpm: Optional[str] = None
    room_temperature_c: Optional[str] = None
    room_humidity_percent: Optional[str] = None
    barometer_pressure_mbar: Optional[str] = None
    tc_inlet_temp_c: Optional[str] = None
    scav_air_temperature_c: Optional[str] = None
    tc_outlet_back_press_mmaq: Optional[str] = None
    max_combustion_pressure_bar: Optional[str] = None
    max_combustion_pressure_iso_bar: Optional[str] = None
    compression_pressure_bar: Optional[str] = None
    compression_pressure_iso_bar: Optional[str] = None
    mean_effective_pressure_bar: Optional[str] = None
    fuel_injection_pump_index_mm: Optional[str] = None
    exh_temp_cylinder_outlet_ave_c: Optional[str] = None
    exh_temp_tc_inlet_c: Optional[str] = None
    exh_temp_tc_inlet_iso_c: Optional[str] = None
    exh_temp_tc_outlet_c: Optional[str] = None
    exh_temp_tc_outlet_iso_c: Optional[str] = None
    turbocharger_speed_x1000_rpm: Optional[str] = None
    turbocharger_speed_x1000_iso_rpm: Optional[str] = None
    scav_air_pressure_bar: Optional[str] = None
    scav_air_pressure_iso_kg_cm2: Optional[str] = None
    turbocharger_gas_inlet_press_kg_cm2: Optional[str] = None
    fuel_oil_temperature_c: Optional[str] = None
    fuel_oil_consumption_kg_h: Optional[str] = None
    fuel_oil_consumption_g_kwh: Optional[str] = None
    fuel_oil_consumption_iso_g_kwh: Optional[str] = None
    load_kw: Optional[str] = None
    pmax_raw_mpa: Optional[str] = None
    boost_air_pressure_raw_mpa: Optional[str] = None
    exh_temp_tc_inlet_graph_c: Optional[str] = None
    exh_temp_cyl_outlet_avg_graph_c: Optional[str] = None
    exh_temp_tc_outlet_graph_c: Optional[str] = None
    fuel_pump_index_graph: Optional[str] = None
    sfoc_graph_g_kwh: Optional[str] = None
    exhaust_gas_temp_before_tc_c: Optional[str] = None
    exhaust_gas_temp_after_tc_c: Optional[str] = None
    turbocharger_speed_rpm: Optional[str] = None
    fuel_rack_position_mm: Optional[str] = None
    sfoc_g_kwh: Optional[str] = None
    fuel_consumption_total_kg_h: Optional[str] = None
    tc_exhaust_inlet_bank_1_3_c: Optional[str] = None
    tc_exhaust_inlet_bank_4_6_c: Optional[str] = None

class ExtractionResultExtract(BaseModel):
    vessel_info: VesselInfoExtract
    session_info: SessionInfoExtract
    performance_table: List[PerformancePointExtract]


async def extract_data_with_gemini(pdf_bytes: bytes, engine_type: str):
    # Highly stable fallback sequence supporting 2.5 and 2.0 architectures
    models_to_try = [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-2.5-pro"
    ]

    if engine_type == 'auxiliaryEngine':
        prompt = """
        You are a Marine Engineer. Extract the Engine Performance Table from this Auxiliary Engine PDF.

        PMAX / CYLINDER PRESSURE EXTRACTION:
        - Identify cylinder maximum combustion pressure. In Japanese shop trials, this is typically written as "気筒内最高圧力" or "Max. Combustion Press. of Cylinder" (or "Pmax").
        - If Pmax is listed in MPa (e.g. 17.7 MPa), populate it directly in `pmax_raw_mpa`. 
        - If it is listed in bar (e.g. 177 bar), populate it in `max_combustion_pressure_bar`. 

        MULTIPLE ENGINES/GENERATORS EXTRACTION INSTRUCTIONS:
        - The PDF may contain performance sheets for multiple distinct Auxiliary Engines / Generators (e.g. No.1 Gen, No.2 Gen, No.3 Gen or Engine Numbers like 11988, 11989, 11990).
        - You MUST extract every column for every generator present in the PDF file.
        - For each PerformancePoint object, populate the 'engine_no' field with the specific engine serial number (e.g., "11988") or designation (e.g. "Aux Engine No.1") extracted from the header of that generator's test page.
        - If the PDF only contains a single generator, populate the 'engine_no' with that single engine's number.
        - ONLY extract columns and load points that are explicitly listed as operational parameters in the main summary trial tables. Ignore theoretical values or single limit values mentioned in passing on description or vibration pages.

        Map the data to the provided schema using these semantic mapping rules:
        - "load_percentage"                    (Look for: "Load", "%", "Load Factor")
        - "load_kw"                            (Look for: "Generator Output", "Load", "kW", "Brake Power")
        - "engine_output_kw"                   (Look for: "Load", "Output", "Power", "kW")
        - "engine_speed_rpm"                   (Look for: "Speed", "RPM", "min-1")
        - "pmax_raw_mpa"                       (Look for: 気筒内最高圧力, Max. Combustion Press of Cylinder, Cylinder Press, MPa)
        - "max_combustion_pressure_bar"        (Look for: Pmax, Max. Press, bar)
        - "compression_pressure_bar"           (Look for: Pcomp, Comp. Press)
        - "boost_air_pressure_raw_mpa"         (Look for: Boost Air Press., Charge Air Press., MPa)
        - "scav_air_pressure_bar"              (Look for: Scav Air Pressure, Scav. Press, Charge Air Press, bar)
        - "exh_temp_tc_inlet_graph_c"          (Look for: TC Inlet Temp, Turbine Inlet, °C)
        - "exh_temp_cyl_outlet_avg_graph_c"    (Look for: Cylinder Outlet Temp Average, Cyl. Avg, °C)
        - "exh_temp_tc_outlet_graph_c"         (Look for: TC Outlet Temp, Turbine Outlet, °C)
        - "fuel_pump_index_graph"              (Look for: Fuel Pump Index, Rack Position, mm, Fuel Notch)
        - "sfoc_graph_g_kwh"                   (Look for: Specific Fuel Consumption, SFOC, g/kWh)
        - "exh_temp_cylinder_outlet_ave_c"     (Look for: "Exh Temp (Cyl Avg)", "Cyl Out Temp", "Exhaust Cyl Avg")
        - "exhaust_gas_temp_before_tc_c"       (Look for: "Exh Temp Before TC", "T/C Inlet", "Turbine Inlet", "Average of inlet banks")
        - "exhaust_gas_temp_after_tc_c"        (Look for: "Exh Temp After TC", "T/C Outlet", "Turbine Outlet")
        - "turbocharger_speed_rpm"             (Look for: "T/C Speed", "Blower Speed")
        - "fuel_rack_position_mm"              (Look for: "Fuel Rack", "Rack Position", "Fuel Index", "Index")
        - "sfoc_g_kwh"                         (Look for: "SFOC", "Specific Fuel Cons.", "g/kWh")
        - "fuel_consumption_total_kg_h"        (Look for: "Total Fuel Cons.", "Fuel Consumption", "FOC kg/h")
        - "tc_exhaust_inlet_bank_1_3_c"        (Look for: "T/C Inlet 1~3 Cyl", "T/C Exhaust Inlet Bank 1-3")
        - "tc_exhaust_inlet_bank_4_6_c"        (Look for: "T/C Inlet 4~6 Cyl", "T/C Exhaust Inlet Bank 4-6")

        Rules:
        - Clean numeric values: remove units (bar, kW, RPM, °C, etc.).
        - Provide null for missing/blank values. DO NOT omit keys entirely.
        """
    else:
        prompt = """
        You are a Marine Engineer. Extract the Engine Performance Table from this Main Engine PDF.

        CRITICAL TABLE EXTRACTION INSTRUCTIONS:
        1. The PDF contains a Shop Trial Performance Matrix.
        2. You MUST extract EVERY column from the table. Typically there are columns for 25%, 50%, 75%, 90% (or 85%), 100% (1st run / 100-1), 100% (2nd run / 100-2), and 110% loads. Do not skip any columns, and ensure both 100% runs are extracted as separate sequential records.
        3. Do NOT extract arbitrary percentages or load limits mentioned in passing text or vibration documents (e.g. "misfiring cylinder at 79% load" or "vibration range 41-50 rpm"). Only extract fully populated columns belonging to the official trial run tables (e.g. Page 42 or Page 62).
        4. "fuel_injection_pump_index_mm" (Fuel Index) and "fuel_oil_consumption_kg_h" (Fuel Consumption) are extremely important.
        5. Strictly align numbers to their row parameters. The PDF table has rows for parameters and columns for loads. You must transpose this so each load column becomes an object in the JSON array.
        6. Double check every parameter column so values are not swapped or shifted between adjacent load points.
        7. Extract the "test_sequence" for each load point column sequential index (e.g. 1, 2, 3, 4, 5, 6, 7).
        8. ONLY extract load percentage columns that have fully populated performance rows on the summary page. If a load point (such as '70%' or '83% MCR') is mentioned as a reference, vibrating condition, or general spec on early drawing or description pages but contains no actual logged trial data, you MUST ignore it completely.

        EXAMPLE OF HOW TO TRANSPOSE AND PAIR THE DATA:
        If the PDF table has rows:
        Load (%)           | 25.0  | 50.0  |
        Fuel Index (mm)    | 29.5  | 44.4  |
        Fuel Cons. (kg/h)  | 434.8 | 861.2 |

        You must map it into the objects like this:
        [
          { "load_percentage": "25.0", "test_sequence": "1", "fuel_injection_pump_index_mm": "29.5", "fuel_oil_consumption_kg_h": "434.8" },
          { "load_percentage": "50.0", "test_sequence": "2", "fuel_injection_pump_index_mm": "44.4", "fuel_oil_consumption_kg_h": "861.2" }
        ]

        Map the data to the provided schema using these semantic mapping rules for the performance_table:
        - "load_percentage"                    (Look for: Load, %, Load Factor. Keep descriptive text intact, e.g., "25% (T/C Cut-off)" or "100-1")
        - "engine_output_kw"                   (Look for: Output, Power, Brake Power, kW, BHP)
        - "engine_speed_rpm"                   (Look for: Speed, RPM, Ne)
        - "max_combustion_pressure_bar"        (Look for: Pmax, Max. Press, Maximum Pressure, P.max. Standard measured value.)
        - "compression_pressure_bar"           (Look for: Pcomp, Comp. Press, Compression Press. Standard measured value.)
        - "mean_effective_pressure_bar"        (Look for: Pmean, Pme, Mean Eff. Press, Pi)
        - "scav_air_pressure_bar"              (Look for: Scav. Air Press, Charge Air Press, Pscav)
        - "scav_air_temperature_c"             (Look for: Scav. Temp, Charge Air Temp, Cooler Outlet Temp)
        - "exh_temp_cylinder_outlet_ave_c"     (Look for: Cyl Out Temp, Exhaust Cyl Avg, Exh. Gas Temp Cyl.)
        - "exh_temp_tc_inlet_c"                (Look for: T/C Inlet, Turbine Inlet, Exh Temp Before Blower)
        - "exh_temp_tc_outlet_c"               (Look for: T/C Outlet, Turbine Outlet, Exh Temp After Blower)
        - "turbocharger_speed_x1000_rpm"       (Look for: T/C Speed, Blower Speed. IMPORTANT: If the extracted value is a raw whole number > 100 (e.g. 5759), divide by 1000 and return a single-decimal string, e.g. "5.8". If it is already scaled as a single decimal like "5.9", extract it directly as is.)
        - "fuel_injection_pump_index_mm"       (Look for: Fuel Index, F.I.P. Index, Fuel Pump Index, Rack Position, F.Pump Mark, Fuel injection pump index)
        - "fuel_oil_consumption_kg_h"          (Look for: Fuel Consumption, Fuel Oil Consumption, FOC, Fuel Cons., Fuel Oil Cons. kg/h)
        - "fuel_oil_consumption_iso_g_kwh"     (Look for: Fuel oil consumption (ISO) g/kWh, or ISO SFOC, or Converted value based on ISO. Extract ONLY the ISO corrected fuel rate, not the raw measured SFOC.)
        - "tc_inlet_temp_c"                    (Look for: Before Turbine °C)
        - "tc_outlet_back_press_mmaq"          (Look for: Press Drop mmAq or Back Pressure mmAq)
        - "room_temperature_c"                 (Look for: Test Room Temperature °C)
        - "room_humidity_percent"              (Look for: Test Room Humidity %)
        - "barometer_pressure_mbar"            (Look for: Atmospheric/Barometric Pressure mbar)
        - "fuel_oil_temperature_c"             (Look for: Fuel Oil Temperature °C)
        - "fuel_oil_consumption_g_kwh"         (Look for: Fuel Oil Consumption g/kWh or Measured SFOC g/kWh)
        - "max_combustion_pressure_iso_bar"    (Look for: ISO corrected Pmax bar)
        - "compression_pressure_iso_bar"       (Look for: ISO corrected Pcomp bar)
        - "scav_air_pressure_iso_kg_cm2"       (Look for: ISO corrected Scav Air Pressure kg/cm² or bar)
        - "turbocharger_gas_inlet_press_kg_cm2" (Look for: Turbocharger gas inlet press kg/cm2 or bar)
        - "exh_temp_tc_inlet_iso_c"            (Look for: ISO corrected Exh Temp Before T/C °C)
        - "exh_temp_tc_outlet_iso_c"           (Look for: ISO corrected Exh Temp After T/C °C)
        - "turbocharger_speed_x1000_iso_rpm"   (Look for: ISO corrected T/C Speed x1000 rpm)

        Rules:
        - Clean numeric values: remove units (bar, kW, RPM, °C, etc.).
        - Provide null for missing/blank values (such as '-' placeholders). DO NOT omit keys entirely.
        - Ensure every row parameter matches its respective load column.
        """

    last_error = None

    # Write raw bytes to secure temp local storage
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as temp_file:
        temp_file.write(pdf_bytes)
        temp_path = temp_file.name

    try:
        for target_model in models_to_try:
            keys_tried_for_this_model = 0
            
            while keys_tried_for_this_model < len(API_KEYS):
                # Instantiate Client dynamically on the currently rotated key
                client = genai.Client(api_key=API_KEYS[current_key_index])
                uploaded_file = None
                
                try:
                    logger.info(f"📤 Uploading PDF via Google Files API (Key {current_key_index + 1}/{len(API_KEYS)})")
                    uploaded_file = await client.aio.files.upload(
                        file=temp_path,
                        config=types.UploadFileConfig(mime_type="application/pdf")
                    )
                    logger.info(f"✅ Upload successful. Cloud URI: {uploaded_file.uri}")

                    logger.info(f"🚀 Running Structured Extraction | Model: {target_model}")
                    response = await client.aio.models.generate_content(
                        model=target_model,
                        contents=[prompt, uploaded_file],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=ExtractionResultExtract,
                            temperature=0.0
                        )
                    )

                    # SAFETY CHECK: Prevent Google SDK "IndexError: string index out of range" crash on empty/blocked replies
                    if (
                        not response.candidates 
                        or len(response.candidates) == 0 
                        or not response.candidates[0].content 
                        or not response.candidates[0].content.parts 
                        or len(response.candidates[0].content.parts) == 0
                    ):
                        raise Exception("Gemini returned an empty response candidate or was blocked by safety filters.") 

                    try:
                        text_content = response.text
                    except Exception as text_err:
                        raise Exception(f"Failed to extract text content: {str(text_err)}")

                    if not text_content or text_content.strip() == "":
                        raise Exception("Model returned blank text content.")

                    raw_extracted = json.loads(text_content)
                    
                    # Convert the lean extracted data back to database-compatible schema structure
                    result = convert_to_database_schema(raw_extracted)
                    
                    # Clean up file on success
                    try:
                        await client.aio.files.delete(name=uploaded_file.name)
                        logger.info("🧹 Cleaned up file from Gemini cloud storage.")
                    except Exception as df_err:
                        logger.warning(f"⚠️ Failed to delete Gemini file: {str(df_err)}")

                    # Apply normalization, units formatting and defensive path-fallbacks
                    return post_process_extraction(result)

                except Exception as e:
                    # Always clean up the temporary file on error before retrying or exiting
                    if uploaded_file:
                        try:
                            await client.aio.files.delete(name=uploaded_file.name)
                        except Exception:
                            pass
                    
                    error_msg = str(e).lower()
                    
                    # Enhanced key rotation matching 503 Service Unavailable or rate limit spikes
                    if (
                        "429" in error_msg or 
                        "503" in error_msg or 
                        "unavailable" in error_msg or 
                        "quota" in error_msg or 
                        "resource exhausted" in error_msg or 
                        "invalid" in error_msg or 
                        "api key" in error_msg
                    ):
                        logger.warning(f"⚠️ Key issue or server demand limit hit on Key {current_key_index + 1}. Rotating API Key...")
                        rotate_api_key()
                        keys_tried_for_this_model += 1
                        last_error = e
                        continue 
                    
                    logger.warning(f"⚠️ Model {target_model} failed: {str(e)}. Falling back to next model...")
                    last_error = e
                    break 

    finally:
        # Guarantee cleanup of local file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
    logger.error(f"❌ ALL MODELS AND KEYS FAILED. Last error: {str(last_error)}")
    raise Exception(f"AI Extraction failed: {str(last_error)}")


def convert_to_database_schema(lean_data: dict) -> dict:
    """
    Safely converts the lean, constraint-optimized extraction structure 
    to the fully-formed database-compatible ExtractionResult layout.
    """
    vessel_raw = lean_data.get("vessel_info", {})
    session_raw = lean_data.get("session_info", {})
    perf_raw_list = lean_data.get("performance_table", [])

    # Map Vessel Info fields directly
    vessel_out = {}
    for key, value in vessel_raw.items():
        vessel_out[key] = value

    # Map Session Info fields directly
    session_out = {}
    for key, value in session_raw.items():
        session_out[key] = value

    # Map Performance Points directly
    perf_out_list = []
    for point in perf_raw_list:
        p_out = {}
        for key, value in point.items():
            p_out[key] = value
        perf_out_list.append(p_out)

    return {
        "vessel_info": vessel_out,
        "session_info": session_out,
        "performance_table": perf_out_list
    }


# ---------------------------------------------------------
# Helper Normalization & Fallback Logic Functions
# ---------------------------------------------------------
def clean_numeric_str(val: Optional[str]) -> Optional[str]:
    """Cleans up extracted string data to ensure no formatting strings or units slip in."""
    if val is None:
        return None
    cleaned = val.strip().replace(",", "")
    if cleaned in ["-", "--", "null", "none", "blank", ""]:
        return None
    return cleaned

def post_process_extraction(result: dict) -> dict:
    """
    Applies the Path-Fallback & Ingestion Validation logic:
    1. Sanitizes string data to remove unit formatting and detect Null values.
    2. Filters out unpopulated load points.
    3. Explicitly populates default unit columns to match database requirements.
    4. Automatically resolves Main vs Aux fuel index key mismatches.
    5. Merges measured standard values to ISO parameters if missing on older trials.
    """
    # 1. Clean and Apply Fallback for Vessel Specifications (Sheet 1)
    v_info = result.get("vessel_info", {})
    for key in list(v_info.keys()):
        v_info[key] = clean_numeric_str(v_info[key])
    
    # Auto-assign standard static units for sheet 1 metadata (avoids Pydantic proto errors)
    v_info["propeller_pitch_mm_Unit"] = v_info.get("propeller_pitch_mm_Unit") or "mm"
    v_info["sfoc_target_g_kwh_Unit"] = v_info.get("sfoc_target_g_kwh_Unit") or "g/kWh"
    v_info["mcr_power_kw_Unit"] = v_info.get("mcr_power_kw_Unit") or "kW"
    v_info["mcr_rpm_Unit"] = v_info.get("mcr_rpm_Unit") or "RPM"
    v_info["csr_power_kw_Unit"] = v_info.get("csr_power_kw_Unit") or "kW"
    v_info["mcr_limit_unit"] = v_info.get("mcr_limit_unit") or "kW"

    # 2. Clean and Apply Session Specifications (Sheet 2)
    s_info = result.get("session_info", {})
    for key in list(s_info.keys()):
        s_info[key] = clean_numeric_str(s_info[key])
        
    s_info["room_temp_cold_condition_c_Unit"] = "°C"
    s_info["lub_oil_temp_hot_condition_c_Unit"] = "°C"
    s_info["lub_oil_temp_cold_condition_c_Unit"] = "°C"

    # 3. Clean, Align, Validate and Apply ISO Fallback to Performance points (Sheet 3)
    perf_table = result.get("performance_table", [])
    validated_table = []
    
    for point in perf_table:
        # Clean numeric fields
        for key in list(point.keys()):
            point[key] = clean_numeric_str(point[key])
        
        # VALIDATION SAFEGUARD: Filter out arbitrary text mentions (vibration pages/specs)
        if not point.get("engine_output_kw") and not point.get("engine_speed_rpm") and not point.get("load_kw"):
            logger.warning(f"⚠️ Dropping unpopulated/invalid performance point: {point.get('load_percentage')}")
            continue
            
        # FUEL INDEX SAFETY MERGE: Map main/aux index keys to prevent mismatch failure
        if not point.get("fuel_injection_pump_index_mm") and point.get("fuel_rack_position_mm"):
            point["fuel_injection_pump_index_mm"] = point.get("fuel_rack_position_mm")
        elif not point.get("fuel_rack_position_mm") and point.get("fuel_injection_pump_index_mm"):
            point["fuel_rack_position_mm"] = point.get("fuel_injection_pump_index_mm")
            
        # AUXILIARY SPECIFIC FUEL INDEX SAFETY MERGE:
        if not point.get("fuel_pump_index_graph") and point.get("fuel_rack_position_mm"):
            point["fuel_pump_index_graph"] = point.get("fuel_rack_position_mm")
        elif not point.get("fuel_rack_position_mm") and point.get("fuel_pump_index_graph"):
            point["fuel_rack_position_mm"] = point.get("fuel_pump_index_graph")
            
        # AUXILIARY SPECIFIC LOAD POWER SAFETY MERGE:
        if not point.get("load_kw") and point.get("engine_output_kw"):
            point["load_kw"] = point.get("engine_output_kw")
        elif not point.get("engine_output_kw") and point.get("load_kw"):
            point["engine_output_kw"] = point.get("load_kw")
            
        # AUXILIARY SPECIFIC SFOC SAFETY MERGE:
        if not point.get("sfoc_graph_g_kwh") and point.get("sfoc_g_kwh"):
            point["sfoc_graph_g_kwh"] = point.get("sfoc_g_kwh")
        elif not point.get("sfoc_g_kwh") and point.get("sfoc_graph_g_kwh"):
            point["sfoc_g_kwh"] = point.get("sfoc_graph_g_kwh")
            
        # AUXILIARY SPECIFIC PMAX SAFETY MERGE:
        # Note: MPa is converted from bar (divided by 10) on standard database insertion [12]
        if not point.get("pmax_raw_mpa") and point.get("max_combustion_pressure_bar"):
            try:
                point["pmax_raw_mpa"] = str(round(float(point.get("max_combustion_pressure_bar")) / 10.0, 3))
            except Exception:
                pass
        elif not point.get("max_combustion_pressure_bar") and point.get("pmax_raw_mpa"):
            try:
                point["max_combustion_pressure_bar"] = str(round(float(point.get("pmax_raw_mpa")) * 10.0, 1))
            except Exception:
                pass
                
        # AUXILIARY SPECIFIC SCAV / BOOST AIR SAFETY MERGE:
        if not point.get("boost_air_pressure_raw_mpa") and point.get("scav_air_pressure_bar"):
            try:
                point["boost_air_pressure_raw_mpa"] = str(round(float(point.get("scav_air_pressure_bar")) / 10.0, 3))
            except Exception:
                pass
        elif not point.get("scav_air_pressure_bar") and point.get("boost_air_pressure_raw_mpa"):
            try:
                point["scav_air_pressure_bar"] = str(round(float(point.get("boost_air_pressure_raw_mpa")) * 10.0, 2))
            except Exception:
                pass
                
        # AUXILIARY SPECIFIC TEMPERATURE MERGES:
        if not point.get("exh_temp_tc_inlet_graph_c") and point.get("exhaust_gas_temp_before_tc_c"):
            point["exh_temp_tc_inlet_graph_c"] = point.get("exhaust_gas_temp_before_tc_c")
        elif not point.get("exhaust_gas_temp_before_tc_c") and point.get("exh_temp_tc_inlet_graph_c"):
            point["exhaust_gas_temp_before_tc_c"] = point.get("exh_temp_tc_inlet_graph_c")
            
        if not point.get("exh_temp_cyl_outlet_avg_graph_c") and point.get("exh_temp_cylinder_outlet_ave_c"):
            point["exh_temp_cyl_outlet_avg_graph_c"] = point.get("exh_temp_cylinder_outlet_ave_c")
        elif not point.get("exh_temp_cylinder_outlet_ave_c") and point.get("exh_temp_cyl_outlet_avg_graph_c"):
            point["exh_temp_cylinder_outlet_ave_c"] = point.get("exh_temp_cyl_outlet_avg_graph_c")
            
        if not point.get("exh_temp_tc_outlet_graph_c") and point.get("exhaust_gas_temp_after_tc_c"):
            point["exh_temp_tc_outlet_graph_c"] = point.get("exhaust_gas_temp_after_tc_c")
        elif not point.get("exhaust_gas_temp_after_tc_c") and point.get("exh_temp_tc_outlet_graph_c"):
            point["exhaust_gas_temp_after_tc_c"] = point.get("exh_temp_tc_outlet_graph_c")

        # Consolidated Fallback Calculation: Map split TC Inlet bank readings into one unified TC Inlet value
        if not point.get("exh_temp_tc_inlet_graph_c") or point.get("exh_temp_tc_inlet_graph_c") == "":
            b1 = point.get("tc_exhaust_inlet_bank_1_3_c")
            b4 = point.get("tc_exhaust_inlet_bank_4_6_c")
            if b1 and b4:
                try:
                    avg_val = str(round((float(b1) + float(b4)) / 2.0, 1))
                    point["exh_temp_tc_inlet_graph_c"] = avg_val
                    point["exhaust_gas_temp_before_tc_c"] = avg_val
                except Exception:
                    pass

        # Populate standard static database units for every single point parameter
        point["load_percentage_Unit"] = "%"
        point["load_kw_Unit"] = "kW"
        point["engine_output_kw_Unit"] = "kW"
        point["engine_speed_rpm_Unit"] = "RPM"
        point["room_temperature_c_Unit"] = "°C"
        point["room_humidity_percent_Unit"] = "%"
        point["barometer_pressure_mbar_Unit"] = "mbar"
        point["tc_inlet_temp_c_Unit"] = "°C"
        point["scav_air_temperature_c_Unit"] = "°C"
        point["tc_outlet_back_press_mmaq_Unit"] = "mmAq"
        point["max_combustion_pressure_bar_Unit"] = "bar"
        point["max_combustion_pressure_iso_bar_Unit"] = "bar"
        point["compression_pressure_bar_Unit"] = "bar"
        point["compression_pressure_iso_bar_Unit"] = "bar"
        point["mean_effective_pressure_bar_Unit"] = "bar"
        point["fuel_injection_pump_index_mm_Unit"] = "mm"
        point["exh_temp_cylinder_outlet_ave_c_Unit"] = "°C"
        point["exh_temp_tc_inlet_c_Unit"] = "°C"
        point["exh_temp_tc_inlet_iso_c_Unit"] = "°C"
        point["exh_temp_tc_outlet_c_Unit"] = "°C"
        point["exh_temp_tc_outlet_iso_c_Unit"] = "°C"
        point["turbocharger_speed_x1000_rpm_Unit"] = "x1000 RPM"
        point["turbocharger_speed_x1000_iso_rpm_Unit"] = "x1000 RPM"
        point["scav_air_pressure_bar_Unit"] = "bar"
        point["scav_air_pressure_iso_kg_cm2_Unit"] = "kg/cm²"
        point["turbocharger_gas_inlet_press_kg_cm2_Unit"] = "kg/cm²"
        point["fuel_oil_temperature_c_Unit"] = "°C"
        point["fuel_oil_consumption_kg_h_Unit"] = "kg/h"
        point["fuel_oil_consumption_g_kwh_Unit"] = "g/kWh"
        point["fuel_oil_consumption_iso_g_kwh_Unit"] = "g/kWh"
        
        # Auxiliary specific default units
        point["pmax_raw_mpa_Unit"] = "MPa"
        point["boost_air_pressure_raw_mpa_Unit"] = "MPa"
        point["exh_temp_tc_inlet_graph_c_Unit"] = "°C"
        point["exh_temp_cyl_outlet_avg_graph_c_Unit"] = "°C"
        point["exh_temp_tc_outlet_graph_c_Unit"] = "°C"
        point["fuel_pump_index_graph_Unit"] = "mm"
        point["sfoc_graph_g_kwh_Unit"] = "g/kWh"
        point["exhaust_gas_temp_before_tc_c_Unit"] = "°C"
        point["exhaust_gas_temp_after_tc_c_Unit"] = "°C"
        point["turbocharger_speed_rpm_Unit"] = "RPM"
        point["fuel_rack_position_mm_Unit"] = "mm"
        point["sfoc_g_kwh_Unit"] = "g/kWh"
        point["fuel_consumption_total_kg_h_Unit"] = "kg/h"
        point["tc_exhaust_inlet_bank_1_3_c_Unit"] = "°C"
        point["tc_exhaust_inlet_bank_4_6_c_Unit"] = "°C"

        # ISO Fallback Merges (Calculated -> ISO columns)
        if not point.get("max_combustion_pressure_iso_bar"):
            point["max_combustion_pressure_iso_bar"] = point.get("max_combustion_pressure_bar")
            
        if not point.get("compression_pressure_iso_bar"):
            point["compression_pressure_iso_bar"] = point.get("compression_pressure_bar")
            
        if not point.get("fuel_oil_consumption_iso_g_kwh"):
            point["fuel_oil_consumption_iso_g_kwh"] = point.get("fuel_oil_consumption_g_kwh")
            
        if not point.get("scav_air_pressure_iso_kg_cm2"):
            point["scav_air_pressure_iso_kg_cm2"] = point.get("scav_air_pressure_bar")
            
        if not point.get("exh_temp_tc_inlet_iso_c"):
            point["exh_temp_tc_inlet_iso_c"] = point.get("exh_temp_tc_inlet_c")
            
        if not point.get("exh_temp_tc_outlet_iso_c"):
            point["exh_temp_tc_outlet_iso_c"] = point.get("exh_temp_tc_outlet_c")
            
        if not point.get("turbocharger_speed_x1000_iso_rpm"):
            point["turbocharger_speed_x1000_iso_rpm"] = point.get("turbocharger_speed_x1000_rpm")
            
        validated_table.append(point)

    result["performance_table"] = validated_table
    return result