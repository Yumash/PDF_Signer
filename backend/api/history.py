from fastapi import APIRouter
from fastapi.responses import FileResponse

from constants import is_demo_mode
from errors import ApiError
from services.history_service import (
    list_entries,
    get_entry,
    get_original_path,
    get_result_path,
    delete_entry,
)

router = APIRouter(prefix="/api/history", tags=["history"])

# Map a stored extension to the response media type for downloads/reopen.
_MEDIA = {
    "pdf": "application/pdf",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "tiff": "image/tiff",
    "tif": "image/tiff",
    "webp": "image/webp",
}


@router.get("")
def get_history():
    # Demo mode keeps the signing history in the browser — nothing is persisted
    # server-side, so there is never anything to list.
    if is_demo_mode():
        return []
    return list_entries()


@router.get("/{entry_id}")
def get_history_entry(entry_id: str):
    meta = get_entry(entry_id)
    if not meta:
        raise ApiError("history_not_found", "History entry not found", 404)
    return meta


@router.get("/{entry_id}/original")
def get_history_original(entry_id: str):
    path = get_original_path(entry_id)
    if not path:
        raise ApiError("history_not_found", "History entry not found", 404)
    meta = get_entry(entry_id) or {}
    media = _MEDIA.get(meta.get("ext", ""), "application/octet-stream")
    return FileResponse(path, media_type=media, filename=meta.get("filename"))


@router.get("/{entry_id}/result")
def get_history_result(entry_id: str):
    path = get_result_path(entry_id)
    if not path:
        raise ApiError("history_not_found", "History entry not found", 404)
    meta = get_entry(entry_id) or {}
    ext = meta.get("ext", "bin")
    media = _MEDIA.get(ext, "application/octet-stream")
    return FileResponse(path, media_type=media, filename=f"signed.{ext}")


@router.delete("/{entry_id}")
def remove_history_entry(entry_id: str):
    if not delete_entry(entry_id):
        raise ApiError("history_not_found", "History entry not found", 404)
    return {"deleted": entry_id}
