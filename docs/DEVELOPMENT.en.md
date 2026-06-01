# PDF Signer — Developer Guide (EN)

Русская версия: [DEVELOPMENT.ru.md](DEVELOPMENT.ru.md)
· ← [README](../README.md#english) · [CHANGELOG](../CHANGELOG.md#english)

## Overview

PDF Signer is an offline tool that overlays a handwritten signature onto PDF and
image documents. It runs fully locally: a React + Konva frontend talks to a
FastAPI backend that rasterises pages, removes the signature background, and
burns signatures into the output file. The original document is never modified.

## Architecture

```
┌─────────────── Frontend (React 19 + Vite + Konva) ───────────────┐
│ useDocument   – open file; pdfjs-dist renders PDF pages in-browser │
│                 to canvas data URLs; exposes real per-page pixel   │
│                 dimensions (pageDims) and a loadId counter         │
│ useSignatures – signature library CRUD against /api/signatures     │
│ useCanvas     – signature layers per page (+ undo/redo via         │
│                 useHistory)                                        │
│ CanvasEditor  – Konva stage; drag / resize / rotate / opacity      │
│ App           – orchestrates; builds the export payload            │
│ i18n          – RU/EN catalogs, t() helper, language switch        │
└────────────────────────────────────────────────────────────────────┘
                 │  HTTP (same-origin via nginx proxy, or :8000 in dev)
┌─────────────── Backend (FastAPI · Python 3.11) ──────────────────┐
│ api/document   – /render: rasterise pages (PyMuPDF) → base64 PNG   │
│ api/signatures – upload (bg removal), list, image, delete          │
│ api/export     – burn signatures into PDF (PyMuPDF) or image       │
│ services/      – pdf_service, pdf_writer, composer,                │
│                  signature_service                                 │
│ errors.py      – ApiError {code,message} + DomainError             │
└────────────────────────────────────────────────────────────────────┘
```

### Data flow (export)

1. The frontend renders each page at its real pixel size and places signature
   layers in that coordinate space (the Konva stage = the rendered page size, so
   the page aspect ratio is preserved).
2. On export it sends `pages` (per-page signatures + `stage_w/stage_h` + optional
   `jitter`) and `delete_pages`.
3. The backend re-renders each signed PDF page at 200 DPI, scales the signature
   coordinates by `pix / stage` (uniformly, since the aspect ratios match),
   composites the signatures (Pillow), and rebuilds the document.

## API reference

Base: `/api`. Errors use `{ "detail": { "code": "<stable_code>", "message": "<english>" } }`.
The frontend maps `code` to a localized message.

### `GET /api/config`
Returns `{ "demo_mode": bool, "version": "<x.y.z>" }`. The static frontend bundle
fetches this at startup (it cannot read env vars) to learn whether the server is
a stateless public demo. See **Demo mode** below.

### `POST /api/document/render`
Form: `file`. Returns `{ "page_count": n, "pages": ["<base64 png>", ...] }`.
Errors: `unsupported_file_type` (422), `file_too_large` (413), `too_many_pages`,
`page_too_large`, `image_too_large` (422).

### `POST /api/signatures?remove_bg=true|false`
Form: `file` (image). Returns `{ "id": "<uuid>", "filename", "size" }`.
Errors: `file_too_large` (413), `unsupported_signature_format`, `image_too_large`,
`signature_not_detected` (422 — background removal found no ink).

### `GET /api/signatures`
Returns `[{ "id", "filename", "size" }, ...]`.

### `GET /api/signatures/{id}/image`
Returns the PNG. `signature_not_found` (404) for an unknown or non-UUID id.

### `DELETE /api/signatures/{id}`
Returns `{ "deleted": "<id>" }`. `signature_not_found` (404).

### `POST /api/export`
Form: `file`; `pages` (JSON); `delete_pages` (JSON list of page indices, optional).
`pages` is a list of `{ page_idx, stage_w, stage_h, jitter, signatures: [{ id, x, y, w, h, angle, opacity }] }`.
Returns the signed PDF or image (source format preserved).
Errors: `invalid_pages_payload`, `file_too_large` (413), `corrupt_pdf`,
`corrupt_image`, `page_index_out_of_range`, `stage_aspect_mismatch`,
`invalid_dimensions`, `stage_dims_required`, `invalid_signature_id`,
`coords_out_of_bounds`, `unsupported_file_type`, `too_many_pages`,
`page_too_large`, `image_too_large`, `no_pages_left` (all 422).

### `GET /health`
Returns `{ "status": "ok", "service": "pdf-signer-api" }`.

## Key behaviors

- **Background removal** (`signature_service._remove_bg_adaptive`): luminance
  threshold vs paper estimated from corner pixels; crops to the alpha (ink)
  bounding box; raises `signature_not_detected` if nothing remains.
- **Signature jitter**: deterministic per-instance variation seeded by
  `(sig_id, page, index)`; intensity 0..1 from the UI slider; 0 = off.
- **Multi-page**: layers are kept per page index; export burns every signed page.
- **Page deletion**: pages marked for deletion are excluded from the export
  (reversible toggle; not a destructive edit of the source).
- **Limits** (anti-DoS): `MAX_FILE_SIZE` 50 MB, `MAX_PAGES` 500,
  `MAX_PIXMAP_PIXELS` ~64 MP, Pillow decompression-bomb guard.
- **Demo mode** (`DEMO_MODE=1`, `constants.is_demo_mode()`): the server persists
  nothing. `POST /api/signatures` runs background removal in memory and returns
  the PNG inline as base64 (no disk write); the listing/image/rename/delete
  endpoints and `GET /api/history` are inert (`[]` / 404). `POST /api/export`
  takes the signature pixels from a `signatures_data` form field (JSON
  `{ id: base64png }`, capped at `MAX_SIGNATURES_DATA_BYTES` → 413 and
  `MAX_INLINE_SIGS`) and skips both the output copy and the history entry. The
  browser (`lib/demoStore.js`, IndexedDB) keeps the only copy of the library and
  history. A malformed value of `DEMO_MODE` is treated as off (fail-safe).

## Development

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload          # http://localhost:8000

# Frontend
cd frontend
npm install
npm run dev                        # http://localhost:5173
```

`DATA_DIR` (default `./data`) holds `signatures/` and `output/`.

## Testing

```bash
pip install -r backend/requirements.txt pytest httpx
python -m pytest                   # backend (pytest.ini sets pythonpath=backend)

cd frontend && npm run lint        # ESLint flat config
cd frontend && npm test            # Vitest (hooks, i18n)
cd frontend && npm run build       # production build
```

CI (`.github/workflows/ci.yml`) runs backend pytest and frontend lint, test, build on
push to main and on pull requests.

## Deployment

- **Docker** (recommended): `docker compose up` → http://localhost:8080. The
  backend is reached only via the nginx proxy (no host port); containers run
  non-root; `/data` is a named volume.
- **Public demo (stateless)**: `docker compose -f docker-compose.yml -f
  docker-compose.demo.yml up`. The override sets `DEMO_MODE=1` and drops the data
  volume (via the `!reset` merge tag — an empty list would merge, not replace),
  so the server stores nothing and visitors are isolated; the browser keeps the
  only copy. Plain `docker compose up` stays fully persistent.
- **Native app (Tauri)**: `scripts/build-exe.sh` builds for the **host OS** and
  collects the installers into **`./release/`**. It builds the FastAPI sidecar
  (PyInstaller from `backend/api_server.spec`), places it under the Rust target
  triple (`api-server-<triple>[.exe]`, matching `externalBin` in
  `tauri.conf.json`), then runs `tauri build` (bundle `targets: "all"` → every
  installer format the host supports). Icons are committed under
  `src-tauri/icons/`. The native build is **Windows-first** (verified there);
  macOS/Linux use the same flow but are experimental.

  Common prerequisites: **Rust/cargo**, **Python 3.11 + PyInstaller**, **Node/npm**.

  | OS | Extra prerequisites | Build | Output in `./release/` |
  |---|---|---|---|
  | **Windows** | WebView2 (preinstalled on Win 10/11) | `bash scripts/build-exe.sh` | `*-setup.exe` (NSIS), `*.msi` |
  | **macOS** | Xcode Command Line Tools (`xcode-select --install`) | `bash scripts/build-exe.sh` | `*.dmg`, `*.app` |
  | **Linux** | `webkit2gtk-4.1`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `build-essential` (Debian/Ubuntu names) | `bash scripts/build-exe.sh` | `*.deb`, `*.rpm`, `*.AppImage` |

  Tauri only cross-compiles within reason — build each OS's installers **on that
  OS** (or its CI runner). To run the loose binary, keep `pdf-signer` and
  `api-server` together: the app launches the sidecar from beside itself.

  CI (`release.yml`) builds the full **Windows** release on **merge to main**: it
  auto-tags `v<version>` (read from `package.json`, when the version was bumped)
  and publishes the `.exe`/`.msi` plus the GHCR images on that tag; a manual `v*`
  tag triggers the same build. macOS/Linux are not built in CI yet — build them
  locally with the script above.

## Internationalization

API responses are locale-agnostic (error `code` + English `message`). The
frontend (`src/i18n/`) holds RU/EN catalogs, a `t(key, vars)` helper, a language
switcher, and `resolveApiError(detail, t)` that maps error codes to localized
text.
