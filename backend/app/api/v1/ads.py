"""Ads management endpoints."""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.api.deps import get_session, get_current_user, require_super_admin
from app.models.ad_campaign import AdCampaign
from app.models.notification import Notification
from app.models.project import Project
from app.core.config import settings
from app.core.security import get_project_token
from app.services.ads.meta_campaign import MetaCampaignService
from pydantic import BaseModel, Field
from datetime import datetime, timedelta, timezone
import httpx
import json

router = APIRouter()

META_BASE = "https://graph.facebook.com/v19.0"

meta_service = MetaCampaignService()


class AdCampaignResponse(BaseModel):
    id: int
    project_id: int
    name: str
    objective: str | None
    status: str
    daily_budget: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConceptInput(BaseModel):
    id: int
    hook_3s: str
    body: str
    cta: str
    format: str
    image_url: str | None = None


class CreateCampaignRequest(BaseModel):
    name: str
    objective: str  # OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS
    daily_budget: float  # dollars
    countries: list[str] = ["AR", "MX", "CO", "CL"]
    # Legacy single-creative fields (optional when concepts provided)
    image_url: str | None = None
    ad_copy: str | None = None
    destination_url: str | None = None
    # Andromeda multi-creative concepts
    concepts: list[ConceptInput] | None = None
    # New audience & placement options
    pixel_event: str | None = None  # Purchase|Lead|AddToCart|ViewContent|CompleteRegistration
    audience_type: str = "broad"  # broad|custom|lookalike|retargeting_lookalike
    custom_audience_ids: list[str] = []  # meta_audience_id values
    lookalike_audience_ids: list[str] = []  # meta_audience_id values
    placements: list[str] = []  # instagram_feed|instagram_reels|instagram_stories|facebook_feed|audience_network
    advantage_placements: bool = True


class GenerateConceptsRequest(BaseModel):
    campaign_objective: str  # OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS
    count: int = 12
    product_description: str | None = None
    destination_url: str | None = None
    audience_type: str = "broad"
    pixel_event: str | None = None
    excluded_hooks: list[str] | None = None


class RefreshCreativesRequest(BaseModel):
    existing_hooks: list[str]


class UpdateStatusRequest(BaseModel):
    status: str  # active | paused


async def fetch_live_campaign_statuses(project: Project, db: AsyncSession) -> dict[str, str]:
    """Fetch live campaign statuses from Meta API keyed by meta_campaign_id."""
    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")
    if not token or not ad_account_id:
        return {}
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{META_BASE}/act_{ad_account_id}/campaigns",
                params={
                    "fields": "id,status",
                    "access_token": token,
                },
                timeout=10.0,
            )
            data = resp.json()
            if "error" in data:
                return {}
            return {c["id"]: c["status"] for c in data.get("data", [])}
    except Exception:
        return {}


@router.get("/{project_id}")
async def list_campaigns(project_id: int, db: AsyncSession = Depends(get_session)) -> list[dict]:
    """List ad campaigns for a project, enriched with live Meta status."""
    result = await db.execute(
        select(AdCampaign)
        .where(AdCampaign.project_id == project_id)
        .order_by(AdCampaign.created_at.desc())
    )
    campaigns = result.scalars().all()

    # Load project to get token/account
    proj_result = await db.execute(select(Project).where(Project.id == project_id))
    project = proj_result.scalar_one_or_none()

    live_statuses: dict[str, str] = {}
    if project:
        live_statuses = await fetch_live_campaign_statuses(project, db)

    output = []
    for c in campaigns:
        live_status = live_statuses.get(c.meta_campaign_id or "", c.status)
        output.append({
            "id": c.id,
            "project_id": c.project_id,
            "meta_campaign_id": c.meta_campaign_id,
            "name": c.name,
            "objective": c.objective,
            "status": c.status,
            "live_status": live_status,
            "daily_budget": c.daily_budget,
            "lifetime_budget": c.lifetime_budget,
            "notes": c.notes,
            "created_at": str(c.created_at),
        })

    return output


@router.get("/campaigns/{project_slug}")
async def list_campaigns_by_slug(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_super_admin()),
) -> list[dict]:
    """List ad campaigns for a project by slug. super_admin only."""
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, f"Project '{project_slug}' not found")

    result = await db.execute(
        select(AdCampaign)
        .where(AdCampaign.project_id == project.id)
        .order_by(AdCampaign.created_at.desc())
    )
    campaigns = result.scalars().all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "objective": c.objective,
            "status": c.status,
            "daily_budget": c.daily_budget,
            "meta_campaign_id": c.meta_campaign_id,
        }
        for c in campaigns
    ]


@router.post("/generate-concepts/{project_slug}")
async def generate_concepts(
    project_slug: str,
    body: GenerateConceptsRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate Andromeda-compliant ad concepts for a project using Claude."""
    from app.services.claude.client import ClaudeClient

    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, f"Project '{project_slug}' not found")

    try:
        claude = ClaudeClient()
        result = await claude.generate_ad_concepts(
            project=project,
            campaign_objective=body.campaign_objective,
            count=body.count,
            product_description=body.product_description,
            existing_hooks=body.excluded_hooks,
            destination_url=body.destination_url,
            audience_type=body.audience_type,
            pixel_event=body.pixel_event,
        )
    except Exception as e:
        raise HTTPException(500, f"Concept generation failed: {str(e)}")

    return {
        "project_slug": project_slug,
        "objective": body.campaign_objective,
        "concepts": result.get("concepts", []),
        "diversity_audit": result.get("diversity_audit", {}),
    }


@router.post("/{campaign_id}/refresh-creatives")
async def refresh_creatives(
    campaign_id: int,
    body: RefreshCreativesRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Generate fresh Andromeda concepts that are conceptually opposite to fatigued hooks."""
    from app.services.claude.client import ClaudeClient

    result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    try:
        claude = ClaudeClient()
        concepts_result = await claude.generate_ad_concepts(
            project=project,
            campaign_objective=campaign.objective or "OUTCOME_LEADS",
            count=12,
            existing_hooks=body.existing_hooks,
        )
    except Exception as e:
        raise HTTPException(500, f"Concept generation failed: {str(e)}")

    return {
        "project_slug": project.slug,
        "objective": campaign.objective,
        "concepts": concepts_result.get("concepts", []),
        "diversity_audit": concepts_result.get("diversity_audit", {}),
    }


class GenerateConceptImageRequest(BaseModel):
    hook: str
    body: str
    format: str = "Feed 1:1"
    project_slug: str


@router.post("/generate-concept-image")
async def generate_concept_image(
    body: GenerateConceptImageRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    from app.services.media.html_renderer import HTMLSlideRenderer
    proj_result = await db.execute(select(Project).where(Project.slug == body.project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")
    media_config = project.media_config or {}
    renderer = HTMLSlideRenderer()
    slide_data = {
        "headline": body.hook,
        "subtext": body.body[:120],
        "slide_number": 1,
        "total_slides": 1,
    }
    try:
        url = await renderer.render_slide(slide_data, media_config)
        return {"image_url": url}
    except Exception as e:
        raise HTTPException(500, f"Image generation failed: {str(e)}")


@router.post("/create/{project_slug}")
async def create_campaign(
    project_slug: str,
    body: CreateCampaignRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Create a full Meta Ads campaign (Campaign + Ad Set + Creative + Ad)."""
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, f"Project '{project_slug}' not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")
    facebook_page_id = project.facebook_page_id or ""

    if not token or not ad_account_id:
        raise HTTPException(400, "Project missing meta_access_token or ad_account_id")
    if not facebook_page_id:
        raise HTTPException(400, "Project missing facebook_page_id")

    # Andromeda multi-concept path
    if body.concepts is not None:
        approved_count = len(body.concepts)
        if approved_count < 6:
            raise HTTPException(
                400,
                f"Andromeda requires minimum 6 unique creatives. Currently: {approved_count}",
            )

        if not body.destination_url:
            raise HTTPException(400, "destination_url is required when using concepts")

        from app.services.storage.s3 import S3Service
        from app.services.media.html_renderer import HTMLSlideRenderer

        s3_service = S3Service()
        renderer = HTMLSlideRenderer()
        media_config = project.media_config or {}

        async def upload_placeholder(slug: str) -> str:
            return await s3_service.upload_placeholder_image(slug)

        # Generate images for concepts that don't have one using HTMLSlideRenderer
        concepts_with_images = []
        for c in body.concepts:
            concept_dict = c.model_dump()
            if not concept_dict.get("image_url"):
                try:
                    url = await renderer.render_slide(
                        slide_data={
                            "headline": concept_dict.get("hook_3s", ""),
                            "subtext": concept_dict.get("body", "")[:120],
                            "slide_number": 1,
                            "total_slides": 1,
                        },
                        media_config=media_config,
                    )
                    concept_dict["image_url"] = url
                except Exception:
                    concept_dict["image_url"] = await upload_placeholder(project_slug)
            concepts_with_images.append(concept_dict)

        # Resolve pixel_id from project config for conversion tracking (SALES and LEADS)
        pixel_id: str | None = (project.content_config or {}).get("meta_pixel_id")

        try:
            meta_ids = await meta_service.create_campaign_with_concepts(
                token=token,
                ad_account_id=ad_account_id,
                facebook_page_id=facebook_page_id,
                name=body.name,
                objective=body.objective,
                daily_budget_dollars=body.daily_budget,
                countries=body.countries,
                destination_url=body.destination_url,
                concepts=concepts_with_images,
                placeholder_image_fn=upload_placeholder,
                project_slug=project_slug,
                audience_type=body.audience_type,
                custom_audience_ids=body.custom_audience_ids,
                lookalike_audience_ids=body.lookalike_audience_ids,
                placements=body.placements,
                advantage_placements=body.advantage_placements,
                pixel_event=body.pixel_event,
                pixel_id=pixel_id,
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        except Exception as e:
            raise HTTPException(500, f"Meta API error: {str(e)}")

        campaign = AdCampaign(
            project_id=project.id,
            meta_campaign_id=meta_ids["campaign_id"],
            meta_adset_id=meta_ids["adset_id"],
            meta_creative_id=meta_ids.get("creative_id"),
            meta_ad_id=meta_ids.get("ad_id"),
            ad_account_id=ad_account_id,
            facebook_page_id=facebook_page_id,
            name=body.name,
            objective=body.objective,
            status="paused",
            daily_budget=body.daily_budget,
            image_url=body.concepts[0].image_url if body.concepts else None,
            ad_copy=body.concepts[0].body if body.concepts else None,
            destination_url=body.destination_url,
            countries=json.dumps(body.countries),
        )
        db.add(campaign)
        await db.commit()
        await db.refresh(campaign)

        return {
            "id": campaign.id,
            "meta_campaign_id": meta_ids["campaign_id"],
            "meta_adset_id": meta_ids["adset_id"],
            "status": "paused",
            "ads_created": len(meta_ids.get("ads_created", [])),
            "message": f"Campaign created with {approved_count} Andromeda creatives. Activate when ready.",
        }

    # Legacy single-creative path
    if not body.image_url or not body.ad_copy or not body.destination_url:
        raise HTTPException(400, "image_url, ad_copy, and destination_url are required when not using concepts")

    try:
        meta_ids = await meta_service.create_full_campaign(
            token=token,
            ad_account_id=ad_account_id,
            facebook_page_id=facebook_page_id,
            name=body.name,
            objective=body.objective,
            daily_budget_dollars=body.daily_budget,
            countries=body.countries,
            image_url=body.image_url,
            ad_copy=body.ad_copy,
            destination_url=body.destination_url,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(500, f"Meta API error: {str(e)}")

    campaign = AdCampaign(
        project_id=project.id,
        meta_campaign_id=meta_ids["campaign_id"],
        meta_adset_id=meta_ids["adset_id"],
        meta_creative_id=meta_ids["creative_id"],
        meta_ad_id=meta_ids["ad_id"],
        ad_account_id=ad_account_id,
        facebook_page_id=facebook_page_id,
        name=body.name,
        objective=body.objective,
        status="paused",
        daily_budget=body.daily_budget,
        image_url=body.image_url,
        ad_copy=body.ad_copy,
        destination_url=body.destination_url,
        countries=json.dumps(body.countries),
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)

    return {
        "id": campaign.id,
        "meta_campaign_id": meta_ids["campaign_id"],
        "meta_adset_id": meta_ids["adset_id"],
        "status": "paused",
        "message": "Campaign created successfully. Activate when ready.",
    }


@router.put("/{campaign_id}/status")
async def update_campaign_status(
    campaign_id: int,
    body: UpdateStatusRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Activate or pause a campaign."""
    result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    token = await get_project_token(project, db) if project else ""

    meta_status = "ACTIVE" if body.status == "active" else "PAUSED"

    if token and campaign.meta_campaign_id:
        await meta_service.set_campaign_status(token, campaign.meta_campaign_id, meta_status)

    campaign.status = body.status
    await db.commit()
    return {"id": campaign.id, "status": campaign.status}


@router.post("/{campaign_id}/optimize")
async def manual_optimize(
    campaign_id: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Manually trigger optimization. campaign_id can be local DB id or Meta campaign id."""
    from app.services.ads.optimizer import analyze_campaign

    campaign = None
    try:
        result = await db.execute(select(AdCampaign).where(AdCampaign.id == int(campaign_id)))
        campaign = result.scalar_one_or_none()
    except (ValueError, OverflowError):
        pass
    if not campaign:
        result = await db.execute(select(AdCampaign).where(AdCampaign.meta_campaign_id == campaign_id))
        campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    return await analyze_campaign(campaign, project, db)


@router.get("/detail/{campaign_id}")
async def get_campaign_detail(
    campaign_id: str,
    project_slug: str | None = None,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Return full campaign detail. campaign_id can be a DB integer id or a Meta campaign ID string."""
    # Try DB lookup by integer id first, then by meta_campaign_id
    campaign: AdCampaign | None = None
    try:
        db_id = int(campaign_id)
        result = await db.execute(select(AdCampaign).where(AdCampaign.id == db_id))
        campaign = result.scalar_one_or_none()
    except ValueError:
        pass

    if campaign is None:
        result = await db.execute(select(AdCampaign).where(AdCampaign.meta_campaign_id == campaign_id))
        campaign = result.scalar_one_or_none()

    # Get project for token — from campaign, from slug param, or first project
    project: Project | None = None
    if campaign:
        proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
        project = proj_result.scalar_one_or_none()
    elif project_slug:
        proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
        project = proj_result.scalar_one_or_none()
    else:
        proj_result = await db.execute(select(Project).limit(1))
        project = proj_result.scalar_one_or_none()

    token = await get_project_token(project, db) if project else ""
    ad_account_id = ((project.ad_account_id or "") if project else "").removeprefix("act_")

    meta_campaign_id = (campaign.meta_campaign_id if campaign else None) or campaign_id

    if not token:
        raise HTTPException(400, "No Meta access token configured")

    # Defaults
    campaign_info: dict = {}
    insights_summary_raw: dict = {}
    daily_insights_raw: list = []
    adsets_raw: list = []
    ads_raw: list = []

    # Build a custom date range: 30 days ago → today (inclusive)
    today = datetime.now(timezone.utc).date()
    since = today - timedelta(days=29)
    time_range = {"since": str(since), "until": str(today)}

    if token and meta_campaign_id:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                # a. Campaign info
                ci_resp = await client.get(
                    f"{META_BASE}/{meta_campaign_id}",
                    params={
                        "fields": "name,objective,status,created_time,daily_budget",
                        "access_token": token,
                    },
                )
                campaign_info = ci_resp.json()

                # b. Insights last 30d (summary)
                ins_resp = await client.get(
                    f"{META_BASE}/{meta_campaign_id}/insights",
                    params={
                        "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type,purchase_roas",
                        "time_range": json.dumps(time_range),
                        "access_token": token,
                    },
                )
                ins_data = ins_resp.json()
                ins_rows = ins_data.get("data", [])
                insights_summary_raw = ins_rows[0] if ins_rows else {}

                # c. Daily insights breakdown
                daily_resp = await client.get(
                    f"{META_BASE}/{meta_campaign_id}/insights",
                    params={
                        "fields": "spend,impressions,reach,clicks,ctr,cpc,cpm,frequency,actions,action_values,cost_per_action_type,purchase_roas",
                        "time_range": json.dumps(time_range),
                        "time_increment": "1",
                        "access_token": token,
                    },
                )
                daily_data = daily_resp.json()
                daily_insights_raw = daily_data.get("data", [])

                # d. Ad sets
                if ad_account_id:
                    adsets_resp = await client.get(
                        f"{META_BASE}/act_{ad_account_id}/adsets",
                        params={
                            "fields": "id,name,status,daily_budget,targeting",
                            "filtering": json.dumps([{"field": "campaign.id", "operator": "EQUAL", "value": meta_campaign_id}]),
                            "access_token": token,
                        },
                    )
                    adsets_raw = adsets_resp.json().get("data", [])

                    # e. Ads
                    ads_resp = await client.get(
                        f"{META_BASE}/act_{ad_account_id}/ads",
                        params={
                            "fields": "id,name,status,creative{thumbnail_url}",
                            "filtering": json.dumps([{"field": "campaign.id", "operator": "EQUAL", "value": meta_campaign_id}]),
                            "access_token": token,
                        },
                    )
                    ads_raw = ads_resp.json().get("data", [])
        except Exception:
            pass

    # Load optimization logs (only if we have a DB campaign record)
    from app.models.optimization_log import CampaignOptimizationLog
    opt_logs = []
    if campaign:
        logs_result = await db.execute(
            select(CampaignOptimizationLog)
            .where(CampaignOptimizationLog.campaign_id == campaign.id)
            .order_by(CampaignOptimizationLog.checked_at.desc())
            .limit(20)
        )
        opt_logs = logs_result.scalars().all()
    def get_approval_status(log: CampaignOptimizationLog) -> str:
        decision = (log.decision or "").upper()
        if decision in ("SCALE", "PAUSE"):
            return "approved" if log.action_taken else "pending"
        return "auto_executed"

    optimization_logs = []
    for log in opt_logs:
        metrics_parsed = None
        if log.metrics_snapshot:
            try:
                metrics_parsed = json.loads(log.metrics_snapshot)
            except (json.JSONDecodeError, TypeError):
                metrics_parsed = log.metrics_snapshot
        optimization_logs.append({
            "id": log.id,
            "created_at": str(log.checked_at),
            "decision": log.decision,
            "rationale": log.rationale,
            "budget_before": log.old_budget,
            "budget_after": log.new_budget,
            "approval_status": get_approval_status(log),
            "metrics_snapshot": metrics_parsed,
        })

    # Build insights summary
    actions = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("actions", [])}
    action_values = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("action_values", [])}
    cpa_dict = {a["action_type"]: float(a["value"]) for a in insights_summary_raw.get("cost_per_action_type", [])}
    objective = (campaign_info.get("objective") or (campaign.objective if campaign else None) or "").upper()

    total_spend = float(insights_summary_raw.get("spend", 0))
    total_impressions = int(insights_summary_raw.get("impressions", 0))
    total_reach = int(insights_summary_raw.get("reach", 0))
    total_clicks = int(insights_summary_raw.get("clicks", 0))
    avg_ctr = float(insights_summary_raw.get("ctr", 0))
    avg_cpc = float(insights_summary_raw.get("cpc", 0))
    avg_cpm = float(insights_summary_raw.get("cpm", 0))
    avg_frequency = float(insights_summary_raw.get("frequency", 0))

    # Extract action counts
    leads = actions.get("lead") or None
    if leads is not None:
        leads = int(leads)
    landing_page_views_raw = actions.get("landing_page_view")
    landing_page_views = int(landing_page_views_raw) if landing_page_views_raw is not None else None
    link_clicks_raw = actions.get("link_click")
    link_clicks = int(link_clicks_raw) if link_clicks_raw is not None else None
    post_reactions_raw = actions.get("post_reaction")
    post_reactions = int(post_reactions_raw) if post_reactions_raw is not None else None
    post_saves_raw = actions.get("onsite_conversion.post_save")
    post_saves = int(post_saves_raw) if post_saves_raw is not None else None
    comments_raw = actions.get("comment")
    comments = int(comments_raw) if comments_raw is not None else None
    video_views_raw = actions.get("video_view")
    video_views = int(video_views_raw) if video_views_raw is not None else None
    page_engagement_raw = actions.get("page_engagement")
    page_engagement = int(page_engagement_raw) if page_engagement_raw is not None else None

    # Derived metrics
    cpl = round(total_spend / leads, 2) if leads and leads > 0 else None
    cost_per_lpv = round(total_spend / landing_page_views, 2) if landing_page_views and landing_page_views > 0 else None
    click_to_lead_rate = round((leads / link_clicks) * 100, 2) if leads and link_clicks and link_clicks > 0 else None
    lp_conversion_rate = round((leads / landing_page_views) * 100, 2) if leads and landing_page_views and landing_page_views > 0 else None
    cpc_derived = round(total_spend / link_clicks, 2) if link_clicks and link_clicks > 0 else None
    hook_rate = round((landing_page_views / total_impressions) * 100, 2) if landing_page_views and total_impressions > 0 else None

    # Meta returns purchases under multiple action_type values depending on
    # whether Pixel, CAPI, or on-site checkout is used. Define once for reuse.
    PURCHASE_ACTION_TYPES = {
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "omni_purchase",
        "onsite_web_purchase",
    }

    if "LEADS" in objective:
        total_results = leads or 0
        result_label = "Leads"
        cost_per_result = cpa_dict.get("lead", 0)
        roas = None
        purchases = None
        revenue = None
        cost_per_purchase = None
    elif "SALES" in objective:
        purchases_sum = sum(v for k, v in actions.items() if k in PURCHASE_ACTION_TYPES)
        purchases = int(purchases_sum) if purchases_sum > 0 else None
        total_results = purchases or 0
        result_label = "Compras"
        # CPA: prefer the most specific key available, fall back to first match
        cost_per_result = next(
            (cpa_dict[k] for k in PURCHASE_ACTION_TYPES if k in cpa_dict),
            0,
        )
        revenue_sum = sum(v for k, v in action_values.items() if k in PURCHASE_ACTION_TYPES)
        revenue = float(revenue_sum) if revenue_sum > 0 else None
        # purchase_roas from Meta is preferred; fall back to calculated ROAS
        purchase_roas_data = insights_summary_raw.get("purchase_roas") or []
        if purchase_roas_data and isinstance(purchase_roas_data, list):
            roas_values = [
                float(r.get("value", 0))
                for r in purchase_roas_data
                if r.get("action_type") in PURCHASE_ACTION_TYPES
            ]
            roas = roas_values[0] if roas_values else (
                float(purchase_roas_data[0].get("value", 0)) if purchase_roas_data else None
            )
        elif revenue and total_spend > 0:
            roas = round(revenue / total_spend, 2)
        else:
            roas = None
        cost_per_purchase = round(total_spend / purchases, 2) if purchases and purchases > 0 else None
    else:
        total_results = float(total_clicks)
        result_label = "Clicks"
        cost_per_result = avg_cpc
        roas = None
        purchases = None
        revenue = None
        cost_per_purchase = None

    insights_summary = {
        "period": f"{since} / {today}",
        "total_spend": total_spend,
        "total_impressions": total_impressions,
        "total_reach": total_reach,
        "total_clicks": total_clicks,
        "avg_ctr": avg_ctr,
        "avg_cpc": avg_cpc,
        "avg_cpm": avg_cpm,
        "avg_frequency": avg_frequency,
        "total_results": total_results,
        "result_label": result_label,
        "cost_per_result": cost_per_result,
        "roas": roas,
        # Funnel metrics
        "leads": leads,
        "landing_page_views": landing_page_views,
        "link_clicks": link_clicks,
        "post_reactions": post_reactions,
        "post_saves": post_saves,
        "comments": comments,
        "video_views": video_views,
        "page_engagement": page_engagement,
        "cpl": cpl,
        "cost_per_landing_page_view": cost_per_lpv,
        "click_to_lead_rate": click_to_lead_rate,
        "landing_page_conversion_rate": lp_conversion_rate,
        "cpc_derived": cpc_derived,
        "hook_rate": hook_rate,
        # Sales-specific
        "purchases": purchases,
        "revenue": revenue,
        "cost_per_purchase": cost_per_purchase,
    }

    # Build daily insights
    daily_insights = []
    for day in daily_insights_raw:
        day_actions = {a["action_type"]: float(a["value"]) for a in day.get("actions", [])}
        day_cpa = {a["action_type"]: float(a["value"]) for a in day.get("cost_per_action_type", [])}
        if "LEADS" in objective:
            day_results = day_actions.get("lead", 0)
            day_cpr = day_cpa.get("lead", 0)
        elif "SALES" in objective:
            day_results = sum(v for k, v in day_actions.items() if k in PURCHASE_ACTION_TYPES)
            day_cpr = next(
                (day_cpa[k] for k in PURCHASE_ACTION_TYPES if k in day_cpa),
                0,
            )
        else:
            day_results = float(int(day.get("clicks", 0)))
            day_spend = float(day.get("spend", 0))
            day_clicks = int(day.get("clicks", 0))
            day_cpr = day_spend / day_clicks if day_clicks > 0 else 0
        daily_insights.append({
            "date": day.get("date_start", ""),
            "spend": float(day.get("spend", 0)),
            "impressions": int(day.get("impressions", 0)),
            "clicks": int(day.get("clicks", 0)),
            "ctr": float(day.get("ctr", 0)),
            "cpc": float(day.get("cpc", 0)),
            "frequency": float(day.get("frequency", 0)),
            "results": day_results,
            "cost_per_result": day_cpr,
        })

    # Build ad sets
    def summarize_targeting(targeting: dict) -> str:
        if not targeting:
            return "Broad"
        parts = []
        geo = targeting.get("geo_locations", {})
        countries = geo.get("countries", [])
        if countries:
            parts.append(f"Countries: {', '.join(countries)}")
        age_min = targeting.get("age_min")
        age_max = targeting.get("age_max")
        if age_min or age_max:
            parts.append(f"Age: {age_min or '?'}-{age_max or '?'}")
        return "; ".join(parts) if parts else "Broad"

    def _adset_budget_display(a: dict) -> dict:
        raw = a.get("daily_budget")
        if raw and int(raw) > 0:
            dollars = float(raw) / 100.0
            return {"daily_budget": dollars, "budget_display": dollars}
        return {"daily_budget": 0.0, "budget_display": "CBO"}

    adsets = [
        {
            "id": a["id"],
            "name": a.get("name", ""),
            "status": a.get("status", ""),
            **_adset_budget_display(a),
            "targeting_summary": summarize_targeting(a.get("targeting") or {}),
        }
        for a in adsets_raw
    ]

    # Build ads
    ads_out = [
        {
            "id": a["id"],
            "name": a.get("name", ""),
            "status": a.get("status", ""),
            "creative_thumbnail": (a.get("creative") or {}).get("thumbnail_url"),
        }
        for a in ads_raw
    ]

    # Andromeda status logic
    if avg_frequency > 3.0:
        andromeda_status = "fatigued"
        andromeda_reason = f"Frequency {avg_frequency:.1f} exceeds 3.0 threshold"
    elif avg_ctr > 0 and avg_frequency < 2.0:
        andromeda_status = "healthy"
        andromeda_reason = "CTR stable, frequency within bounds"
    elif total_spend > 0:
        andromeda_status = "healthy"
        andromeda_reason = "Campaign within normal parameters"
    else:
        andromeda_status = "healthy"
        andromeda_reason = "Insufficient data for analysis"

    daily_budget_raw = campaign_info.get("daily_budget")
    meta_daily_budget = float(daily_budget_raw) / 100.0 if daily_budget_raw else 0.0
    # If campaign-level budget is zero, sum adset budgets as fallback
    adset_budget_total = sum(a.get("daily_budget", 0) for a in adsets)
    # Prefer Meta campaign-level value if non-zero, then adset sum, then DB value
    if meta_daily_budget > 0:
        campaign_daily_budget = meta_daily_budget
    elif adset_budget_total > 0:
        campaign_daily_budget = adset_budget_total
    else:
        campaign_daily_budget = (campaign.daily_budget if campaign else 0.0) or 0.0

    return {
        "campaign": {
            "id": campaign.id if campaign else meta_campaign_id,
            "meta_campaign_id": meta_campaign_id,
            "name": campaign_info.get("name") or (campaign.name if campaign else meta_campaign_id),
            "objective": campaign_info.get("objective") or (campaign.objective if campaign else "") or "",
            "status": campaign_info.get("status") or (campaign.status if campaign else "UNKNOWN"),
            "created_at": campaign_info.get("created_time") or (str(campaign.created_at) if campaign else ""),
            "daily_budget": campaign_daily_budget,
        },
        "insights_summary": insights_summary,
        "daily_insights": daily_insights,
        "adsets": adsets,
        "ads": ads_out,
        "optimization_logs": optimization_logs,
        "andromeda_status": andromeda_status,
        "andromeda_reason": andromeda_reason,
    }


class UpdateAdCopyRequest(BaseModel):
    headline: str | None = None
    primary_text: str | None = None


@router.get("/{campaign_id}/ads")
async def list_campaign_ads(
    campaign_id: int,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> list[dict]:
    """Return all ads in a campaign with their current headline and primary_text."""
    result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")

    if not token:
        raise HTTPException(400, "Project missing meta_access_token")
    if not ad_account_id:
        raise HTTPException(400, "Project missing ad_account_id — cannot list ads")
    if not campaign.meta_campaign_id:
        raise HTTPException(400, "Campaign has no Meta campaign ID — cannot list ads")

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            # 1. Get all ad IDs in the campaign
            ads_resp = await client.get(
                f"{META_BASE}/act_{ad_account_id}/ads",
                params={
                    "campaign_id": campaign.meta_campaign_id,
                    "fields": "id,name,campaign_id",
                    "access_token": token,
                },
            )
            ads_data = ads_resp.json()
            if "error" in ads_data:
                raise HTTPException(502, f"Meta API error: {ads_data['error'].get('message', 'unknown')}")

            # Filter strictly — Meta occasionally returns stale ads from other campaigns
            raw_ads = [
                ad for ad in ads_data.get("data", [])
                if ad.get("campaign_id") == campaign.meta_campaign_id
            ]

            # 2. For each ad, fetch creative details
            output = []
            for ad in raw_ads:
                ad_id = ad["id"]
                creative_resp = await client.get(
                    f"{META_BASE}/{ad_id}",
                    params={
                        "fields": "id,name,creative{id,object_story_spec,image_url,thumbnail_url}",
                        "access_token": token,
                    },
                )
                creative_data = creative_resp.json()
                if "error" in creative_data:
                    # Include ad with null fields rather than failing the whole list
                    output.append({"id": ad_id, "name": ad.get("name", ""), "headline": None, "primary_text": None, "image_url": None})
                    continue

                creative = creative_data.get("creative") or {}
                spec = creative.get("object_story_spec") or {}
                link_data = spec.get("link_data") or {}
                video_data = spec.get("video_data") or {}

                headline = link_data.get("name") or video_data.get("title") or None
                primary_text = link_data.get("message") or video_data.get("message") or None

                # Extract image_url: try multiple fallback paths
                image_url = (
                    creative.get("image_url")
                    or creative.get("thumbnail_url")
                    or link_data.get("picture")
                    or (list((link_data.get("image_crops") or {}).values())[0][0].get("url")
                        if link_data.get("image_crops") else None)
                    or None
                )

                output.append({
                    "id": ad_id,
                    "name": creative_data.get("name") or ad.get("name", ""),
                    "headline": headline,
                    "primary_text": primary_text,
                    "image_url": image_url,
                })

            return output

    except HTTPException:
        raise
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("list_campaign_ads error: %s", exc)
        raise HTTPException(502, f"Failed to fetch ads from Meta: {str(exc)}")


@router.patch("/{campaign_id}/ads/{ad_id}")
async def update_ad_copy(
    campaign_id: int,
    ad_id: str,
    body: UpdateAdCopyRequest,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Update the headline and/or primary_text for a specific ad by swapping its creative."""
    result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")

    if not token:
        raise HTTPException(400, "Project missing meta_access_token")
    if not ad_account_id:
        raise HTTPException(400, "Project missing ad_account_id")

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            # 1. Fetch current creative
            creative_resp = await client.get(
                f"{META_BASE}/{ad_id}",
                params={
                    "fields": "id,name,creative{id,object_story_spec}",
                    "access_token": token,
                },
            )
            creative_data = creative_resp.json()
            if "error" in creative_data:
                raise HTTPException(502, f"Meta API error: {creative_data['error'].get('message', 'unknown')}")

            creative_block = creative_data.get("creative") or {}
            spec = creative_block.get("object_story_spec") or {}

            # 2. Merge headline and primary_text into spec
            if "link_data" in spec:
                if body.headline is not None:
                    spec["link_data"]["name"] = body.headline
                if body.primary_text is not None:
                    spec["link_data"]["message"] = body.primary_text
            elif "video_data" in spec:
                if body.headline is not None:
                    spec["video_data"]["title"] = body.headline
                if body.primary_text is not None:
                    spec["video_data"]["message"] = body.primary_text
            else:
                raise HTTPException(400, "Ad creative does not have link_data or video_data — cannot update copy")

            # 3. Create new creative with updated spec
            new_creative_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adcreatives",
                data={
                    "object_story_spec": json.dumps(spec),
                    "access_token": token,
                },
            )
            new_creative_data = new_creative_resp.json()
            if "error" in new_creative_data:
                raise HTTPException(502, f"Meta API error creating creative: {new_creative_data['error'].get('message', 'unknown')}")

            new_creative_id = new_creative_data["id"]

            # 4. Swap creative on the ad
            swap_resp = await client.post(
                f"{META_BASE}/{ad_id}",
                data={
                    "creative": json.dumps({"creative_id": new_creative_id}),
                    "access_token": token,
                },
            )
            swap_data = swap_resp.json()
            if "error" in swap_data:
                raise HTTPException(502, f"Meta API error swapping creative: {swap_data['error'].get('message', 'unknown')}")

            return {"success": True, "creative_id": new_creative_id}

    except HTTPException:
        raise
    except Exception as exc:
        import logging
        logging.getLogger(__name__).error("update_ad_copy error: %s", exc)
        raise HTTPException(502, f"Failed to update ad copy: {str(exc)}")


@router.post("/{campaign_id}/ads/{ad_id}/image")
async def update_ad_image(
    campaign_id: int,
    ad_id: str,
    image: UploadFile = File(...),
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Upload a new image for a specific ad by swapping its creative."""
    import logging

    # Validate content type
    if image.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(400, "Only JPEG and PNG images are supported")

    # Read and validate file size (4 MB max)
    file_bytes = await image.read()
    if len(file_bytes) > 4 * 1024 * 1024:
        raise HTTPException(400, "Image file size must not exceed 4 MB")

    result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")

    if not token:
        raise HTTPException(400, "Project missing meta_access_token")
    if not ad_account_id:
        raise HTTPException(400, "Project missing ad_account_id")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # 1. Upload image to Meta Ad Images
            upload_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adimages",
                data={"access_token": token},
                files={"filename": (image.filename or "image.jpg", file_bytes, image.content_type)},
            )
            upload_data = upload_resp.json()
            if "error" in upload_data:
                raise HTTPException(502, f"Meta API error uploading image: {upload_data['error'].get('message', 'unknown')}")

            images_block = upload_data.get("images", {})
            first_key = next(iter(images_block), None)
            if not first_key:
                raise HTTPException(502, "Meta API returned no image data")
            new_hash = images_block[first_key]["hash"]
            new_url = images_block[first_key]["url"]

            # 2. Fetch current creative
            creative_resp = await client.get(
                f"{META_BASE}/{ad_id}",
                params={
                    "fields": "id,name,creative{id,object_story_spec}",
                    "access_token": token,
                },
            )
            creative_data = creative_resp.json()
            if "error" in creative_data:
                raise HTTPException(502, f"Meta API error: {creative_data['error'].get('message', 'unknown')}")

            creative_block = creative_data.get("creative") or {}
            spec = creative_block.get("object_story_spec") or {}

            # 3. Merge new image_hash into spec
            if "link_data" in spec:
                spec["link_data"]["image_hash"] = new_hash
                spec["link_data"].pop("picture", None)
            elif "video_data" in spec:
                spec["video_data"]["image_hash"] = new_hash
            else:
                raise HTTPException(400, "Ad creative does not have link_data or video_data — cannot update image")

            # 4. Create new creative with updated spec
            new_creative_resp = await client.post(
                f"{META_BASE}/act_{ad_account_id}/adcreatives",
                data={
                    "object_story_spec": json.dumps(spec),
                    "access_token": token,
                },
            )
            new_creative_data = new_creative_resp.json()
            if "error" in new_creative_data:
                raise HTTPException(502, f"Meta API error creating creative: {new_creative_data['error'].get('message', 'unknown')}")

            new_creative_id = new_creative_data["id"]

            # 5. Swap creative on the ad
            swap_resp = await client.post(
                f"{META_BASE}/{ad_id}",
                data={
                    "creative": json.dumps({"creative_id": new_creative_id}),
                    "access_token": token,
                },
            )
            swap_data = swap_resp.json()
            if "error" in swap_data:
                raise HTTPException(502, f"Meta API error swapping creative: {swap_data['error'].get('message', 'unknown')}")

            return {"success": True, "image_hash": new_hash, "image_url": new_url}

    except HTTPException:
        raise
    except Exception as exc:
        logging.getLogger(__name__).error("update_ad_image error: %s", exc)
        raise HTTPException(502, f"Failed to update ad image: {str(exc)}")


@router.get("/import/{project_slug}")
async def import_campaigns(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Import ACTIVE and PAUSED campaigns from Meta into the local DB.

    For each campaign returned by Meta:
    - If it already exists (by meta_campaign_id): update name, status, daily_budget when changed.
    - If new: insert a new AdCampaign row.

    After import, immediately run one optimization cycle for newly imported campaigns
    that have been running > 7 days (start_time < today - 7).
    """
    from app.services.ads.optimizer import analyze_campaign
    import json as _json

    # 1. Load project
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, f"Project '{project_slug}' not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")

    if not token:
        raise HTTPException(400, "Project missing meta_access_token")
    if not ad_account_id:
        raise HTTPException(400, "Project missing ad_account_id")

    # 2. Fetch campaigns from Meta
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{META_BASE}/act_{ad_account_id}/campaigns",
                params={
                    "fields": "id,name,objective,status,daily_budget,start_time,stop_time",
                    "filtering": _json.dumps([
                        {
                            "field": "effective_status",
                            "operator": "IN",
                            "value": ["ACTIVE", "PAUSED"],
                        }
                    ]),
                    "access_token": token,
                    "limit": 100,
                },
            )
    except Exception as e:
        raise HTTPException(502, f"Error connecting to Meta API: {str(e)}")

    data = resp.json()
    if "error" in data:
        meta_err = data["error"]
        raise HTTPException(
            400,
            f"Meta API error {meta_err.get('code', '')}: {meta_err.get('message', 'Unknown error')}",
        )

    meta_campaigns = data.get("data", [])

    # 3. Load existing campaigns for this project keyed by meta_campaign_id
    existing_result = await db.execute(
        select(AdCampaign).where(AdCampaign.project_id == project.id)
    )
    existing_by_meta_id: dict[str, AdCampaign] = {
        c.meta_campaign_id: c
        for c in existing_result.scalars().all()
        if c.meta_campaign_id
    }

    imported_campaigns: list[AdCampaign] = []
    updated_campaigns: list[AdCampaign] = []
    # Track start_date per meta_campaign_id for the optimizer step
    start_dates: dict[str, object] = {}

    today = datetime.utcnow().date()

    for mc in meta_campaigns:
        meta_id = mc["id"]
        meta_status_raw = mc.get("status", "PAUSED").upper()
        status = "active" if meta_status_raw == "ACTIVE" else "paused"
        name = mc.get("name", "")
        objective = mc.get("objective")

        # daily_budget is in cents from Meta
        daily_budget_cents = mc.get("daily_budget")
        daily_budget = float(daily_budget_cents) / 100.0 if daily_budget_cents else None

        # Parse start_time date portion (format: "2024-01-15T00:00:00+0000")
        start_time_str = mc.get("start_time", "")
        start_date = None
        if start_time_str:
            try:
                start_date = datetime.fromisoformat(start_time_str.replace("+0000", "+00:00")).date()
            except Exception:
                pass
        start_dates[meta_id] = start_date

        if meta_id in existing_by_meta_id:
            # Update if anything changed
            campaign = existing_by_meta_id[meta_id]
            changed = False
            if campaign.name != name:
                campaign.name = name
                changed = True
            if campaign.status != status:
                campaign.status = status
                changed = True
            if daily_budget is not None and campaign.daily_budget != daily_budget:
                campaign.daily_budget = daily_budget
                changed = True
            if changed:
                updated_campaigns.append(campaign)
        else:
            # Insert new campaign
            campaign = AdCampaign(
                project_id=project.id,
                meta_campaign_id=meta_id,
                ad_account_id=ad_account_id,
                name=name,
                objective=objective,
                status=status,
                daily_budget=daily_budget,
            )
            db.add(campaign)
            imported_campaigns.append(campaign)

    await db.commit()

    # Refresh new campaigns to get their DB ids
    for c in imported_campaigns:
        await db.refresh(c)

    # 4. Run optimizer for newly imported campaigns running > 7 days
    optimizer_results: list[dict] = []
    for campaign in imported_campaigns:
        # Check start_date per campaign using its meta_campaign_id
        campaign_start = start_dates.get(campaign.meta_campaign_id or "")
        if campaign_start is not None:
            days_running = (today - campaign_start).days
            if days_running < 7:
                continue
        try:
            result = await analyze_campaign(campaign, project, db)
            optimizer_results.append(result)
        except Exception:
            pass  # Optimizer failure must not break the import response

    all_campaigns = [
        {
            "id": c.id,
            "meta_campaign_id": c.meta_campaign_id,
            "name": c.name,
            "objective": c.objective,
            "status": c.status,
            "daily_budget": c.daily_budget,
            "action": "imported",
        }
        for c in imported_campaigns
    ] + [
        {
            "id": c.id,
            "meta_campaign_id": c.meta_campaign_id,
            "name": c.name,
            "objective": c.objective,
            "status": c.status,
            "daily_budget": c.daily_budget,
            "action": "updated",
        }
        for c in updated_campaigns
    ]

    return {
        "imported": len(imported_campaigns),
        "updated": len(updated_campaigns),
        "total": len(imported_campaigns) + len(updated_campaigns),
        "optimizer_ran": len(optimizer_results),
        "campaigns": all_campaigns,
    }


@router.get("/{campaign_id}/recommendations")
async def get_campaign_recommendations(
    campaign_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Return active recommendations (pending notifications + last opt log) for a campaign."""
    from app.models.optimization_log import CampaignOptimizationLog

    # 1. Load campaign
    camp_result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = camp_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    # 2. Fetch all unread notifications for this user and filter by campaign_id in action_data
    RELEVANT_TYPES = {"optimizer_scale", "optimizer_pause", "campaign_fatigued", "high_ctr_low_conversion"}
    notif_result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        ).order_by(Notification.created_at.desc())
    )
    all_notifs = notif_result.scalars().all()

    recommendations = []
    for n in all_notifs:
        if n.type not in RELEVANT_TYPES:
            continue
        action_data = n.action_data or {}
        # action_data.campaign_id may be int or str
        notif_campaign_id = action_data.get("campaign_id")
        if notif_campaign_id is None:
            continue
        try:
            if int(notif_campaign_id) != campaign_id:
                continue
        except (TypeError, ValueError):
            continue

        # Determine decision from type
        decision_map = {
            "optimizer_scale": "SCALE",
            "optimizer_pause": "PAUSE",
            "campaign_fatigued": "MODIFY",
            "high_ctr_low_conversion": "MODIFY",
        }
        decision = decision_map.get(n.type, "MODIFY")

        # Parse metrics from action_data
        metrics = None
        if "metrics" in action_data:
            raw = action_data["metrics"]
            metrics = raw if isinstance(raw, dict) else None
        elif n.type == "campaign_fatigued":
            # Build from available keys
            metrics = {k: action_data[k] for k in ("ctr_current", "ctr_7d_ago", "ctr_drop_pct", "frequency", "cost_per_result") if k in action_data}

        creative_brief = action_data.get("creative_brief") if n.type == "campaign_fatigued" else None

        # approved: None = pending, True/False from action_data
        approved_val = action_data.get("approved")  # None, True, or False
        approved: bool | None = None
        if isinstance(approved_val, bool):
            approved = approved_val

        recommendations.append({
            "id": n.id,
            "source": "notification",
            "type": n.type,
            "created_at": n.created_at.isoformat() if n.created_at else None,
            "decision": decision,
            "rationale": n.message,
            "approval_token": action_data.get("approval_token"),
            "approved": approved,
            "budget_current": action_data.get("current_budget"),
            "budget_proposed": action_data.get("new_budget"),
            "metrics": metrics,
            "creative_brief": creative_brief,
        })

    # 3. Last optimization log
    log_result = await db.execute(
        select(CampaignOptimizationLog)
        .where(CampaignOptimizationLog.campaign_id == campaign_id)
        .order_by(CampaignOptimizationLog.checked_at.desc())
        .limit(1)
    )
    last_log = log_result.scalar_one_or_none()
    last_optimization = None
    if last_log:
        metrics_snapshot = None
        if last_log.metrics_snapshot:
            try:
                metrics_snapshot = json.loads(last_log.metrics_snapshot)
            except (json.JSONDecodeError, TypeError):
                metrics_snapshot = last_log.metrics_snapshot
        last_optimization = {
            "checked_at": last_log.checked_at.isoformat() if last_log.checked_at else None,
            "decision": last_log.decision,
            "rationale": last_log.rationale,
            "metrics_snapshot": metrics_snapshot,
        }

    return {
        "campaign_id": campaign_id,
        "campaign_name": campaign.name,
        "has_pending": len(recommendations) > 0,
        "recommendations": recommendations,
        "last_optimization": last_optimization,
    }


@router.get("/{campaign_id}/logs")
async def get_optimization_logs(
    campaign_id: int,
    db: AsyncSession = Depends(get_session),
) -> list[dict]:
    """Get optimization history for a campaign."""
    from app.models.optimization_log import CampaignOptimizationLog

    result = await db.execute(
        select(CampaignOptimizationLog)
        .where(CampaignOptimizationLog.campaign_id == campaign_id)
        .order_by(CampaignOptimizationLog.checked_at.desc())
        .limit(20)
    )
    logs = result.scalars().all()

    return [
        {
            "id": log.id,
            "checked_at": str(log.checked_at),
            "decision": log.decision,
            "rationale": log.rationale,
            "action_taken": log.action_taken,
            "old_budget": log.old_budget,
            "new_budget": log.new_budget,
            "metrics_snapshot": log.metrics_snapshot,
        }
        for log in logs
    ]


class RefreshCreativeRequest(BaseModel):
    ad_id: str
    image_url: str
    headline: str
    body: str
    approval_token: str


@router.post("/{campaign_id}/refresh-creative")
async def refresh_creative(
    campaign_id: int,
    body: RefreshCreativeRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Upload a new creative to Meta Ads to replace a fatigued ad. Requires valid approval_token from a campaign_fatigued notification."""
    from app.models.optimization_log import CampaignOptimizationLog
    from app.services.notifications import NotificationService

    # 1. Find matching campaign_fatigued notification by approval_token
    notif_result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.type == "campaign_fatigued",
            Notification.is_read == False,
        )
    )
    notif = None
    for n in notif_result.scalars().all():
        if n.action_data and n.action_data.get("approval_token") == body.approval_token:
            notif = n
            break

    if not notif:
        raise HTTPException(404, "Approval token not found or already used")

    # 2. Get campaign + project
    campaign_result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(404, "Project not found")

    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")
    facebook_page_id = project.facebook_page_id or ""

    if not token or not ad_account_id:
        raise HTTPException(400, "Project missing meta credentials")

    # 3. Create new AdCreative + Ad on Meta
    destination_url = campaign.destination_url or ""
    if not destination_url:
        raise HTTPException(400, "Campaign has no destination_url configured")

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            new_ids = await meta_service.create_creative_and_ad(
                client=client,
                token=token,
                ad_account_id=ad_account_id,
                facebook_page_id=facebook_page_id,
                adset_id=campaign.meta_adset_id or "",
                campaign_name=campaign.name,
                concept_id=0,
                hook_3s=body.headline,
                body=body.body,
                cta="Learn More",
                image_url=body.image_url,
                destination_url=destination_url,
            )
    except Exception as e:
        raise HTTPException(500, f"Meta API error: {str(e)}")

    new_creative_id = new_ids.get("creative_id", "")

    # 4. Update optimization log: mark creative_refreshed
    logs_result = await db.execute(
        select(CampaignOptimizationLog)
        .where(CampaignOptimizationLog.campaign_id == campaign_id)
        .order_by(CampaignOptimizationLog.checked_at.desc())
        .limit(1)
    )
    latest_log = logs_result.scalar_one_or_none()
    if latest_log:
        latest_log.creative_refreshed = True
        latest_log.new_creative_id = new_creative_id

    # 5. Mark notification as read
    notif.is_read = True
    notif.action_data = {**(notif.action_data or {}), "creative_refreshed": True, "new_creative_id": new_creative_id}

    # 6. Create success notification
    notification_svc = NotificationService(db)
    await notification_svc.create(
        type="system",
        title=f"✅ Creativo actualizado — {campaign.name}",
        message="El nuevo creativo está activo en Meta Ads.",
        project_id=campaign.project_id,
    )

    await db.commit()

    return {"success": True, "new_creative_id": new_creative_id}


class UpdateBudgetRequest(BaseModel):
    daily_budget: float


@router.put("/{campaign_id}/budget")
async def update_campaign_budget(
    campaign_id: str,
    body: UpdateBudgetRequest,
    db: AsyncSession = Depends(get_session),
) -> dict:
    """Update campaign daily budget. campaign_id can be local DB id or Meta campaign id."""
    # Try local DB id first, then meta_campaign_id (handles large Meta IDs with JS precision loss)
    campaign = None
    try:
        result = await db.execute(select(AdCampaign).where(AdCampaign.id == int(campaign_id)))
        campaign = result.scalar_one_or_none()
    except (ValueError, OverflowError):
        pass
    if not campaign:
        result = await db.execute(select(AdCampaign).where(AdCampaign.meta_campaign_id == campaign_id))
        campaign = result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    token = await get_project_token(project, db) if project else ""

    if token and campaign.meta_adset_id:
        await meta_service.update_adset_budget(token, campaign.meta_adset_id, body.daily_budget)
    elif token and campaign.meta_campaign_id:
        await meta_service.update_campaign_budget(token, campaign.meta_campaign_id, body.daily_budget)

    campaign.daily_budget = body.daily_budget
    await db.commit()
    return {"id": campaign.id, "daily_budget": campaign.daily_budget}


@router.post("/optimizer/approve")
async def optimizer_approve(
    body: dict,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Approve a pending SCALE or PAUSE action from a notification."""
    approval_token = body.get("approval_token")
    if not approval_token:
        raise HTTPException(400, "approval_token required")

    # Find notification with this approval token
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    notif = None
    for n in result.scalars().all():
        if n.action_data and n.action_data.get("approval_token") == approval_token:
            notif = n
            break

    if not notif:
        raise HTTPException(404, "Approval token not found or already used")

    action_data = notif.action_data
    action = action_data.get("action")
    campaign_id = action_data.get("campaign_id")

    # Fetch campaign
    campaign_result = await db.execute(select(AdCampaign).where(AdCampaign.id == campaign_id))
    campaign = campaign_result.scalar_one_or_none()
    if not campaign:
        raise HTTPException(404, "Campaign not found")

    proj_result = await db.execute(select(Project).where(Project.id == campaign.project_id))
    project = proj_result.scalar_one_or_none()
    token = await get_project_token(project, db) if project else ""

    meta_svc = MetaCampaignService()
    result_msg = ""

    if action == "scale":
        new_budget = action_data.get("new_budget", campaign.daily_budget)
        if token and campaign.meta_adset_id:
            await meta_svc.update_adset_budget(token, campaign.meta_adset_id, new_budget)
        elif token and campaign.meta_campaign_id:
            await meta_svc.update_campaign_budget(token, campaign.meta_campaign_id, new_budget)
        else:
            import logging
            logging.getLogger(__name__).warning(
                "optimizer_approve: no meta_adset_id or meta_campaign_id for campaign %s — DB updated but Meta skipped",
                campaign.id,
            )
        campaign.daily_budget = new_budget
        result_msg = f"Budget increased to ${new_budget}/day"

    elif action == "pause":
        if token and campaign.meta_campaign_id:
            await meta_svc.set_campaign_status(token, campaign.meta_campaign_id, "PAUSED")
        campaign.status = "paused"
        result_msg = "Campaign paused"

    notif.is_read = True
    notif.action_data = {**action_data, "approved": True, "result": result_msg}

    # Save optimization log so the action appears in campaign history
    from app.models.optimization_log import CampaignOptimizationLog
    from datetime import datetime
    log_decision = "SCALE" if action == "scale" else "PAUSE"
    log = CampaignOptimizationLog(
        campaign_id=campaign.id,
        project_id=campaign.project_id,
        checked_at=datetime.utcnow(),
        decision=log_decision,
        rationale=action_data.get("rationale", f"Approved by user: {result_msg}"),
        action_taken="BUDGET_UPDATED" if action == "scale" else "CAMPAIGN_PAUSED",
        old_budget=action_data.get("current_budget"),
        new_budget=action_data.get("new_budget") if action == "scale" else None,
    )
    db.add(log)
    await db.commit()

    return {"ok": True, "action": action, "result": result_msg}


@router.post("/optimizer/reject")
async def optimizer_reject(
    body: dict,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Reject a pending optimizer action."""
    approval_token = body.get("approval_token")
    result = await db.execute(
        select(Notification).where(Notification.user_id == current_user.id)
    )
    notif = None
    for n in result.scalars().all():
        if n.action_data and n.action_data.get("approval_token") == approval_token:
            notif = n
            break

    if not notif:
        raise HTTPException(404, "Approval token not found")

    notif.is_read = True
    notif.action_data = {**(notif.action_data or {}), "approved": False}
    await db.commit()
    return {"ok": True, "action": "rejected"}


# ── Campaign Chat ─────────────────────────────────────────────────────────────

VALID_QUESTION_KEYS = {
    "how_are_campaigns",
    "wasting_money",
    "change_this_week",
    "creative_fatigue",
    "ready_to_scale",
}


class CampaignChatRequest(BaseModel):
    project_slug: str = Field(..., max_length=100)
    question_key: str = Field(..., max_length=64)
    language: str = Field("en", max_length=10)
    campaign_id: int | None = None


@router.post("/chat")
async def campaign_chat(
    body: CampaignChatRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_super_admin()),
) -> dict:
    """Conversational campaign analysis powered by Claude. super_admin only, 15-min cooldown."""
    from app.services.ads.campaign_chat import run_campaign_chat, CooldownError

    if body.question_key not in VALID_QUESTION_KEYS:
        raise HTTPException(400, f"Invalid question_key. Must be one of: {', '.join(VALID_QUESTION_KEYS)}")

    try:
        return await run_campaign_chat(
            question_key=body.question_key,
            project_slug=body.project_slug,
            user=current_user,
            db=db,
            language=body.language,
            campaign_id=body.campaign_id,
        )
    except CooldownError as e:
        raise HTTPException(
            status_code=429,
            detail={
                "error": "cooldown",
                "cooldown_remaining_seconds": e.remaining_seconds,
            },
        )
