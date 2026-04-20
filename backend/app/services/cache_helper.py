"""Cache helper for Meta API responses — get_or_fetch_cache utility."""
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.meta_api_cache import MetaApiCache, AuditLog

# TTL constants (seconds) per cache key type
CACHE_TTLS: dict[str, int] = {
    "account_status": 900,      # 15 min
    "campaign_stats": 1800,     # 30 min
    "token_status": 86400,      # 24 hours
    "organic_stats": 3600,      # 1 hour
    "manual_refresh_lock": 1800,  # 30 min — rate limit for manual refresh
}


async def get_or_fetch_cache(
    db: AsyncSession,
    project_id: int,
    cache_key: str,
    fetch_fn: Callable[[], Awaitable[Any]],
    ttl: int,
) -> tuple[Any, bool]:
    """
    Retrieve data from cache or fetch fresh from source.

    Returns (data, is_stale) where is_stale=True means data came from an
    expired cache entry (fetch_fn failed).
    """
    # Look for existing cache record
    result = await db.execute(
        select(MetaApiCache).where(
            MetaApiCache.project_id == project_id,
            MetaApiCache.cache_key == cache_key,
        )
    )
    cache_entry = result.scalar_one_or_none()

    # Cache hit and still valid
    if cache_entry and cache_entry.is_valid:
        return cache_entry.data, False

    # Cache miss or expired — fetch fresh data
    try:
        fresh_data = await fetch_fn()

        if cache_entry:
            cache_entry.data = fresh_data
            cache_entry.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
            cache_entry.ttl_seconds = ttl
        else:
            cache_entry = MetaApiCache(
                project_id=project_id,
                cache_key=cache_key,
                data=fresh_data,
                fetched_at=datetime.now(timezone.utc).replace(tzinfo=None),
                ttl_seconds=ttl,
            )
            db.add(cache_entry)

        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return fresh_data, False

    except Exception as exc:
        # Fetch failed — log to audit and return stale cache if available
        audit = AuditLog(
            project_id=project_id,
            action=f"cache_fetch_failed:{cache_key}",
            endpoint=cache_key,
            response_status=None,
            error_message=str(exc),
            timestamp=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        db.add(audit)
        try:
            await db.commit()
        except Exception:
            await db.rollback()

        if cache_entry and cache_entry.data:
            return cache_entry.data, True

        raise


async def invalidate_project_cache(db: AsyncSession, project_id: int, exclude_key: str | None = None) -> None:
    """Delete all cache entries for a project, optionally excluding a specific key."""
    stmt = delete(MetaApiCache).where(MetaApiCache.project_id == project_id)
    if exclude_key:
        stmt = stmt.where(MetaApiCache.cache_key != exclude_key)
    await db.execute(stmt)
    await db.commit()
