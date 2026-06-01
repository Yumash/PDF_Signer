import io
import json
import logging
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import Response
from PIL import Image

from constants import STAGE_FALLBACK_H, STAGE_FALLBACK_W, is_demo_mode
from errors import ApiError, DomainError
from services import pdf_service
from services.pdf_writer import export_pdf, save_output
from services.composer import compose_page
from services.signature_service import (
    decode_inline_signatures,
    get_signatures_dir,
    is_valid_sig_id,
)
from services.history_service import save_entry

router = APIRouter(prefix="/api/export", tags=["export"])

logger = logging.getLogger(__name__)


def _persist_copy(data: bytes, ext: str) -> None:
    """Save a server-side copy of the export (audit trail). Best-effort: a
    disk-full or permission error must never block the user's download — the
    signed bytes are already in hand, so log and return them regardless."""
    try:
        save_output(data, ext)
    except Exception as e:
        # Never block the user's download — the signed bytes are already in hand.
        logger.warning("Could not save server-side export copy: %s", e)


def _save_history(
    original: bytes,
    result: bytes,
    *,
    filename: str,
    ext: str,
    pages_payload: list,
    delete_list: list,
) -> None:
    """Persist a full history entry (original + result + layout) for later
    re-editing. Best-effort, like _persist_copy — never blocks the download."""
    try:
        save_entry(
            original,
            result,
            filename=filename,
            ext=ext,
            pages_payload=pages_payload,
            delete_pages=delete_list,
        )
    except Exception as e:
        # Best-effort, like _persist_copy — a failure here must never break the
        # already-produced export response.
        logger.warning("Could not save history entry: %s", e)


# Map source extension -> (PIL format, response media type, output extension).
# Lets image export preserve the source format instead of always emitting JPEG.
IMAGE_OUTPUT = {
    ".jpg": ("JPEG", "image/jpeg", ".jpg"),
    ".jpeg": ("JPEG", "image/jpeg", ".jpeg"),
    ".png": ("PNG", "image/png", ".png"),
    ".tiff": ("TIFF", "image/tiff", ".tiff"),
    ".tif": ("TIFF", "image/tiff", ".tif"),
    ".webp": ("WEBP", "image/webp", ".webp"),
}

_ASPECT_TOLERANCE = 0.01  # 1% — absorbs integer rounding of rendered sizes


def _validate_sig_ids(sigs: list[dict]):
    """Reject client-supplied signature ids that are not canonical UUIDs,
    closing the path-traversal vector via sig['id'] (composer builds a file
    path from it)."""
    for s in sigs:
        if not is_valid_sig_id(s.get("id")):
            raise ApiError("invalid_signature_id", "Invalid signature id")


def _check_aspect(stage_w: float, stage_h: float, page_w: float, page_h: float):
    """Ensure the client stage aspect ratio matches the page.

    The backend scales x and y independently (sx = page/stage on each axis). If
    the stage aspect ratio differs from the page, sx != sy and the signature is
    distorted with no visible error. Enforcing the match here keeps sx == sy.
    """
    if stage_w <= 0 or stage_h <= 0 or page_w <= 0 or page_h <= 0:
        raise ApiError("invalid_dimensions", "Invalid stage or page dimensions")
    page_ar = page_w / page_h
    if abs(stage_w / stage_h - page_ar) > _ASPECT_TOLERANCE * page_ar:
        raise ApiError(
            "stage_aspect_mismatch",
            "Stage dimensions do not match the page aspect ratio",
        )


def _is_number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _validate_payload_shape(pages_payload):
    """Reject a malformed `pages` payload up front so downstream field access
    can't raise KeyError/TypeError (which would surface as 500). Returns 422."""
    if not isinstance(pages_payload, list):
        raise ApiError("invalid_pages_payload", "Invalid pages payload.")
    # Count limits BEFORE per-item iteration — bounds the O(n·m) work an
    # attacker can trigger with a single unauthenticated request.
    if len(pages_payload) > pdf_service.MAX_PAGES:
        raise ApiError("invalid_pages_payload", "Too many pages in payload.")
    for p in pages_payload:
        if (
            not isinstance(p, dict)
            or not isinstance(p.get("page_idx"), int)
            or isinstance(p.get("page_idx"), bool)
            or p["page_idx"] < 0
        ):
            raise ApiError("invalid_pages_payload", "Invalid pages payload.")
        # stage_w/stage_h, when present, feed division in _check_aspect and the
        # export scaling — a non-numeric or non-positive value would raise an
        # unhandled TypeError/ZeroDivision (HTTP 500). Reject as 422 up front.
        for key in ("stage_w", "stage_h"):
            if key in p and not (_is_number(p[key]) and p[key] > 0):
                raise ApiError("invalid_pages_payload", "Invalid pages payload.")
        sigs = p.get("signatures", [])
        if not isinstance(sigs, list):
            raise ApiError("invalid_pages_payload", "Invalid pages payload.")
        if len(sigs) > pdf_service.MAX_SIGS_PER_PAGE:
            raise ApiError("invalid_pages_payload", "Too many signatures on a page.")
        for s in sigs:
            if not isinstance(s, dict) or not all(
                _is_number(s.get(k)) for k in ("x", "y", "w", "h")
            ):
                raise ApiError("invalid_pages_payload", "Invalid pages payload.")
            # Non-positive w/h would otherwise be silently clamped to 1px in the
            # composer (a placement the user never asked for); reject explicitly.
            if s["w"] <= 0 or s["h"] <= 0:
                raise ApiError("invalid_pages_payload", "Invalid pages payload.")


def _validate_signatures(sigs: list[dict], page_w: float, page_h: float):
    for s in sigs:
        if (
            s["x"] < 0
            or s["y"] < 0
            or s["x"] + s["w"] > page_w
            or s["y"] + s["h"] > page_h
        ):
            raise ApiError(
                "coords_out_of_bounds",
                f"Signature coordinates out of page bounds: "
                f"x={s['x']}, y={s['y']}, w={s['w']}, h={s['h']}",
            )


@router.post("")
async def export_document(
    file: UploadFile = File(...),
    pages: str = Form(...),
    delete_pages: str = Form("[]"),
    signatures_data: str = Form("{}"),
):
    # Cap the raw body before parsing — a huge `pages` string is a cheap,
    # unauthenticated DoS vector (O(n) parse + O(n·m) validation otherwise).
    if len(pages) > pdf_service.MAX_PAGES_JSON_BYTES:
        raise ApiError("invalid_pages_payload", "Pages payload too large.", 413)
    try:
        pages_payload = json.loads(pages)
        delete_list = json.loads(delete_pages)
    except (json.JSONDecodeError, ValueError):
        raise ApiError("invalid_pages_payload", "Invalid pages payload.")

    # Demo mode: the browser owns the signatures and ships their pixels inline,
    # so the server composes from `signatures_data` and persists nothing.
    demo = is_demo_mode()
    sig_images = None
    if demo:
        if len(signatures_data) > pdf_service.MAX_SIGNATURES_DATA_BYTES:
            raise ApiError(
                "signatures_data_too_large", "Inline signatures payload too large.", 413
            )
        try:
            sig_images = decode_inline_signatures(signatures_data)
        except DomainError as e:
            raise ApiError(e.code, e.message)
    if not isinstance(delete_list, list):
        raise ApiError("invalid_pages_payload", "Invalid pages payload.")
    delete_list = [
        i
        for i in delete_list
        if isinstance(i, int) and not isinstance(i, bool) and i >= 0
    ]
    _validate_payload_shape(pages_payload)
    data = await file.read()
    if len(data) > pdf_service.MAX_FILE_SIZE:
        raise ApiError("file_too_large", "File exceeds the size limit.", 413)
    ext = Path(file.filename or "").suffix.lower()

    if ext == ".pdf":
        import fitz

        try:
            doc = fitz.open(stream=data, filetype="pdf")
        except Exception:
            raise ApiError(
                "corrupt_pdf", "Could not open PDF: file is corrupt or unsupported."
            )
        try:
            pdf_service.ensure_render_safe(doc)
            if delete_list and len({i for i in delete_list if i < len(doc)}) >= len(
                doc
            ):
                raise ApiError("no_pages_left", "No pages left after deletion.", 422)
            for p in pages_payload:
                idx = p["page_idx"]
                if idx >= len(doc):
                    raise ApiError(
                        "page_index_out_of_range", f"Page index {idx} out of range"
                    )
                # Signatures arrive in the frontend stage coordinate space
                # (stage_w x stage_h, default 794x1123). pdf_writer scales from
                # that same space, so bounds must be checked against it — NOT
                # against page.rect (a different unit) which produced both false
                # rejections (small pages) and false passes (large pages).
                stage_w = p.get("stage_w", STAGE_FALLBACK_W)
                stage_h = p.get("stage_h", STAGE_FALLBACK_H)
                sigs = p["signatures"]
                if sigs:
                    rect = doc[idx].rect
                    _check_aspect(stage_w, stage_h, rect.width, rect.height)
                _validate_sig_ids(sigs)
                _validate_signatures(sigs, stage_w, stage_h)
        except DomainError as e:
            raise ApiError(e.code, e.message)
        finally:
            doc.close()

        result_bytes = export_pdf(
            data, pages_payload, delete_pages=delete_list, sig_images=sig_images
        )
        if not demo:
            _persist_copy(result_bytes, "pdf")
            _save_history(
                data,
                result_bytes,
                filename=file.filename or "document.pdf",
                ext="pdf",
                pages_payload=pages_payload,
                delete_list=delete_list,
            )
        return Response(
            content=result_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": "attachment; filename=signed.pdf"},
        )

    elif ext in IMAGE_OUTPUT:
        try:
            img = Image.open(io.BytesIO(data))
            pdf_service.ensure_image_safe(img)
            img.load()  # force decode so corrupt/truncated data fails here
        except ApiError:
            raise
        except DomainError as e:
            raise ApiError(e.code, e.message)
        except Exception:
            raise ApiError(
                "corrupt_image",
                "Could not open image: file is corrupt or unsupported.",
            )
        page_info = pages_payload[0] if pages_payload else {}
        sigs = page_info.get("signatures", [])
        _validate_sig_ids(sigs)
        stage_w = page_info.get("stage_w", 0)
        stage_h = page_info.get("stage_h", 0)
        if not stage_w or not stage_h:
            raise ApiError("stage_dims_required", "stage_w and stage_h are required")
        sx = img.width / stage_w
        sy = img.height / stage_h
        if sigs and abs(sx - sy) > _ASPECT_TOLERANCE * max(sx, sy):
            raise ApiError(
                "stage_aspect_mismatch",
                "Stage dimensions do not match the image aspect ratio",
            )
        scaled_sigs = [
            {
                **s,
                "x": s["x"] * sx,
                "y": s["y"] * sy,
                "w": s["w"] * sx,
                "h": s["h"] * sy,
            }
            for s in sigs
        ]
        _validate_signatures(scaled_sigs, img.width, img.height)
        composed = compose_page(
            img,
            scaled_sigs,
            None if demo else get_signatures_dir(),
            jitter=page_info.get("jitter", 0),
            page_index=page_info.get("page_idx", 0),
            sig_images=sig_images,
        )
        fmt, media_type, out_ext = IMAGE_OUTPUT[ext]
        buf = io.BytesIO()
        composed.convert("RGB").save(buf, format=fmt)
        result_bytes = buf.getvalue()
        if not demo:
            _persist_copy(result_bytes, out_ext.lstrip("."))
            _save_history(
                data,
                result_bytes,
                filename=file.filename or f"document{out_ext}",
                ext=out_ext.lstrip("."),
                pages_payload=pages_payload,
                delete_list=delete_list,
            )
        return Response(
            content=result_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=signed{out_ext}"},
        )

    else:
        raise ApiError("unsupported_file_type", f"Unsupported file type: {ext}")
