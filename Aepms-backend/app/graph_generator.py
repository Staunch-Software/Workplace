#!/usr/bin/env python3
"""
Production script to generate performance graph JSON from monthly report and shop trial data
Combines shop trial baseline data with monthly performance data for frontend graph creation

Usage:
  python generate_performance_graph.py --report_id 123
  python generate_performance_graph.py --imo_number 9481697 --report_month "2025-03"
  python generate_performance_graph.py --report_id 123 --output graph_output.json
"""

import json
import argparse
import sys
from pathlib import Path
from datetime import datetime
from decimal import Decimal
from typing import Dict, List, Optional, Any
import logging
from sqlalchemy.orm import Session

# Import your app modules
from app.database import SessionLocal
from app.models import (
    VesselInfo,
    MonthlyReportHeader, 
    MonthlyISOPerformanceData,
    ShopTrialSession,
    ShopTrialPerformanceData
)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class PerformanceGraphGenerator:
    """Generates performance comparison graph data from database"""
    
    def __init__(self, db_session: Session):
        self.db = db_session
    
    def get_shop_trial_baseline(self, engine_no: str) -> List[Dict[str, Any]]:
        """Get shop trial baseline data for the engine"""
        try:
            # Get shop trial session for this engine
            session_records = self.db.query(ShopTrialSession).filter(
                ShopTrialSession.engine_no == engine_no
            ).all()
            
            if not session_records:
                raise ValueError(f"No shop trial sessions found for engine {engine_no}")
            
            # Get performance data from the first session (most recent or primary)
            baseline_records = self.db.query(ShopTrialPerformanceData).filter(
                ShopTrialPerformanceData.session_id == session_records[0].session_id
            ).order_by(ShopTrialPerformanceData.load_percentage).all()
            
            if not baseline_records:
                raise ValueError(f"No shop trial performance data found for engine {engine_no}")
            
            baseline_data = []
            for record in baseline_records:
                baseline_data.append({
                    # Primary load percentage for X-axis
                    "load_percentage": float(record.load_percentage),
                    "engine_output_kw": float(record.engine_output_kw) if record.engine_output_kw else None,
                    
                    # Engine speed
                    "engine_speed_rpm": float(record.engine_speed_rpm) if record.engine_speed_rpm else None,
                    
                    # Combustion pressures (ISO preferred, fallback to raw)
                    "max_combustion_pressure_bar": (
                        float(record.max_combustion_pressure_iso_bar) if record.max_combustion_pressure_iso_bar 
                        else (float(record.max_combustion_pressure_bar) if record.max_combustion_pressure_bar else None)
                    ),
                    "compression_pressure_bar": (
                        float(record.compression_pressure_iso_bar) if record.compression_pressure_iso_bar 
                        else (float(record.compression_pressure_bar) if record.compression_pressure_bar else None)
                    ),
                    
                    # Scavenge air pressure (ISO preferred, with unit conversion)
                    "scav_air_pressure_kg_cm2": (
                        float(record.scav_air_pressure_iso_kg_cm2) if record.scav_air_pressure_iso_kg_cm2 
                        else (
                            float(record.turbocharger_gas_inlet_press_kg_cm2) if record.turbocharger_gas_inlet_press_kg_cm2 
                            else (float(record.scav_air_pressure_bar) * 1.01972 if record.scav_air_pressure_bar else None)  # Convert bar to kg/cm²
                        )
                    ),
                    
                    # Turbocharger speed (ISO preferred)
                    "turbocharger_speed_x1000_rpm": (
                        float(record.turbocharger_speed_x1000_iso_rpm) if record.turbocharger_speed_x1000_iso_rpm 
                        else (float(record.turbocharger_speed_x1000_rpm) if record.turbocharger_speed_x1000_rpm else None)
                    ),
                    
                    # Exhaust temperatures (ISO preferred)
                    "exh_temp_tc_inlet_c": (
                        float(record.exh_temp_tc_inlet_iso_c) if record.exh_temp_tc_inlet_iso_c 
                        else (float(record.exh_temp_tc_inlet_c) if record.exh_temp_tc_inlet_c else None)
                    ),
                    "exh_temp_tc_outlet_c": (
                        float(record.exh_temp_tc_outlet_iso_c) if record.exh_temp_tc_outlet_iso_c 
                        else (float(record.exh_temp_tc_outlet_c) if record.exh_temp_tc_outlet_c else None)
                    ),
                    "cyl_exhaust_gas_temp_outlet_c": float(record.exh_temp_cylinder_outlet_ave_c) if record.exh_temp_cylinder_outlet_ave_c else None,
                    
                    # Fuel consumption
                    "fuel_consumption_total_kg_h": float(record.fuel_oil_consumption_kg_h) if record.fuel_oil_consumption_kg_h else None,
                    "sfoc_g_kwh": (
                        float(record.fuel_oil_consumption_iso_g_kwh) if record.fuel_oil_consumption_iso_g_kwh 
                        else (float(record.fuel_oil_consumption_g_kwh) if record.fuel_oil_consumption_g_kwh else None)
                    ),
                    
                    # Fuel injection pump index
                    "fuel_inj_pump_index_mm": float(record.fuel_injection_pump_index_mm) if record.fuel_injection_pump_index_mm else None
                })
            
            return baseline_data
            
        except Exception as e:
            logger.error(f"Error fetching shop trial baseline data: {e}")
            raise
    
    def get_monthly_performance_data(self, report_id: int) -> Dict[str, Any]:
        """Get monthly performance data from uploaded report"""
        try:
            # Get ISO corrected monthly performance data
            iso_data = self.db.query(MonthlyISOPerformanceData).filter(
                MonthlyISOPerformanceData.report_id == report_id
            ).first()
            
            if not iso_data:
                raise ValueError(f"No monthly performance data found for report {report_id}")
            
            monthly_point = {
                "report_id": report_id,
                "load_percentage": float(iso_data.load_percentage),
                "engine_speed_rpm": float(iso_data.engine_speed_graph_rpm) if iso_data.engine_speed_graph_rpm else None,
                "sfoc_g_kwh": float(iso_data.sfoc_graph_g_kwh) if iso_data.sfoc_graph_g_kwh else None,
                "max_combustion_pressure_bar": float(iso_data.max_combustion_pressure_iso_bar) if iso_data.max_combustion_pressure_iso_bar else None,
                "compression_pressure_bar": float(iso_data.compression_pressure_iso_bar) if iso_data.compression_pressure_iso_bar else None,
                "scav_air_pressure_kg_cm2": float(iso_data.scav_air_pressure_graph_kg_cm2) if iso_data.scav_air_pressure_graph_kg_cm2 else None,
                "turbocharger_speed_x1000_rpm": float(iso_data.turbocharger_speed_graph_x1000_rpm_scaled) if iso_data.turbocharger_speed_graph_x1000_rpm_scaled else None,
                "exh_temp_tc_inlet_c": float(iso_data.exh_temp_tc_inlet_iso_c) if iso_data.exh_temp_tc_inlet_iso_c else None,
                "exh_temp_tc_outlet_c": float(iso_data.exh_temp_tc_outlet_iso_c) if iso_data.exh_temp_tc_outlet_iso_c else None,
                "cyl_exhaust_gas_temp_outlet_c": float(iso_data.cyl_exhaust_gas_temp_outlet_graph_c) if iso_data.cyl_exhaust_gas_temp_outlet_graph_c else None,
                "fuel_consumption_total_kg_h": float(iso_data.fuel_consumption_total_graph_kg_h) if iso_data.fuel_consumption_total_graph_kg_h else None,
                "fuel_inj_pump_index_mm": float(iso_data.fuel_inj_pump_index_graph_mm) if iso_data.fuel_inj_pump_index_graph_mm else None,
                "correction_date": iso_data.correction_date.isoformat() if iso_data.correction_date else None
            }
            
            return monthly_point
            
        except Exception as e:
            logger.error(f"Error fetching monthly performance data: {e}")
            raise
    
    def get_report_info(self, report_id: int) -> Dict[str, Any]:
        """Get report and vessel information"""
        try:
            # Get monthly report header
            report = self.db.query(MonthlyReportHeader).filter(
                MonthlyReportHeader.report_id == report_id
            ).first()
            
            if not report:
                raise ValueError(f"Monthly report {report_id} not found")
            
            # Get vessel information
            vessel = self.db.query(VesselInfo).filter(
                VesselInfo.imo_number == report.imo_number
            ).first()
            
            if not vessel:
                raise ValueError(f"Vessel with IMO {report.imo_number} not found")
            
            return {
                "report_id": report_id,
                "imo_number": report.imo_number,
                "vessel_name": vessel.vessel_name,
                "engine_no": vessel.engine_no,
                "report_month": report.report_month,
                "report_date": report.report_date.isoformat() if report.report_date else None,
                "engine_maker": vessel.engine_maker,
                "engine_model": vessel.engine_model,
                "mcr_power_kw": float(vessel.mcr_power_kw) if vessel.mcr_power_kw else None,
                "generated_at": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Error fetching report information: {e}")
            raise
    
    def generate_graph_json(self, report_id: int) -> Dict[str, Any]:
        """Generate complete graph JSON for frontend"""
        try:
            print(f"Generating graph data for report {report_id}...")
            
            # Get report and vessel information
            report_info = self.get_report_info(report_id)
            print(f"Report: {report_info['vessel_name']} - {report_info['report_month']}")
            
            # Get shop trial baseline data using engine_no
            baseline_data = self.get_shop_trial_baseline(report_info['engine_no'])
            print(f"Found {len(baseline_data)} baseline data points")
            
            # Get monthly performance data
            monthly_data = self.get_monthly_performance_data(report_id)
            print(f"Monthly data at {monthly_data['load_percentage']}% load")
            
            # Define available metrics for plotting
            metrics = [
                {"key": "sfoc_g_kwh", "name": "SFOC", "unit": "g/kWh", "description": "Specific Fuel Oil Consumption"},
                {"key": "engine_speed_rpm", "name": "Engine Speed", "unit": "RPM", "description": "Engine Revolution Per Minute"},
                {"key": "max_combustion_pressure_bar", "name": "Max Combustion Pressure", "unit": "Bar", "description": "Maximum Combustion Pressure"},
                {"key": "compression_pressure_bar", "name": "Compression Pressure", "unit": "Bar", "description": "Compression Pressure"},
                {"key": "scav_air_pressure_kg_cm2", "name": "Scavenge Air Pressure", "unit": "kg/cm²", "description": "Scavenge Air Pressure"},
                {"key": "turbocharger_speed_x1000_rpm", "name": "Turbocharger Speed", "unit": "×1000 RPM", "description": "Turbocharger Speed"},
                {"key": "exh_temp_tc_inlet_c", "name": "T/C Inlet Exhaust Temp", "unit": "°C", "description": "Turbocharger Inlet Exhaust Temperature"},
                {"key": "exh_temp_tc_outlet_c", "name": "T/C Outlet Exhaust Temp", "unit": "°C", "description": "Turbocharger Outlet Exhaust Temperature"},
                {"key": "cyl_exhaust_gas_temp_outlet_c", "name": "Cylinder Outlet Exhaust Temp", "unit": "°C", "description": "Cylinder Outlet Exhaust Temperature"},
                {"key": "fuel_consumption_total_kg_h", "name": "Total Fuel Consumption", "unit": "kg/h", "description": "Total Fuel Consumption"},
                {"key": "fuel_inj_pump_index_mm", "name": "Fuel Injection Pump Index", "unit": "mm", "description": "Fuel Injection Pump Index"},
                {"key": "engine_output_kw", "name": "Engine Output", "unit": "kW", "description": "Engine Output Power"}
            ]
            
            # Build complete graph data structure
            graph_data = {
                "vessel_info": {
                    "vessel_name": report_info['vessel_name'],
                    "imo_number": report_info['imo_number'],
                    "engine_no": report_info['engine_no'],
                    "engine_maker": report_info['engine_maker'],
                    "engine_model": report_info['engine_model'],
                    "mcr_power_kw": report_info['mcr_power_kw']
                },
                "report_info": {
                    "report_id": report_info['report_id'],
                    "report_month": report_info['report_month'],
                    "report_date": report_info['report_date'],
                    "generated_at": report_info['generated_at']
                },
                "shop_trial_baseline": baseline_data,
                "monthly_performance": monthly_data,
                "available_metrics": metrics,
                "chart_config": {
                    "x_axis": {
                        "key": "load_percentage",
                        "label": "Load Percentage (%)",
                        "min": 20,
                        "max": 115
                    },
                    "default_metric": "sfoc_g_kwh"
                }
            }
            
            return graph_data
            
        except Exception as e:
            logger.error(f"Error generating graph data: {e}")
            raise

def find_report_by_imo_and_month(db: Session, imo_number: int, report_month: str) -> Optional[int]:
    """Find report ID using IMO number and report month"""
    try:
        report = db.query(MonthlyReportHeader).filter(
            MonthlyReportHeader.imo_number == imo_number,
            MonthlyReportHeader.report_month == report_month
        ).first()
        
        return report.report_id if report else None
        
    except Exception as e:
        logger.error(f"Error finding report: {e}")
        return None

def main():
    """Main execution function"""
    parser = argparse.ArgumentParser(
        description="Generate performance graph JSON from monthly report and shop trial data",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python generate_performance_graph.py --report_id 123
  python generate_performance_graph.py --imo_number 9481697 --report_month "2025-03"
  python generate_performance_graph.py --report_id 123 --output my_graph.json
        """
    )
    
    # Input options
    parser.add_argument("--report_id", type=int, help="Monthly report ID")
    parser.add_argument("--imo_number", type=int, help="Vessel IMO number")
    parser.add_argument("--report_month", type=str, help="Report month in YYYY-MM format")
    
    # Output options
    parser.add_argument("--output", type=str, help="Output JSON file path")
    parser.add_argument("--pretty", action="store_true", help="Pretty format JSON output")
    
    args = parser.parse_args()
    
    # Validate input arguments
    if not args.report_id and not (args.imo_number and args.report_month):
        print("ERROR: Must provide either:")
        print("  --report_id <ID>")
        print("  OR")
        print("  --imo_number <IMO> --report_month <YYYY-MM>")
        sys.exit(1)
    
    try:
        # Create database session
        db = SessionLocal()
        
        # Determine report_id
        if args.report_id:
            report_id = args.report_id
        else:
            print(f"Looking for report: IMO {args.imo_number}, Month {args.report_month}")
            report_id = find_report_by_imo_and_month(db, args.imo_number, args.report_month)
            if not report_id:
                print(f"ERROR: No report found for IMO {args.imo_number} in month {args.report_month}")
                sys.exit(1)
            print(f"Found report ID: {report_id}")
        
        # Generate graph data
        generator = PerformanceGraphGenerator(db)
        graph_data = generator.generate_graph_json(report_id)
        
        # Determine output file
        if args.output:
            output_file = args.output
        else:
            output_file = f"performance_graph_{report_id}.json"
        
        # Save JSON file
        with open(output_file, 'w') as f:
            if args.pretty:
                json.dump(graph_data, f, indent=2, ensure_ascii=False)
            else:
                json.dump(graph_data, f, ensure_ascii=False)
        
        print(f"\nSUCCESS: Graph data generated!")
        print(f"Output file: {output_file}")
        print(f"Vessel: {graph_data['vessel_info']['vessel_name']}")
        print(f"Baseline points: {len(graph_data['shop_trial_baseline'])}")
        print(f"Monthly load: {graph_data['monthly_performance']['load_percentage']}%")
        print(f"Available metrics: {len(graph_data['available_metrics'])}")
        
    except Exception as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    
    finally:
        if 'db' in locals():
            db.close()

if __name__ == "__main__":
    main()