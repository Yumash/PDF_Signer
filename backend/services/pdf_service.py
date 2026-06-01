import io
import base64
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image

from errors import DomainError


SUPPORTED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}
SUPPORTED_PDF_EXTS = {".pdf"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
MAX_PAGES = 500  # reject absurd page counts (DoS)
MAX_SIGS_PER_PAGE = 100  # reject absurd signature counts per page (DoS)
# Cap raw `pages` JSON before parsing (DoS). Kept under Starlette's ~1MB
# multipart part limit so this explicit 413 fires first; legit payloads (a few
# pages × a few signatures) are a few KB.
MAX_PAGES_JSON_BYTES = 512 * 1024
# Cap the demo-mode inline `signatures_data` part before decoding (DoS). Kept
# under Starlette's ~1MB multipart part limit so this explicit 413 fires first;
# legit payloads (a few cropped-ink PNGs as base64) are well under this.
MAX_SIGNATURES_DATA_BYTES = 900 * 1024
RENDER_DPI = 200
MAX_PIXMAP_PIXELS = 64_000_000  # ~8000x8000 — cap rasterised page area (bomb)

# Make Pillow raise DecompressionBombError instead of merely warning, so a tiny
# file declaring a huge canvas can't exhaust memory when decoded.
Image.MAX_IMAGE_PIXELS = MAX_PIXMAP_PIXELS


def ensure_render_safe(doc) -> None:
    """Reject PDFs that would be unsafe to rasterise (too many pages, or a page
    whose pixmap at RENDER_DPI would exceed MAX_PIXMAP_PIXELS). Raises ValueError."""
    if len(doc) > MAX_PAGES:
        raise DomainError(
            "too_many_pages", f"PDF has too many pages (max {MAX_PAGES})."
        )
    scale = RENDER_DPI / 72.0
    for page in doc:
        if (page.rect.width * scale) * (page.rect.height * scale) > MAX_PIXMAP_PIXELS:
            raise DomainError(
                "page_too_large", "PDF page is too large to render safely."
            )


def ensure_image_safe(img) -> None:
    """Hard pixel cap, checked from the header before full decode. Pillow only
    *raises* above 2x MAX_IMAGE_PIXELS, so this enforces the real limit and does
    not depend on import order setting the global. Raises DomainError."""
    if img.width * img.height > MAX_PIXMAP_PIXELS:
        raise DomainError("image_too_large", "Image is too large to process safely.")


def render_document(filename: str, data: bytes) -> list[str]:
    """Return list of base64-encoded PNG pages."""
    ext = Path(filename).suffix.lower()

    if ext in SUPPORTED_PDF_EXTS:
        return _render_pdf(data)
    elif ext in SUPPORTED_IMAGE_EXTS:
        return _render_image(data)
    else:
        raise DomainError("unsupported_file_type", f"Unsupported file type: {ext}")


def _render_pdf(data: bytes) -> list[str]:
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise DomainError(
            "corrupt_pdf", "Could not open PDF: file is corrupt or unsupported."
        )
    try:
        ensure_render_safe(doc)
        pages = []
        for page in doc:
            pix = page.get_pixmap(dpi=RENDER_DPI)
            png_bytes = pix.tobytes("png")
            pages.append(base64.b64encode(png_bytes).decode())
        return pages
    finally:
        doc.close()


def _render_image(data: bytes) -> list[str]:
    try:
        img = Image.open(io.BytesIO(data))
        ensure_image_safe(img)
        img.load()  # force decode so a decompression bomb fails here
    except Image.DecompressionBombError:
        raise DomainError("image_too_large", "Image is too large to process safely.")
    except DomainError:
        raise
    except Exception:
        raise DomainError(
            "corrupt_image", "Could not open image: file is corrupt or unsupported."
        )
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    return [base64.b64encode(buf.getvalue()).decode()]
