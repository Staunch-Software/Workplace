# Ship Engine Performance Data Loader

A Python system to load ship engine performance data from Excel files into a PostgreSQL database.

## Features

- **Modular Architecture**: Clean separation between Excel parsing, database operations, and data transformation
- **Robust Data Handling**: Safe type conversion, error handling, and validation
- **Upsert Logic**: Prevents duplicates by updating existing records
- **Comprehensive Logging**: Detailed logging and statistics reporting
- **Flexible Configuration**: Environment variables and command-line options

## Database Schema

The system supports the following data types:
- **Vessel Information**: Master data for engines/vessels
- **Shop Trial Sessions**: Trial metadata and conditions
- **Performance Data**: Detailed measurements at different load points
- **Crank Shaft Deflections**: Mechanical measurements
- **Bearing Temperatures**: Temperature monitoring data

## Installation

1. **Clone/Download the code files**

2. **Install Python dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Set up PostgreSQL database**:
   ```sql
   CREATE DATABASE ship_performance;
   ```

4. **Configure environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

## Usage

### Basic Usage

```bash
# Load Excel data to database
python main.py path/to/your/shop_trials.xlsx
```

### Advanced Usage

```bash
# Specify custom database URL
python main.py shop_trials.xlsx --db-url "postgresql://user:pass@host:5432/db"

# Skip table creation (if tables already exist)
python main.py shop_trials.xlsx --no-create-tables

# Dry run to validate data without loading
python main.py shop_trials.xlsx --dry-run

# Verbose logging
python main.py shop_trials.xlsx --verbose
```

### Environment Variables

Create a `.env` file with your database configuration:

```
DB_USER=postgres
DB_PASSWORD=your_password
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ship_performance
```

## Excel File Structure

The system expects Excel files with the following characteristics:

### Sheet Organization
- Each sheet represents a vessel or test session
- Sheet names are used as vessel names
- Multiple load points per session are supported

### Required Data Points
- **Engine Number**: Unique identifier for the engine
- **Vessel Information**: Name, IMO, hull number, specifications
- **Trial Date**: When the test was conducted
- **Performance Data**: Load percentages, power output, fuel consumption, temperatures, pressures

### Data Layout Examples

**Vessel Info Section**:
```
Engine No:        ABC123
Vessel Name:      MV Example
IMO Number:       1234567
MCR Power:        15000 kW
```

**Performance Data Section**:
```
Load %    Output (kW)    RPM    SFOC (g/kWh)    Pmax (bar)
25        3750           105    195             140
50        7500           120    185             155
75        11250          135    180             170
100       15000          150    175             185
```

## File Structure

```
project/
├── db.py                 # Database connection and session management
├── models.py            # SQLAlchemy ORM models
├── excel_loader.py      # Excel data extraction and transformation
├── data_loader.py       # Database loading with upsert logic
├── main.py              # Main entry script
├── requirements.txt     # Python dependencies
├── .env.example        # Environment variables template
└── README.md           # This file
```

## Key Features

### 1. Modular Design
- **`db.py`**: Handles all database connections and session management
- **`models.py`**: SQLAlchemy ORM models matching the PostgreSQL schema
- **`excel_loader.py`**: Excel parsing logic (easily replaceable with PDF parser)
- **`data_loader.py`**: Database insertion with upsert logic
- **`main.py`**: Orchestrates the entire pipeline

### 2. Error Handling
- Skips invalid rows with detailed error logging
- Continues processing even when individual records fail
- Comprehensive error reporting and statistics

### 3. Data Validation
- Type conversion with fallback values
- Required field validation
- Foreign key constraint handling

### 4. Upsert Logic
- Prevents duplicate vessels (by `engine_no`)
- Prevents duplicate sessions (by `engine_no` + `trial_date`)
- Updates existing records with new data when found

### 5. Performance Optimization
- Batch processing for large datasets
- Proper indexing on frequently queried fields
- Connection pooling and session management

## Database Schema Overview

### Core Tables

**vessel_info**: Master data for engines and vessels
- `engine_no` (Primary Key): Unique engine identifier
- Vessel specifications, owner information, engine details

**shop_trial_session**: Test session metadata
- Links to vessel via `engine_no`
- Trial conditions, dates, and documentation

**shop_trial_performance_data**: Detailed performance measurements
- Load point data with measured and ISO-corrected values
- Power output, fuel consumption, temperatures, pressures

**shop_trial_crank_shaft_deflection**: Mechanical measurements
- Deflection values by cylinder and crank position

**shop_trial_bearing_temperature**: Temperature monitoring
- Bearing temperatures by type and position

### Monthly Performance Tables (Future Use)

**monthly_report_header**: Key performance indicators from monthly reports
**monthly_report_details_jsonb**: Flexible storage for detailed monthly data

## Logging and Monitoring

The system provides comprehensive logging:

- **INFO Level**: Progress updates, successful operations
- **WARNING Level**: Non-fatal errors, skipped records
- **ERROR Level**: Fatal errors, failed operations
- **DEBUG Level**: Detailed processing information (use `--verbose`)

Log files are written to `data_loading.log` in the current directory.

## Statistics Reporting

After each run, you'll see a detailed summary:

```
Data Loading Summary:
- Vessels: 8 inserted, 2 updated
- Sessions: 12 inserted, 0 updated
- Performance Records: 48 inserted, 0 updated
- Deflection Records: 96 inserted
- Bearing Records: 144 inserted
- Errors: 3
```

## Error Handling

Common error scenarios and solutions:

### 1. Database Connection Issues
```
ERROR - Database connection failed: could not connect to server
```
**Solution**: Check PostgreSQL is running and credentials are correct

### 2. Missing Required Data
```
WARNING - Missing engine_no: vessel: {'vessel_name': 'Unknown'}
```
**Solution**: Ensure Excel file has proper engine numbers in recognizable format

### 3. Data Type Issues
```
WARNING - Error converting value to decimal: 'N/A'
```
**Solution**: System handles this gracefully by using NULL values

### 4. Duplicate Data
```
INFO - Updated vessel: ENG001
```
**Solution**: System automatically updates existing records

## Customization

### Excel Structure Adaptation

If your Excel files have different structure, modify `excel_loader.py`:

1. **Update field mapping patterns** in `extract_vessel_info()`:
   ```python
   header_patterns = {
       'engine_no': ['Engine No', 'Engine Serial', 'Your Custom Field'],
       # Add your patterns here
   }
   ```

2. **Modify data extraction logic** in `extract_performance_data()`:
   ```python
   # Customize how you identify performance data rows
   load_rows = []  # Your custom logic here
   ```

3. **Adjust session linking** in `_infer_session_key()`:
   ```python
   # Customize how child records link to sessions
   return f"{engine_no}_{trial_date}"
   ```

### Database Schema Extensions

To add new fields:

1. **Update models.py**: Add new columns to ORM models
2. **Update data cleaning methods**: Modify `_clean_*_data()` methods
3. **Update Excel extraction**: Add extraction logic for new fields

## Troubleshooting

### Common Issues

1. **Excel file not found**
   - Check file path is correct
   - Ensure file has `.xlsx` or `.xls` extension

2. **No data extracted**
   - Verify Excel file structure matches expected format
   - Use `--dry-run` to see what data is found
   - Check sheet names and data organization

3. **Database permission errors**
   - Ensure PostgreSQL user has CREATE, INSERT, UPDATE permissions
   - Verify database exists and is accessible

4. **Memory issues with large files**
   - Process Excel files in smaller chunks
   - Consider splitting large files into multiple smaller ones

### Debugging Tips

1. **Use dry-run mode** to validate data extraction:
   ```bash
   python main.py your_file.xlsx --dry-run
   ```

2. **Enable verbose logging**:
   ```bash
   python main.py your_file.xlsx --verbose
   ```

3. **Check log files** for detailed error information:
   ```bash
   tail -f data_loading.log
   ```

## Future Extensions

This modular design allows easy extension for:

### PDF Processing
Replace `excel_loader.py` with `pdf_parser.py` for direct PDF ingestion:
```python
from pdf_parser import load_pdf_data  # Instead of load_excel_data
```

### Real-time Processing
Add API endpoints to accept uploaded files and process them immediately.

### Dashboard Integration
The database structure supports direct visualization and reporting tools.

### Advanced Analytics
Performance trend analysis, predictive maintenance, and comparison reporting.

## Development

### Adding New Data Types

1. **Create new ORM model** in `models.py`
2. **Add extraction logic** in `excel_loader.py`
3. **Add loading logic** in `data_loader.py`
4. **Update main pipeline** in `main.py`

### Testing

For production use, consider adding:
- Unit tests for data extraction logic
- Integration tests for database operations
- Validation tests for data quality

### Performance Optimization

For large datasets:
- Implement batch processing in `data_loader.py`
- Add connection pooling configuration
- Consider using bulk insert operations for initial loads

## Support

For issues or questions:
1. Check the log files for detailed error information
2. Verify your Excel file structure matches the expected format
3. Test with a small sample file first
4. Use dry-run mode to validate data extraction

## License

This system is designed for ship engine performance monitoring applications.#   A e p m s - b a c k e n d  
 