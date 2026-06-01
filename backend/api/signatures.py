from fastapi import APIRouter, UploadFile, File, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from constants import is_demo_mode
from errors import ApiError, DomainError
from services import pdf_service
from services.signature_service import (
    list_signatures,
    save_signature,
    process_signature,
    delete_signature,
    get_signature_path,
    rename_signature,
)

router = APIRouter(prefix="/api/signatures", tags=["signatures"])


class RenameRequest(BaseModel):
    name: str


@router.get("")
def get_signatures():
    # Demo mode persists nothing server-side — the browser owns the library, so
    # there is never anything to list here.
    if is_demo_mode():
        return []
    return list_signatures()


@router.post("")
async def upload_signature(
    file: UploadFile = File(...),
    remove_bg: bool = Query(default=True),
):
    data = await file.read()
    if len(data) > pdf_service.MAX_FILE_SIZE:
        raise ApiError("file_too_large", "File exceeds the size limit.", 413)
    try:
        # Both paths run identical validation + background removal. In demo mode
        # the processed PNG is returned inline (base64) and never touches disk;
        # otherwise it is persisted and referenced by id.
        if is_demo_mode():
            result = process_signature(file.filename or "", data, remove_bg=remove_bg)
        else:
            result = save_signature(file.filename or "", data, remove_bg=remove_bg)
    except DomainError as e:
        raise ApiError(e.code, e.message)
    return result


@router.get("/{sig_id}/image")
def get_signature_image(sig_id: str):
    # Nothing is stored server-side in demo mode; the browser holds the image.
    if is_demo_mode():
        raise ApiError("signature_not_found", "Signature not found", 404)
    path = get_signature_path(sig_id)
    if not path:
        raise ApiError("signature_not_found", "Signature not found", 404)
    return FileResponse(path, media_type="image/png")


@router.patch("/{sig_id}")
def patch_signature(sig_id: str, body: RenameRequest):
    # Demo signatures live only in the browser, which renames them locally.
    if is_demo_mode():
        raise ApiError("signature_not_found", "Signature not found", 404)
    # rename_signature returns the canonical stored name (cleaned) or None when
    # the id is unknown/invalid. Echo the stored value so the client matches a
    # subsequent GET /api/signatures (no flicker from trim vs. clean differences).
    cleaned = rename_signature(sig_id, body.name)
    if cleaned is None:
        raise ApiError("signature_not_found", "Signature not found", 404)
    return {"id": sig_id, "name": cleaned}


@router.delete("/{sig_id}")
def remove_signature(sig_id: str):
    # Demo signatures live only in the browser, which deletes them locally.
    if is_demo_mode():
        raise ApiError("signature_not_found", "Signature not found", 404)
    if not delete_signature(sig_id):
        raise ApiError("signature_not_found", "Signature not found", 404)
    return {"deleted": sig_id}
