"""Projects CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.deps import get_session, get_current_user_optional, get_current_user
from app.models.project import Project
from pydantic import BaseModel
from typing import Optional
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


class ProjectResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str | None
    is_active: bool
    facebook_page_id: str | None
    instagram_account_id: str | None
    ad_account_id: str | None
    credits_balance: int = 0
    media_config: dict | None = None
    content_config: dict | None = None
    meta_token_expires_at: datetime | None = None

    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    name: str
    slug: str
    facebook_page_id: Optional[str] = None
    instagram_account_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    is_active: bool = True
    content_config: Optional[dict] = {}


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    facebook_page_id: Optional[str] = None
    instagram_account_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    is_active: Optional[bool] = None
    content_config: Optional[dict] = None
    media_config: Optional[dict] = None


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> list[Project]:
    """List projects filtered by role:
    - super_admin / unauthenticated → all projects
    - admin → projects they own (owner_id == current_user.id)
    - operator / client → assigned projects via UserProject
    """
    if current_user is None or current_user.role == "super_admin":
        result = await db.execute(select(Project).order_by(Project.created_at.desc()))
        return result.scalars().all()

    if current_user.role == "admin":
        result = await db.execute(
            select(Project).where(Project.owner_id == current_user.id).order_by(Project.created_at.desc())
        )
        return result.scalars().all()

    # Operator or client: return only assigned projects
    from app.models.user_project import UserProject
    up_result = await db.execute(
        select(UserProject.project_id).where(UserProject.user_id == current_user.id)
    )
    project_ids = [row[0] for row in up_result.fetchall()]
    if not project_ids:
        return []
    result = await db.execute(
        select(Project).where(Project.id.in_(project_ids)).order_by(Project.created_at.desc())
    )
    return result.scalars().all()


@router.post("/", response_model=ProjectResponse)
async def create_project(
    data: ProjectCreate,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> Project:
    """Create a new project. Sets owner_id to the creating user."""
    existing = await db.execute(select(Project).where(Project.slug == data.slug))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Project with slug '{data.slug}' already exists")

    project = Project(
        name=data.name,
        slug=data.slug,
        facebook_page_id=data.facebook_page_id,
        instagram_account_id=data.instagram_account_id,
        ad_account_id=data.ad_account_id,
        meta_access_token=data.meta_access_token,
        telegram_chat_id=data.telegram_chat_id,
        is_active=data.is_active,
        content_config=data.content_config or {},
        owner_id=current_user.id,
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.delete("/{slug}", status_code=204)
async def delete_project(
    slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> None:
    """Delete a project. super_admin can delete any; admin can only delete their own."""
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
    if current_user.role == "admin" and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete projects you own")
    await db.delete(project)
    await db.commit()


@router.get("/{slug}", response_model=ProjectResponse)
async def get_project(
    slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> Project:
    """Get a single project by slug."""
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")

    # Ownership check: super_admin sees all; admin must own; operator/client must be assigned
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            if project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="You do not have access to this project")
        else:
            from app.models.user_project import UserProject
            up = await db.execute(
                select(UserProject).where(
                    UserProject.user_id == current_user.id,
                    UserProject.project_id == project.id,
                )
            )
            if up.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="You do not have access to this project")

    return project


@router.put("/{slug}", response_model=ProjectResponse)
async def update_project(
    slug: str,
    data: ProjectUpdate,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> Project:
    """Update an existing project by slug."""
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")

    # Ownership check: super_admin can update any; admin must own the project
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            if project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="You can only update projects you own")
        else:
            raise HTTPException(status_code=403, detail="Insufficient permissions to update projects")

    if data.name is not None:
        project.name = data.name
    if data.facebook_page_id is not None:
        project.facebook_page_id = data.facebook_page_id
    if data.instagram_account_id is not None:
        project.instagram_account_id = data.instagram_account_id
    if data.ad_account_id is not None:
        project.ad_account_id = data.ad_account_id
    if data.meta_access_token is not None:
        project.meta_access_token = data.meta_access_token
    if data.telegram_chat_id is not None:
        project.telegram_chat_id = data.telegram_chat_id
    if data.is_active is not None:
        project.is_active = data.is_active
    if data.content_config is not None:
        project.content_config = data.content_config
    if data.media_config is not None:
        project.media_config = data.media_config

    await db.commit()
    await db.refresh(project)
    return project


# ── Meta asset management (no re-OAuth required) ──────────────────────────────

class MetaAssetsAssign(BaseModel):
    facebook_page_id: str
    instagram_account_id: str
    ad_account_id: str


@router.get("/{slug}/meta-assets/discover")
async def discover_meta_assets(
    slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Discover available Meta assets using the current user's stored token.

    Returns pages, ad_accounts and instagram_accounts linked to the user's
    UserMetaToken — no new OAuth flow required.

    Raises 400 if the user has no connected Meta account.
    """
    from app.models.user_meta_token import UserMetaToken
    from app.core.security import decrypt_token
    from app.services.meta_oauth import discover_assets
    from datetime import datetime as dt

    result = await db.execute(
        select(UserMetaToken).where(UserMetaToken.user_id == current_user.id)
    )
    user_token = result.scalar_one_or_none()

    if user_token is None:
        raise HTTPException(
            status_code=400,
            detail="No Meta account connected. Connect from Settings first.",
        )

    if user_token.expires_at is not None and user_token.expires_at <= dt.utcnow():
        raise HTTPException(
            status_code=400,
            detail="Meta token is expired. Reconnect from Settings.",
        )

    token = decrypt_token(user_token.encrypted_token)
    assets = await discover_assets(token)

    logger.info(
        "discover_meta_assets: user=%s project=%s pages=%d ad_accounts=%d ig=%d",
        current_user.id,
        slug,
        len(assets.get("pages", [])),
        len(assets.get("ad_accounts", [])),
        len(assets.get("instagram_accounts", [])),
    )

    return assets


@router.post("/{slug}/meta-assets", response_model=ProjectResponse)
async def assign_meta_assets(
    slug: str,
    data: MetaAssetsAssign,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> Project:
    """Assign Meta asset IDs to a project without touching the stored token.

    The caller must own the project or be a super_admin.
    Does NOT modify ``meta_access_token`` — only the asset ID fields.
    """
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")

    # Access check: super_admin bypasses; admin must own the project;
    # operators must be assigned via UserProject.
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            if project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="You do not have access to this project")
        else:
            from app.models.user_project import UserProject
            up = await db.execute(
                select(UserProject).where(
                    UserProject.user_id == current_user.id,
                    UserProject.project_id == project.id,
                )
            )
            if up.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="You do not have access to this project")

    project.facebook_page_id = data.facebook_page_id
    project.instagram_account_id = data.instagram_account_id
    project.ad_account_id = data.ad_account_id

    await db.commit()
    await db.refresh(project)

    logger.info(
        "assign_meta_assets: user=%s project=%s page=%s ig=%s ad=%s",
        current_user.id,
        slug,
        data.facebook_page_id,
        data.instagram_account_id,
        data.ad_account_id,
    )

    return project
