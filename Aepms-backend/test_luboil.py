import os
import pdfplumber
import re
import json

def find_file_in_project(filename, search_root):
    print(f"🕵️‍♂️ Searching for '{filename}' in {search_root}...")
    for root, dirs, files in os.walk(search_root):
        if filename in files:
            return os.path.join(root, filename)
    return None

def extract_lube_report_data(pdf_path):
    print(f"\n🔍 Opening PDF: {pdf_path}")
    extracted_data = {}
    full_text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text: full_text += text + "\n"
        
        # Regex Extraction
        date_match = re.search(r"Sample Date\s+(\d{2}/\w{3}/\d{4})", full_text, re.IGNORECASE)
        if date_match: extracted_data['sample_date'] = date_match.group(1)

        visc_match = re.search(r"Viscosity 100°C cSt\s+([\d.]+)", full_text, re.IGNORECASE)
        if visc_match: extracted_data['viscosity_100c'] = visc_match.group(1)

        flash_match = re.search(r"Flash Point.*?°C\s+([>\d.]+)", full_text, re.IGNORECASE)
        if flash_match: extracted_data['flash_point'] = flash_match.group(1)

        fe_match = re.search(r"Iron \(Fe\) ppm\s+(\d+)", full_text, re.IGNORECASE)
        if fe_match: extracted_data['iron_ppm'] = fe_match.group(1)

        tbn_match = re.search(r"TBN.*?mg KOH/g\s+([\d.]+)", full_text, re.IGNORECASE)
        if tbn_match: extracted_data['tbn'] = tbn_match.group(1)
        
        return extracted_data
    except Exception as e:
        print(f"❌ Error reading PDF: {e}")
        return None

if __name__ == "__main__":
    # 🔴 TARGET FILENAME (The one you see in your tab)
    target_filename = "GCL GANGA -96.pdf" 

    # 1. Get the directory where this script lives
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 2. Look in current folder first
    full_path = os.path.join(script_dir, target_filename)
    
    if not os.path.exists(full_path):
        print(f"❌ Not found in current folder: {script_dir}")
        
        # 3. Search in the PARENT directory (Ozellar Project)
        parent_dir = os.path.dirname(os.path.dirname(script_dir)) # Go up 2 levels
        found_path = find_file_in_project(target_filename, parent_dir)
        
        if found_path:
            print(f"✅ FOUND IT HERE: {found_path}")
            full_path = found_path
        else:
            print("❌ Could not find the file anywhere in the project folders.")
            print("👉 Please Drag & Drop the PDF file into the 'iso-performance-backend' folder.")
            exit()

    # 4. Run extraction on the found path
    data = extract_lube_report_data(full_path)
    
    if data:
        print("\n✅ Extraction Results:")
        print(json.dumps(data, indent=4))
    else:
        print("\n⚠️ PDF opened, but no data matched the Regex patterns.")