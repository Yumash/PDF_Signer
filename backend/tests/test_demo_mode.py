"""Phase 7 — end-to-end demo-mode integration.

A single happy-path flow through the public-demo surface, asserting the
server-persists-nothing invariant holds across config -> upload -> export ->
history. The per-endpoint edge cases live in test_demo_config / test_demo_signature
/ test_demo_export; this ties them together as one realistic session.
"""

import json
from pathlib import Path


def _has_files(data_dir, *subdirs):
    """True if any of the named DATA_DIR subdirs exists and is non-empty."""
    for sub in subdirs:
        p = Path(data_dir) / sub
        if p.exists() and any(p.iterdir()):
            return True
    return False


def test_demo_full_round_trip_persists_nothing(
    client, monkeypatch, make_image, tmp_path
):
    monkeypatch.setenv("DEMO_MODE", "1")

    # 1. The frontend learns it is a demo from /api/config.
    cfg = client.get("/api/config").json()
    assert cfg["demo_mode"] is True

    # 2. Upload a signature: processed + returned inline, never stored.
    up = client.post(
        "/api/signatures?remove_bg=true",
        files={"file": ("sig.png", make_image(), "image/png")},
    )
    assert up.status_code == 200
    sig = up.json()
    assert sig["image"].startswith("data:image/png;base64,")

    # 3. The server-side library is always empty in demo (browser owns it).
    assert client.get("/api/signatures").json() == []

    # 4. Export an image, shipping the signature pixels inline.
    pages = [
        {
            "page_idx": 0,
            "stage_w": 120,
            "stage_h": 60,
            "signatures": [
                {
                    "id": sig["id"],
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
    signed = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={
            "pages": json.dumps(pages),
            "signatures_data": json.dumps({sig["id"]: sig["image"]}),
        },
    )
    assert signed.status_code == 200
    assert signed.headers["content-type"] == "image/png"
    # A composed export differs from the bare document — the signature really
    # made it onto the page.
    bare = client.post(
        "/api/export",
        files={"file": ("doc.png", make_image(), "image/png")},
        data={"pages": json.dumps(pages), "signatures_data": "{}"},
    )
    assert signed.content != bare.content

    # 5. History stays empty, and nothing was written under DATA_DIR.
    assert client.get("/api/history").json() == []
    assert not _has_files(tmp_path, "signatures", "output", "history")
