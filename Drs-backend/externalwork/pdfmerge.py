import os
from PyPDF2 import PdfMerger

# Folder containing all your PDFs
pdf_folder = r"D:\Ozellar Project\PDFs"

# Output file name
output_path = os.path.join(pdf_folder, "merged_all.pdf")

# Initialize merger
merger = PdfMerger()

# Get all PDF files sorted alphabetically
pdf_files = sorted([f for f in os.listdir(pdf_folder) if f.endswith(".pdf")])

for pdf in pdf_files:
    merger.append(os.path.join(pdf_folder, pdf))
    print(f"Added: {pdf}")

# Write out the merged file
merger.write(output_path)
merger.close()

print(f"✅ Merged {len(pdf_files)} PDFs successfully into {output_path}")
