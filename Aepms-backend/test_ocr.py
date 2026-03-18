# D:\performance_engine\aepms_project\iso-performance-backend\debug_ocr.py

import os
import cv2
import numpy as np
import fitz  # PyMuPDF
from paddleocr import PaddleOCR
import shutil
import pandas as pd
import logging

# Configure logging for this script
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize PaddleOCR globally (reuse the same settings as your parser)
# show_log=False suppresses PaddleOCR's internal debug messages for cleaner output
ocr = PaddleOCR(use_angle_cls=True, lang='en', use_gpu=False, show_log=False)

def preprocess_image_for_ocr(image: np.ndarray, debug: bool = False) -> np.ndarray:
    """
    Enhanced image preprocessing for better OCR accuracy on scanned documents.
    (Copied from your shop_trial_parser.py for consistency)
    """
    if len(image.shape) == 3:
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    else:
        gray = image.copy()
    
    # Apply Gaussian blur to reduce noise (kernel size 3x3 or 5x5 might be better)
    blurred = cv2.GaussianBlur(gray, (3, 3), 0) # Increased kernel size for more blur

    # Apply adaptive thresholding
    # Experiment with block_size (odd number, e.g., 11, 21, 31) and C (e.g., 2, 5, 10)
    thresh = cv2.adaptiveThreshold(
        blurred, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY, 31, 10 # Increased block_size and C for potentially better watermark handling
    )
    
    # Morphological operations to clean up the image (larger kernel for more effect)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2)) # Increased kernel size
    cleaned = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    
    if debug:
        cv2.imwrite("debug_preprocessed.png", cleaned)
        logger.info("Debug: Saved preprocessed image")
    
    return cleaned

def run_full_ocr_debug(pdf_path: str, target_page_index: int = 0):
    """
    Runs OCR on a specified PDF page and prints all raw PaddleOCR output,
    including text detections, confidence scores, and table HTML.
    """
    logger.info(f"Starting full OCR debug for PDF: {pdf_path}, targeting page index: {target_page_index}")
    
    temp_image_dir = "debug_ocr_images"
    os.makedirs(temp_image_dir, exist_ok=True)
    
    try:
        # --- Convert PDF to images using PyMuPDF ---
        doc = fitz.open(pdf_path)
        image_paths = []
        
        if target_page_index >= len(doc):
            logger.error(f"Target page index {target_page_index} is out of bounds for PDF with {len(doc)} pages.")
            return

        # Only convert the target page for efficiency in debugging
        page = doc[target_page_index]
        matrix = fitz.Matrix(300/72, 300/72) # Render at 300 DPI
        pix = page.get_pixmap(matrix=matrix)
        img_path = os.path.join(temp_image_dir, f"page_{target_page_index+1}.png")
        pix.save(img_path)
        image_paths.append(img_path)
        
        doc.close()
        logger.info(f"Converted page {target_page_index+1} to image: {img_path}")

        # --- Load and Preprocess Image ---
        img = cv2.imread(img_path)
        if img is None:
            logger.error(f"Could not read image: {img_path}")
            return
        
        # Preprocess the image (set debug=True to save the intermediate image)
        preprocessed_img = preprocess_image_for_ocr(img, debug=True)

        # --- Run PaddleOCR in full mode (detection, recognition, table) ---
        logger.info("Running PaddleOCR on the preprocessed image...")
        # The `table=True` flag is crucial for getting structured table output
        ocr_result = ocr.ocr(preprocessed_img, cls=True, rec=True, det=True, table=True)

        if ocr_result and ocr_result[0]:
            # --- Print Raw Text Detections ---
            logger.info("\n--- Raw Text Detections (Bounding Box, Text, Confidence) ---")
            for detection in ocr_result[0]:
                if len(detection) >= 2 and detection[1]:
                    coords = detection[0]
                    text_info = detection[1]
                    text = text_info[0] if isinstance(text_info, (list, tuple)) else str(text_info)
                    confidence = text_info[1] if isinstance(text_info, (list, tuple)) and len(text_info) > 1 else 1.0
                    logger.info(f"  Coords: {coords}, Text: '{text}', Confidence: {confidence:.2f}")
            
            # --- Print Full OCR'd Text (concatenated) ---
            full_text_concat = "\n".join([line[1][0] for line in ocr_result[0]])
            logger.info("\n--- Full OCR'd Text (Concatenated) ---")
            logger.info(full_text_concat)

            # --- Print Table HTML Output ---
            if 'html' in ocr_result[0]:
                table_html = ocr_result[0]['html']
                logger.info("\n--- PaddleOCR Table HTML Output ---")
                logger.info(table_html)

                # --- Try to parse HTML with Pandas and print DataFrame ---
                try:
                    dfs = pd.read_html(table_html)
                    if dfs:
                        table_df = dfs[0] # Get the first DataFrame
                        logger.info("\n--- Extracted Table DataFrame (using pandas) ---")
                        logger.info(table_df.to_string()) # Use to_string() for full DataFrame output
                    else:
                        logger.warning("Pandas could not extract any DataFrame from the HTML output.")
                except Exception as e:
                    logger.error(f"Error parsing HTML with pandas: {e}")
            else:
                logger.warning("PaddleOCR did not return HTML table structure for this page.")

        else:
            logger.warning("No text detected by PaddleOCR on this page.")

    except Exception as e:
        logger.error(f"Error during PDF processing: {e}")
    finally:
        # Clean up temporary images
        if os.path.exists(temp_image_dir):
            shutil.rmtree(temp_image_dir)
            logger.info(f"Cleaned up temporary image directory: {temp_image_dir}")

# Example usage
if __name__ == "__main__":
    # IMPORTANT: Place your shop trial PDF (e.g., MA-H-804C-18W-04.pdf)
    # in the same directory as this debug_ocr.py script for easy testing.
    # If you're using a multi-page PDF, adjust target_page_index to the page
    # containing the "Summary Data of Shop Trial" table (0-indexed).
    # For MA-H-804C-18W-04.pdf, the table is on page 4, so index is 3.
    # If you cropped it to a single page, index is 0.
    
    test_pdf_path = "shop Trail raw data" # Adjust this path as needed
    page_with_table_index = 0 # For the full MA-H-804C-18W-04.pdf, page 4 is index 3

    if os.path.exists(test_pdf_path):
        run_full_ocr_debug(test_pdf_path, target_page_index=page_with_table_index)
    else:
        logger.error(f"Error: PDF file not found at {test_pdf_path}")
        logger.info("Please place the shop trial PDF in the same directory as debug_ocr.py for testing.")