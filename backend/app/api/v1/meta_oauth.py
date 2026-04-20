"""Meta OAuth 2.0 endpoints — initiate and handle the OAuth callback."""
import base64
import json
import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_session, get_current_user_optional
from app.core.config import settings
from app.core.security import encrypt_token
from app.models.project import Project
from app.services.meta_oauth import (
    discover_assets,
    exchange_code,
    generate_state,
    upgrade_to_long_lived,
    validate_state,
)

logger = logging.getLogger(__name__)

router = APIRouter()

_META_AUTHORIZE_URL = "https://www.facebook.com/dialog/oauth"
_META_OAUTH_SCOPES = (
    "ads_management,"  # required: create/pause/scale campaigns via meta_campaign.py
    "ads_read,"
    "pages_read_engagement,"
    "pages_manage_posts,"
    "instagram_basic,"
    "instagram_content_publish"
    # business_management removed: discover_assets uses /me/accounts and /me/adaccounts
    # which are covered by pages_read_engagement + ads_read, not business_management
)


@router.get("/start")
async def meta_oauth_start(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
    project_slug: str | None = None,
    mode: str = "project",
) -> RedirectResponse:
    """Initiate the Meta OAuth flow.

    Supports two modes:
    - ``mode="project"`` (default): connects a token to the given project. Requires
      ``project_slug``. Browser redirect — no auth header needed.
    - ``mode="user"``: connects a personal Meta token to the authenticated user.
      No ``project_slug`` needed. Requires an authenticated session via
      Authorization: Bearer header.
    """
    if mode == "user":
        # Require Authorization header-based auth (fetch + Bearer from frontend)
        if not current_user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        state = generate_state(mode="user", user_id=current_user.id)
    else:
        # mode="project" — project_slug is required
        if not project_slug:
            raise HTTPException(status_code=400, detail="project_slug is required when mode='project'")
        result = await db.execute(select(Project).where(Project.slug == project_slug))
        project = result.scalar_one_or_none()
        if project is None:
            raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")
        state = generate_state(mode="project", slug=project_slug)

    authorize_url = (
        f"{_META_AUTHORIZE_URL}"
        f"?client_id={settings.META_APP_ID}"
        f"&redirect_uri={settings.META_OAUTH_REDIRECT_URI}"
        f"&scope={_META_OAUTH_SCOPES}"
        f"&state={state}"
        f"&response_type=code"
    )
    return RedirectResponse(url=authorize_url, status_code=302)


@router.get("/callback")
async def meta_oauth_callback(
    db: AsyncSession = Depends(get_session),
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
) -> RedirectResponse:
    """Handle the Meta OAuth callback.

    On success, updates the project's Meta token and discovered asset IDs, then
    redirects to the dashboard with ``?meta_connected=true``.

    On failure at any step, redirects to the dashboard with an appropriate
    ``?meta_error=<reason>`` query parameter instead of raising HTTP errors so
    that the user sees a meaningful message in the UI rather than a raw error page.
    """
    base_projects_url = f"{settings.FRONTEND_URL}/dashboard/projects"

    # --- Meta reported an error (user denied access, app issue, etc.) ---
    if error:
        logger.warning("Meta OAuth error: %s — %s", error, error_description)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error={error}",
            status_code=302,
        )

    # --- Validate state ---
    try:
        payload = validate_state(state or "")
    except ValueError as exc:
        logger.warning("Meta OAuth invalid state: %s", exc)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error=invalid_state",
            status_code=302,
        )

    oauth_mode = payload.get("mode", "project")

    # =========================================================
    # USER MODE — store token in UserMetaToken, skip asset discovery
    # =========================================================
    if oauth_mode == "user":
        user_id = payload.get("user_id")

        # --- Exchange authorization code for short-lived token ---
        try:
            short_token = await exchange_code(code or "")
        except RuntimeError as exc:
            logger.error("Meta OAuth token exchange error for user '%s': %s", user_id, exc)
            return RedirectResponse(
                url=f"{base_projects_url}?meta_error=token_exchange_failed",
                status_code=302,
            )

        # --- Upgrade to long-lived token ---
        try:
            long_token, expires_at = await upgrade_to_long_lived(short_token)
        except RuntimeError as exc:
            logger.error("Meta OAuth token upgrade error for user '%s': %s", user_id, exc)
            return RedirectResponse(
                url=f"{base_projects_url}?meta_error=token_upgrade_failed",
                status_code=302,
            )

        # --- UPSERT UserMetaToken ---
        from app.models.user_meta_token import UserMetaToken
        result = await db.execute(select(UserMetaToken).where(UserMetaToken.user_id == user_id))
        umt = result.scalar_one_or_none()
        if umt:
            umt.encrypted_token = encrypt_token(long_token)
            umt.expires_at = expires_at
        else:
            db.add(UserMetaToken(
                user_id=user_id,
                encrypted_token=encrypt_token(long_token),
                expires_at=expires_at,
            ))
        await db.commit()

        logger.info(
            "Meta OAuth (user mode) complete for user '%s': expires=%s",
            user_id,
            expires_at,
        )

        return RedirectResponse(
            url=f"{settings.FRONTEND_URL}/dashboard/settings?meta_connected=true",
            status_code=302,
        )

    # =========================================================
    # PROJECT MODE — existing behavior
    # =========================================================
    slug = payload.get("slug")

    # --- Load project ---
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if project is None:
        logger.warning("Meta OAuth callback: project '%s' not found", slug)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error=project_not_found",
            status_code=302,
        )

    # --- Exchange authorization code for short-lived token ---
    try:
        short_token = await exchange_code(code or "")
    except RuntimeError as exc:
        logger.error("Meta OAuth token exchange error for project '%s': %s", slug, exc)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error=token_exchange_failed",
            status_code=302,
        )

    # --- Upgrade to long-lived token ---
    try:
        long_token, expires_at = await upgrade_to_long_lived(short_token)
    except RuntimeError as exc:
        logger.error("Meta OAuth token upgrade error for project '%s': %s", slug, exc)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error=token_upgrade_failed",
            status_code=302,
        )

    # --- Discover linked assets (never raises) ---
    assets = await discover_assets(long_token)

    # --- Persist token to DB (always) ---
    encrypted_token = encrypt_token(long_token)
    project.meta_access_token = encrypted_token
    project.meta_token_expires_at = expires_at

    pages = assets.get("pages", [])
    ad_accounts = assets.get("ad_accounts", [])
    instagram_accounts = assets.get("instagram_accounts", [])

    # --- Check if user has multiple assets in any category ---
    needs_selection = (
        len(pages) > 1 or len(ad_accounts) > 1 or len(instagram_accounts) > 1
    )

    if needs_selection:
        # Auto-assign first of each as default, but let the user pick
        if assets.get("facebook_page_id") is not None:
            project.facebook_page_id = assets["facebook_page_id"]
        if assets.get("instagram_account_id") is not None:
            project.instagram_account_id = assets["instagram_account_id"]
        if assets.get("ad_account_id") is not None:
            project.ad_account_id = assets["ad_account_id"]

        await db.commit()

        logger.info(
            "Meta OAuth: multiple assets for project '%s' — redirecting to selection UI "
            "(pages=%d, ad_accounts=%d, ig_accounts=%d)",
            slug,
            len(pages),
            len(ad_accounts),
            len(instagram_accounts),
        )

        assets_payload = {
            "pages": pages,
            "ad_accounts": ad_accounts,
            "instagram_accounts": instagram_accounts,
            "current": {
                "page_id": assets.get("facebook_page_id"),
                "instagram_id": assets.get("instagram_account_id"),
                "ad_account_id": assets.get("ad_account_id"),
            },
        }
        encoded = base64.urlsafe_b64encode(
            json.dumps(assets_payload).encode()
        ).decode()
        return RedirectResponse(
            url=f"{base_projects_url}?meta_select=true&slug={quote(slug)}&assets={quote(encoded)}",
            status_code=302,
        )

    # --- Single asset per category — auto-assign and finish ---
    if assets.get("facebook_page_id") is not None:
        project.facebook_page_id = assets["facebook_page_id"]
    if assets.get("instagram_account_id") is not None:
        project.instagram_account_id = assets["instagram_account_id"]
    if assets.get("ad_account_id") is not None:
        project.ad_account_id = assets["ad_account_id"]

    await db.commit()

    logger.info(
        "Meta OAuth complete for project '%s': page=%s ig=%s ad_account=%s expires=%s",
        slug,
        assets.get("facebook_page_id"),
        assets.get("instagram_account_id"),
        assets.get("ad_account_id"),
        expires_at,
    )

    return RedirectResponse(
        url=f"{base_projects_url}?meta_connected=true",
        status_code=302,
    )
