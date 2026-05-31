"""Tests for signature background removal feedback (fix-bg-removal-feedback).

A blank/contrast-less scan used to be saved as a fully transparent PNG with no
error. Now an undetectable signature raises -> HTTP 422, and the alpha-channel
crop actually trims a white-paper scan to the ink.
"""

import io

from PIL import Image, ImageDraw


def _png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _upload(client, data, remove_bg=True):
    return client.post(
        "/api/signatures",
        params={"remove_bg": str(remove_bg).lower()},
        files={"file": ("sig.png", data, "image/png")},
    )


def test_blank_white_image_rejected(client):
    img = Image.new("RGB", (200, 100), (255, 255, 255))
    r = _upload(client, _png_bytes(img), remove_bg=True)
    assert r.status_code == 422
    assert "подпись" in r.json()["detail"].lower()


def test_dark_ink_signature_accepted_and_cropped(client):
    img = Image.new("RGB", (200, 100), (255, 255, 255))
    ImageDraw.Draw(img).rectangle([80, 40, 119, 59], fill=(10, 10, 10))
    r = _upload(client, _png_bytes(img), remove_bg=True)
    assert r.status_code == 200
    sig_id = r.json()["id"]

    out_resp = client.get(f"/api/signatures/{sig_id}/image")
    assert out_resp.status_code == 200
    out = Image.open(io.BytesIO(out_resp.content)).convert("RGBA")
    # Cropped to the ink rectangle (~40x20), much smaller than the 200x100 input.
    assert out.width < 200 and out.height < 100
    # Contains fully opaque ink pixels.
    assert out.getchannel("A").getextrema()[1] == 255


def test_blank_image_kept_when_bg_removal_disabled(client):
    # With removal off, a plain image is stored as-is (no detection, no 422).
    img = Image.new("RGB", (60, 40), (255, 255, 255))
    r = _upload(client, _png_bytes(img), remove_bg=False)
    assert r.status_code == 200
