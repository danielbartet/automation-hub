"""Competitor Intelligence endpoints — weekly brief per project."""
import logging
from datetime import datetime, timezone
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

    now = datetime.now(timezone.utc)

    hooks: list[dict] = []
    seen: set[tuple] = set()

    for ad in raw_ads:
        # Only skip ads with EXPLICIT evidence they have stopped.
        # Missing is_active (None) or True → keep. Only False → skip.
        is_active = ad.get("is_active")
        if is_active is False:
            continue

        # Filter out ads with a past end_date — only if the field is present and parseable.
        # Absent end_date means the ad is still running (Apify omits it for active ads).
        # Prefer the raw ISO/epoch end_date over the human-readable end_date_formatted.
        end_date_raw = ad.get("end_date") or ""
        if end_date_raw:
            try:
                if isinstance(end_date_raw, (int, float)):
                    end_dt = datetime.fromtimestamp(end_date_raw, tz=timezone.utc)
                else:
                    end_dt = datetime.fromisoformat(str(end_date_raw).replace("Z", "+00:00"))
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
                if end_dt < now:
                    continue
            except Exception:
                pass  # unparseable end_date — keep the ad

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

        # Recalculate days_active dynamically from raw start_date so the value
        # is always accurate at query time, not frozen at scrape time (cache TTL 48h).
        raw_start = ad.get("start_date") or ad.get("ad_delivery_start_time") or ""
        if raw_start:
            try:
                if isinstance(raw_start, (int, float)):
                    start_dt = datetime.fromtimestamp(raw_start, tz=timezone.utc)
                else:
                    start_dt = datetime.fromisoformat(str(raw_start).replace("Z", "+00:00"))
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
                days_active = (now - start_dt).days
            except Exception:
                days_active = int(ad.get("days_active") or 0)
        else:
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
