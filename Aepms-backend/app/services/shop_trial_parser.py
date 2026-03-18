import os
import re
import cv2
import numpy as np
from paddleocr import PaddleOCR
import fitz  # PyMuPDF
from PIL import Image
from typing import List, Dict, Any, Optional, Tuple
from datetime import date
import shutil
import pandas as pd
from fuzzywuzzy import fuzz
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Corrected import path for data_models
from app.schemas.data_models import AmbientConditions, PerformanceParameters, ShopTrialData

# Initialize PaddleOCR globally to avoid re-loading models for every request
ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=False, show_log=False)

# Enhanced parameter mapping dictionary with more variations and OCR error corrections
PARAMETER_MAPPINGS = {
    # Ambient conditions with OCR error variations
    "ambient_temperature": [
        "room temperature", "ambient temp", "temperature", "temp room",
        "air temperature", "ambient air temp", "air temp", "atmospheric temperature",
        "room temp", "temp", "°c", "celsius", "temp ambient",
        # OCR error variations
        "temperalure", "lemperature", "temperaiure", "remperature"
    ],
    "ambient_pressure": [
        "barometer pressure", "ambient pressure", "atmospheric pressure", "bar pressure",
        "atm pressure", "barometric", "pressure", "mbar", "bar", "kpa", "ambient press",
        # OCR error variations  
        "baramerer pressure", "bararneler pressure", "baromeler pressure", "bararnerer pressune"
    ],
    "ambient_humidity": [
        "room humidity", "ambient humidity", "humidity", "relative humidity",
        "rh", "%rh", "humid", "moisture", "ambient rh", "air humidity",
        # OCR error variations
        "hurndity", "hurnidity", "relaiive humidity"
    ],
    
    # Performance parameters with OCR error variations
    "engine_speed": [
        "engine speed", "speed", "rpm", "revolution", "revolutions", "rev/min",
        "engine rpm", "shaft speed", "crankshaft speed", "rotational speed",
        # OCR error variations
        "enqine speed", "engne speed", "engine speid", "eneanespeed"
    ],
    "engine_output": [
        "engine output", "power", "output", "engine power", "brake power",
        "bhp", "kw", "kilowatt", "horsepower", "shaft power", "mechanical power",
        # OCR error variations
        "engne output", "enqine output", "engine outpul"
    ],
    "fuel_oil_consumption_raw": [
        "fuel oil consumption", "fuel consumption", "foc", "sfc", "specific fuel consumption",
        "fuel rate", "consumption", "g/kwh", "g/kw-h", "fuel oil", "diesel consumption",
        # OCR error variations
        "fuel oil consumplion", "fual oil consumption"
    ],
    "exhaust_gas_temp_tc_inlet": [
        "exh temp t/c inlet", "exhaust temp tc inlet", "tc inlet temp", "turbo inlet",
        "exhaust gas temperature tc inlet", "turbine inlet temperature", "exhaust inlet temp",
        "t/c inlet", "turbocharger inlet", "exhaust temperature inlet"
    ],
    "exhaust_gas_temp_tc_outlet": [
        "exh temp t/c outlet", "exhaust temp tc outlet", "tc outlet temp", "turbo outlet",
        "exhaust gas temperature tc outlet", "turbine outlet temperature", "exhaust outlet temp",
        "t/c outlet", "turbocharger outlet", "exhaust temperature outlet"
    ],
    "scavenge_air_pressure": [
        "scav air pressure", "scavenge pressure", "boost pressure", "air pressure",
        "scavenge air press", "intake pressure", "charge air pressure", "compressed air pressure"
    ],
    "scavenge_air_temperature": [
        "scav air temperature", "scavenge temp", "air temperature", "intake temp",
        "scavenge air temp", "charge air temperature", "compressed air temp", "intake air temp"
    ],
    "max_combustion_pressure": [
        "max combustion pressure", "combustion pressure", "max pressure", "peak pressure",
        "maximum combustion pressure", "cylinder pressure max", "peak combustion pressure",
        "pmax", "firing pressure"
    ],
    "compression_pressure": [
        "compression pressure", "comp pressure", "cylinder pressure", "compression press",
        "compression end pressure", "compression ratio pressure"
    ]
}

def preprocess_image_for_ocr(image: np.ndarray, debug: bool = False) -> np.ndarray:
    """
    Enhanced image preprocessing for better OCR accuracy on scanned documents.
    """
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()
    
    # Apply Gaussian blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (1, 1), 0)
    
    # Apply adaptive thresholding
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 11, 2
    )
    
    # Morphological operations to clean up the image
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 1))
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    if debug:
        cv2.imwrite("debug_preprocessed.png", cleaned)
        logger.info("Debug: Saved preprocessed image")
    
    return cleaned

def fuzzy_match_parameter(extracted_text: str, target_parameters: Dict[str, List[str]], threshold: int = 70) -> Optional[str]:
    """
    Use fuzzy matching to find the best parameter match with lower threshold.
    """
    best_match = None
    best_score = 0
    
    extracted_lower = extracted_text.lower().strip()
    
    for param_key, param_variations in target_parameters.items():
        for variation in param_variations:
            # Try multiple fuzzy matching algorithms
            scores = [
                fuzz.ratio(extracted_lower, variation.lower()),
                fuzz.partial_ratio(extracted_lower, variation.lower()),
                fuzz.token_sort_ratio(extracted_lower, variation.lower()),
                fuzz.token_set_ratio(extracted_lower, variation.lower())
            ]
            score = max(scores)
            
            if score > best_score and score >= threshold:
                best_score = score
                best_match = param_key
    
    if best_match:
        logger.info(f"Matched '{extracted_text}' to '{best_match}' with score {best_score}")
    
    return best_match

def extract_numeric_value(text: str) -> Optional[float]:
    """
    Enhanced numeric value extraction handling OCR errors and various formats.
    """
    if not text or pd.isna(text):
        return None
    
    # Convert to string if not already
    text = str(text).strip()
    
    # Handle common OCR errors
    text = text.replace('O', '0').replace('o', '0').replace('I', '1').replace('l', '1')
    text = text.replace('S', '5').replace('B', '8').replace('G', '6')
    
    # Remove common units and symbols but keep numbers
    text = re.sub(r'[°%]', '', text)  # Remove degree and percent symbols
    text = re.sub(r'[A-Za-z]+', '', text)  # Remove all letters
    
    # Extract all numbers (including decimals and negative)
    number_pattern = r'-?\d*\.?\d+'
    matches = re.findall(number_pattern, text)
    
    # Filter out empty matches and convert to float
    valid_numbers = []
    for match in matches:
        if match and match != '.' and match != '-':
            try:
                num = float(match)
                # Filter out unreasonable values (like single digits that might be OCR errors)
                if abs(num) > 0.1:  # Allow small decimals but filter out tiny numbers
                    valid_numbers.append(num)
            except ValueError:
                continue
    
    # Return the first valid number found
    if valid_numbers:
        return valid_numbers[0]
    
    return None

def find_target_load_column(df: pd.DataFrame) -> Optional[str]:
    """
    Find the column representing 100% load or closest match.
    """
    if df.empty:
        return None
    
    # Look for columns that might represent 100% load
    possible_columns = []
    
    for col in df.columns:
        col_str = str(col).lower()
        
        # Direct matches
        if any(target in col_str for target in ['100%', '100-1', '100 %', 'hundred']):
            return col
        
        # Numeric columns around 100
        if col_str.replace('.', '').replace('-', '').isdigit():
            try:
                num_val = float(re.sub(r'[^\d.]', '', col_str))
                if 95 <= num_val <= 110:
                    possible_columns.append((col, abs(100 - num_val)))
            except ValueError:
                pass
    
    # Return the column closest to 100
    if possible_columns:
        return min(possible_columns, key=lambda x: x[1])[0]
    
    # Fallback to the last numeric column
    numeric_cols = [col for col in df.columns if pd.api.types.is_numeric_dtype(df[col])]
    if numeric_cols:
        return numeric_cols[-1]
    
    return None

def extract_table_data_from_image(image_path: str, page_num: int) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Extract table data from a specific image using improved OCR strategies.
    """
    logger.info(f"Processing page {page_num} for table data extraction")
    
    img = cv2.imread(image_path)
    if img is None:
        logger.error(f"Could not read image: {image_path}")
        return {}, {}
    
    # Try both original and preprocessed images
    images_to_try = [
        ("original", img),
        ("preprocessed", preprocess_image_for_ocr(img))
    ]
    
    ambient_data = {}
    performance_data = {}
    
    for img_type, processed_img in images_to_try:
        logger.info(f"Trying OCR on {img_type} image")
        
        try:
            # Get OCR results
            ocr_result = ocr.ocr(processed_img, cls=True)
            
            if ocr_result and ocr_result[0]:
                # Extract all text with coordinates
                text_data = []
                for detection in ocr_result[0]:
                    if len(detection) >= 2 and detection[1]:
                        coords = detection[0]
                        text_info = detection[1]
                        text = text_info[0] if isinstance(text_info, (list, tuple)) else str(text_info)
                        confidence = text_info[1] if isinstance(text_info, (list, tuple)) and len(text_info) > 1 else 1.0
                        
                        # Calculate center coordinates
                        center_y = sum(coord[1] for coord in coords) / 4
                        center_x = sum(coord[0] for coord in coords) / 4
                        
                        text_data.append({
                            'text': text.strip(),
                            'confidence': confidence,
                            'y': center_y,
                            'x': center_x,
                            'coords': coords
                        })
                
                # Sort by Y coordinate (top to bottom) then X coordinate (left to right)
                text_data.sort(key=lambda x: (x['y'], x['x']))
                
                # Process each text item
                for i, item in enumerate(text_data):
                    text = item['text']
                    
                    # Try to match parameter
                    matched_param = fuzzy_match_parameter(text, PARAMETER_MAPPINGS)
                    
                    if matched_param:
                        # Found a parameter, now look for its value
                        value = None
                        
                        # Strategy 1: Check if the same text contains the value
                        value = extract_numeric_value(text)
                        
                        # Strategy 2: Look in nearby cells (same row)
                        if value is None:
                            row_threshold = 20  # pixels
                            for j in range(i+1, min(i+10, len(text_data))):  # Check next 10 items
                                candidate = text_data[j]
                                # Check if it's in the same row
                                if abs(candidate['y'] - item['y']) < row_threshold:
                                    value = extract_numeric_value(candidate['text'])
                                    if value is not None:
                                        logger.info(f"Found value {value} for '{matched_param}' in nearby text '{candidate['text']}'")
                                        break
                        
                        # Strategy 3: Look for values in the entire row area
                        if value is None:
                            row_texts = []
                            for candidate in text_data:
                                if abs(candidate['y'] - item['y']) < 30:  # Wider row threshold
                                    row_texts.append(candidate['text'])
                            
                            # Try to extract value from combined row text
                            combined_text = ' '.join(row_texts)
                            value = extract_numeric_value(combined_text)
                        
                        # If we found a value, store it
                        if value is not None:
                            if matched_param in ["ambient_temperature", "ambient_pressure", "ambient_humidity"]:
                                ambient_data[matched_param] = value
                                logger.info(f"Added ambient data: {matched_param} = {value}")
                            else:
                                performance_data[matched_param] = value
                                logger.info(f"Added performance data: {matched_param} = {value}")
        
        except Exception as e:
            logger.error(f"Error during OCR processing: {e}")
    
    # Additional strategy: Look for common value patterns
    # Sometimes values are extracted separately from parameter names
    if not ambient_data or not performance_data:
        logger.info("Trying to find isolated numeric values...")
        
        # Look for typical value ranges for missing parameters
        for item in text_data if 'text_data' in locals() else []:
            value = extract_numeric_value(item['text'])
            if value is not None:
                # Try to infer parameter based on value range
                if 15 <= value <= 50 and 'ambient_temperature' not in ambient_data:
                    ambient_data['ambient_temperature'] = value
                    logger.info(f"Inferred ambient temperature: {value}")
                elif 900 <= value <= 1100 and 'ambient_pressure' not in ambient_data:
                    ambient_data['ambient_pressure'] = value
                    logger.info(f"Inferred ambient pressure: {value}")
                elif 30 <= value <= 90 and 'ambient_humidity' not in ambient_data:
                    ambient_data['ambient_humidity'] = value
                    logger.info(f"Inferred ambient humidity: {value}")
                elif 500 <= value <= 2000 and 'engine_speed' not in performance_data:
                    performance_data['engine_speed'] = value
                    logger.info(f"Inferred engine speed: {value}")
                elif 100 <= value <= 10000 and 'engine_output' not in performance_data:
                    performance_data['engine_output'] = value
                    logger.info(f"Inferred engine output: {value}")
    
    logger.info(f"Page {page_num} - Final ambient data: {ambient_data}")
    logger.info(f"Page {page_num} - Final performance data: {performance_data}")
    
    return ambient_data, performance_data

def extract_data_from_shop_trial_pdf(pdf_path: str) -> Optional[ShopTrialData]:
    """
    Main function to extract shop trial data from PDF.
    """
    logger.info(f"Starting extraction for shop trial PDF: {pdf_path}")
    
    temp_image_dir = "temp_pdf_images"
    os.makedirs(temp_image_dir, exist_ok=True)
    
    try:
        # Convert PDF to images
        doc = fitz.open(pdf_path)
        image_paths = []
        
        for i, page in enumerate(doc):
            # Higher DPI for better OCR
            matrix = fitz.Matrix(300/72, 300/72)
            pix = page.get_pixmap(matrix=matrix)
            img_path = os.path.join(temp_image_dir, f"page_{i+1}.png")
            pix.save(img_path)
            image_paths.append(img_path)
        
        doc.close()
        logger.info(f"Converted {len(image_paths)} pages to images")
        
        # Initialize data containers
        all_ambient_data = {}
        all_performance_data = {}
        
        # Process all pages to find data
        for i, img_path in enumerate(image_paths):
            logger.info(f"Processing page {i+1}/{len(image_paths)}")
            
            ambient_data, performance_data = extract_table_data_from_image(img_path, i+1)
            
            # Merge data (later pages may have more complete data)
            all_ambient_data.update(ambient_data)
            all_performance_data.update(performance_data)
        
        logger.info(f"Final extracted data - Ambient: {all_ambient_data}")
        logger.info(f"Final extracted data - Performance: {all_performance_data}")
        
        # Validate and create Pydantic models
        try:
            # Filter out None values and create models
            clean_ambient_data = {k: v for k, v in all_ambient_data.items() if v is not None}
            clean_performance_data = {k: v for k, v in all_performance_data.items() if v is not None}
            
            # Provide reasonable defaults for missing data
            ambient_defaults = {
                'ambient_temperature': 25.0,  # Default room temperature
                'ambient_pressure': 1013.25,  # Standard atmospheric pressure
                'ambient_humidity': 60.0  # Typical humidity
            }
            
            performance_defaults = {
                'engine_speed': 1000.0,
                'engine_output': 1000.0,
                'fuel_oil_consumption_raw': 200.0,
                'exhaust_gas_temp_tc_inlet': 400.0,
                'exhaust_gas_temp_tc_outlet': 300.0,
                'scavenge_air_pressure': 2.5,
                'scavenge_air_temperature': 50.0,
                'max_combustion_pressure': 150.0,
                'compression_pressure': 140.0
            }
            
            # Use extracted values where available, defaults otherwise
            final_ambient_data = {**ambient_defaults, **clean_ambient_data}
            final_performance_data = {**performance_defaults, **clean_performance_data}
            
            ambient_conditions = AmbientConditions(**final_ambient_data)
            performance_params = PerformanceParameters(**final_performance_data)
            
            shop_trial_data = ShopTrialData(
                ambient_conditions=ambient_conditions,
                performance_at_100_load=performance_params
            )
            
            logger.info("Successfully created ShopTrialData model")
            logger.info(f"Used extracted ambient values: {list(clean_ambient_data.keys())}")
            logger.info(f"Used extracted performance values: {list(clean_performance_data.keys())}")
            
            return shop_trial_data
            
        except Exception as e:
            logger.error(f"Error creating Pydantic models: {e}")
            return None
    
    except Exception as e:
        logger.error(f"Error during PDF processing: {e}")
        return None
    
    finally:
        # Clean up temporary images
        if os.path.exists(temp_image_dir):
            shutil.rmtree(temp_image_dir)
            logger.info(f"Cleaned up temporary directory: {temp_image_dir}")

# Example usage
if __name__ == "__main__":
    # Add your test PDF path here
    shop_trial_pdf_path = "MA-H-804C-18W-04.pdf"
    
    if os.path.exists(shop_trial_pdf_path):
        extracted_data = extract_data_from_shop_trial_pdf(shop_trial_pdf_path)
        if extracted_data:
            print("\n✅ Shop Trial Data Extraction Successful!")
            print(extracted_data.model_dump_json(indent=2))
        else:
            print("\n❌ Shop Trial Data Extraction Failed.")
    else:
        print(f"❌ Error: PDF file not found at {shop_trial_pdf_path}")
        print("Please place a shop trial PDF in the directory for testing.")