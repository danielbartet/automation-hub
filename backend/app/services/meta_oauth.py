"""Meta OAuth 2.0 service — state generation, code exchange, and asset discovery."""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# In-process nonce store: nonce -> timestamp of creation
_nonce_store: dict[str, float] = {}

META_BASE = "https://graph.facebook.com/v19.0"


def generate_state(slug: str) -> str:
    """Generate a signed, base64url-encoded state parameter for the Meta OAuth flow.

    The state encodes the project slug and a one-time nonce so that the
    callback can verify the round-trip without a session.

    Returns a string of the form ``<encoded_payload>.<hmac_signature>``.
    """
    nonce = secrets.token_hex(16)
    _nonce_store[nonce] = time.time()

    payload = {"slug": slug, "nonce": nonce, "ts": int(time.time())}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(
        settings.META_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()

    return f"{encoded}.{sig}"


def validate_state(state: str) -> str:
    """Validate the state parameter returned by Meta and return the project slug.

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
        settings.META_OAUTH_STATE_SECRET.encode(),
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

    # Check TTL (5 minutes)
    if time.time() - payload.get("ts", 0) > 300:
        raise ValueError("state has expired (TTL exceeded)")

    # Verify nonce is present (replay protection)
    nonce = payload.get("nonce")
    if nonce not in _nonce_store:
        raise ValueError("state nonce is unknown or already consumed (replay protection)")

    # Consume nonce to prevent replay
    del _nonce_store[nonce]

    slug = payload.get("slug")
    if not slug:
        raise ValueError("state payload is missing the project slug")

    return slug


async def exchange_code(code: str) -> str:
    """Exchange a Meta authorization code for a short-lived access token.

    Args:
        code: The authorization code received from Meta in the callback.

    Returns:
        The short-lived access token string.

    Raises:
        RuntimeError: If Meta returns a non-2xx response.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{META_BASE}/oauth/access_token",
            params={
                "client_id": settings.META_APP_ID,
                "client_secret": settings.META_APP_SECRET,
                "redirect_uri": settings.META_OAUTH_REDIRECT_URI,
                "code": code,
            },
        )
    if not resp.is_success:
        logger.error("Meta token exchange failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Meta token exchange failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    return data["access_token"]


async def upgrade_to_long_lived(short_token: str) -> tuple[str, datetime]:
    """Upgrade a short-lived Meta token to a long-lived token.

    Args:
        short_token: The short-lived access token from :func:`exchange_code`.

    Returns:
        A tuple of ``(long_lived_token, expires_at)`` where ``expires_at`` is a
        UTC :class:`datetime` computed from the ``expires_in`` field in the
        Meta response.

    Raises:
        RuntimeError: If Meta returns a non-2xx response.
    """
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(
            f"{META_BASE}/oauth/access_token",
            params={
                "grant_type": "fb_exchange_token",
                "client_id": settings.META_APP_ID,
                "client_secret": settings.META_APP_SECRET,
                "fb_exchange_token": short_token,
            },
        )
    if not resp.is_success:
        logger.error("Meta token upgrade failed %s: %s", resp.status_code, resp.text)
        raise RuntimeError(f"Meta token upgrade failed ({resp.status_code}): {resp.text}")

    data = resp.json()
    long_lived_token = data["access_token"]
    expires_at = datetime.utcnow() + timedelta(seconds=data["expires_in"])
    return long_lived_token, expires_at


async def discover_assets(token: str) -> dict:
    """Discover Meta assets (page, Instagram account, ad account) linked to the token.

    Logs warnings for missing assets but never raises — the caller should
    proceed with whatever was discovered and update the project accordingly.

    Args:
        token: A long-lived Meta access token.

    Returns:
        A dict with keys ``facebook_page_id``, ``instagram_account_id``, and
        ``ad_account_id``.  Any value may be ``None`` if not found.
    """
    facebook_page_id: str | None = None
    instagram_account_id: str | None = None
    ad_account_id: str | None = None

    # --- Facebook Page ---
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{META_BASE}/me/accounts",
                params={"fields": "id,name,instagram_business_account", "access_token": token},
            )
        data = resp.json()
        pages = data.get("data", [])
        if not pages:
            logger.warning("discover_assets: no Facebook Pages found for this token")
        else:
            page = pages[0]
            facebook_page_id = page.get("id")
    except Exception as exc:
        logger.warning("discover_assets: error fetching Facebook Pages: %s", exc)

    # --- Instagram Business Account (requires page ID) ---
    if facebook_page_id:
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{META_BASE}/{facebook_page_id}",
                    params={"fields": "instagram_business_account", "access_token": token},
                )
            result = resp.json()
            instagram_account_id = result.get("instagram_business_account", {}).get("id")
            if not instagram_account_id:
                logger.warning(
                    "discover_assets: no Instagram Business Account linked to page %s",
                    facebook_page_id,
                )
        except Exception as exc:
            logger.warning("discover_assets: error fetching Instagram account: %s", exc)

    # --- Ad Account ---
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{META_BASE}/me/adaccounts",
                params={"fields": "id", "access_token": token},
            )
        data = resp.json()
        ad_accounts = data.get("data", [])
        if not ad_accounts:
            logger.warning("discover_assets: no Ad Accounts found for this token")
        else:
            ad_account_id = ad_accounts[0].get("id")
    except Exception as exc:
        logger.warning("discover_assets: error fetching Ad Accounts: %s", exc)

    return {
        "facebook_page_id": facebook_page_id,
        "instagram_account_id": instagram_account_id,
        "ad_account_id": ad_account_id,
    }
