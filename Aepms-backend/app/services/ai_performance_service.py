import openai
import json
from app.models import ShopTrialPerformanceData, VesselInfo
from sqlalchemy import select

class AIPerformanceAnalyzer:
    def __init__(self, db_session):
        self.db = db_session

    async def generate_analysis(self, vessel_imo, actual_data_pdf_text, engine_type="ME"):
        # 1. Fetch Baseline from your DB (This is what you currently sync via Excel)
        # We need this to give the AI the "Baseline" to compare against
        result = await self.db.execute(
            select(VesselInfo).where(VesselInfo.imo_number == vessel_imo)
        )
        vessel = result.scalar_one_or_none()
        
        # 2. Construct the Prompt (Using your Master Prompt)
        master_prompt = f"""
        YOU ARE A MARINE ENGINEER. 
        Analyze the following data for Vessel: {vessel.vessel_name}.
        
        BASELINE DATA (From DB): 
        SMCR: {vessel.mcr_power_kw} kW @ {vessel.mcr_rpm} RPM
        CSR: {vessel.csr_power_kw} kW @ {vessel.csr_rpm} RPM
        
        ACTUAL ONBOARD DATA (Extracted from PDF):
        {actual_data_pdf_text}
        
        TASK:
        1. Generate a professional performance report (Text).
        2. Provide a STRUCTURED JSON object at the end containing the extracted values for storage.
        
        JSON FORMAT REQUIRED:
        {{
            "engine_speed_rpm": float,
            "engine_output_kw": float,
            "sfoc_g_kwh": float,
            "pmax_bar": float,
            "pcomp_bar": float,
            "scav_air_press_bar": float
            ... (use your database column names)
        }}
        """

        # 3. Call OpenAI/LLM
        response = openai.ChatCompletion.create(
            model="gpt-4o",
            messages=[{"role": "system", "content": master_prompt}]
        )
        
        # Parse text and JSON from response
        full_text = response.choices[0].message.content
        # Logic to split text report and the JSON part...
        return full_text