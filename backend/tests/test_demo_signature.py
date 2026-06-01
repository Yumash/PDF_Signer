"""Phase 2 — stateless signature processing in demo mode.

DEMO_MODE=1: upload runs the same validation + background removal as the normal
path but returns the PNG inline (base64) and writes nothing to disk; the
listing/image/rename/delete endpoints become inert.
"""

import base64
import io
from pathlib import Path

from PIL import Image

from services.signature_service import process_signature, save_signature

# A canonical UUID — passes is_valid_sig_id, so any 404 comes from the demo
# guard rather than id validation.
_VALID_UUID = "12345678-1234-1234-1234-123456789abc"


def _png_files(data_dir):
    d = Path(data_dir) / "signatures"
    return list(d.glob("*.png")) if d.exists() else []


def _decode_data_url(image: str) -> bytes:
    assert image.startswith("data:image/png;base64,")
    return base64.b64decode(image.split(",", 1)[1])


def test_demo_upload_returns_base64_and_writes_nothing(
    client, monkeypatch, make_image, tmp_path
):
    monkeypatch.setenv("DEMO_MODE", "1")
    res = client.post(
        "/api/signatures?remove_bg=true",
        files={"file": ("my sig.png", make_image(), "image/png")},
    )
    assert res.status_code == 200
    body = res.json()
    assert set(body) >= {"id", "name", "image"}
    assert body["name"] == "my sig"
    # The inline image decodes to a valid PNG.
    Image.open(io.BytesIO(_decode_data_url(body["image"]))).verify()
    # AC1: nothing persisted server-side.
    assert _png_files(tmp_path) == []
    assert not (Path(tmp_path) / "signatures" / "meta.json").exists()


def test_process_signature_pixels_match_save_signature(make_image, tmp_path):
    # AC2: demo processing is pixel-identical to the disk path (same helper).
    data = make_image()
    saved = save_signature("sig.png", data, remove_bg=True)
    disk_png = (Path(tmp_path) / "signatures" / f"{saved['id']}.png").read_bytes()
    processed = process_signature("sig.png", data, remove_bg=True)
    inline_png = _decode_data_url(processed["image"])

    a = Image.open(io.BytesIO(disk_png)).convert("RGBA")
    b = Image.open(io.BytesIO(inline_png)).convert("RGBA")
    assert a.size == b.size
    assert a.tobytes() == b.tobytes()
    assert processed["name"] == saved["name"] == "sig"


def test_demo_read_and_mutate_endpoints_are_inert(client, monkeypatch):
    # AC3: list is empty; image/rename/delete 404 — never 500.
    monkeypatch.setenv("DEMO_MODE", "1")
    assert client.get("/api/signatures").json() == []
    assert client.get(f"/api/signatures/{_VALID_UUID}/image").status_code == 404
    assert (
        client.patch(f"/api/signatures/{_VALID_UUID}", json={"name": "x"}).status_code
        == 404
    )
    assert client.delete(f"/api/signatures/{_VALID_UUID}").status_code == 404


def test_demo_off_upload_still_persists(client, monkeypatch, make_image, tmp_path):
    # AC4 (negative): with DEMO_MODE off the upload writes to disk as before.
    monkeypatch.delenv("DEMO_MODE", raising=False)
    res = client.post(
        "/api/signatures", files={"file": ("sig.png", make_image(), "image/png")}
    )
    assert res.status_code == 200
    body = res.json()
    assert "image" not in body
    assert "filename" in body
    assert len(_png_files(tmp_path)) == 1


def test_demo_unsupported_format_is_422(client, monkeypatch):
    # AC5 (negative): a bad format is a clean 422 DomainError, not a 500.
    monkeypatch.setenv("DEMO_MODE", "1")
    res = client.post(
        "/api/signatures",
        files={"file": ("sig.txt", b"not an image", "text/plain")},
    )
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "unsupported_signature_format"
