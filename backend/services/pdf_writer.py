import io
import uuid
from datetime import datetime
from pathlib import Path

import fitz
from PIL import Image

from constants import STAGE_FALLBACK_H, STAGE_FALLBACK_W, get_data_dir
from services.composer import compose_page
from services.pdf_service import ensure_render_safe, RENDER_DPI
from services.signature_service import get_signatures_dir


def export_pdf(
    pdf_data: bytes,
    pages_payload: list[dict],
    delete_pages: list[int] | None = None,
    sig_images: dict | None = None,
) -> bytes:
    """Burn signatures into PDF pages, return new PDF bytes. Pages whose original
    index is in `delete_pages` are omitted from the output. In demo mode the
    signature pixels arrive via `sig_images` ({id: Image}) instead of disk."""
    src = fitz.open(stream=pdf_data, filetype="pdf")
    out = fitz.open()
    try:
        return _build_pdf(src, out, pages_payload, set(delete_pages or []), sig_images)
    finally:
        out.close()
        src.close()


def _build_pdf(src, out, pages_payload, delete_set, sig_images=None) -> bytes:
    ensure_render_safe(src)  # defense-in-depth: cap pages / pixmap area
    # Demo mode resolves signatures from the inline map, so the disk dir is never
    # touched (and never created).
    sig_dir = None if sig_images is not None else get_signatures_dir()

    page_map = {p["page_idx"]: p["signatures"] for p in pages_payload}

    stage_map = {
        p["page_idx"]: (
            p.get("stage_w", STAGE_FALLBACK_W),
            p.get("stage_h", STAGE_FALLBACK_H),
        )
        for p in pages_payload
    }
    jitter_map = {p["page_idx"]: p.get("jitter", 0) for p in pages_payload}

    for i, page in enumerate(src):
        if i in delete_set:
            continue  # page removed from the exported document
        if i in page_map and page_map[i]:
            pix = page.get_pixmap(dpi=RENDER_DPI)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            stage_w, stage_h = stage_map.get(i, (STAGE_FALLBACK_W, STAGE_FALLBACK_H))
            sx = pix.width / stage_w
            sy = pix.height / stage_h
            scaled_sigs = [
                {
                    **s,
                    "x": s["x"] * sx,
                    "y": s["y"] * sy,
                    "w": s["w"] * sx,
                    "h": s["h"] * sy,
                }
                for s in page_map[i]
            ]
            composed = compose_page(
                img,
                scaled_sigs,
                sig_dir,
                jitter=jitter_map.get(i, 0),
                page_index=i,
                sig_images=sig_images,
            )

            buf = io.BytesIO()
            composed.convert("RGB").save(buf, format="PNG")
            buf.seek(0)

            new_page = out.new_page(width=page.rect.width, height=page.rect.height)
            new_page.insert_image(new_page.rect, stream=buf.read())
        else:
            out.insert_pdf(src, from_page=i, to_page=i)

    return out.tobytes(deflate=True)


def save_output(data: bytes, ext: str = "pdf") -> Path:
    data_dir = get_data_dir() / "output"
    data_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    # uuid suffix avoids collisions/overwrites for exports within the same second.
    path = data_dir / f"signed_{ts}_{uuid.uuid4().hex[:8]}.{ext}"
    path.write_bytes(data)
    return path
