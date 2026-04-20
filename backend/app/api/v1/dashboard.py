"""Dashboard KPI endpoints — real Meta Ads data."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.api.deps import get_session, get_current_user
from app.models.project import Project
from app.models.content import ContentPost
from app.core.config import settings
from app.core.security import get_project_token
import httpx
import json
from datetime import datetime, timedelta

router = APIRouter()

META_BASE = "https://graph.facebook.com/v19.0"


def get_andromeda_status(campaign_insights: dict) -> tuple[str, str]:
    ctr = float(campaign_insights.get("ctr", 0))
    frequency = float(campaign_insights.get("frequency", 0))
    cpa = float(campaign_insights.get("cost_per_action", 0))

    if frequency > 3.0:
        return "fatigued", f"Frequency {frequency:.1f} exceeds 3.0 threshold"
    elif ctr > 0 and frequency < 2.0:
        return "healthy", "CTR stable, frequency within bounds"
    elif cpa > 0:
        return "healthy", "Campaign within normal parameters"
    else:
        return "healthy", "Insufficient data for analysis"


def build_kpis(objective: str, insights: dict) -> dict:
    actions = {a["action_type"]: float(a["value"]) for a in insights.get("actions", []) if "action_type" in a and "value" in a}
    cpa_dict = {a["action_type"]: float(a["value"]) for a in insights.get("cost_per_action_type", []) if "action_type" in a and "value" in a}

    base = {
        "spend": float(insights.get("spend", 0)),
        "impressions": int(insights.get("impressions", 0)),
        "reach": int(insights.get("reach", 0)),
        "ctr": float(insights.get("ctr", 0)),
        "cpm": float(insights.get("cpm", 0)),
        "frequency": float(insights.get("frequency", 0)),
    }

    if "LEADS" in objective:
        leads = actions.get("lead", 0)
        cpl = cpa_dict.get("lead", 0)
        return {**base, "leads": leads, "cpl": cpl}
    elif "SALES" in objective:
        purchases = actions.get("purchase", 0)
        omni = actions.get("omni_purchase", 0)
        revenue = omni if isinstance(omni, (int, float)) else 0
        cpa = cpa_dict.get("purchase", 0)
        spend = float(insights.get("spend", 0))
        roas = (revenue / spend) if spend > 0 else 0
        return {**base, "purchases": purchases, "cpa": cpa, "roas": round(roas, 2), "revenue": revenue}
    elif "TRAFFIC" in objective:
        clicks = int(insights.get("clicks", 0))
        cpc = float(insights.get("cpc", 0))
        lpv = actions.get("landing_page_view", 0)
        return {**base, "clicks": clicks, "cpc": cpc, "landing_page_views": lpv}
    else:
        return base


async def fetch_account_insights(client: httpx.AsyncClient, ad_account_id: str, token: str, date_preset: str) -> dict:
    try:
        resp = await client.get(
            f"{META_BASE}/act_{ad_account_id}/insights",
            params={
                "fields": "spend",
                "date_preset": date_preset,
                "access_token": token,
            },
            timeout=15.0,
        )
        data = resp.json()
        if "error" in data:
            return {}
        rows = data.get("data", [])
        return rows[0] if rows else {}
    except Exception:
        return {}


async def fetch_campaign_insights(client: httpx.AsyncClient, campaign_id: str, token: str, date_preset: str) -> dict:
    try:
        resp = await client.get(
            f"{META_BASE}/{campaign_id}/insights",
            params={
                "fields": "spend,impressions,reach,clicks,ctr,cpm,cpc,frequency,actions,cost_per_action_type",
                "date_preset": date_preset,
                # Scope to 7d_click + 1d_view to match Meta Ads Manager default attribution.
                "action_attribution_windows": json.dumps(["7d_click", "1d_view"]),
                "access_token": token,
            },
            timeout=10.0,
        )
        data = resp.json()
        if "error" in data:
            return {}
        rows = data.get("data", [])
        return rows[0] if rows else {}
    except Exception:
        return {}


async def fetch_meta_ads_data(project: Project, db: AsyncSession) -> dict:
    token = await get_project_token(project, db)
    ad_account_id = (project.ad_account_id or "").removeprefix("act_")

    if not token or not ad_account_id:
        return {"campaigns": [], "totals": {"spend_today": 0.0, "spend_this_month": 0.0, "active_campaigns": 0}}

    campaigns_out = []
    active_count = 0

    try:
        async with httpx.AsyncClient() as client:
            # Fetch account-level spend totals (2 calls instead of 2N per-campaign calls)
            account_today = await fetch_account_insights(client, ad_account_id, token, "today")
            account_month = await fetch_account_insights(client, ad_account_id, token, "this_month")
            total_spend_today = float(account_today.get("spend", 0))
            total_spend_month = float(account_month.get("spend", 0))

            # Fetch only ACTIVE and PAUSED campaigns
            resp = await client.get(
                f"{META_BASE}/act_{ad_account_id}/campaigns",
                params={
                    "fields": "id,name,objective,status,daily_budget,lifetime_budget",
                    "filtering": json.dumps([{"field": "effective_status", "operator": "IN", "value": ["ACTIVE", "PAUSED"]}]),
                    "limit": 50,
                    "access_token": token,
                },
                timeout=15.0,
            )
            resp_data = resp.json()

            if "error" in resp_data:
                return {"campaigns": [], "totals": {"spend_today": total_spend_today, "spend_this_month": total_spend_month, "active_campaigns": 0}}

            campaigns = resp_data.get("data", [])

            for campaign in campaigns:
                campaign_id = campaign.get("id", "")
                objective = campaign.get("objective", "AWARENESS")
                status = campaign.get("status", "PAUSED")
                daily_budget_raw = campaign.get("daily_budget")
                daily_budget_dollars = float(daily_budget_raw) / 100.0 if daily_budget_raw else 0.0

                if status == "ACTIVE":
                    active_count += 1

                # Fetch insights for today and this_month
                insights_today = await fetch_campaign_insights(client, campaign_id, token, "today")
                insights_month = await fetch_campaign_insights(client, campaign_id, token, "this_month")

                spend_today = float(insights_today.get("spend", 0))
                spend_month = float(insights_month.get("spend", 0))

                kpis = build_kpis(objective, insights_month)
                andromeda_status, andromeda_reason = get_andromeda_status(insights_month)

                campaigns_out.append({
                    "id": campaign_id,
                    "name": campaign.get("name", ""),
                    "objective": objective,
                    "status": status,
                    "daily_budget": daily_budget_dollars,
                    "spend_today": spend_today,
                    "spend_this_month": spend_month,
                    "kpis": kpis,
                    "andromeda_status": andromeda_status,
                    "andromeda_reason": andromeda_reason,
                })

    except Exception:
        return {"campaigns": [], "totals": {"spend_today": 0.0, "spend_this_month": 0.0, "active_campaigns": 0}}

    return {
        "campaigns": campaigns_out,
        "totals": {
            "spend_today": round(total_spend_today, 2),
            "spend_this_month": round(total_spend_month, 2),
            "active_campaigns": active_count,
        },
    }


@router.get("/{project_slug}")
async def get_dashboard_kpis(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    _current_user=Depends(get_current_user),
) -> dict:
    """Return real KPI data for a project's dashboard."""
    result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Fetch real Meta Ads data
    meta_ads = await fetch_meta_ads_data(project, db)
    total_spend_month = meta_ads["totals"]["spend_this_month"]

    # Content stats
    now = datetime.utcnow()
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    posts_week_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
            ContentPost.created_at >= week_ago,
        )
    )
    posts_week_count = posts_week_result.scalar_one() or 0

    posts_month_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
            ContentPost.created_at >= month_ago,
        )
    )
    posts_month_count = posts_month_result.scalar_one() or 0

    total_posts_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
        )
    )
    total_posts_count = total_posts_result.scalar_one() or 0

    pending_result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project.id,
            ContentPost.status == "pending_approval",
        )
    )
    pending_count = pending_result.scalar_one() or 0

    recent_result = await db.execute(
        select(ContentPost)
        .where(ContentPost.project_id == project.id)
        .order_by(ContentPost.created_at.desc())
        .limit(5)
    )
    recent_posts = recent_result.scalars().all()

    last_published_result = await db.execute(
        select(ContentPost.published_at)
        .where(
            ContentPost.project_id == project.id,
            ContentPost.published_at.isnot(None),
        )
        .order_by(ContentPost.published_at.desc())
        .limit(1)
    )
    last_published_row = last_published_result.scalar_one_or_none()
    last_published_at = str(last_published_row) if last_published_row else None

    return {
        "project": {
            "name": project.name,
            "slug": project.slug,
            "is_active": project.is_active,
        },
        "meta_ads": meta_ads,
        "content": {
            "total_posts": total_posts_count,
            "posts_this_week": posts_week_count,
            "posts_this_month": posts_month_count,
            "pending_approvals": pending_count,
            "last_published_at": last_published_at,
            "recent_posts": [
                {
                    "id": p.id,
                    "caption": p.caption[:100] if p.caption else "",
                    "status": p.status,
                    "image_url": p.image_url,
                    "created_at": str(p.created_at),
                }
                for p in recent_posts
            ],
        },
        "costs": {
            "anthropic_spend_this_month": 0.0,
            "meta_ads_spend_this_month": total_spend_month,
            "aws_s3_estimated": 0.0,
            "total_estimated": total_spend_month,
        },
    }
