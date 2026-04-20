"""Pinterest OAuth 2.0 service — PKCE, state generation, code exchange, and board discovery."""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

PINTEREST_TOKEN_URL = "https://api.pinterest.com/v5/oauth/token"
PINTEREST_API_BASE = "https://api.pinterest.com/v5"
PINTEREST_SCOPES = "boards:read,pins:read,pins:write,user_accounts:read"

# TTL for state parameter (10 minutes)
_STATE_TTL = 600


def generate_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE code verifier and code challenge pair.

    Returns:
        A tuple of ``(code_verifier, code_challenge)`` where:
        - ``code_verifier`` is a cryptographically random URL-safe string
        - ``code_challenge`` is the BASE64URL(SHA256(code_verifier)) of the verifier
    """
    code_verifier = secrets.token_urlsafe(32)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


def generate_state(project_slug: str) -> str:
    """Generate a signed, base64url-encoded state parameter for Pinterest OAuth CSRF protection.

    Security: HMAC-SHA256 signature prevents forgery. TTL prevents stale reuse.
    No in-memory nonce store — survives server restarts during the OAuth flow.

    Args:
        project_slug: The project slug to embed in the state payload.

    Returns:
        A string of the form ``<encoded_payload>.<hmac_signature>``.
    """
    payload = {"slug": project_slug, "ts": int(time.time())}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(
        settings.PINTEREST_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()
    return f"{encoded}.{sig}"


def validate_state(state: str) -> str:
    """Validate the HMAC-signed state parameter and return the project slug.

    Args:
        state: The state string returned by Pinterest in the OAuth callback.

    Returns:
        The project slug embedded in the state payload.

    Raises:
        ValueError: With a descriptive message if validation fails for any reason.
    """
    # Split into encoded payload and HMAC signature
    try:
        last_dot = state.rindex(".")
        encoded = state[:last_dot]
        received_sig = state[last_dot + 1:]
    except ValueError:
        raise ValueError("state parameter is malformed (missing separator)")

    # Recompute signature and compare in constant time
    expected_sig = hmac.new(
        settings.PINTEREST_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig, received_sig):
        raise ValueError("state HMAC signature is invalid")

    # Decode and parse payload
    try:
        payload = json.loads(base64.urlsafe_b64decode(encoded.encode()).decode())
    except Exception as exc:
        raise ValueError(f"state payload could not be decoded: {exc}") from exc

    # Check TTL
    if time.time() - payload.get("ts", 0) > _STATE_TTL:
        raise ValueError("state has expired (TTL exceeded)")

    slug = payload.get("slug")
    if not slug:
        raise ValueError("state payload is missing the project slug")

    return slug


async def exchange_code(
    code: str,
    code_verifier: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange a Pinterest authorization code for access and refresh tokens.

    Args:
        code: The authorization code received from Pinterest in the callback.
        code_verifier: The PKCE code verifier generated at the start of the flow.
        client_id: The Pinterest app client ID.
        client_secret: The Pinterest app client secret.
        redirect_uri: The redirect URI registered with the Pinterest app.

    Returns:
        A dict with ``access_token``, ``refresh_token``, and ``expires_in`` keys.

    Raises:
        RuntimeError: If Pinterest returns a non-2xx response.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            PINTEREST_TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "code_verifier": code_verifier,
            },
            auth=(client_id, client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if not resp.is_success:
        logger.error("Pinterest token exchange failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(
            f"Pinterest token exchange failed ({resp.status_code}): {resp.text}"
        )

    data = resp.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", ""),
        "expires_in": data.get("expires_in", 0),
    }


async def refresh_access_token(
    refresh_token: str,
    client_id: str,
    client_secret: str,
) -> dict:
    """Refresh an expired Pinterest access token using the refresh token.

    Args:
        refresh_token: The refresh token obtained during initial authorization.
        client_id: The Pinterest app client ID.
        client_secret: The Pinterest app client secret.

    Returns:
        A dict with ``access_token`` and ``refresh_token`` keys.

    Raises:
        RuntimeError: If Pinterest returns a non-2xx response.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            PINTEREST_TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            },
            auth=(client_id, client_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if not resp.is_success:
        logger.error("Pinterest token refresh failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(
            f"Pinterest token refresh failed ({resp.status_code}): {resp.text}"
        )

    data = resp.json()
    return {
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token", refresh_token),
    }


async def fetch_boards(access_token: str) -> list[dict]:
    """Fetch all Pinterest boards accessible with the given access token.

    Args:
        access_token: A valid Pinterest access token.

    Returns:
        A list of dicts with ``id``, ``name``, and ``description`` keys.

    Raises:
        RuntimeError: If Pinterest returns a non-2xx response.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{PINTEREST_API_BASE}/boards",
            headers={"Authorization": f"Bearer {access_token}"},
            params={"page_size": 100},
        )

    if not resp.is_success:
        logger.error("Pinterest boards fetch failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(
            f"Pinterest boards fetch failed ({resp.status_code}): {resp.text}"
        )

    data = resp.json()
    boards = data.get("items", [])
    return [
        {
            "id": board.get("id", ""),
            "name": board.get("name", ""),
            "description": board.get("description", ""),
        }
        for board in boards
    ]
