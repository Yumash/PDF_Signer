"""Phase 3 — stateless export in demo mode.

DEMO_MODE=1: the browser ships signature pixels inline via `signatures_data`;
the server composes from them and persists neither the output copy nor a history
entry. The composer resolves signatures from disk (normal) or the inline map
(demo) identically.
"""

import io
import json
from pathlib import Path

from PIL import Image

from services import pdf_service
from services.composer import compose_page
from services.signature_service import process_signature, save_signature

_SID = "12345678-1234-1234-1234-123456789abc"


def _is_empty(p: Path) -> bool:
    return (not p.exists()) or (not any(p.iterdir()))


def _sig_image(make_image) -> Image.Image:
    return Image.open(io.BytesIO(make_image(40, 20))).convert("RGBA")


def test_compose_page_inline_and_disk_resolve_identically(make_image, tmp_path):
    # AC1: a signature resolved from the inline dict produces the same pixels as
    # one read from disk — proving the disk path is unchanged and inline is a
    # drop-in source.
    sig = _sig_image(make_image)
    page = Image.new("RGB", (200, 100), (255, 255, 255))
    placements = [{"id": _SID, "x": 10, "y": 10, "w": 40, "h": 20}]

    out_inline = compose_page(page, placements, None, sig_images={_SID: sig})

    sigdir = tmp_path / "sd"
    sigdir.mkdir()
    sig.save(sigdir / f"{_SID}.png")
    out_disk = compose_page(page, placements, sigdir)

    assert out_inline.size == out_disk.size == (200, 100)
    assert out_inline.tobytes() == out_disk.tobytes()


def test_demo_image_export_composes_and_persists_nothing(
    client, monkeypatch, make_image, tmp_path
):
    # AC2: demo image export composes from inline data and writes nothing.
    monkeypatch.setenv("DEMO_MODE", "1")
    sig = process_signature("sig.png", make_image(), remove_bg=True)
    sid = sig["id"]
    pages = [
        {
            "page_idx": 0,
            "stage_w": 120,
            "stage_h": 60,
            "signatures": [
                {
                    "id": sid,
                    "x": 10,
                    "y": 5,
                    "w": 40,
                    "h": 20,
                    "angle": 0,
                    "opacity": 1,
                    "jitter": 0,
                }
            ],
        }
    ]
    with_sig = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={
            "pages": json.dumps(pages),
            "signatures_data": json.dumps({sid: sig["image"]}),
        },
    )
    assert with_sig.status_code == 200
    assert with_sig.headers["content-type"] == "image/png"
    Image.open(io.BytesIO(with_sig.content)).verify()
    assert _is_empty(tmp_path / "output")
    assert _is_empty(tmp_path / "history")

    # The same export with no inline pixels (AC4) skips the placement -> a valid
    # PNG that differs from the composed one, never a 500.
    without = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={"pages": json.dumps(pages), "signatures_data": "{}"},
    )
    assert without.status_code == 200
    assert without.content != with_sig.content


def test_demo_pdf_export_composes_and_persists_nothing(
    client, monkeypatch, make_pdf, make_image, tmp_path
):
    # AC2 for the PDF path.
    monkeypatch.setenv("DEMO_MODE", "1")
    sig = process_signature("sig.png", make_image(), remove_bg=True)
    sid = sig["id"]
    pages = [
        {
            "page_idx": 0,
            "stage_w": 595,
            "stage_h": 842,
            "signatures": [
                {
                    "id": sid,
                    "x": 50,
                    "y": 50,
                    "w": 100,
                    "h": 50,
                    "angle": 0,
                    "opacity": 1,
                    "jitter": 0,
                }
            ],
        }
    ]
    res = client.post(
        "/api/export",
        files={"file": ("doc.pdf", make_pdf(width=595, height=842), "application/pdf")},
        data={
            "pages": json.dumps(pages),
            "signatures_data": json.dumps({sid: sig["image"]}),
        },
    )
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert _is_empty(tmp_path / "output")
    assert _is_empty(tmp_path / "history")


def test_demo_signatures_data_too_large_is_413(client, monkeypatch, make_image):
    # AC3: oversized inline payload is rejected with 413, not a 500.
    monkeypatch.setenv("DEMO_MODE", "1")
    big = "x" * (pdf_service.MAX_SIGNATURES_DATA_BYTES + 1)
    res = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={
            "pages": json.dumps(
                [{"page_idx": 0, "stage_w": 120, "stage_h": 60, "signatures": []}]
            ),
            "signatures_data": big,
        },
    )
    assert res.status_code == 413
    assert res.json()["detail"]["code"] == "signatures_data_too_large"


def test_demo_off_export_still_persists(client, monkeypatch, make_image, tmp_path):
    # AC5 (negative): with DEMO_MODE off, export writes the output copy + history.
    monkeypatch.delenv("DEMO_MODE", raising=False)
    saved = save_signature("sig.png", make_image(), remove_bg=True)
    pages = [
        {
            "page_idx": 0,
            "stage_w": 120,
            "stage_h": 60,
            "signatures": [
                {
                    "id": saved["id"],
                    "x": 5,
                    "y": 5,
                    "w": 30,
                    "h": 15,
                    "angle": 0,
                    "opacity": 1,
                    "jitter": 0,
                }
            ],
        }
    ]
    res = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={"pages": json.dumps(pages)},
    )
    assert res.status_code == 200
    assert len(list((tmp_path / "output").glob("*"))) == 1
    assert len(list((tmp_path / "history").iterdir())) == 1
