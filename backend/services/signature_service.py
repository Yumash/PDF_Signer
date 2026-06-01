import base64
import io
import json
import os
import re
import threading
import uuid
from pathlib import Path

import numpy as np
from PIL import Image

from constants import get_data_dir
from errors import DomainError
from services.pdf_service import ensure_image_safe


# Demo export sends the signature pixels inline (the server stores nothing), so
# cap the unique-signature count. The raw payload byte-cap lives in the export
# endpoint (MAX_SIGNATURES_DATA_BYTES) next to the other request byte-caps.
MAX_INLINE_SIGS = 100


SUPPORTED_EXTS = {".jpg", ".jpeg", ".png", ".tiff", ".tif", ".webp"}

# Ink/paper separation knob: keep pixels darker than the paper by this much.
DARKNESS_THRESHOLD = 35

# Max length of a user-facing signature display name (defensive cap).
MAX_NAME_LEN = 80

_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def is_valid_sig_id(sig_id) -> bool:
    """True only for canonical UUID strings.

    Signature ids are server-generated UUIDs (save_signature). Anything else is
    rejected so a client-supplied id can never traverse out of the signatures
    directory when used to build a filesystem path.
    """
    return isinstance(sig_id, str) and bool(_UUID_RE.match(sig_id))


def _remove_bg_adaptive(
    img: Image.Image, darkness_threshold: int = DARKNESS_THRESHOLD
) -> Image.Image:
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
        raise DomainError(
            "signature_not_detected",
            "No signature detected: could not separate ink from the background.",
        )
    return result.crop(bbox)


def get_signatures_dir() -> Path:
    # Computed at call time (not bound at import) so a DATA_DIR set after import
    # — Docker, tests, the Tauri host's app_data_dir — always takes effect.
    # Symmetric with pdf_writer.save_output.
    d = get_data_dir() / "signatures"
    d.mkdir(parents=True, exist_ok=True)
    return d


# --- Display-name metadata --------------------------------------------------
# User-facing names live in a single meta.json (id -> {"name": ...}) next to the
# PNGs, keeping signatures themselves untouched and the store trivially portable
# (Docker volume / Tauri app_data_dir). A missing/corrupt file degrades to "no
# names" rather than failing the listing.


# Sync endpoints run in FastAPI's threadpool, so a multi-delete fires concurrent
# read-modify-write cycles on the shared meta.json. Serialize them with a lock and
# write atomically (temp + os.replace) so a delete can't be lost and a reader can
# never see a half-written file.
_META_LOCK = threading.Lock()


def _meta_path() -> Path:
    return get_signatures_dir() / "meta.json"


def _load_meta() -> dict:
    path = _meta_path()
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_meta(meta: dict) -> None:
    path = _meta_path()
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def _clean_name(name: str) -> str:
    """Trim, collapse whitespace, and cap length. Empty after cleaning -> ''."""
    cleaned = " ".join(str(name).split()).strip()
    return cleaned[:MAX_NAME_LEN]


def _name_for(meta: dict, sig_id: str) -> str:
    entry = meta.get(sig_id)
    return entry.get("name", "") if isinstance(entry, dict) else ""


def list_signatures() -> list[dict]:
    d = get_signatures_dir()
    meta = _load_meta()
    result = []
    for f in sorted(d.glob("*.png")):
        sid = f.stem
        result.append(
            {
                "id": sid,
                "filename": f.name,
                "size": f.stat().st_size,
                "name": _name_for(meta, sid),
            }
        )
    return result


def rename_signature(sig_id: str, name: str) -> str | None:
    """Set a signature's display name. Returns the cleaned name that was stored
    (possibly empty), or None for an unknown/invalid id."""
    if not is_valid_sig_id(sig_id):
        return None
    if not (get_signatures_dir() / f"{sig_id}.png").exists():
        return None
    cleaned = _clean_name(name)
    with _META_LOCK:
        meta = _load_meta()
        entry = meta.get(sig_id)
        if not isinstance(entry, dict):
            entry = {}
        entry["name"] = cleaned
        meta[sig_id] = entry
        _save_meta(meta)
    return cleaned


def _prepare_signature(
    filename: str, data: bytes, remove_bg: bool
) -> tuple[Image.Image, str, str]:
    """Validate, decode and (optionally) background-remove an uploaded signature.

    Returns (rgba_image, sig_id, default_name). Shared by the disk-persisting
    save_signature and the in-memory process_signature (demo mode) so both paths
    apply identical validation and ink/paper separation.
    """
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_EXTS:
        raise DomainError("unsupported_signature_format", f"Unsupported format: {ext}")

    try:
        img = Image.open(io.BytesIO(data))
        ensure_image_safe(img)
        img.load()  # force decode so a decompression bomb fails here
    except Image.DecompressionBombError:
        raise DomainError("image_too_large", "Image is too large to process safely.")
    if remove_bg:
        img = _remove_bg_adaptive(img)
    img = img.convert("RGBA")

    sig_id = str(uuid.uuid4())
    # Default display name = the original upload's base name, so the library is
    # readable before the user renames anything.
    default_name = _clean_name(Path(filename).stem)
    return img, sig_id, default_name


def save_signature(filename: str, data: bytes, remove_bg: bool = True) -> dict:
    img, sig_id, default_name = _prepare_signature(filename, data, remove_bg)

    out_path = get_signatures_dir() / f"{sig_id}.png"
    img.save(out_path, format="PNG")

    if default_name:
        with _META_LOCK:
            meta = _load_meta()
            meta[sig_id] = {"name": default_name}
            _save_meta(meta)

    return {
        "id": sig_id,
        "filename": out_path.name,
        "size": out_path.stat().st_size,
        "name": default_name,
    }


def process_signature(filename: str, data: bytes, remove_bg: bool = True) -> dict:
    """Demo-mode counterpart to save_signature: the same validation and
    background removal, but NOTHING is written to disk. The processed PNG is
    returned as a base64 data URL so the browser becomes the only store.
    """
    img, sig_id, default_name = _prepare_signature(filename, data, remove_bg)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")

    return {
        "id": sig_id,
        "name": default_name,
        "image": f"data:image/png;base64,{b64}",
    }


def decode_inline_signatures(raw: str) -> dict[str, Image.Image]:
    """Decode the demo-mode `signatures_data` payload into {id: RGBA Image}.

    The payload is a JSON object mapping a signature id to a base64 PNG (a bare
    base64 string or a `data:image/png;base64,...` URL). In demo mode the browser
    owns the signatures and sends the pixels with the export request so the
    server keeps nothing.

    Two distinct failure modes, by design:
      * Malformed payload, too many entries, or an oversized/decompression-bomb
        image -> DomainError (the request is rejected). Fail-closed: an attack or
        a genuinely too-large image surfaces as a clear error.
      * A single corrupt or unknown-id entry -> skipped (the composer then skips
        that placement, matching the disk path's "missing file -> skip").
    """
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        raise DomainError("invalid_signatures_data", "Invalid signatures payload.")
    if not isinstance(parsed, dict):
        raise DomainError("invalid_signatures_data", "Invalid signatures payload.")
    if len(parsed) > MAX_INLINE_SIGS:
        raise DomainError("too_many_signatures", "Too many inline signatures.")

    out: dict[str, Image.Image] = {}
    for sig_id, value in parsed.items():
        if not is_valid_sig_id(sig_id) or not isinstance(value, str):
            continue  # unknown/invalid id -> placement skipped downstream
        payload = value.split(",", 1)[1] if value.startswith("data:") else value
        try:
            data = base64.b64decode(payload, validate=True)
            img = Image.open(io.BytesIO(data))
            ensure_image_safe(img)
            img.load()  # force decode so a bomb/corrupt entry fails here
        except DomainError:
            raise
        except Image.DecompressionBombError:
            raise DomainError("image_too_large", "Inline signature too large.")
        except Exception:
            continue  # corrupt single entry must not 500 the whole export
        out[sig_id] = img.convert("RGBA")
    return out


def delete_signature(sig_id: str) -> bool:
    if not is_valid_sig_id(sig_id):
        return False
    path = get_signatures_dir() / f"{sig_id}.png"
    if not path.exists():
        return False
    path.unlink()
    with _META_LOCK:
        meta = _load_meta()
        if meta.pop(sig_id, None) is not None:
            _save_meta(meta)
    return True


def get_signature_path(sig_id: str) -> Path | None:
    if not is_valid_sig_id(sig_id):
        return None
    path = get_signatures_dir() / f"{sig_id}.png"
    return path if path.exists() else None
