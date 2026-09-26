"""
FEATURE 8 - Multi-format document understanding: text extraction.

Every supported format is turned into the same shape - a list of
`PageContent` segments - so chunking, embedding, trust scoring and retrieval
are identical no matter what was uploaded:

  .pdf           one segment per page (page numbers kept for citations);
                 pages with no text layer are OCR'd from their embedded images
  .docx          one segment per heading-delimited section; tables become
                 "Column: value" lines so each row reads on its own
  .xlsx / .csv   one segment per sheet; every row becomes a self-contained
                 "Header: value; Header: value." line
  .txt           one segment per heading-delimited section
  .jpg / .png    OCR'd into a single segment

Any failure raises `ExtractionError` with a message that is safe to show an
admin as-is.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, List, Optional

FILE_TYPES = {
    ".pdf": "pdf",
    ".docx": "word",
    ".xlsx": "excel",
    ".pptx": "presentation",
    ".csv": "csv",
    ".txt": "text",
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
}

# Legacy binary Office formats need a different parser entirely - say so
# plainly instead of the generic "unsupported" message.
LEGACY_EXTENSIONS = {".doc": ".docx", ".xls": ".xlsx", ".ppt": ".pptx"}

MAX_SPREADSHEET_ROWS = 20_000
MAX_IMAGE_PIXELS = 40_000_000


class ExtractionError(Exception):
    """Raised with a user-facing explanation when a file can't be read."""


@dataclass
class PageContent:
    # None for formats without real pages (Word, spreadsheets, text, images) -
    # citations then point at `heading` (section or sheet name) instead.
    page_number: Optional[int]
    text: str
    likely_scanned: bool
    heading: str | None


HEADING_PATTERN = re.compile(r"^(?:[0-9]+(\.[0-9]+)*\.?\s+)?[A-Z][A-Za-z0-9 ,'&/-]{3,80}$")


def detect_heading(text: str) -> str | None:
    for line in text.splitlines():
        line = line.strip()
        if 4 <= len(line) <= 90 and HEADING_PATTERN.match(line):
            return line
    return None


def file_type_for(filename: str) -> Optional[str]:
    ext = _ext(filename)
    return FILE_TYPES.get(ext)


def _ext(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def unsupported_type_message(filename: str) -> str:
    ext = _ext(filename)
    if ext in LEGACY_EXTENSIONS:
        modern = LEGACY_EXTENSIONS[ext]
        return f"Older {ext} files aren't supported. Save it as {modern} and upload that instead."
    shown = ext or "files without an extension"
    return (
        f"Unsupported file type ({shown}). Upload a PDF, Word (.docx), Excel (.xlsx), "
        "PowerPoint (.pptx), CSV, plain text (.txt), or image (.jpg, .png) file."
    )


def content_matches_type(file_type: str, head: bytes) -> bool:
    """Cheap magic-byte check so a renamed file is rejected up front instead
    of failing deep inside a parser."""
    if file_type == "pdf":
        return head.lstrip()[:5] == b"%PDF-"
    if file_type in ("word", "excel", "presentation"):
        return head[:4] == b"PK\x03\x04"
    if file_type == "image":
        return head[:8] == b"\x89PNG\r\n\x1a\n" or head[:3] == b"\xff\xd8\xff"
    if file_type in ("text", "csv"):
        return b"\x00" not in head[:4096] or head[:2] in (b"\xff\xfe", b"\xfe\xff")
    return False


# ---------- OCR ----------

_ocr_engine = None


def _get_ocr_engine():
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
        except ImportError as exc:  # pragma: no cover - depends on deployment
            raise ExtractionError(
                "Text recognition for images isn't available on this server."
            ) from exc
        _ocr_engine = RapidOCR()
    return _ocr_engine


def ocr_image(image) -> str:
    """OCR a PIL image. Returns recognized lines top-to-bottom, joined by newlines."""
    import numpy as np

    if image.width * image.height > MAX_IMAGE_PIXELS:
        raise ExtractionError("This image is too large to read. Resize it below 40 megapixels and try again.")
    engine = _get_ocr_engine()
    result, _ = engine(np.array(image.convert("RGB")))
    if not result:
        return ""
    # Each result is [box, text, score]; sort by the box's top edge, then left.
    ordered = sorted(result, key=lambda r: (round(r[0][0][1] / 10), r[0][0][0]))
    return "\n".join(r[1].strip() for r in ordered if r[1].strip())


# ---------- Per-format extractors ----------

def extract_pdf(file_path: str) -> List[PageContent]:
    from pypdf import PdfReader
    from pypdf.errors import PdfReadError

    try:
        reader = PdfReader(file_path)
        if reader.is_encrypted:
            raise ExtractionError("This PDF is password-protected. Upload an unlocked copy.")
        raw_pages = list(reader.pages)
    except ExtractionError:
        raise
    except (PdfReadError, ValueError, OSError, KeyError) as exc:
        raise ExtractionError("This PDF appears to be damaged or isn't a valid PDF.") from exc

    pages: List[PageContent] = []
    for i, page in enumerate(raw_pages):
        try:
            text = (page.extract_text() or "").strip()
        except Exception:  # noqa: BLE001 - one unreadable page shouldn't sink the document
            text = ""
        likely_scanned = len(text) < 30
        if likely_scanned:
            ocr_text = _ocr_pdf_page(page)
            text = ocr_text or text
        pages.append(
            PageContent(
                page_number=i + 1,
                text=text,
                likely_scanned=likely_scanned,
                heading=detect_heading(text) if text else None,
            )
        )
    return pages


def _ocr_pdf_page(page) -> str:
    """Scanned PDF pages are usually one embedded image per page - OCR every
    embedded image on the page and join the results."""
    texts = []
    try:
        images = list(page.images)
    except Exception:  # noqa: BLE001 - unsupported image encodings inside the PDF
        return ""
    for img in images:
        try:
            texts.append(ocr_image(img.image))
        except ExtractionError:
            raise
        except Exception:  # noqa: BLE001
            continue
    return "\n".join(t for t in texts if t).strip()


def extract_docx(file_path: str) -> List[PageContent]:
    from docx import Document as DocxDocument
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    try:
        doc = DocxDocument(file_path)
        blocks = list(doc.iter_inner_content())
    except Exception as exc:  # noqa: BLE001 - python-docx raises many zip/xml error types
        raise ExtractionError("This Word file appears to be damaged or isn't a valid .docx file.") from exc

    sections: List[PageContent] = []
    heading: Optional[str] = None
    lines: List[str] = []

    def flush():
        text = "\n".join(lines).strip()
        if text:
            sections.append(PageContent(page_number=None, text=text, likely_scanned=False, heading=heading))

    for block in blocks:
        if isinstance(block, Paragraph):
            text = block.text.strip()
            if not text:
                continue
            style = (block.style.name if block.style is not None else "") or ""
            if style.startswith("Heading") or style == "Title":
                flush()
                lines = []
                heading = text[:500]
                # Keep the heading in the body too, so it's searchable.
                lines.append(text if text.endswith((".", ":", "?", "!")) else f"{text}.")
            else:
                lines.append(text)
        elif isinstance(block, Table):
            rows = [[cell.text.strip() for cell in row.cells] for row in block.rows]
            lines.extend(_rows_to_lines(rows))
    flush()
    return sections


def extract_xlsx(file_path: str) -> List[PageContent]:
    from openpyxl import load_workbook

    try:
        wb = load_workbook(file_path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError("This Excel file appears to be damaged or isn't a valid .xlsx file.") from exc

    sheets: List[PageContent] = []
    total_rows = 0
    try:
        for ws in wb.worksheets:
            rows = []
            for row in ws.iter_rows(values_only=True):
                total_rows += 1
                if total_rows > MAX_SPREADSHEET_ROWS:
                    raise ExtractionError(
                        f"This spreadsheet has more than {MAX_SPREADSHEET_ROWS:,} rows. "
                        "Split it into smaller files and upload those."
                    )
                rows.append([_cell_text(v) for v in row])
            text = "\n".join(_rows_to_lines(rows)).strip()
            if text:
                sheets.append(PageContent(page_number=None, text=text, likely_scanned=False, heading=ws.title))
    finally:
        wb.close()
    return sheets


def extract_pptx(file_path: str) -> List[PageContent]:
    """One section per slide, headed "Slide N: <title>" so citations point at
    the slide. Text boxes, tables, grouped shapes, and speaker notes are all
    read; a slide that's only a picture (a pasted scan or screenshot) is
    OCR'd like a scanned PDF page."""
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    try:
        slides = list(Presentation(file_path).slides)
    except Exception as exc:  # noqa: BLE001 - python-pptx raises many zip/xml error types
        raise ExtractionError("This PowerPoint file appears to be damaged or isn't a valid .pptx file.") from exc

    def walk(shapes):
        for shape in shapes:
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                yield from walk(shape.shapes)
            else:
                yield shape

    sections: List[PageContent] = []
    for number, slide in enumerate(slides, start=1):
        title_shape = slide.shapes.title
        title = title_shape.text_frame.text.strip() if title_shape is not None else ""
        # python-pptx returns a new proxy object per access, so compare ids.
        title_id = title_shape.shape_id if title_shape is not None else None
        lines: List[str] = []
        pictures = []
        for shape in walk(slide.shapes):
            if shape.has_text_frame and shape.shape_id != title_id:
                for paragraph in shape.text_frame.paragraphs:
                    text = "".join(run.text for run in paragraph.runs).strip()
                    if text:
                        lines.append(text)
            elif getattr(shape, "has_table", False) and shape.has_table:
                rows = [[cell.text.strip() for cell in row.cells] for row in shape.table.rows]
                lines.extend(_rows_to_lines(rows))
            elif shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pictures.append(shape)

        likely_scanned = len(" ".join(lines)) < 30 and bool(pictures)
        if likely_scanned:
            lines.extend(t for t in (_ocr_slide_picture(p) for p in pictures) if t)

        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip() if slide.notes_slide.notes_text_frame else ""
            if notes:
                lines.append(notes)

        heading = f"Slide {number}: {title}"[:500] if title else f"Slide {number}"
        body = "\n".join(lines).strip()
        if not body and not title:
            continue
        # Keep the title in the body too, so it's searchable.
        text = "\n".join(filter(None, [_as_sentence(title) if title else "", body]))
        sections.append(PageContent(page_number=None, text=text, likely_scanned=likely_scanned, heading=heading))
    return sections


def _ocr_slide_picture(shape) -> str:
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(io.BytesIO(shape.image.blob)) as img:
            img.load()
            return ocr_image(img)
    except ExtractionError:
        raise
    except (UnidentifiedImageError, OSError, ValueError, AttributeError):
        return ""  # unsupported embedded image formats (e.g. EMF) - skip, don't fail the deck


def extract_csv(file_path: str) -> List[PageContent]:
    raw = _read_text(file_path)
    try:
        dialect = csv.Sniffer().sniff(raw[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    try:
        rows = list(csv.reader(io.StringIO(raw), dialect))
    except csv.Error as exc:
        raise ExtractionError("This CSV file couldn't be parsed. Check that it's a valid comma-separated file.") from exc
    if len(rows) > MAX_SPREADSHEET_ROWS:
        raise ExtractionError(
            f"This CSV has more than {MAX_SPREADSHEET_ROWS:,} rows. Split it into smaller files and upload those."
        )
    text = "\n".join(_rows_to_lines(rows)).strip()
    return [PageContent(page_number=None, text=text, likely_scanned=False, heading=None)] if text else []


def extract_txt(file_path: str) -> List[PageContent]:
    raw = _read_text(file_path)
    sections: List[PageContent] = []
    heading: Optional[str] = None
    paragraphs: List[str] = []

    def flush():
        text = "\n\n".join(paragraphs).strip()
        if text:
            sections.append(PageContent(page_number=None, text=text, likely_scanned=False, heading=heading))

    for block in re.split(r"\n\s*\n", raw.replace("\r\n", "\n")):
        block = block.strip()
        if not block:
            continue
        single_line = "\n" not in block
        md_heading = block.startswith("#") and single_line
        if md_heading or (single_line and len(block) <= 90 and HEADING_PATTERN.match(block) and not block.endswith(".")):
            flush()
            paragraphs = []
            heading = block.lstrip("#").strip()[:500]
            paragraphs.append(f"{heading}.")
        else:
            paragraphs.append(block)
    flush()
    return sections


def extract_image(file_path: str) -> List[PageContent]:
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(file_path) as img:
            if img.width * img.height > MAX_IMAGE_PIXELS:
                raise ExtractionError(
                    "This image is too large to read. Resize it below 40 megapixels and try again."
                )
            img.load()
            text = ocr_image(img)
    except ExtractionError:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ExtractionError("This image appears to be damaged or isn't a valid JPG/PNG file.") from exc
    return [PageContent(page_number=None, text=text, likely_scanned=True, heading=None)] if text else []


EXTRACTORS = {
    "pdf": extract_pdf,
    "word": extract_docx,
    "excel": extract_xlsx,
    "presentation": extract_pptx,
    "csv": extract_csv,
    "text": extract_txt,
    "image": extract_image,
}


def extract_document(file_path: str, file_type: str) -> List[PageContent]:
    extractor = EXTRACTORS.get(file_type)
    if extractor is None:
        raise ExtractionError(f"Unsupported file type: {file_type}.")
    segments = extractor(file_path)
    if not any(s.text.strip() for s in segments):
        if file_type == "image":
            raise ExtractionError("No readable text was found in this image.")
        if file_type == "pdf":
            raise ExtractionError("No readable text was found in this PDF, even after text recognition.")
        raise ExtractionError("This file doesn't contain any readable text.")
    return segments


# ---------- helpers ----------

def _read_text(file_path: str) -> str:
    with open(file_path, "rb") as f:
        data = f.read()
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return data.decode("utf-16", errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


def _cell_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime):
        return value.date().isoformat() if value.time() == datetime.min.time() else value.isoformat(sep=" ")
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _rows_to_lines(rows: Iterable[List[str]]) -> List[str]:
    """First non-empty row is the header; every later row becomes a
    self-contained sentence like "Route: 12; Stop: Tambaram; Departs: 7:10."
    so it still makes sense after chunking splits the table."""
    lines: List[str] = []
    header: Optional[List[str]] = None
    for row in rows:
        cells = [c.strip() for c in row]
        if not any(cells):
            continue
        if header is None:
            header = [c or f"Column {i + 1}" for i, c in enumerate(cells)]
            continue
        pairs = []
        for i, value in enumerate(cells):
            if not value:
                continue
            label = header[i] if i < len(header) else f"Column {i + 1}"
            pairs.append(f"{label}: {value}")
        if pairs:
            lines.append(_as_sentence("; ".join(pairs)))
    if header is not None and not lines:
        # A single-row sheet: keep its content rather than dropping it.
        lines.append(_as_sentence("; ".join(c for c in header if c)))
    return lines


def _as_sentence(text: str) -> str:
    return text if text.endswith((".", "!", "?")) else f"{text}."
