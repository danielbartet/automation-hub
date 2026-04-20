"""Meta OAuth 2.0 service — state generation, code exchange, and asset discovery."""
import base64
import hashlib
import hmac
import json
import logging
import time
from datetime import datetime, timedelta

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

META_BASE = "https://graph.facebook.com/v19.0"

# TTL for state parameter (10 minutes — enough for slow OAuth flows)
_STATE_TTL = 600


def generate_state(
    mode: str = "project",
    slug: str | None = None,
    user_id: str | None = None,
) -> str:
    """Generate a signed, base64url-encoded state parameter for the Meta OAuth flow.

    Security: HMAC-SHA256 signature prevents forgery. TTL prevents stale reuse.
    No in-memory nonce store — survives server restarts during the OAuth flow.

    Args:
        mode: ``"project"`` (default) or ``"user"``.
        slug: Required when ``mode="project"`` — the project slug.
        user_id: Required when ``mode="user"`` — the authenticated user's ID.

    Returns a string of the form ``<encoded_payload>.<hmac_signature>``.
    """
    if mode == "project":
        payload: dict = {"mode": "project", "slug": slug, "ts": int(time.time())}
    else:
        payload = {"mode": "user", "user_id": user_id, "ts": int(time.time())}

    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(
        settings.META_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()

    return f"{encoded}.{sig}"


def validate_state(state: str) -> dict:
    """Validate the state parameter returned by Meta and return the full payload dict.

    Backward-compatible: if the payload has no ``mode`` key (old format), it is
    treated as ``mode="project"`` and the dict will contain ``{"mode": "project",
    "slug": ...}``.

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

    # Check TTL
    if time.time() - payload.get("ts", 0) > _STATE_TTL:
        raise ValueError("state has expired (TTL exceeded)")

    # Backward compat: old payloads have no "mode" key — treat as project mode
    if "mode" not in payload:
        slug = payload.get("slug")
        if not slug:
            raise ValueError("state payload is missing the project slug")
        return {"mode": "project", "slug": slug}

    mode = payload.get("mode")
    if mode == "project":
        if not payload.get("slug"):
            raise ValueError("state payload is missing the project slug")
    elif mode == "user":
        if not payload.get("user_id"):
            raise ValueError("state payload is missing user_id")
    else:
        raise ValueError(f"state payload has unknown mode: {mode!r}")

    return payload


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
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Meta token response missing access_token: {list(data.keys())}")
    return token


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
    long_lived_token = data.get("access_token")
    if not long_lived_token:
        raise RuntimeError(f"Meta token response missing access_token: {list(data.keys())}")
    expires_at = datetime.utcnow() + timedelta(seconds=data.get("expires_in", 5184000))  # default 60 days
    return long_lived_token, expires_at


async def discover_assets(token: str) -> dict:
    """Discover Meta assets (pages, Instagram accounts, ad accounts) linked to the token.

    Logs warnings for missing assets but never raises — the caller should
    proceed with whatever was discovered and update the project accordingly.

    Args:
        token: A long-lived Meta access token.

    Returns:
        A dict with:
        - ``facebook_page_id``: ID of the first page (or None)
        - ``instagram_account_id``: ID of the first IG account (or None)
        - ``ad_account_id``: ID of the first ad account (or None)
        - ``pages``: list of dicts with ``id`` and ``name`` for all pages
        - ``ad_accounts``: list of dicts with ``id`` and ``name`` for all ad accounts
        - ``instagram_accounts``: list of dicts with ``id`` and ``username`` for all IG accounts
    """
    facebook_page_id: str | None = None
    instagram_account_id: str | None = None
    ad_account_id: str | None = None
    all_pages: list[dict] = []
    all_ad_accounts: list[dict] = []
    all_instagram_accounts: list[dict] = []

    # --- Facebook Pages ---
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{META_BASE}/me/accounts",
                params={"fields": "id,name", "access_token": token},
            )
        data = resp.json()
        pages = data.get("data", [])
        if not pages:
            logger.warning("discover_assets: no Facebook Pages found for this token")
        else:
            all_pages = [{"id": p.get("id"), "name": p.get("name", "")} for p in pages]
            facebook_page_id = pages[0].get("id")
    except Exception as exc:
        logger.warning("discover_assets: error fetching Facebook Pages: %s", exc)

    # --- Instagram Business Accounts (one per page) ---
    for page_info in all_pages:
        page_id = page_info["id"]
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(
                    f"{META_BASE}/{page_id}",
                    params={"fields": "instagram_business_account", "access_token": token},
                )
            result = resp.json()
            ig = result.get("instagram_business_account")
            if ig and ig.get("id"):
                # Fetch the username separately
                ig_id = ig["id"]
                try:
                    async with httpx.AsyncClient(timeout=30.0) as client:
                        ig_resp = await client.get(
                            f"{META_BASE}/{ig_id}",
                            params={"fields": "id,username", "access_token": token},
                        )
                    ig_data = ig_resp.json()
                    username = ig_data.get("username", ig_id)
                except Exception:
                    username = ig_id
                all_instagram_accounts.append({"id": ig_id, "username": username})
        except Exception as exc:
            logger.warning(
                "discover_assets: error fetching Instagram account for page %s: %s",
                page_id,
                exc,
            )

    if all_instagram_accounts:
        instagram_account_id = all_instagram_accounts[0]["id"]
    elif facebook_page_id:
        logger.warning(
            "discover_assets: no Instagram Business Account linked to any discovered page"
        )

    # --- Ad Accounts ---
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{META_BASE}/me/adaccounts",
                params={"fields": "id,name", "access_token": token},
            )
        data = resp.json()
        ad_accounts = data.get("data", [])
        if not ad_accounts:
            logger.warning("discover_assets: no Ad Accounts found for this token")
        else:
            all_ad_accounts = [{"id": a.get("id"), "name": a.get("name", a.get("id", ""))} for a in ad_accounts]
            ad_account_id = ad_accounts[0].get("id")
    except Exception as exc:
        logger.warning("discover_assets: error fetching Ad Accounts: %s", exc)

    return {
        "facebook_page_id": facebook_page_id,
        "instagram_account_id": instagram_account_id,
        "ad_account_id": ad_account_id,
        "pages": all_pages,
        "ad_accounts": all_ad_accounts,
        "instagram_accounts": all_instagram_accounts,
    }
