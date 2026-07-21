"""
Lube Oil Extractor Factory
============================
This is the single entry point for ALL PDF extractions.
It automatically detects the lab that produced the PDF and
delegates to the correct specialist extractor.

Priority routing order:
  1. Gulf Marine   → gulf_extractor.py
  2. Tribocare     → tribocare_extractor.py
  3. Shell / Default → existing luboil_pdf_extractor.py (unchanged)

Usage (from luboil_report_processor.py):
    from app.services.pdf_extractors.factory import extract_lube_oil_report_data
"""
import logging
import pdfplumber
from typing import Any, Dict, Optional, BinaryIO

from app.services.pdf_extractors import gulf_extractor
from app.services.pdf_extractors import tribocare_extractor
# Shell extractor is the original file — imported directly
from app.luboil_pdf_extractor import extract_lube_oil_report_data as _shell_extract

logger = logging.getLogger(__name__)

# ─── Lab Detection Keywords ───────────────────────────────────────────────────
# Tribocare puts its logo mid-page (~char 2600), so we scan the full page 1 text.
_DETECTION_LIMIT = 6000

_GULF_KEYWORDS     = ["gulf marine"]
_TRIBOCARE_KEYWORDS = ["tribocare", "tribocare fzc"]


def _detect_lab(first_page_text: str, filename: str = "") -> str:
    """
    Identifies the laboratory from the first page of text.
    Returns one of: 'GULF', 'TRIBOCARE', 'SHELL'

    Detection strategy:
      1. Scan full page 1 text (Tribocare puts its name ~char 2600)
      2. Fallback: check filename for known lab prefixes
    """
    snippet = first_page_text[:_DETECTION_LIMIT].lower()
    fname   = filename.lower()

    # Gulf Marine always puts its name in the Equipment Information block
    for kw in _GULF_KEYWORDS:
        if kw in snippet:
            return "GULF"

    # Tribocare signature: appears in the first detail page header ~mid-page
    for kw in _TRIBOCARE_KEYWORDS:
        if kw in snippet:
            return "TRIBOCARE"

    # Filename-based fallback (e.g. "9644500_GCL_SARASWATI(27)_02-07-2026.pdf")
    # Tribocare filenames often follow the pattern: IMO_VESSEL(batch)_date.pdf
    # Gulf filenames also follow this pattern, but their page text is always detected above.
    # We use the summary page presence of 'Machine Name' col (Tribocare-only header) as tiebreaker.
    if "machine name" in snippet:
        return "TRIBOCARE"

    return "SHELL"


def extract_lube_oil_report_data(pdf_file_stream: BinaryIO) -> Optional[Dict[str, Any]]:
    """
    Drop-in replacement for the original extract_lube_oil_report_data().
    Accepts a binary file stream and returns the standard extracted-report dict.

    The caller (luboil_report_processor.py) does NOT need to change — it still
    calls this one function, exactly as before.
    """
    # Read the stream position so we can reset it for whichever extractor runs
    pdf_file_stream.seek(0)

    # ── Detect lab from page 1 text ───────────────────────────────────────
    import os
    filename = getattr(pdf_file_stream, 'name', '') or ''
    filename = os.path.basename(filename)

    try:
        with pdfplumber.open(pdf_file_stream) as pdf:
            p0_text = pdf.pages[0].extract_text() if pdf.pages else ""
            lab = _detect_lab(p0_text or "", filename)

        logger.info(f"[Factory] Lab detected: {lab}")
    except Exception as e:
        logger.error(f"[Factory] Could not read PDF for detection: {e}")
        return None

    # ── Route to correct extractor ────────────────────────────────────────
    pdf_file_stream.seek(0)  # Reset stream before each extractor opens it

    if lab == "GULF":
        try:
            with pdfplumber.open(pdf_file_stream) as pdf:
                result = gulf_extractor.extract(pdf)
            if result:
                logger.info(f"[Factory] Gulf extraction succeeded: {len(result.get('machineries', []))} machines.")
                return result
            else:
                logger.warning("[Factory] Gulf extractor returned None — falling back to Shell.")
        except Exception as e:
            logger.error(f"[Factory] Gulf extractor error: {e}", exc_info=True)
            logger.warning("[Factory] Falling back to Shell extractor.")

    elif lab == "TRIBOCARE":
        try:
            with pdfplumber.open(pdf_file_stream) as pdf:
                result = tribocare_extractor.extract(pdf)
            if result:
                logger.info(f"[Factory] Tribocare extraction succeeded: {len(result.get('machineries', []))} machines.")
                return result
            else:
                logger.warning("[Factory] Tribocare extractor returned None — falling back to Shell.")
        except Exception as e:
            logger.error(f"[Factory] Tribocare extractor error: {e}", exc_info=True)
            logger.warning("[Factory] Falling back to Shell extractor.")

    # ── Shell (default) path ──────────────────────────────────────────────
    pdf_file_stream.seek(0)
    logger.info("[Factory] Running Shell extractor.")
    return _shell_extract(pdf_file_stream)
