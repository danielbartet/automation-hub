"""Per-user operation throttling service.

Provides multi-window rate limiting for content_post and campaign_create
operations, with Meta API usage cap enforcement.
"""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.operation_limit import UserOperationLimit, UserOperationLog

# ── Plan defaults ─────────────────────────────────────────────────────────────

_PLAN_DEFAULTS: dict[str, dict] = {
    "basic": {
        "plan": "basic",
        "max_posts_per_min": 1,
        "max_posts_per_hour": 3,
        "max_posts_per_day": 3,
        "min_post_interval_min": 2,
        "max_campaigns_per_min": 1,
        "max_campaigns_per_hour": 2,
        "max_campaigns_per_day": 1,
        "min_campaign_interval_min": 5,
        "meta_usage_cap_pct": 40,
    },
    "pro": {
        "plan": "pro",
        "max_posts_per_min": 2,
        "max_posts_per_hour": 6,
        "max_posts_per_day": 10,
        "min_post_interval_min": 1,
        "max_campaigns_per_min": 1,
        "max_campaigns_per_hour": 3,
        "max_campaigns_per_day": 5,
        "min_campaign_interval_min": 3,
        "meta_usage_cap_pct": 70,
    },
    "business": {
        "plan": "business",
        "max_posts_per_min": 5,
        "max_posts_per_hour": 15,
        "max_posts_per_day": 30,
        "min_post_interval_min": 0,
        "max_campaigns_per_min": 2,
        "max_campaigns_per_hour": 8,
        "max_campaigns_per_day": 15,
        "min_campaign_interval_min": 1,
        "meta_usage_cap_pct": 80,
    },
}


async def get_plan_defaults(plan: str) -> dict:
    """Return limit defaults for the given plan (falls back to basic)."""
    return dict(_PLAN_DEFAULTS.get(plan, _PLAN_DEFAULTS["basic"]))


async def _get_or_create_limit(
    db: AsyncSession, user_id: str
) -> UserOperationLimit:
    """Load the UserOperationLimit for user_id, creating a basic-plan row if missing."""
    result = await db.execute(
        select(UserOperationLimit).where(UserOperationLimit.user_id == user_id)
    )
    limit = result.scalar_one_or_none()
    if limit is None:
        limit = UserOperationLimit(
            user_id=user_id,
            **{k: v for k, v in _PLAN_DEFAULTS["basic"].items() if k != "plan"},
            plan="basic",
        )
        db.add(limit)
        await db.flush()
    return limit


def _now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def check_operation_allowed(
    db: AsyncSession,
    user_id: str,
    operation_type: str,  # "content_post" | "campaign_create"
    meta_usage_pct: float = 0.0,
) -> tuple[bool, str, int]:
    """Check whether the user may perform operation_type right now.

    Returns:
        (allowed, reason, retry_after_seconds)
        allowed=True means the operation is permitted.
        retry_after_seconds is 0 when allowed=True.
    """
    limit = await _get_or_create_limit(db, user_id)
    now = _now_naive()

    # ── Determine per-operation field names ───────────────────────────────────
    if operation_type == "content_post":
        per_min = limit.max_posts_per_min
        per_hour = limit.max_posts_per_hour
        per_day = limit.max_posts_per_day
        min_interval = limit.min_post_interval_min
    else:  # campaign_create
        per_min = limit.max_campaigns_per_min
        per_hour = limit.max_campaigns_per_hour
        per_day = limit.max_campaigns_per_day
        min_interval = limit.min_campaign_interval_min

    # ── 1. Meta API cap ───────────────────────────────────────────────────────
    if limit.meta_usage_cap_pct > 0 and meta_usage_pct >= limit.meta_usage_cap_pct:
        return (
            False,
            f"Meta API usage ({meta_usage_pct:.1f}%) has reached your plan cap "
            f"({limit.meta_usage_cap_pct}%). Try again in a few minutes.",
            300,
        )

    # ── 2. Minimum interval since last operation ──────────────────────────────
    if min_interval > 0:
        latest_result = await db.execute(
            select(UserOperationLog)
            .where(
                UserOperationLog.user_id == user_id,
                UserOperationLog.operation_type == operation_type,
            )
            .order_by(UserOperationLog.created_at.desc())
            .limit(1)
        )
        latest = latest_result.scalar_one_or_none()
        if latest is not None:
            elapsed_seconds = (now - latest.created_at).total_seconds()
            required_seconds = min_interval * 60
            if elapsed_seconds < required_seconds:
                retry = int(required_seconds - elapsed_seconds) + 1
                return (
                    False,
                    f"Please wait at least {min_interval} minute(s) between operations.",
                    retry,
                )

    # ── 3. Per-minute cap ─────────────────────────────────────────────────────
    if per_min > 0:
        window_start = now - timedelta(seconds=60)
        count_result = await db.execute(
            select(func.count(UserOperationLog.id)).where(
                UserOperationLog.user_id == user_id,
                UserOperationLog.operation_type == operation_type,
                UserOperationLog.created_at >= window_start,
            )
        )
        count = count_result.scalar() or 0
        if count >= per_min:
            return (False, "Per-minute operation limit reached.", 60)

    # ── 4. Per-hour cap ───────────────────────────────────────────────────────
    if per_hour > 0:
        window_start = now - timedelta(seconds=3600)
        count_result = await db.execute(
            select(func.count(UserOperationLog.id)).where(
                UserOperationLog.user_id == user_id,
                UserOperationLog.operation_type == operation_type,
                UserOperationLog.created_at >= window_start,
            )
        )
        count = count_result.scalar() or 0
        if count >= per_hour:
            return (False, "Hourly operation limit reached.", 3600)

    # ── 5. Per-day cap ────────────────────────────────────────────────────────
    if per_day > 0:
        window_start = now - timedelta(seconds=86400)
        count_result = await db.execute(
            select(func.count(UserOperationLog.id)).where(
                UserOperationLog.user_id == user_id,
                UserOperationLog.operation_type == operation_type,
                UserOperationLog.created_at >= window_start,
            )
        )
        count = count_result.scalar() or 0
        if count >= per_day:
            return (False, "Daily operation limit reached.", 86400)

    return (True, "", 0)


async def record_operation(
    db: AsyncSession, user_id: str, operation_type: str
) -> None:
    """Insert a UserOperationLog row to record a completed operation."""
    log = UserOperationLog(
        id=str(uuid4()),
        user_id=user_id,
        operation_type=operation_type,
    )
    db.add(log)
    await db.flush()


async def get_current_meta_usage(db: AsyncSession) -> float:
    """Return the latest MetaAppUsage.max_pct value, or 0.0 if no data."""
    from app.models.meta_api_audit_log import MetaAppUsage

    result = await db.execute(
        select(MetaAppUsage)
        .order_by(MetaAppUsage.recorded_at.desc())
        .limit(1)
    )
    row = result.scalar_one_or_none()
    if row is None or row.max_pct is None:
        return 0.0
    return float(row.max_pct)


async def check_schedule_conflict(
    db: AsyncSession,
    project_id: int,
    scheduled_at: datetime,
) -> bool:
    """Return True if a content post is already scheduled within ±30 minutes.

    Checks ContentPost for the same project_id, scheduled_at within the window,
    and status not in ('failed', 'deleted').
    """
    from app.models.content import ContentPost

    window_start = scheduled_at - timedelta(minutes=30)
    window_end = scheduled_at + timedelta(minutes=30)

    result = await db.execute(
        select(func.count(ContentPost.id)).where(
            ContentPost.project_id == project_id,
            ContentPost.scheduled_at >= window_start,
            ContentPost.scheduled_at <= window_end,
            ContentPost.status.notin_(["failed", "deleted"]),
        )
    )
    count = result.scalar() or 0
    return count > 0
