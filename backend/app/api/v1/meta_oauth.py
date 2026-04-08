"""Meta OAuth 2.0 endpoints — initiate and handle the OAuth callback."""
import logging

from fastapi import APIRouter, Depends
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_session
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
    "ads_management,"
    "pages_read_engagement,"
    "pages_manage_posts,"
    "instagram_basic,"
    "instagram_content_publish,"
    "business_management"
)


@router.get("/start")
async def meta_oauth_start(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """Initiate the Meta OAuth flow for the given project.

    Redirects the browser to the Meta authorization dialog.  Returns 404 if
    no project with the given slug exists.
    """
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if project is None:
        # Return 404 as a plain JSON response — we're not inside a browser flow yet
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    state = generate_state(project_slug)

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
        slug = validate_state(state or "")
    except ValueError as exc:
        logger.warning("Meta OAuth invalid state: %s", exc)
        return RedirectResponse(
            url=f"{base_projects_url}?meta_error=invalid_state",
            status_code=302,
        )

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

    # --- Persist to DB ---
    encrypted_token = encrypt_token(long_token)
    project.meta_access_token = encrypted_token
    project.meta_token_expires_at = expires_at

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
