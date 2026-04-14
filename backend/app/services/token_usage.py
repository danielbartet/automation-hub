"""Token usage logging and limit enforcement service."""
from datetime import datetime, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.token_usage import TokenUsageLog, UserTokenLimit
from app.services.claude.client import compute_cost


async def log_token_usage(
    db: AsyncSession,
    user_id: str | None,
    project_id: int | None,
    usage: dict,
    operation_type: str,
) -> TokenUsageLog:
    """Log a token usage event and optionally fire a threshold notification."""
    cost = compute_cost(
        usage.get("model", ""),
        usage.get("input_tokens", 0),
        usage.get("output_tokens", 0),
    )
    log = TokenUsageLog(
        user_id=user_id,
        project_id=project_id,
        tokens_input=usage.get("input_tokens", 0),
        tokens_output=usage.get("output_tokens", 0),
        tokens_cached=usage.get("cache_read_tokens", 0),
        model=usage.get("model", ""),
        operation_type=operation_type,
        cost_usd=cost,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    # Check 80% threshold and fire notification if crossed
    if user_id:
        await _check_and_notify_threshold(db, user_id, log)

    return log


async def check_token_limit(
    db: AsyncSession,
    user_id: str,
) -> tuple[bool, int, int]:
    """Returns (is_over_limit, tokens_used_this_month, monthly_limit).

    Returns (False, 0, 0) when the user has no limit configured (unlimited).
    """
    result = await db.execute(
        select(UserTokenLimit).where(UserTokenLimit.user_id == user_id)
    )
    limit_row = result.scalar_one_or_none()
    if not limit_row or limit_row.monthly_token_limit == 0:
        return (False, 0, 0)

    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    usage_result = await db.execute(
        select(func.sum(TokenUsageLog.tokens_input + TokenUsageLog.tokens_output))
        .where(
            TokenUsageLog.user_id == user_id,
            TokenUsageLog.created_at >= month_start,
        )
    )
    total = usage_result.scalar() or 0
    return (total >= limit_row.monthly_token_limit, total, limit_row.monthly_token_limit)


async def _check_and_notify_threshold(
    db: AsyncSession, user_id: str, log: TokenUsageLog
) -> None:
    """Fire a token_limit_warning notification when the user crosses 80% of their limit."""
    from app.core.database import AsyncSessionLocal
    from app.services.notifications import NotificationService

    result = await db.execute(
        select(UserTokenLimit).where(UserTokenLimit.user_id == user_id)
    )
    limit_row = result.scalar_one_or_none()
    if not limit_row or limit_row.monthly_token_limit == 0:
        return

    month_start = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    usage_result = await db.execute(
        select(func.sum(TokenUsageLog.tokens_input + TokenUsageLog.tokens_output))
        .where(TokenUsageLog.user_id == user_id, TokenUsageLog.created_at >= month_start)
    )
    total = usage_result.scalar() or 0
    prev_total = total - (log.tokens_input + log.tokens_output)

    pct = total / limit_row.monthly_token_limit
    prev_pct = prev_total / limit_row.monthly_token_limit

    if pct >= 0.8 and prev_pct < 0.8:
        try:
            async with AsyncSessionLocal() as notif_db:
                notif_svc = NotificationService(notif_db)
                await notif_svc.create(
                    type="token_limit_warning",
                    title="Token limit warning",
                    message=(
                        f"You've used {pct * 100:.0f}% of your monthly token limit "
                        f"({total:,}/{limit_row.monthly_token_limit:,} tokens)."
                    ),
                    user_id=user_id,
                )
        except Exception:
            pass  # never block on notification failure
