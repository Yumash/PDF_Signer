from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.config import router as config_router
from api.document import router as document_router
from api.export import router as export_router
from api.signatures import router as signatures_router
from api.history import router as history_router
from constants import APP_VERSION

app = FastAPI(title="PDF Signer API", version=APP_VERSION)

# The browser deployment talks to the API same-origin through the nginx proxy,
# so CORS is only needed for the dev server and the Tauri webview. Restrict to
# those known origins instead of "*" (the API is unauthenticated).
ALLOWED_ORIGINS = [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "tauri://localhost",
    "http://tauri.localhost",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type"],  # the API only needs the upload content type
)


@app.middleware("http")
async def _api_security_headers(request, call_next):
    """Keep document content (exported PDFs, signature images) out of any cache
    and stop content-type sniffing on the unauthenticated /api/* surface."""
    response = await call_next(request)
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["X-Content-Type-Options"] = "nosniff"
    return response


app.include_router(config_router)
app.include_router(document_router)
app.include_router(signatures_router)
app.include_router(export_router)
app.include_router(history_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "pdf-signer-api"}


if __name__ == "__main__":
    # Entry point for the bundled sidecar (PyInstaller) so the .exe starts a
    # server instead of importing `app` and exiting.
    import os

    import uvicorn

    # The Tauri shell picks a free port at startup and passes it via
    # PDF_SIGNER_PORT (hardcoding 8000 broke the app when that port was taken).
    # Default to 8000 for the Docker/standalone run where the port is fixed.
    port = int(os.environ.get("PDF_SIGNER_PORT", "8000"))
    uvicorn.run(app, host="127.0.0.1", port=port)
