# app/ae_field_metadata.py
from decimal import Decimal
from datetime import date

AE_FIELD_METADATA_MAPPING = {
    # Vessel & Engine Info
    'vesselname': {'target_column': None, 'unit': None, 'type_hint': str},
    'imo': {'target_column': None, 'unit': None, 'type_hint': int},
    'aemaker': {'target_column': 'maker', 'unit': None, 'type_hint': str},
    'model': {'target_column': 'model', 'unit': None, 'type_hint': str},
    'noofcyl': {'target_column': 'num_of_cylinders', 'unit': 'cylinders', 'type_hint': int},
    'ratedload': {'target_column': 'rated_engine_output_kw', 'unit': 'KW', 'type_hint': Decimal},
    'engineselection': {'target_column': 'designation', 'unit': None, 'type_hint': str},
    
    # Report Header
    'performancedate': {'target_column': 'report_date', 'unit': None, 'type_hint': date},
    'reportmonth': {'target_column': 'report_month', 'unit': None, 'type_hint': str},
    'totalenginerunhrs': {'target_column': 'total_engine_run_hrs', 'unit': 'Hrs', 'type_hint': Decimal},
    'measuredby': {'target_column': 'measured_by', 'unit': None, 'type_hint': str},
    'chiefengineer': {'target_column': 'chief_engineer_name', 'unit': None, 'type_hint': str},
    
    # Performance Parameters (for graph data)
    'load': {'target_column': 'load_kw', 'unit': 'KW', 'type_hint': Decimal},
    '%load': {'target_column': 'load_percentage', 'unit': '%', 'type_hint': Decimal},
    
    # Cylinder readings - Pmax (MPa in PDF, convert to Bar)
    **{f'pmax#{i}': {'target_column': None, 'unit': 'MPa', 'type_hint': Decimal, 'convert_to': 'Bar', 'conversion_factor': Decimal('10')} 
       for i in range(1, 7)},
    
    # Boost Air Pressure (MPa in PDF, convert to Bar)
    'scavairpress': {'target_column': 'boost_air_pressure_graph_bar', 'unit': 'Bar', 'type_hint': Decimal},
    
    # Exhaust Temperatures
    'tcexhintemp': {'target_column': 'exh_temp_tc_inlet_graph_c', 'unit': '°C', 'type_hint': Decimal},
    'tcexhouttemp': {'target_column': 'exh_temp_tc_outlet_graph_c', 'unit': '°C', 'type_hint': Decimal},
    **{f'exhausttemp#{i}': {'target_column': None, 'unit': '°C', 'type_hint': Decimal} 
       for i in range(1, 7)},
    
    # Fuel Rack Index
    **{f'fuelrack#{i}': {'target_column': None, 'unit': 'mm', 'type_hint': Decimal} 
       for i in range(1, 7)},
}