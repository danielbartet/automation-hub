"""Competitor Intelligence endpoints — weekly brief per project."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_current_user, assert_project_access
from app.models.competitor_intelligence import CompetitorIntelligenceBrief
from app.models.competitor_cache import CompetitorResearchCache
from app.models.project import Project

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/{project_slug}")
async def get_competitor_intelligence_brief(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Return the latest competitor intelligence brief for a project.

    Briefs are generated every Sunday at 06:00 UTC by the background scheduler.
    Returns 404 with a helpful message if no brief has been generated yet.
    """
    # Resolve project
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Check access
    await assert_project_access(current_user, project.id, db)

    # Fetch latest brief
    brief_result = await db.execute(
        select(CompetitorIntelligenceBrief)
        .where(CompetitorIntelligenceBrief.project_id == project.id)
        .order_by(CompetitorIntelligenceBrief.generated_at.desc())
        .limit(1)
    )
    brief = brief_result.scalar_one_or_none()

    if not brief:
        raise HTTPException(
            status_code=404,
            detail="No brief available yet. Brief generates every Sunday.",
        )

    return {
        "project_slug": project_slug,
        "brief_id": brief.id,
        "generated_at": brief.generated_at.isoformat(),
        "analyzed_ads_count": brief.analyzed_ads_count,
        "brief": brief.brief,
    }


@router.get("/{project_slug}/hooks")
async def get_hook_library(
    project_slug: str,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[dict]:
    """Return a deduplicated, sorted list of competitor ad hooks from the research cache.

    Each entry includes page_name, headline, body, days_active, start_date, snapshot_url.
    Sorted by days_active descending (longer-running = likely performing).
    Returns max 50 results.
    """
    # Resolve project
    proj_result = await db.execute(select(Project).where(Project.slug == project_slug))
    project = proj_result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project '{project_slug}' not found")

    # Check access
    await assert_project_access(current_user, project.id, db)

    # Fetch competitor research cache
    cache_result = await db.execute(
        select(CompetitorResearchCache).where(CompetitorResearchCache.project_id == project.id)
    )
    cache = cache_result.scalar_one_or_none()

    if not cache:
        return []

    # Extract ads from research_json
    raw_ads: list[dict] = cache.research_json.get("ads", []) if cache.research_json else []

    hooks: list[dict] = []
    seen: set[tuple] = set()

    for ad in raw_ads:
        page_name = ad.get("page_name") or ad.get("competitor") or ""
        # headline: try title first, then ad_creative_link_titles
        headline = ad.get("title") or ""
        if not headline:
            titles = ad.get("ad_creative_link_titles") or []
            headline = titles[0] if titles else ""

        # body: try body first, then ad_creative_bodies
        body = ad.get("body") or ""
        if not body:
            bodies = ad.get("ad_creative_bodies") or []
            body = bodies[0] if bodies else ""

        days_active = int(ad.get("days_active") or 0)
        start_date = ad.get("start_date_formatted") or ad.get("start_date") or ""
        snapshot_url = ad.get("snapshot_url") or ""

        # Deduplicate by (page_name + headline)
        dedup_key = (page_name.lower().strip(), headline.lower().strip())
        if dedup_key in seen:
            continue
        seen.add(dedup_key)

        if not page_name and not headline and not body:
            continue

        hooks.append({
            "page_name": page_name,
            "headline": headline,
            "body": body,
            "days_active": days_active,
            "start_date": start_date,
            "snapshot_url": snapshot_url,
        })

    # Sort by days_active descending
    hooks.sort(key=lambda x: x["days_active"], reverse=True)

    return hooks[:50]
