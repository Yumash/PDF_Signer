import io
import json
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import Response
from PIL import Image

from constants import STAGE_FALLBACK_H, STAGE_FALLBACK_W
from errors import ApiError, DomainError
from services import pdf_service
from services.pdf_writer import export_pdf, save_output
from services.composer import compose_page
from services.signature_service import get_signatures_dir, is_valid_sig_id

router = APIRouter(prefix="/api/export", tags=["export"])

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
):
    try:
        pages_payload = json.loads(pages)
        delete_list = json.loads(delete_pages)
    except (json.JSONDecodeError, ValueError):
        raise ApiError("invalid_pages_payload", "Invalid pages payload.")
    delete_list = [
        i
        for i in delete_list
        if isinstance(i, int) and not isinstance(i, bool) and i >= 0
    ]
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

        result_bytes = export_pdf(data, pages_payload, delete_pages=delete_list)
        save_output(result_bytes, "pdf")
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
            get_signatures_dir(),
            jitter=page_info.get("jitter", 0),
            page_index=page_info.get("page_idx", 0),
        )
        fmt, media_type, out_ext = IMAGE_OUTPUT[ext]
        buf = io.BytesIO()
        composed.convert("RGB").save(buf, format=fmt)
        result_bytes = buf.getvalue()
        save_output(result_bytes, out_ext.lstrip("."))
        return Response(
            content=result_bytes,
            media_type=media_type,
            headers={"Content-Disposition": f"attachment; filename=signed{out_ext}"},
        )

    else:
        raise ApiError("unsupported_file_type", f"Unsupported file type: {ext}")
