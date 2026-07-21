import os
import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from google_auth_oauthlib.flow import Flow

router = APIRouter(prefix="/auth/calendar")

SCOPES = ["https://www.googleapis.com/auth/calendar"]
CREDS_PATH = Path(__file__).resolve().parents[2] / "google_credentials.json"
TOKEN_PATH  = Path(__file__).resolve().parents[1] / "calendar_token.json"

_pending_states: set[str] = set()

REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/calendar/callback"
)

def _build_flow() -> Flow:
    if CREDS_PATH.exists():
        return Flow.from_client_secrets_file(
            str(CREDS_PATH), scopes=SCOPES, redirect_uri=REDIRECT_URI
        )
    client_id     = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise HTTPException(
            status_code=500,
            detail=(
                "Google credentials not found. Place google_credentials.json in "
                "backend/ or set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars."
            ),
        )
    return Flow.from_client_config(
        {
            "web": {
                "client_id": client_id,
                "client_secret": client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [REDIRECT_URI],
            }
        },
        scopes=SCOPES,
        redirect_uri=REDIRECT_URI,
    )

@router.get("")
async def start_auth() -> RedirectResponse:
    flow = _build_flow()
    state = secrets.token_urlsafe(16)
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="select_account consent",
        state=state,
    )
    _pending_states.add(state)
    return RedirectResponse(auth_url)

@router.get("/callback")
async def callback(code: str, state: str = "") -> HTMLResponse:
    if state not in _pending_states:
        raise HTTPException(status_code=400, detail="Invalid OAuth state.")
    _pending_states.discard(state)

    flow = _build_flow()
    flow.fetch_token(code=code)
    TOKEN_PATH.write_text(flow.credentials.to_json())

    return HTMLResponse(
        "<html><body style='font-family:sans-serif;padding:2rem'>"
        "<h2>&#x2705; Google Calendar connected!</h2>"
        "<p>You can close this tab and return to Fraise.</p>"
        "</body></html>"
    )
