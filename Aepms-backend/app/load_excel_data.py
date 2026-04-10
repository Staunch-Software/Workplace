#!/usr/bin/env python3
"""
Main entry script for loading ship engine performance data from Excel to PostgreSQL.
Supports both Main Engine (ME) and Auxiliary Engine (AE) data loading.
"""

import argparse
import sys
import os
import asyncio
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime

from .database import init_database, get_table_info
from .config import app_config, db_config, get_database_url, ensure_data_dir
from .excel_loader import load_excel_data
from .data_loader import load_data_to_database
from .ae_excel_loader import load_ae_excel_data
from .ae_data_loader import load_ae_data_to_database

def setup_logging(verbose: bool = False) -> None:
    """Setup comprehensive logging configuration."""
    log_level = logging.DEBUG if verbose else getattr(logging, app_config.LOG_LEVEL.upper())
    
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = log_dir / f"ship_performance_{timestamp}.log"
    
    logging.basicConfig(
        level=log_level,
        format='%(asctime)s | %(name)-20s | %(levelname)-8s | %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_file, encoding='utf-8')
        ]
    )
    
    logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('openpyxl').setLevel(logging.WARNING)
    
    logger = logging.getLogger(__name__)
    logger.info(f"Logging initialized. Log file: {log_file}")

def validate_excel_file(excel_path: str) -> bool:
    """Validate Excel file exists and is readable."""
    logger = logging.getLogger(__name__)
    
    if not os.path.exists(excel_path):
        logger.error(f"Excel file not found: {excel_path}")
        return False
    
    if not excel_path.lower().endswith(('.xlsx', '.xls')):
        logger.error(f"Invalid file format. Expected .xlsx or .xls, got: {excel_path}")
        return False
    
    try:
        file_size = os.path.getsize(excel_path)
        if file_size == 0:
            logger.error(f"Excel file is empty: {excel_path}")
            return False
        
        logger.info(f"Excel file validated: {excel_path} ({file_size:,} bytes)")
        return True
        
    except Exception as e:
        logger.error(f"Error validating Excel file: {e}")
        return False

def print_banner():
    """Print application banner."""
    banner = """
╔══════════════════════════════════════════════════════════════════════════════╗
║                    SHIP ENGINE PERFORMANCE DATA LOADER                      ║
║                                                                              ║
║                          Excel → PostgreSQL Pipeline                        ║
║                                                                              ║
║  Processes shop trial and monthly performance data from Excel workbooks     ║
║  and loads them into PostgreSQL database with full relationship mapping.    ║
╚══════════════════════════════════════════════════════════════════════════════╝
"""
    print(banner)

def print_config_info():
    """Print current configuration information."""
    logger = logging.getLogger(__name__)
    
    logger.info("Configuration:")
    logger.info(f"  Database: {get_database_url(include_password=False)}")
    logger.info(f"  Log Level: {app_config.LOG_LEVEL}")
    logger.info(f"  Data Directory: {app_config.DATA_DIR}")

async def load_excel_to_database(excel_path: Optional[str] = None, ae_excel_path: Optional[str] = None, 
                          create_tables: bool = True, dry_run: bool = False) -> bool:
    """
    Main function to orchestrate Excel data loading into PostgreSQL.
    
    Args:
        excel_path: Path to Main Engine Excel file (optional if ae_excel_path provided)
        ae_excel_path: Path to Auxiliary Engine Excel file (optional)
        create_tables: Whether to create database tables if they don't exist
        dry_run: If True, extract and validate data without loading to database
        
    Returns:
        bool: True if successful, False otherwise
    """
    logger = logging.getLogger(__name__)
    
    try:
        print_config_info()
        
        # Determine operation mode
        ae_only_mode = not excel_path and ae_excel_path
        me_only_mode = excel_path and not ae_excel_path
        dual_mode = excel_path and ae_excel_path
        
        if not excel_path and not ae_excel_path:
            logger.error("No input files provided. Specify ME file, AE file, or both.")
            return False
        
        # Step 2: Validate Main Engine Excel file
        if excel_path:
            logger.info("Validating Main Engine Excel file...")
            if not validate_excel_file(excel_path):
                if ae_only_mode:
                    logger.error("ME file validation failed and no AE file provided")
                    return False
                logger.warning("ME file invalid, continuing with AE data only")
                excel_path = None
        
        # Step 3: Validate AE Excel file
        if ae_excel_path:
            logger.info("Validating Auxiliary Engine Excel file...")
            if not validate_excel_file(ae_excel_path):
                if ae_only_mode:
                    return False
                logger.warning("AE Excel validation failed. Continuing with ME data only.")
                ae_excel_path = None
        
        # Step 4: Initialize database connection
        logger.info("Initializing database connection...")
        
        if not await init_database(create_tables=create_tables):
            logger.error("Failed to initialize database")
            return False
        
        # Step 5: Extract Main Engine data from Excel
        me_extracted_data = None
        me_total_records = 0
        
        if excel_path:
            logger.info("Extracting Main Engine data from Excel file...")
            try:
                me_extracted_data = load_excel_data(excel_path)
                me_total_records = sum(len(records) for records in me_extracted_data.values())
                
                logger.info("Main Engine data extraction summary:")
                for data_type, records in me_extracted_data.items():
                    logger.info(f"  {data_type}: {len(records)} records")
                
                if me_total_records == 0:
                    logger.warning("No Main Engine data was extracted from the Excel file")
                    if not ae_excel_path:
                        return False
                        
            except Exception as e:
                logger.error(f"Failed to extract ME data from Excel: {e}")
                if not ae_excel_path:
                    return False
                logger.warning("Continuing with AE data only")
                me_extracted_data = None
        
        # Step 6: Extract AE data if provided
        ae_extracted_data = None
        ae_total_records = 0
        
        if ae_excel_path:
            logger.info("Extracting Auxiliary Engine data from Excel file...")
            try:
                ae_extracted_data = load_ae_excel_data(ae_excel_path)
                ae_total_records = sum(len(records) for records in ae_extracted_data.values())
                
                logger.info("Auxiliary Engine data extraction summary:")
                for data_type, records in ae_extracted_data.items():
                    logger.info(f"  {data_type}: {len(records)} records")
                    
                if ae_total_records == 0:
                    logger.warning("No Auxiliary Engine data was extracted")
                    if not me_extracted_data:
                        return False
                        
            except Exception as e:
                logger.error(f"Failed to extract AE data from Excel: {e}")
                if not me_extracted_data:
                    return False
                logger.warning("Continuing with Main Engine data only")
                ae_extracted_data = None
        
        # Step 7: Handle dry run mode
        if dry_run:
            logger.info("DRY RUN MODE - No data will be loaded to database")
            print("\n" + "="*80)
            print("DRY RUN RESULTS")
            print("="*80)
            
            if me_extracted_data:
                print(f"\nMain Engine Excel file: {excel_path}")
                print(f"Main Engine total records found: {me_total_records:,}")
                
                for data_type, records in me_extracted_data.items():
                    if records:
                        print(f"\n{data_type.upper()}: {len(records)} records")
                        if len(records) > 0:
                            sample = records[0]
                            print("  Sample record:")
                            for key, value in list(sample.items())[:5]:
                                if value is not None:
                                    print(f"    {key}: {value}")
            
            if ae_extracted_data:
                print(f"\n{'='*80}")
                print(f"Auxiliary Engine Excel file: {ae_excel_path}")
                print(f"Auxiliary Engine total records found: {ae_total_records:,}")
                
                for data_type, records in ae_extracted_data.items():
                    if records:
                        print(f"\n{data_type.upper()}: {len(records)} records")
                        if len(records) > 0:
                            sample = records[0]
                            print("  Sample record:")
                            for key, value in list(sample.items())[:3]:
                                if value is not None:
                                    print(f"    {key}: {value}")
            
            print("\nDry run completed successfully!")
            return True
        
        # Step 8: Load Main Engine data into database
        me_stats = None
        if me_extracted_data and me_total_records > 0:
            logger.info("Loading Main Engine data into PostgreSQL database...")
            try:
                me_stats = await load_data_to_database(me_extracted_data)
            except Exception as e:
                logger.error(f"Failed to load Main Engine data into database: {e}")
                if not ae_extracted_data:
                    return False
                logger.warning("Continuing with AE data loading")
        
        # Step 9: Load AE data if available
        ae_stats = None
        if ae_extracted_data and ae_total_records > 0:
            logger.info("Loading Auxiliary Engine data into PostgreSQL database...")
            try:
                ae_stats = await load_ae_data_to_database(ae_extracted_data)
            except Exception as e:
                logger.error(f"Failed to load AE data into database: {e}")
                if not me_stats:
                    return False
                logger.warning("Main Engine data was loaded successfully")
        
        # Step 10: Display combined results
        print("\n" + "="*80)
        print("COMBINED LOADING SUMMARY")
        print("="*80)
        
        if me_stats:
            print(me_stats.get_summary())
            print(f"\nMain Engine Totals:")
            print(f"  Vessels: {me_stats.vessels_inserted} inserted, {me_stats.vessels_updated} updated")
            print(f"  Sessions: {me_stats.sessions_inserted} inserted, {me_stats.sessions_updated} updated")
            print(f"  Performance: {me_stats.performance_records_inserted} inserted, {me_stats.performance_records_updated} updated")
            print(f"  Monthly: {me_stats.monthly_headers_inserted} inserted, {me_stats.monthly_headers_updated} updated")
            print(f"  Errors: {len(me_stats.errors)}")
        
        if ae_stats:
            print(ae_stats.get_summary())
            print(f"\nAuxiliary Engine Totals:")
            print(f"  Generators: {ae_stats.generators_inserted} inserted, {ae_stats.generators_updated} updated")
            print(f"  Baseline: {ae_stats.baseline_inserted} inserted, {ae_stats.baseline_updated} updated")
            print(f"  Errors: {len(ae_stats.errors)}")
        
        # Calculate success
        me_total_processed = 0
        if me_stats:
            me_total_processed = (me_stats.vessels_inserted + me_stats.vessels_updated +
                                 me_stats.sessions_inserted + me_stats.sessions_updated +
                                 me_stats.performance_records_inserted + me_stats.performance_records_updated +
                                 me_stats.monthly_headers_inserted + me_stats.monthly_headers_updated)
        
        ae_total_processed = 0
        if ae_stats:
            ae_total_processed = (ae_stats.generators_inserted + ae_stats.generators_updated +
                                 ae_stats.baseline_inserted + ae_stats.baseline_updated)
        
        total_processed = me_total_processed + ae_total_processed
        
        print("="*80)
        
        # REPLACE WITH
        if total_processed > 0:
            logger.info(f"Data loading pipeline completed successfully! Processed {total_processed:,} records")
            result = True
        else:
            logger.error("No data was successfully loaded")
            result = False
        return result
    
    except Exception as e:
        logger.error(f"Unexpected error in data loading pipeline: {e}", exc_info=True)
        return False
    
    finally:
        from .database import engine
        await engine.dispose()

def main():
    """Main function with command line interface."""
    parser = argparse.ArgumentParser(
        description="Load ship engine performance data from Excel to PostgreSQL",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
EXAMPLES:
  Main Engine only:
    python -m app.main_excel data/shop_trials.xlsx
  
  Auxiliary Engine only:
    python -m app.main_excel --ae-only --ae-file data/generators.xlsx
  
  Main Engine + Auxiliary Engine:
    python -m app.main_excel data/shop_trials.xlsx --ae-file data/generators.xlsx
  
  Dry run (validate without loading):
    python -m app.main_excel data/shop_trials.xlsx --dry-run
  
  Verbose logging:
    python -m app.main_excel data/shop_trials.xlsx --verbose

ENVIRONMENT VARIABLES:
  DB_HOST         PostgreSQL host (default: localhost)
  DB_PORT         PostgreSQL port (default: 5432)
  DB_NAME         Database name (default: ship_performance)
  DB_USER         Database user (default: postgres)
  DB_PASSWORD     Database password (default: password)
        """
    )
    
    parser.add_argument(
        'excel_file',
        nargs='?',
        help='Path to Main Engine Excel file (optional if --ae-only)'
    )
    
    parser.add_argument(
        '--ae-file',
        help='Path to Auxiliary Engine Excel file'
    )
    
    parser.add_argument(
        '--ae-only',
        action='store_true',
        help='Load only Auxiliary Engine data (ME file not required)'
    )
    
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Extract and validate data without loading to database'
    )
    
    parser.add_argument(
        '--no-create-tables',
        action='store_true',
        help='Skip table creation (assumes tables already exist)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose logging (DEBUG level)'
    )
    
    parser.add_argument(
        '--check-db',
        action='store_true',
        help='Test database connection and show table info'
    )
    
    parser.add_argument(
        '--version',
        action='version',
        version='Ship Engine Performance Data Loader v1.2.0'
    )
    
    args = parser.parse_args()
    
    setup_logging(verbose=args.verbose)
    logger = logging.getLogger(__name__)
    
    print_banner()
    
    try:
        # Handle database check
        if args.check_db:
            logger.info("Testing database connection...")
            if asyncio.run(init_database(create_tables=False)):
                table_info = asyncio.run(get_table_info())
                if table_info:
                    print("\nDatabase Tables and Row Counts:")
                    print("-" * 50)
                    for table_name, row_count in table_info.items():
                        print(f"{table_name:30} {row_count:>10,} rows")
                else:
                    print("No tables found in database.")
                return 0
            else:
                print("Database connection failed!")
                return 1
        
        # Validate input arguments
        if args.ae_only:
            if not args.ae_file:
                print("❌ --ae-only requires --ae-file")
                return 1
            excel_path = None
            ae_excel_path = args.ae_file
        else:
            if not args.excel_file and not args.ae_file:
                print("❌ No input files provided. Specify ME file, AE file, or both.")
                print("   Use --help for usage examples")
                return 1
            excel_path = args.excel_file
            ae_excel_path = args.ae_file
        
        # Convert to absolute paths
        if excel_path:
            excel_path = Path(excel_path)
            if not excel_path.is_absolute():
                excel_path = Path.cwd() / excel_path
            excel_path = str(excel_path)
            logger.info(f"Processing Main Engine Excel file: {excel_path}")
        
        if ae_excel_path:
            ae_excel_path = Path(ae_excel_path)
            if not ae_excel_path.is_absolute():
                ae_excel_path = Path.cwd() / ae_excel_path
            ae_excel_path = str(ae_excel_path)
            logger.info(f"Processing Auxiliary Engine Excel file: {ae_excel_path}")
        
        # Main processing
        # REPLACE WITH
        success = asyncio.run(load_excel_to_database(
            excel_path=excel_path,
            ae_excel_path=ae_excel_path,
            create_tables=not args.no_create_tables,
            dry_run=args.dry_run
        ))

        if success:
            if not args.dry_run:
                print("\n✅ Data loading completed successfully!")
            return 0
        else:
            print("\n❌ Data loading failed!")
            print("Check the logs for detailed error information.")
            return 1
    
    except KeyboardInterrupt:
        logger.info("Operation interrupted by user")
        print("\n⚠️  Operation cancelled by user")
        return 1
    
    except Exception as e:
        logger.error(f"Unexpected error: {e}", exc_info=True)
        print(f"\n❌ Unexpected error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())