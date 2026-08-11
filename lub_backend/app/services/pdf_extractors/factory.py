"""
Lube Oil Extractor Factory
============================
This is the single entry point for ALL PDF extractions.

A single PDF can mix results from more than one lab across its pages (e.g.
one machine sampled by Tribocare inside an otherwise all-Gulf-Marine report)
— confirmed on a real "AMNSI Maximus" report where 10 machines were Gulf
Marine format and 1 (on page 8) was Tribocare format. Because of that, this
factory no longer picks exactly one extractor for the whole file. Instead:

  1. viswa_extractor, gulf_extractor and tribocare_extractor are each run
     against the SAME pdf. Every one of them now scans every physical page
     itself and only claims the pages that match its own lab's structure —
     see each module's extract() docstring — so calling all three is safe
     even for a single-lab file (the other two simply find nothing).
  2. Their machineries lists are merged into one report.
  3. Report-level metadata (vessel/report_date/lab_name/oil_source) comes
     from whichever extractor found the most machines (the "primary" lab);
     any vessel_name/report_date it didn't find are backfilled from the
     other extractors' results.
  4. If none of the three found anything, the original Shell/default
     extractor (luboil_pdf_extractor.py) runs unchanged, exactly as before.

Usage (from luboil_report_processor.py):
    from app.services.pdf_extractors.factory import extract_lube_oil_report_data
"""
import logging
import pdfplumber
from typing import Any, Dict, List, Optional, BinaryIO

from app.services.pdf_extractors import gulf_extractor
from app.services.pdf_extractors import tribocare_extractor
from app.services.pdf_extractors import viswa_extractor
# Shell extractor is the original file — imported directly
from app.luboil_pdf_extractor import extract_lube_oil_report_data as _shell_extract

logger = logging.getLogger(__name__)

# ─── Lab Detection Keywords ───────────────────────────────────────────────────
# Tribocare puts its logo mid-page (~char 2600), so we scan the full page 1 text.
_DETECTION_LIMIT = 6000

_VISWA_KEYWORDS     = ["viswa lab", "theviswagroup"]
_GULF_KEYWORDS     = ["gulf marine"]
_TRIBOCARE_KEYWORDS = ["tribocare", "tribocare fzc"]


def _detect_lab(first_page_text: str, filename: str = "") -> str:
    """
    Identifies the SINGLE most likely lab from page-1 text alone.

    This is no longer used to route extraction (a file can legitimately mix
    labs across pages — see the module docstring) — it's kept only as a
    quick diagnostic logged alongside the real per-page multi-lab result,
    so a log line always shows what the old page-1-only heuristic would
    have guessed, for comparison.

    Returns one of: 'VISWA', 'GULF', 'TRIBOCARE', 'SHELL'

    Detection strategy:
      1. Scan full page 1 text (Tribocare puts its name ~char 2600)
      2. Fallback: check filename for known lab prefixes

    NOTE: Viswa is checked FIRST because a Viswa report's "Brand & Grade"
    field can itself contain the words "Gulf Marine" (it's naming the oil
    brand, not the lab) — e.g. "GULF MARINE-GulfSea Hydraulic HVI Plus 32".
    Checking Viswa's own distinctive markers before the Gulf keyword check
    prevents that brand text from ever being misrouted to gulf_extractor.
    """
    snippet = first_page_text[:_DETECTION_LIMIT].lower()
    fname   = filename.lower()

    # Viswa Lab: distinctive report title + lab domain, never appears in
    # Gulf/Tribocare/Shell reports, so safe to check ahead of the rest.
    for kw in _VISWA_KEYWORDS:
        if kw in snippet:
            return "VISWA"

    # Gulf Marine always puts its name in the Equipment Information block
    for kw in _GULF_KEYWORDS:
        if kw in snippet:
            return "GULF"

    # Structural fallback: some Shell/Gulfsea-branded reports (e.g. "AMNSI MAXIMUS")
    # use the exact same Equipment Information / Machinery Unit / Sample Location
    # table layout as Gulf Marine reports, but never say "gulf marine" on page 1 —
    # they only mention the product brand ("GULFSEA ..."). "Machinery Unit" +
    # "Sample Location" together are unique to this table layout (Viswa and
    # Tribocare reports never contain either), so this is safe to check here.
    if "machinery unit" in snippet and "sample location" in snippet:
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


_SPECIALIST_EXTRACTORS = (
    ("VISWA",     viswa_extractor),
    ("GULF",      gulf_extractor),
    ("TRIBOCARE", tribocare_extractor),
)


def extract_lube_oil_report_data(pdf_file_stream: BinaryIO) -> Optional[Dict[str, Any]]:
    """
    Drop-in replacement for the original extract_lube_oil_report_data().
    Accepts a binary file stream and returns the standard extracted-report dict.

    The caller (luboil_report_processor.py) does NOT need to change — it still
    calls this one function, exactly as before.
    """
    pdf_file_stream.seek(0)

    import os
    filename = getattr(pdf_file_stream, 'name', '') or ''
    filename = os.path.basename(filename)

    # ── Run every specialist extractor against the same parsed PDF ─────────
    # Each one now self-filters to only the pages matching its own lab's
    # structure, so running all three is safe for single-lab files too.
    results = []  # list of (lab_name, result_dict), most-machines first later
    try:
        with pdfplumber.open(pdf_file_stream) as pdf:
            # Diagnostic-only: log what the old page-1-only heuristic would
            # have guessed, for comparison against the real per-page result below.
            try:
                p0_text = pdf.pages[0].extract_text() if pdf.pages else ""
                logger.info(f"[Factory] Page-1-only heuristic would have guessed: {_detect_lab(p0_text or '', filename)}")
            except Exception:
                pass

            for lab_name, extractor_module in _SPECIALIST_EXTRACTORS:
                try:
                    result = extractor_module.extract(pdf)
                except Exception as e:
                    logger.error(f"[Factory] {lab_name} extractor error: {e}", exc_info=True)
                    continue
                if result and result.get("machineries"):
                    logger.info(f"[Factory] {lab_name} extraction found {len(result['machineries'])} machine(s).")
                    results.append((lab_name, result))
    except Exception as e:
        logger.error(f"[Factory] Could not read PDF: {e}")
        return None

    if results:
        # Primary lab = whichever extractor found the most machines; its
        # metadata (vessel/report_date/lab_name/oil_source) represents the
        # report as a whole. Every machine's own fields are correct
        # regardless of which lab produced them.
        results.sort(key=lambda pair: len(pair[1]["machineries"]), reverse=True)
        primary_lab, primary_result = results[0]

        metadata = dict(primary_result["metadata"])
        merged_machineries: List[Dict[str, Any]] = list(primary_result["machineries"])

        for lab_name, result in results[1:]:
            merged_machineries.extend(result["machineries"])
            # Backfill vessel_name/report_date if the primary extractor
            # didn't find them (e.g. a lone Tribocare page has no
            # "Summary Report for..." title to read them from).
            if not metadata.get("vessel_name") and result["metadata"].get("vessel_name"):
                metadata["vessel_name"] = result["metadata"]["vessel_name"]
            if not metadata.get("report_date") and result["metadata"].get("report_date"):
                metadata["report_date"] = result["metadata"]["report_date"]

        if len(results) > 1:
            # Mixed-lab report: oil_source/lab_name are report-level columns
            # (one LuboilReport row per upload — see luboil_model.py), shared
            # by every LuboilSample under it via the report_id join. So a
            # PDF that genuinely mixes labs can't tag each sample with its
            # own source in this schema; instead we combine every lab found
            # into one deterministic, alphabetically-sorted string (e.g.
            # "GULF, TRIBOCARE") so the report is never silently filed under
            # just the primary lab — anywhere the UI/API prints oil_source
            # or lab_name as text, both labs show up automatically.
            sorted_labs = sorted(results, key=lambda pair: pair[0])
            metadata["oil_source"] = ", ".join(name for name, _ in sorted_labs)
            metadata["lab_name"] = ", ".join(
                r["metadata"].get("lab_name") or name for name, r in sorted_labs
            )

            other_labs = ", ".join(f"{name} ({len(r['machineries'])})" for name, r in results[1:])
            logger.info(
                f"[Factory] Mixed-lab report: primary={primary_lab} "
                f"({len(primary_result['machineries'])} machines), also found {other_labs}. "
                f"All {len(merged_machineries)} machines included; report filed under "
                f"oil_source={metadata['oil_source']}."
            )

        return {"metadata": metadata, "machineries": merged_machineries}

    # ── Shell (default) path — unchanged ────────────────────────────────────
    pdf_file_stream.seek(0)
    logger.info("[Factory] No specialist extractor matched — running Shell extractor.")
    return _shell_extract(pdf_file_stream)
