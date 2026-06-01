from fastapi import APIRouter

from constants import APP_VERSION, is_demo_mode

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
def get_config():
    """Runtime config for the static frontend bundle.

    The Docker frontend is a prebuilt static bundle and cannot read env vars at
    load time, so it asks the API for its mode at startup. `demo_mode` tells it
    to keep all signatures and history in the browser (the server persists
    nothing) instead of calling the server-side storage endpoints.
    """
    return {"demo_mode": is_demo_mode(), "version": APP_VERSION}
