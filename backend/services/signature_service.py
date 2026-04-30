import io
import os
import uuid
from pathlib import Path

from PIL import Image


DATA_DIR = Path(os.environ.get("DATA_DIR", "./data"))
SIGNATURES_DIR = DATA_DIR / "signatures"

SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}

# Pixels with R,G,B all above this value are treated as background (white paper).
_BG_THRESHOLD = 240


def _remove_bg_threshold(img: Image.Image) -> Image.Image:
    """Replace near-white pixels with transparency. Works well for dark ink on white paper."""
    rgba = img.convert("RGBA")
    pixels = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = pixels[x, y]
            if r >= _BG_THRESHOLD and g >= _BG_THRESHOLD and b >= _BG_THRESHOLD:
                pixels[x, y] = (r, g, b, 0)
    return rgba


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
        img = _remove_bg_threshold(img)
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
