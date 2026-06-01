import hashlib
from pathlib import Path

from PIL import Image

from services.signature_service import is_valid_sig_id


def _jitter_params(sig_id: str, index: int, intensity: float, page: int = 0):
    """Deterministic per-instance jitter so repeated placements of the same
    signature (across pages or several on one page) are not pixel-identical.

    Returns (d_angle_deg, scale_mult, opacity_mult, dx_px, dy_px). intensity<=0
    yields a neutral transform. Seeded by (sig_id, page, index) → reproducible
    and distinct across pages and positions.
    """
    if intensity <= 0:
        return (0.0, 1.0, 1.0, 0, 0)
    intensity = min(intensity, 1.0)
    h = hashlib.sha256(f"{sig_id}:{page}:{index}".encode()).digest()

    def unit(i):  # map a byte to [-1, 1]
        return (h[i] / 255.0) * 2 - 1

    d_angle = unit(0) * 2.5 * intensity  # ±2.5°
    scale_mult = 1 + unit(1) * 0.04 * intensity  # ±4%
    opacity_mult = 1 - (h[2] / 255.0) * 0.10 * intensity  # 0..-10%
    dx = round(unit(3) * 3 * intensity)  # ±3 px
    dy = round(unit(4) * 3 * intensity)
    return (d_angle, scale_mult, opacity_mult, dx, dy)


def _resolve_sig_image(
    sig_id: str,
    sig_dir: Path | None,
    sig_images: dict[str, Image.Image] | None,
) -> Image.Image | None:
    """Source signature image for a placement, or None to skip it.

    Demo mode passes `sig_images` (id -> already-decoded PIL image, sent inline
    with the export request, since the server stores nothing); otherwise the
    image is read from sig_dir/{id}.png on disk. A missing id in either source
    returns None so the placement is skipped — exactly as the original disk path
    did for a missing file.
    """
    if sig_images is not None:
        return sig_images.get(sig_id)
    if sig_dir is not None:
        path = sig_dir / f"{sig_id}.png"
        if path.exists():
            return Image.open(path)
    return None


def compose_page(
    page_img: Image.Image,
    signatures: list[dict],
    sig_dir: Path | None = None,
    jitter: float = 0.0,
    page_index: int = 0,
    sig_images: dict[str, Image.Image] | None = None,
) -> Image.Image:
    """Overlay signatures onto a page image. Returns RGB image with white
    background. Uniquification is per signature: each sig may carry its own
    `jitter` (0..1); the `jitter` argument is only the fallback for signatures
    that don't specify one. `page_index` makes the variation distinct across
    pages.

    Signature pixels come from `sig_dir` (disk, normal mode) or, when
    `sig_images` is provided, from that {id: Image} map (demo mode, sent inline
    with the request)."""
    base = Image.new("RGB", page_img.size, (255, 255, 255))
    if page_img.mode == "RGBA":
        base.paste(page_img.convert("RGB"), mask=page_img.split()[3])
    else:
        base.paste(page_img.convert("RGB"))
    result = base.convert("RGBA")

    for index, sig in enumerate(signatures):
        # Defense-in-depth: never build a path from a non-UUID id.
        if not is_valid_sig_id(sig.get("id")):
            continue
        src_img = _resolve_sig_image(sig["id"], sig_dir, sig_images)
        if src_img is None:
            continue

        # Per-instance uniquification: prefer the signature's own jitter, falling
        # back to the page-level value. Coerce defensively — a non-numeric value
        # from the payload must not raise (it would become an HTTP 500).
        try:
            intensity = float(sig.get("jitter", jitter))
        except (TypeError, ValueError):
            intensity = 0.0
        d_angle, scale_mult, opacity_mult, dx, dy = _jitter_params(
            sig["id"], index, intensity, page_index
        )

        sig_img = src_img.convert("RGBA")

        w = max(1, round(int(sig["w"]) * scale_mult))
        h = max(1, round(int(sig["h"]) * scale_mult))
        sig_img = sig_img.resize((w, h), Image.LANCZOS)

        opacity = max(0.0, min(1.0, sig.get("opacity", 1.0) * opacity_mult))
        if opacity < 1.0:
            r, g, b, a = sig_img.split()
            a = a.point(lambda p: int(p * opacity))
            sig_img = Image.merge("RGBA", (r, g, b, a))

        x = int(sig["x"]) + dx
        y = int(sig["y"]) + dy

        angle = sig.get("angle", 0) + d_angle
        if angle:
            # Konva rotates the layer about its top-left corner at (x, y) —
            # offsetX/Y are 0 (CanvasEditor KonvaImage). Replicate that pivot:
            # centre the corner in a padded canvas, so rotating about the canvas
            # centre == rotating about the corner, then paste so the corner
            # returns to (x, y). PIL's plain centre-pivot rotate shifted rotated
            # signatures ~14-22px off from where the user placed them.
            canvas = Image.new("RGBA", (w * 2, h * 2), (0, 0, 0, 0))
            canvas.paste(sig_img, (w, h))
            canvas = canvas.rotate(-angle, expand=True, resample=Image.BICUBIC)
            ox = round(x - canvas.width / 2)
            oy = round(y - canvas.height / 2)
            result.paste(canvas, (ox, oy), canvas)
        else:
            result.paste(sig_img, (x, y), sig_img)

    return result
