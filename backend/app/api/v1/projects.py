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


PROJECT_TEMPLATES = [
    {
        "id": "tech_saas",
        "name": "Tech SaaS",
        "description": "B2B software product targeting professionals",
        "content_config": {
            "market_region": "North America",
            "brand_voice": "educational",
            "posting_timezone": "America/New_York",
            "optimizer_config": {"cpl_threshold": 15.0, "roas_threshold": 3.0, "cpc_threshold": 1.50},
            "content_categories": ["product_features", "tutorials", "case_studies", "industry_news"],
        },
    },
    {
        "id": "ecommerce",
        "name": "E-commerce",
        "description": "Product-based business selling online",
        "content_config": {
            "market_region": "Global",
            "brand_voice": "conversational",
            "optimizer_config": {"cpl_threshold": 3.0, "roas_threshold": 4.0, "cpc_threshold": 0.50},
            "content_categories": ["product_showcase", "promotions", "testimonials", "lifestyle"],
        },
    },
    {
        "id": "coaching",
        "name": "Coaching / Education",
        "description": "Personal brand, courses, consulting",
        "content_config": {
            "market_region": "LATAM",
            "brand_voice": "bold",
            "posting_timezone": "America/Argentina/Buenos_Aires",
            "optimizer_config": {"cpl_threshold": 5.0, "roas_threshold": 2.0, "cpc_threshold": 0.30},
            "content_categories": ["transformation", "educational", "social_proof", "urgency"],
        },
    },
    {
        "id": "b2b_agency",
        "name": "B2B Agency / Services",
        "description": "Agency or professional services firm",
        "content_config": {
            "market_region": "North America",
            "brand_voice": "formal",
            "optimizer_config": {"cpl_threshold": 25.0, "roas_threshold": 2.5, "cpc_threshold": 2.00},
            "content_categories": ["case_studies", "thought_leadership", "process", "results"],
        },
    },
    {
        "id": "local_business",
        "name": "Local Business",
        "description": "Brick-and-mortar or local service business",
        "content_config": {
            "market_region": "LATAM",
            "brand_voice": "conversational",
            "optimizer_config": {"cpl_threshold": 4.0, "roas_threshold": 3.0, "cpc_threshold": 0.40},
            "content_categories": ["promotions", "community", "behind_scenes", "testimonials"],
        },
    },
]


@router.get("/templates")
async def list_project_templates() -> list[dict]:
    """Return available project setup templates. No auth required."""
    return PROJECT_TEMPLATES


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
    """Delete a project and all its child records.

    super_admin can delete any project; admin can only delete projects they own.
    Child records are deleted explicitly in FK-safe order because SQLite does not
    enforce ON DELETE CASCADE unless the pragma is enabled, and the Project ORM
    relationships do not declare cascade='all, delete-orphan'.
    """
    from sqlalchemy import delete as sql_delete
    from app.models.content import ContentPost
    from app.models.batch import ContentBatch
    from app.models.ad_campaign import AdCampaign
    from app.models.optimization_log import CampaignOptimizationLog
    from app.models.user_project import UserProject
    from app.models.notification import Notification
    from app.models.competitor_cache import CompetitorResearchCache
    from app.models.competitor_intelligence import CompetitorIntelligenceBrief
    from app.models.pinterest_pin import PinterestPin
    from app.models.audience import Audience
    from app.models.ads_audit import AdsAudit
    from app.models.meta_api_audit_log import MetaAPIAuditLog
    from app.models.meta_api_cache import MetaApiCache, AuditLog
    from app.models.approval import Approval

    result = await db.execute(select(Project).where(Project.slug == slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{slug}' not found")
    if current_user.role not in ("super_admin",) and current_user.role == "admin" and project.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete projects you own")
    if current_user.role not in ("super_admin", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions to delete projects")

    pid = project.id

    # 1. Delete grandchild records first (children of ContentPost)
    # Approval references content_posts.id — must go before ContentPost.
    content_post_ids_result = await db.execute(
        select(ContentPost.id).where(ContentPost.project_id == pid)
    )
    content_post_ids = [row[0] for row in content_post_ids_result.fetchall()]
    if content_post_ids:
        await db.execute(sql_delete(Approval).where(Approval.content_post_id.in_(content_post_ids)))

    # 2. Delete direct child records of Project
    await db.execute(sql_delete(ContentPost).where(ContentPost.project_id == pid))
    await db.execute(sql_delete(ContentBatch).where(ContentBatch.project_id == pid))
    await db.execute(sql_delete(CampaignOptimizationLog).where(CampaignOptimizationLog.project_id == pid))
    await db.execute(sql_delete(AdCampaign).where(AdCampaign.project_id == pid))
    await db.execute(sql_delete(UserProject).where(UserProject.project_id == pid))
    await db.execute(sql_delete(Notification).where(Notification.project_id == pid))
    await db.execute(sql_delete(CompetitorResearchCache).where(CompetitorResearchCache.project_id == pid))
    await db.execute(sql_delete(CompetitorIntelligenceBrief).where(CompetitorIntelligenceBrief.project_id == pid))
    await db.execute(sql_delete(PinterestPin).where(PinterestPin.project_id == pid))
    await db.execute(sql_delete(Audience).where(Audience.project_id == pid))
    await db.execute(sql_delete(MetaAPIAuditLog).where(MetaAPIAuditLog.project_id == pid))
    await db.execute(sql_delete(MetaApiCache).where(MetaApiCache.project_id == pid))
    await db.execute(sql_delete(AuditLog).where(AuditLog.project_id == pid))

    # AdsAudit has a child table (ads_audit_items); delete parent — SQLAlchemy
    # cascade='all, delete-orphan' is already declared on AdsAudit itself.
    ads_audits = await db.execute(select(AdsAudit).where(AdsAudit.project_id == pid))
    for audit in ads_audits.scalars().all():
        await db.delete(audit)

    # 2. Finally delete the project itself
    await db.delete(project)
    await db.commit()

    logger.info("delete_project: user=%s deleted project slug=%s id=%s", current_user.id, slug, pid)


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

    # Ownership / assignment check
    if current_user.role not in ("super_admin",):
        if current_user.role == "admin":
            if project.owner_id != current_user.id:
                raise HTTPException(status_code=403, detail="You can only update projects you own")
        elif current_user.role == "operator":
            # Operators may update content/brand config only if assigned to the project
            from app.models.user_project import UserProject
            up = await db.execute(
                select(UserProject).where(
                    UserProject.user_id == current_user.id,
                    UserProject.project_id == project.id,
                )
            )
            if up.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="You do not have access to this project")
            # Strip platform-sensitive fields — operators cannot touch Meta/Pinterest connections
            data.meta_access_token = None
            data.facebook_page_id = None
            data.instagram_account_id = None
            data.ad_account_id = None
            data.telegram_chat_id = None
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
