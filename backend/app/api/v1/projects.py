"""Projects CRUD endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.deps import get_session, get_current_user_optional
from app.models.project import Project
from pydantic import BaseModel
from typing import Optional

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

    model_config = {"from_attributes": True}


class ProjectCreate(BaseModel):
    name: str
    slug: str
    facebook_page_id: Optional[str] = None
    instagram_account_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    n8n_webhook_base_url: Optional[str] = None
    is_active: bool = True
    content_config: Optional[dict] = {}


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    facebook_page_id: Optional[str] = None
    instagram_account_id: Optional[str] = None
    ad_account_id: Optional[str] = None
    meta_access_token: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    n8n_webhook_base_url: Optional[str] = None
    is_active: Optional[bool] = None
    content_config: Optional[dict] = None


@router.get("/", response_model=list[ProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user_optional),
) -> list[Project]:
    """List projects. Admins and unauthenticated requests (backward compat) get all; operators/clients get their assigned projects."""
    if current_user is None or current_user.role == "admin":
        result = await db.execute(select(Project).order_by(Project.created_at.desc()))
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
async def create_project(data: ProjectCreate, db: AsyncSession = Depends(get_session)) -> Project:
    """Create a new project."""
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
        n8n_webhook_base_url=data.n8n_webhook_base_url,
        is_active=data.is_active,
        content_config=data.content_config or {},
    )
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return project


@router.get("/{slug}", response_model=ProjectResponse)
async def get_project(slug: str, db: AsyncSession = Depends(get_session)) -> Project:
    """Get a single project by slug."""
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
    return project


@router.put("/{slug}", response_model=ProjectResponse)
async def update_project(slug: str, data: ProjectUpdate, db: AsyncSession = Depends(get_session)) -> Project:
    """Update an existing project by slug."""
    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")

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
    if data.n8n_webhook_base_url is not None:
        project.n8n_webhook_base_url = data.n8n_webhook_base_url
    if data.is_active is not None:
        project.is_active = data.is_active
    if data.content_config is not None:
        project.content_config = data.content_config

    await db.commit()
    await db.refresh(project)
    return project
