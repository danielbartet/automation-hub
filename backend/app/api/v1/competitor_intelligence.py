"""Competitor Intelligence endpoints — weekly brief per project."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_current_user, assert_project_access
from app.models.competitor_intelligence import CompetitorIntelligenceBrief
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
