"""Pinterest pin management and OAuth endpoints."""
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_current_user
from app.core.config import settings
from app.core.security import decrypt_token, encrypt_token
from app.models.pinterest_pin import PinterestPin
from app.models.project import Project

try:
    from app.services.pinterest_oauth import (
        exchange_code,
        fetch_boards,
        generate_pkce_pair,
        generate_state,
        refresh_access_token,
        validate_state,
    )
    _pinterest_oauth_available = True
except ImportError:
    _pinterest_oauth_available = False

try:
    from app.skills.pinterest_pin_generator.skill import PinterestPinGeneratorSkill
    _skill_available = True
except ImportError:
    _skill_available = False

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pinterest", tags=["pinterest"])
oauth_router = APIRouter(tags=["pinterest-oauth"])

_PINTEREST_API_BASE = "https://api.pinterest.com/v5"
_PINTEREST_AUTHORIZE_URL = "https://www.pinterest.com/oauth/"
_PINTEREST_OAUTH_SCOPES = "boards:read,pins:read,pins:write,user_accounts:read"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class GeneratePinRequest(BaseModel):
    topic: str
    layout: str = "bottom"  # bottom | split | center | badge_bottom
    title: Optional[str] = None
    description: Optional[str] = None
    image_size: str = "1000x1500"  # 1000x1500 | 1000x1000 | 600x900


class UpdatePinRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    board_id: Optional[str] = None


class PinterestPinResponse(BaseModel):
    id: int
    project_id: int
    title: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    layout: str
    topic: Optional[str]
    board_id: Optional[str]
    status: str
    pinterest_pin_id: Optional[str]
    published_at: Optional[datetime]
    created_at: datetime
    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Helper: resolve project by slug + check user access
# ---------------------------------------------------------------------------

async def _get_project_for_user(project_slug: str, current_user, db: AsyncSession) -> Project:
    """Resolve a project by slug and verify the current user has access."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    if current_user.role in ("super_admin",):
        return project

    if current_user.role == "admin":
        if project.owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="Not authorized for this project")
    else:
        from app.models.user_project import UserProject
        user_projects = await db.execute(
            select(UserProject.project_id).where(UserProject.user_id == current_user.id)
        )
        authorized_ids = {row[0] for row in user_projects.fetchall()}
        if project.id not in authorized_ids:
            raise HTTPException(status_code=403, detail="Not authorized for this project")

    return project


async def _get_pin_with_access(pin_id: int, current_user, db: AsyncSession) -> tuple[PinterestPin, Project]:
    """Fetch a pin and verify access via project ownership."""
    result = await db.execute(select(PinterestPin).where(PinterestPin.id == pin_id))
    pin = result.scalar_one_or_none()
    if not pin:
        raise HTTPException(status_code=404, detail=f"Pin {pin_id} not found")

    proj_result = await db.execute(select(Project).where(Project.id == pin.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            if project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="Not authorized for this pin")
        else:
            from app.models.user_project import UserProject
            user_projects = await db.execute(
                select(UserProject.project_id).where(UserProject.user_id == current_user.id)
            )
            authorized_ids = {row[0] for row in user_projects.fetchall()}
            if pin.project_id not in authorized_ids:
                raise HTTPException(status_code=403, detail="Not authorized for this pin")

    return pin, project


# ---------------------------------------------------------------------------
# GET /pinterest/pins  — list pins
# ---------------------------------------------------------------------------

@router.get("/pins", response_model=list[PinterestPinResponse])
async def list_pins(
    project_slug: str = Query(..., description="Project slug to filter pins by"),
    status: Optional[str] = Query(default=None, description="Filter by status"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[PinterestPin]:
    """List Pinterest pins for a project, with optional status filter and pagination."""
    project = await _get_project_for_user(project_slug, current_user, db)

    query = select(PinterestPin).where(PinterestPin.project_id == project.id)
    if status:
        query = query.where(PinterestPin.status == status)

    query = query.order_by(PinterestPin.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


# ---------------------------------------------------------------------------
# POST /pinterest/pins/generate/{project_slug}  — generate a pin
# ---------------------------------------------------------------------------

@router.post("/pins/generate/{project_slug}")
async def generate_pin(
    project_slug: str,
    body: GeneratePinRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Generate a Pinterest pin image using PinterestPinGeneratorSkill.

    If the project has a Pinterest access token, the pin is saved with
    status='pending_approval'. Otherwise returns a preview without a DB record.
    """
    project = await _get_project_for_user(project_slug, current_user, db)

    if not _skill_available:
        raise HTTPException(
            status_code=503,
            detail="PinterestPinGeneratorSkill is not available yet (Phase 2 in progress)",
        )

    payload = {
        "topic": body.topic,
        "layout": body.layout,
        "title": body.title,
        "description": body.description,
        "image_size": body.image_size,
        "content_config": project.content_config or {},
        "media_config": project.media_config or {},
    }

    try:
        skill = PinterestPinGeneratorSkill(project)
        result = await skill.execute(payload)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Pin generation failed: {str(e)}")

    image_url = result.get("image_url")

    # If project has a Pinterest token, save to DB
    if project.pinterest_access_token:
        pin = PinterestPin(
            project_id=project.id,
            title=body.title or result.get("title"),
            description=body.description or result.get("description"),
            image_url=image_url,
            layout=body.layout,
            topic=body.topic,
            status="pending_approval",
        )
        db.add(pin)
        await db.commit()
        await db.refresh(pin)
        return {
            "id": pin.id,
            "pin_id": pin.id,
            "image_url": image_url,
            "title": pin.title,
            "description": pin.description,
            "status": "pending_approval",
        }
    else:
        # No token — preview only, no DB write
        return {
            "id": None,
            "pin_id": None,
            "image_url": image_url,
            "title": None,
            "description": None,
            "status": "preview_only",
        }


# ---------------------------------------------------------------------------
# GET /pinterest/pins/{pin_id}  — get a single pin
# ---------------------------------------------------------------------------

@router.get("/pins/{pin_id}", response_model=PinterestPinResponse)
async def get_pin(
    pin_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> PinterestPin:
    """Fetch a single Pinterest pin by ID."""
    pin, _project = await _get_pin_with_access(pin_id, current_user, db)
    return pin


# ---------------------------------------------------------------------------
# PATCH /pinterest/pins/{pin_id}  — update a pin
# ---------------------------------------------------------------------------

@router.patch("/pins/{pin_id}", response_model=PinterestPinResponse)
async def update_pin(
    pin_id: int,
    body: UpdatePinRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> PinterestPin:
    """Update a Pinterest pin's editable fields.

    Returns 409 if the pin has already been published.
    """
    pin, _project = await _get_pin_with_access(pin_id, current_user, db)

    if pin.status == "published":
        raise HTTPException(status_code=409, detail="Cannot update a pin that has already been published")

    if body.title is not None:
        pin.title = body.title
    if body.description is not None:
        pin.description = body.description
    if body.board_id is not None:
        pin.board_id = body.board_id

    await db.commit()
    await db.refresh(pin)
    return pin


# ---------------------------------------------------------------------------
# DELETE /pinterest/pins/{pin_id}  — delete a pin
# ---------------------------------------------------------------------------

@router.delete("/pins/{pin_id}")
async def delete_pin(
    pin_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Hard-delete a Pinterest pin. Not allowed if already published."""
    pin, _project = await _get_pin_with_access(pin_id, current_user, db)

    if pin.status == "published":
        raise HTTPException(status_code=400, detail="Cannot delete a pin that has already been published")

    await db.delete(pin)
    await db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /pinterest/pins/{pin_id}/publish  — publish a pin to Pinterest
# ---------------------------------------------------------------------------

@router.post("/pins/{pin_id}/publish")
async def publish_pin(
    pin_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Publish a Pinterest pin to the Pinterest API.

    Decrypts the project's Pinterest access token, calls the Pinterest v5 API,
    and updates the pin status to 'published'. Attempts token refresh on 401.
    """
    pin, project = await _get_pin_with_access(pin_id, current_user, db)

    if not project.pinterest_access_token:
        raise HTTPException(status_code=400, detail="Project has no Pinterest access token configured")

    if not pin.board_id:
        raise HTTPException(status_code=400, detail="Pin has no board_id set — update the pin first")

    if not pin.image_url:
        raise HTTPException(status_code=400, detail="Pin has no image_url — generate the image first")

    access_token = decrypt_token(project.pinterest_access_token)

    async def _call_pinterest_api(token: str) -> dict:
        payload: dict = {
            "board_id": pin.board_id,
            "media_source": {
                "source_type": "image_url",
                "url": pin.image_url,
            },
        }
        if pin.title:
            payload["title"] = pin.title
        if pin.description:
            payload["description"] = pin.description

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{_PINTEREST_API_BASE}/pins",
                json=payload,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
        return resp

    resp = await _call_pinterest_api(access_token)

    # On 401: attempt token refresh (if service available) and retry once
    if resp.status_code == 401 and _pinterest_oauth_available and project.pinterest_refresh_token:
        logger.warning("Pinterest API returned 401 for pin %s — attempting token refresh", pin_id)
        try:
            refresh_token = decrypt_token(project.pinterest_refresh_token)
            pinterest_config = (project.content_config or {}).get("pinterest", {})
            new_token_data = await refresh_access_token(
                refresh_token=refresh_token,
                client_id=pinterest_config.get("client_id", ""),
                client_secret=pinterest_config.get("client_secret", ""),
            )
            new_access_token = new_token_data["access_token"]
            project.pinterest_access_token = encrypt_token(new_access_token)
            if new_token_data.get("refresh_token"):
                project.pinterest_refresh_token = encrypt_token(new_token_data["refresh_token"])
            await db.commit()
            resp = await _call_pinterest_api(new_access_token)
        except Exception as e:
            logger.error("Pinterest token refresh failed for pin %s: %s", pin_id, e)
            pin.status = "failed"
            await db.commit()
            raise HTTPException(status_code=502, detail=f"Pinterest token refresh failed: {str(e)}")

    if not resp.is_success:
        logger.error("Pinterest publish failed for pin %s: %s %s", pin_id, resp.status_code, resp.text)
        pin.status = "failed"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Pinterest API error ({resp.status_code}): {resp.text}")

    data = resp.json()
    pinterest_pin_id = data.get("id")

    pin.status = "published"
    pin.pinterest_pin_id = pinterest_pin_id
    pin.published_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    await db.refresh(pin)

    logger.info("Pin %s published to Pinterest — pinterest_pin_id=%s", pin_id, pinterest_pin_id)
    return {
        "success": True,
        "pinterest_pin_id": pinterest_pin_id,
        "published_at": pin.published_at.isoformat(),
    }


# ---------------------------------------------------------------------------
# GET /pinterest/boards/{project_slug}  — list Pinterest boards
# ---------------------------------------------------------------------------

@router.get("/boards/{project_slug}")
async def list_boards(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[dict]:
    """Return available Pinterest boards for the project.

    Returns an empty list (not 4xx) if no Pinterest token is stored.
    """
    project = await _get_project_for_user(project_slug, current_user, db)

    if not project.pinterest_access_token:
        return []

    if not _pinterest_oauth_available:
        logger.warning("pinterest_oauth service not available — returning empty boards list")
        return []

    access_token = decrypt_token(project.pinterest_access_token)
    try:
        boards = await fetch_boards(access_token)
        return boards
    except Exception as e:
        logger.error("Failed to fetch Pinterest boards for project %s: %s", project_slug, e)
        return []


# ---------------------------------------------------------------------------
# OAuth endpoints (registered under /auth/pinterest via oauth_router)
# ---------------------------------------------------------------------------

@oauth_router.get("/start")
async def pinterest_oauth_start(
    project_slug: str = Query(..., description="Project slug to connect Pinterest for"),
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> RedirectResponse:
    """Initiate Pinterest OAuth PKCE flow for a project.

    Reads client_id from project.content_config["pinterest"]["client_id"].
    Stores PKCE code_verifier in project.pinterest_oauth_verifier (encrypted).
    Redirects to Pinterest authorization page.
    """
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    pinterest_config = (project.content_config or {}).get("pinterest", {})
    client_id = pinterest_config.get("client_id")
    if not client_id:
        raise HTTPException(
            status_code=400,
            detail="Project is missing content_config.pinterest.client_id",
        )

    if not _pinterest_oauth_available:
        raise HTTPException(
            status_code=503,
            detail="Pinterest OAuth service is not available yet (Phase 2 in progress)",
        )

    code_verifier, code_challenge = generate_pkce_pair()
    state = generate_state(project_slug)

    # Store encrypted verifier on project
    project.pinterest_oauth_verifier = encrypt_token(code_verifier)
    await db.commit()

    authorize_url = (
        f"{_PINTEREST_AUTHORIZE_URL}"
        f"?client_id={client_id}"
        f"&redirect_uri={settings.PINTEREST_OAUTH_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={_PINTEREST_OAUTH_SCOPES}"
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
    )
    return RedirectResponse(url=authorize_url, status_code=302)


@oauth_router.get("/callback")
async def pinterest_oauth_callback(
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
    error_description: Optional[str] = None,
    db: AsyncSession = Depends(get_session),
) -> RedirectResponse:
    """Handle Pinterest OAuth callback.

    Exchanges the authorization code for tokens, stores them encrypted on the
    project, then redirects to the dashboard with ?pinterest_connected=true.
    """
    base_projects_url = f"{settings.FRONTEND_URL}/dashboard/projects"

    if error:
        logger.warning("Pinterest OAuth error: %s — %s", error, error_description)
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error={error}",
            status_code=302,
        )

    if not _pinterest_oauth_available:
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error=service_unavailable",
            status_code=302,
        )

    # Validate state and extract project_slug
    try:
        project_slug = validate_state(state or "")
    except ValueError as exc:
        logger.warning("Pinterest OAuth invalid state: %s", exc)
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error=invalid_state",
            status_code=302,
        )

    # Load project
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        logger.warning("Pinterest OAuth callback: project '%s' not found", project_slug)
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error=project_not_found",
            status_code=302,
        )

    # Decrypt stored PKCE verifier
    if not project.pinterest_oauth_verifier:
        logger.warning("Pinterest OAuth callback: no verifier stored for project '%s'", project_slug)
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error=missing_verifier",
            status_code=302,
        )
    code_verifier = decrypt_token(project.pinterest_oauth_verifier)

    # Get client credentials from content_config
    pinterest_config = (project.content_config or {}).get("pinterest", {})
    client_id = pinterest_config.get("client_id", "")
    client_secret = pinterest_config.get("client_secret", "")

    # Exchange code for tokens
    try:
        token_data = await exchange_code(
            code=code or "",
            code_verifier=code_verifier,
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=settings.PINTEREST_OAUTH_REDIRECT_URI,
        )
    except Exception as exc:
        logger.error("Pinterest OAuth token exchange error for project '%s': %s", project_slug, exc)
        return RedirectResponse(
            url=f"{base_projects_url}?pinterest_error=token_exchange_failed",
            status_code=302,
        )

    # Persist encrypted tokens
    project.pinterest_access_token = encrypt_token(token_data["access_token"])
    if token_data.get("refresh_token"):
        project.pinterest_refresh_token = encrypt_token(token_data["refresh_token"])
    project.pinterest_oauth_verifier = None  # Clear verifier after use
    await db.commit()

    logger.info("Pinterest OAuth complete for project '%s'", project_slug)

    return RedirectResponse(
        url=f"{base_projects_url}?pinterest_connected=true",
        status_code=302,
    )
