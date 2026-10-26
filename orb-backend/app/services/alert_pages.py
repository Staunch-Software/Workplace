"""The two page views behind an alert's popup.

raw page        one page of the uploaded PDF, cut out with pypdf
extracted page  what the system extracted from that page, rendered as a one-page PDF with the
                alerted entry highlighted

An entry's page_number counts pages AFTER the extractor split two-up spreads and stacked pairs, so
the uploaded PDF page is found through orb_uploads.page_map (see extraction._page_map_from_manifest).
"""
import os
from io import BytesIO
from xml.sax.saxutils import escape

from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from app.services.report_lines import entry_line_rows

NAVY = colors.HexColor("#1F4E79")
LIGHT_BLUE = colors.HexColor("#EBF3FB")
HIGHLIGHT = colors.HexColor("#FFF4D6")
ORANGE = colors.HexColor("#E8890C")
SEVERITY_FILL = {
    "critical": colors.HexColor("#FFE0E0"), "major": colors.HexColor("#FFF0E0"),
    "minor": colors.HexColor("#FFFDE0"), "observation": colors.HexColor("#F1F1F1"),
}


async def load_upload_pdf(upload) -> bytes:
    """The uploaded PDF: the local copy when present, otherwise Azure Blob (as GET /uploads/{id}/pdf)."""
    if upload.storage_path and os.path.exists(upload.storage_path):
        with open(upload.storage_path, "rb") as f:
            return f.read()
    if upload.pdf_blob_url:
        from app.services.azure_storage import download_iopp_document
        try:
            content, _ = await download_iopp_document(upload.pdf_blob_url)
            return content
        except Exception as e:
            raise FileNotFoundError(f"Original PDF is not available: {e}")
    raise FileNotFoundError("Original PDF is no longer available")

def locate_raw_page(page_map, entry_page: int | None, total_pages: int | None, pdf_pages: int) -> dict | None:
    """{"raw_page", "part", "approximate"} for an entry's post-split page number, or None.

    part says which piece of the raw page the entry came from ("left"/"right" of a two-up spread,
    "top"/"bottom" of a stacked pair) and is None for an unsplit page.
    approximate is True for uploads without a page_map whose page count does not match the PDF:
    page numbers may have shifted by a split, so the page shown can be off.
    """
    if not entry_page or entry_page < 1:
        return None
    if page_map:
        first = 1
        for m in page_map:
            outputs = int(m.get("outputs") or 1)
            if first <= entry_page < first + outputs:
                part = None
                if outputs > 1:
                    idx = entry_page - first
                    part = (("left", "right") if m.get("path") == "landscape_split" else ("top", "bottom"))[min(idx, 1)]
                return {"raw_page": int(m["raw_page"]), "part": part, "approximate": False}
            first += outputs
        return None
    approximate = bool(total_pages) and total_pages != pdf_pages
    return {"raw_page": min(entry_page, pdf_pages), "part": None, "approximate": approximate}


def pdf_page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(BytesIO(pdf_bytes)).pages)


def slice_raw_page(pdf_bytes: bytes, raw_page: int) -> bytes:
    """A one-page PDF holding page `raw_page` (1-based) of the uploaded file."""
    reader = PdfReader(BytesIO(pdf_bytes))
    if raw_page < 1 or raw_page > len(reader.pages):
        raise IndexError(f"page {raw_page} is outside the PDF ({len(reader.pages)} pages)")
    writer = PdfWriter()
    writer.add_page(reader.pages[raw_page - 1])
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def _item_sort_key(entry):
    parts = []
    for p in (entry.item_number or "").split("."):
        parts.append(int(p) if p.isdigit() else 0)
    return (entry.entry_date, parts)


def render_extracted_page(*, vessel_name: str, upload, page_number: int, source: dict | None,
                          entries: list, quantities: dict, alert) -> bytes:
    """One-page-per-source-page PDF of what was extracted from `page_number`, alerted entry highlighted."""
    styles = getSampleStyleSheet()
    normal = ParagraphStyle("n", parent=styles["Normal"], fontSize=8, leading=10)
    small = ParagraphStyle("s", parent=normal, textColor=colors.HexColor("#555555"))
    head = ParagraphStyle("h", parent=normal, fontName="Helvetica-Bold", fontSize=9, leading=12)
    title = ParagraphStyle("t", parent=styles["Heading2"], textColor=NAVY, spaceAfter=2)

    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), leftMargin=1 * cm, rightMargin=1 * cm,
                            topMargin=1.2 * cm, bottomMargin=1.2 * cm)
    story = [Paragraph(f"Extracted page {page_number}", title)]
    where = f"{escape(vessel_name)} | {escape(upload.original_filename)}"
    if source:
        where += f" | PDF page {source['raw_page']}" + (f" ({source['part']} part)" if source.get("part") else "")
        if source.get("approximate"):
            where += " | page number approximate"
    story.append(Paragraph(where, small))
    story.append(Spacer(1, 0.25 * cm))

    if alert is not None:
        box = Table([[Paragraph(f"<b>{escape(alert.severity.upper())}</b> &nbsp; {escape(alert.alert_type.replace('_', ' '))}"
                                f"<br/>{escape(alert.message)}", normal)]], colWidths=[27.7 * cm])
        box.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), SEVERITY_FILL.get(alert.severity, colors.white)),
            ("BOX", (0, 0), (-1, -1), 0.6, ORANGE), ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story += [box, Spacer(1, 0.3 * cm)]

    if not entries:
        story.append(Paragraph("No entries were extracted from this page.", normal))
    for entry in sorted(entries, key=_item_sort_key):
        is_alerted = alert is not None and alert.entry_id == entry.id
        officers = ", ".join(filter(None, [
            f"{entry.officer_1_name or ''} {('(' + entry.officer_1_rank + ')') if entry.officer_1_rank else ''}".strip(),
            f"{entry.officer_2_name or ''} {('(' + entry.officer_2_rank + ')') if entry.officer_2_rank else ''}".strip(),
        ]))
        conf = f"{entry.confidence_score * 100:.0f}%" if entry.confidence_score is not None else "-"
        flags = (" &nbsp; <font color='#C00000'>erasure</font>" if entry.has_erasure else "") + \
                (" &nbsp; <font color='#C00000'>gap before</font>" if entry.has_gap_before else "")
        marker = "<font color='#E8890C'>ALERT ENTRY</font> &nbsp; " if is_alerted else ""
        header = (f"{marker}{entry.entry_date} &nbsp; Code {escape(entry.orb_code)} &nbsp; Item {escape(entry.item_number or '-')}"
                  f" &nbsp; {escape(entry.tank_location or '')}")
        rows = [[Paragraph(header, head), "", ""],
                [Paragraph(f"Officers: {escape(officers) or '-'} &nbsp; Confidence: {conf}{flags}", small), "", ""]]
        for line in entry_line_rows(entry, quantities.get(entry.id, [])):
            rows.append([Paragraph(escape(line["item"]), head if line["blank_item"] else normal),
                         Paragraph(escape(line["text"]), normal), Paragraph(escape(line["qty"]), normal)])
        t = Table(rows, colWidths=[1.6 * cm, 17.4 * cm, 8.7 * cm])
        style = [
            ("SPAN", (0, 0), (-1, 0)), ("SPAN", (0, 1), (-1, 1)),
            ("BACKGROUND", (0, 0), (-1, 1), HIGHLIGHT if is_alerted else LIGHT_BLUE),
            ("BOX", (0, 0), (-1, -1), 1.4 if is_alerted else 0.4, ORANGE if is_alerted else colors.grey),
            ("LINEBELOW", (0, 1), (-1, -2), 0.25, colors.lightgrey),
            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]
        if is_alerted:
            style.append(("BACKGROUND", (0, 2), (-1, -1), HIGHLIGHT))
        t.setStyle(TableStyle(style))
        story += [t, Spacer(1, 0.25 * cm)]

    doc.build(story)
    return buf.getvalue()
