import io
import os
import uuid
from pathlib import Path

import numpy as np
from PIL import Image


DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
SIGNATURES_DIR = DATA_DIR / "signatures"

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}


def _remove_bg_adaptive(img: Image.Image, darkness_threshold: int = 35) -> Image.Image:
    """Remove background from a signature image.

    Estimates paper luminance from corner pixels, then keeps only pixels that are
    significantly darker than the paper (= ink). Crops to the ink bounding box so the
    resulting PNG has no transparent padding and scales correctly on the canvas.
    """
    rgba = img.convert("RGBA")
    arr = np.array(rgba, dtype=np.float32)
    h, w = arr.shape[:2]

    # Sample corners to estimate background luminance
    sample = max(1, min(20, w // 6, h // 6))
    corners = np.concatenate(
        [
            arr[:sample, :sample, :3].reshape(-1, 3),
            arr[:sample, w - sample :, :3].reshape(-1, 3),
            arr[h - sample :, :sample, :3].reshape(-1, 3),
            arr[h - sample :, w - sample :, :3].reshape(-1, 3),
        ]
    )
    bg = np.median(corners, axis=0)
    bg_lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]

    # Pixel luminance
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]

    # Keep pixels darker than background by at least darkness_threshold
    arr[:, :, 3] = np.where(bg_lum - lum >= darkness_threshold, 255, 0)

    result = Image.fromarray(arr.astype(np.uint8), "RGBA")

    # Crop to the ink bounding box using the ALPHA channel specifically.
    # result.getbbox() inspects all bands, so white background pixels (RGB=255,
    # alpha=0) count as non-zero and the crop would never trim a white-paper
    # scan. The alpha channel marks ink (255) vs background (0), so its bbox is
    # the true ink extent.
    bbox = result.getchannel("A").getbbox()
    if bbox is None:
        # No pixel survived the darkness threshold → no ink detected. Fail loudly
        # instead of silently saving a fully-transparent PNG.
        raise ValueError(
            "Не удалось распознать подпись: не удалось отделить чернила от фона. "
            "Используйте более контрастное изображение или отключите удаление фона."
        )
    return result.crop(bbox)


def get_signatures_dir() -> Path:
    SIGNATURES_DIR.mkdir(parents=True, exist_ok=True)
    return SIGNATURES_DIR


def list_signatures() -> list[dict]:
    d = get_signatures_dir()
    result = []
    for f in sorted(d.glob("*.png")):
        result.append({"id": f.stem, "filename": f.name, "size": f.stat().st_size})
    return result


def save_signature(filename: str, data: bytes, remove_bg: bool = True) -> dict:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise ValueError(f"Unsupported format: {ext}")

    img = Image.open(io.BytesIO(data))
    if remove_bg:
        img = _remove_bg_adaptive(img)
    img = img.convert("RGBA")

    sig_id = str(uuid.uuid4())
    out_path = get_signatures_dir() / f"{sig_id}.png"
    img.save(out_path, format="PNG")

    return {"id": sig_id, "filename": out_path.name, "size": out_path.stat().st_size}


def delete_signature(sig_id: str) -> bool:
    path = get_signatures_dir() / f"{sig_id}.png"
    if not path.exists():
        return False
    path.unlink()
    return True


def get_signature_path(sig_id: str) -> Path | None:
    path = get_signatures_dir() / f"{sig_id}.png"
    return path if path.exists() else None
