"""Project health monitoring endpoints."""
import asyncio
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.api.deps import get_session, get_current_user
from app.models.project import Project
from app.models.meta_api_cache import MetaApiCache
from app.models.user_project import UserProject
from app.services.meta_health import get_project_health
from app.services.cache_helper import invalidate_project_cache, CACHE_TTLS

router = APIRouter()

REFRESH_LOCK_KEY = "manual_refresh_lock"


async def _get_accessible_project(
    project_id: int,
    db: AsyncSession,
    current_user,
) -> Project:
    """Return project if it exists and current_user has access; raise 404/403 otherwise."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")

    if current_user.role == "admin":
        return project

    # Operator / client: check assignment
    up = await db.execute(
        select(UserProject).where(
            UserProject.user_id == current_user.id,
            UserProject.project_id == project_id,
        )
    )
    if not up.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Access denied to this project")

    return project


# ---------------------------------------------------------------------------
# GET /projects/health/summary  — MUST be registered before /{project_id}/health
# to prevent FastAPI matching "health" as a project_id integer (which yields 422)
# ---------------------------------------------------------------------------

@router.get("/health/summary")
async def get_health_summary(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> list[dict]:
    """Return health summary for all projects accessible to the current user."""
    if current_user.role == "admin":
        result = await db.execute(select(Project).where(Project.is_active == True))
        projects = result.scalars().all()
    else:
        up_result = await db.execute(
            select(UserProject.project_id).where(UserProject.user_id == current_user.id)
        )
        project_ids = [row[0] for row in up_result.fetchall()]
        if not project_ids:
            return []
        result = await db.execute(
            select(Project).where(Project.id.in_(project_ids), Project.is_active == True)
        )
        projects = result.scalars().all()

    if not projects:
        return []

    async def _safe_health(p: Project) -> dict:
        try:
            return await get_project_health(db, p.id)
        except Exception as exc:
            return {
                "project_id": p.id,
                "project_name": p.name,
                "health_color": "red",
                "error": str(exc),
                "is_stale": True,
            }

    results = await asyncio.gather(*[_safe_health(p) for p in projects])
    return list(results)


# ---------------------------------------------------------------------------
# GET /projects/{project_id}/health
# ---------------------------------------------------------------------------

@router.get("/{project_id}/health")
async def get_project_health_endpoint(
    project_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """Return aggregated Meta health data for a project."""
    await _get_accessible_project(project_id, db, current_user)

    try:
        health = await get_project_health(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Health fetch failed: {str(exc)}")

    return health


# ---------------------------------------------------------------------------
# POST /projects/{project_id}/health/refresh
# ---------------------------------------------------------------------------

@router.post("/{project_id}/health/refresh")
async def refresh_project_health(
    project_id: int,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> dict:
    """
    Invalidate cached health data and force a fresh fetch.
    Rate-limited to once per 30 minutes per project.
    """
    await _get_accessible_project(project_id, db, current_user)

    # Check rate limit via the refresh lock cache entry
    lock_result = await db.execute(
        select(MetaApiCache).where(
            MetaApiCache.project_id == project_id,
            MetaApiCache.cache_key == REFRESH_LOCK_KEY,
        )
    )
    lock_entry = lock_result.scalar_one_or_none()

    if lock_entry and lock_entry.is_valid:
        age_seconds = (datetime.utcnow() - lock_entry.fetched_at).total_seconds()
        retry_after = int(CACHE_TTLS[REFRESH_LOCK_KEY] - age_seconds)
        raise HTTPException(
            status_code=429,
            detail={
                "error": "rate_limited",
                "message": "Manual refresh is limited to once every 30 minutes",
                "retry_after_seconds": max(retry_after, 0),
            },
        )

    # Invalidate all project cache entries except the lock itself
    await invalidate_project_cache(db, project_id, exclude_key=REFRESH_LOCK_KEY)

    # Set the refresh lock
    if lock_entry:
        lock_entry.fetched_at = datetime.utcnow()
        lock_entry.ttl_seconds = CACHE_TTLS[REFRESH_LOCK_KEY]
    else:
        lock_entry = MetaApiCache(
            project_id=project_id,
            cache_key=REFRESH_LOCK_KEY,
            data={"locked_at": datetime.utcnow().isoformat()},
            fetched_at=datetime.utcnow(),
            ttl_seconds=CACHE_TTLS[REFRESH_LOCK_KEY],
        )
        db.add(lock_entry)
    await db.commit()

    # Fetch fresh health data (cache is empty so all fetchers hit Meta API)
    try:
        health = await get_project_health(db, project_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Health fetch failed: {str(exc)}")

    return {"refreshed": True, **health}
