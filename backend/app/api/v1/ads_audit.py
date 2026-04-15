"""Ads Audit endpoints — trigger and retrieve Meta Ads health audit results."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user, get_session
from app.models.ad_campaign import AdCampaign
from app.models.ads_audit import AdsAudit, AuditCheckResult
from app.models.project import Project

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class AuditCheckResultSchema(BaseModel):
    id: int
    check_id: str
    category: str
    severity: str
    result: str
    title: str
    detail: str
    recommendation: str
    meta_value: str
    threshold_value: str
    meta_ui_link: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AdsAuditSummarySchema(BaseModel):
    id: int
    project_id: int
    ad_account_id: str
    status: str
    health_score: float | None
    grade: str | None
    score_pixel: float | None
    score_creative: float | None
    score_structure: float | None
    score_audience: float | None
    checks_pass: int
    checks_warning: int
    checks_fail: int
    checks_manual: int
    checks_na: int
    ios_disclaimer: bool
    triggered_by: str
    error_message: str | None
    created_at: datetime
    completed_at: datetime | None
    model_config = ConfigDict(from_attributes=True)


class AdsAuditDetailSchema(AdsAuditSummarySchema):
    check_results: list[AuditCheckResultSchema] = []


class AuditHistoryResponse(BaseModel):
    items: list[AdsAuditSummarySchema]
    total: int
    page: int
    page_size: int


class TriggerAuditResponse(BaseModel):
    audit_id: int
    status: str
    message: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_project_and_check_access(
    project_slug: str,
    current_user,
    db: AsyncSession,
) -> Project:
    """Fetch project by slug and verify the current user has access to it."""
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # super_admin bypasses all checks
    if current_user.role == "super_admin":
        return project

    # admin must own the project
    if current_user.role == "admin":
        if project.owner_id != current_user.id:
            raise HTTPException(status_code=403, detail="You do not have access to this project")
        return project

    # operator / client must be assigned via UserProject
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


# ---------------------------------------------------------------------------
# Background task
# ---------------------------------------------------------------------------


async def _run_audit_background(
    audit_id: int,
    project_id: int,
    meta_campaign_id: str | None = None,
) -> None:
    """Runs audit in background. Opens its own DB session (mirrors optimizer.py pattern).

    When meta_campaign_id is provided the MetaAuditService is initialised in campaign-scoped
    mode so structure and insight fetches are filtered to that single campaign.
    """
    from app.core.database import AsyncSessionLocal
    from app.services.ads.audit import MetaAuditService
    from app.core.security import get_project_token

    async with AsyncSessionLocal() as db:
        audit = await db.get(AdsAudit, audit_id)
        project = await db.get(Project, project_id)

        if not audit or not project:
            return

        try:
            token = await get_project_token(project, db)
            if not token:
                audit.status = "failed"
                audit.error_message = "No valid Meta access token found."
                audit.completed_at = datetime.utcnow()
                await db.commit()
                return

            async with MetaAuditService(
                token,
                project.ad_account_id,
                project_id,
                meta_campaign_id=meta_campaign_id,
            ) as svc:
                await svc.run(audit_id, db)
        except Exception as e:
            # MetaAuditService.run() handles its own error states,
            # but catch anything that escapes
            audit = await db.get(AdsAudit, audit_id)
            if audit and audit.status == "running":
                audit.status = "error"
                audit.error_message = str(e)
                audit.completed_at = datetime.utcnow()
                await db.commit()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/run/{project_slug}", status_code=202, response_model=TriggerAuditResponse)
async def trigger_audit(
    project_slug: str,
    background_tasks: BackgroundTasks,
    campaign_id: int | None = None,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> TriggerAuditResponse:
    """Trigger a new Meta Ads health audit for a project.

    Optional query param ``campaign_id`` (DB integer id) scopes the audit to a single
    campaign. When provided, structure and insight API calls are filtered to that campaign
    so the health score reflects only that campaign's data.  Account-level checks (pixel,
    CAPI, audiences) are unaffected because they apply to the whole ad account.

    Without ``campaign_id`` the audit evaluates the entire ad account (original behaviour).
    """
    project = await _get_project_and_check_access(project_slug, current_user, db)

    if not project.ad_account_id:
        raise HTTPException(
            status_code=422,
            detail="Project has no ad_account_id configured. Cannot run audit.",
        )

    # Resolve campaign and extract meta_campaign_id when campaign_id is provided
    meta_campaign_id: str | None = None
    if campaign_id is not None:
        camp_result = await db.execute(
            select(AdCampaign).where(
                AdCampaign.id == campaign_id,
                AdCampaign.project_id == project.id,
            )
        )
        campaign = camp_result.scalar_one_or_none()
        if campaign is None:
            raise HTTPException(
                status_code=404,
                detail=f"Campaign {campaign_id} not found or does not belong to project '{project_slug}'.",
            )
        if not campaign.meta_campaign_id:
            raise HTTPException(
                status_code=422,
                detail="Campaign has no Meta campaign ID. Cannot run scoped audit.",
            )
        meta_campaign_id = campaign.meta_campaign_id

    # Check for an already-running audit for the same scope
    running_query = select(AdsAudit).where(
        AdsAudit.project_id == project.id,
        AdsAudit.status == "running",
    )
    running_result = await db.execute(running_query)
    running_audits = running_result.scalars().all()
    # For campaign-scoped: block only if another audit is running for the SAME campaign
    # For project-wide: block if any project-wide audit is running
    for running in running_audits:
        running_scope_campaign = (running.raw_data or {}).get("_scope", {}).get("campaign_id")
        if meta_campaign_id is not None:
            if running_scope_campaign == meta_campaign_id:
                raise HTTPException(
                    status_code=409,
                    detail="An audit is already running for this campaign. Wait for it to complete.",
                )
        else:
            if running_scope_campaign is None:
                raise HTTPException(
                    status_code=409,
                    detail="An audit is already running for this project. Wait for it to complete.",
                )

    audit = AdsAudit(
        project_id=project.id,
        ad_account_id=project.ad_account_id,
        status="running",
        triggered_by="manual",
        # Store scope in raw_data immediately so the running check above works correctly
        raw_data={"_scope": {"campaign_id": meta_campaign_id}},
    )
    db.add(audit)
    await db.commit()
    await db.refresh(audit)

    background_tasks.add_task(
        _run_audit_background,
        audit.id,
        project.id,
        meta_campaign_id,
    )

    return TriggerAuditResponse(
        audit_id=audit.id,
        status="running",
        message="Audit started. Poll GET /latest for results.",
    )


@router.get("/latest/{project_slug}", response_model=AdsAuditDetailSchema)
async def get_latest_audit(
    project_slug: str,
    campaign_id: int | None = None,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> AdsAuditDetailSchema:
    """Return the most recent audit for a project, including all check results.

    Optional query param ``campaign_id`` (DB integer id): when supplied, returns the most
    recent audit scoped to that campaign.  Without it, returns the most recent project-wide
    audit (original behaviour).
    """
    project = await _get_project_and_check_access(project_slug, current_user, db)

    # Resolve meta_campaign_id for scope matching when campaign_id is provided
    meta_campaign_id: str | None = None
    if campaign_id is not None:
        camp_result = await db.execute(
            select(AdCampaign).where(
                AdCampaign.id == campaign_id,
                AdCampaign.project_id == project.id,
            )
        )
        campaign = camp_result.scalar_one_or_none()
        if campaign is None:
            raise HTTPException(
                status_code=404,
                detail=f"Campaign {campaign_id} not found or does not belong to project '{project_slug}'.",
            )
        meta_campaign_id = campaign.meta_campaign_id

    # Fetch the most recent N audits and filter in Python by scope stored in raw_data._scope
    # This avoids adding a DB migration while keeping backwards compatibility.
    candidates_result = await db.execute(
        select(AdsAudit)
        .where(AdsAudit.project_id == project.id)
        .options(selectinload(AdsAudit.check_results))
        .order_by(AdsAudit.created_at.desc())
        .limit(50)
    )
    candidates = candidates_result.scalars().all()

    audit = None
    for candidate in candidates:
        scope_campaign = (candidate.raw_data or {}).get("_scope", {}).get("campaign_id")
        if meta_campaign_id is not None:
            # Looking for a campaign-scoped audit for this specific campaign
            if scope_campaign == meta_campaign_id:
                audit = candidate
                break
        else:
            # Looking for a project-wide audit (no campaign scope)
            if scope_campaign is None:
                audit = candidate
                break

    if audit is None:
        raise HTTPException(status_code=404, detail="No audits found for this project.")

    return AdsAuditDetailSchema.model_validate(audit)


@router.get("/history/{project_slug}", response_model=AuditHistoryResponse)
async def get_audit_history(
    project_slug: str,
    page: int = 1,
    page_size: int = 10,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> AuditHistoryResponse:
    """Return paginated audit history for a project (summaries only, no check results)."""
    project = await _get_project_and_check_access(project_slug, current_user, db)

    # Clamp page_size
    page_size = min(page_size, 50)
    offset = (page - 1) * page_size

    # Total count
    from sqlalchemy import func

    count_result = await db.execute(
        select(func.count(AdsAudit.id)).where(AdsAudit.project_id == project.id)
    )
    total = count_result.scalar_one()

    # Paginated items
    items_result = await db.execute(
        select(AdsAudit)
        .where(AdsAudit.project_id == project.id)
        .order_by(AdsAudit.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    audits = items_result.scalars().all()

    return AuditHistoryResponse(
        items=[AdsAuditSummarySchema.model_validate(a) for a in audits],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{audit_id}", response_model=AdsAuditDetailSchema)
async def get_audit(
    audit_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> AdsAuditDetailSchema:
    """Return a specific audit by ID, including all check results."""
    result = await db.execute(
        select(AdsAudit)
        .where(AdsAudit.id == audit_id)
        .options(selectinload(AdsAudit.check_results))
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=404, detail="Audit not found.")

    # Verify user has access to the project this audit belongs to
    proj_result = await db.execute(select(Project).where(Project.id == audit.project_id))
    project = proj_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Audit not found.")

    await _get_project_and_check_access(project.slug, current_user, db)

    return AdsAuditDetailSchema.model_validate(audit)


@router.get("/{audit_id}/checks", response_model=list[AuditCheckResultSchema])
async def get_audit_checks(
    audit_id: int,
    category: Optional[str] = None,
    result: Optional[str] = None,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[AuditCheckResultSchema]:
    """Return check results for a specific audit, with optional filtering by category and result."""
    # First verify the audit exists and the user can access its project
    audit_result = await db.execute(select(AdsAudit).where(AdsAudit.id == audit_id))
    audit = audit_result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=404, detail="Audit not found.")

    proj_result = await db.execute(select(Project).where(Project.id == audit.project_id))
    project = proj_result.scalar_one_or_none()
    if project is None:
        raise HTTPException(status_code=404, detail="Audit not found.")

    await _get_project_and_check_access(project.slug, current_user, db)

    # Build filtered query
    query = select(AuditCheckResult).where(AuditCheckResult.audit_id == audit_id)
    if category is not None:
        query = query.where(AuditCheckResult.category == category)
    if result is not None:
        query = query.where(AuditCheckResult.result == result)

    checks_result = await db.execute(query)
    checks = checks_result.scalars().all()

    return [AuditCheckResultSchema.model_validate(c) for c in checks]
