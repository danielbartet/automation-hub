"""Token Usage endpoints — summary, trend, and limit management."""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, require_role, get_current_user
from app.models.token_usage import TokenUsageLog, UserTokenLimit
from app.models.user import User
from app.models.project import Project

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class TokenUsageSummaryRow(BaseModel):
    user_id: Optional[str]
    user_name: Optional[str]
    project_id: Optional[int]
    project_name: Optional[str]
    tokens_input: int
    tokens_output: int
    tokens_total: int
    cost_usd: float
    operation_count: int
    monthly_limit: int
    percent_used: Optional[float]


class TokenUsageSummaryResponse(BaseModel):
    period: str
    rows: list[TokenUsageSummaryRow]
    totals: dict


class TokenUsageTrendPoint(BaseModel):
    date: str
    tokens: int
    cost_usd: float


class TokenUsageTrendResponse(BaseModel):
    labels: list[str]
    tokens: list[int]
    cost_usd: list[float]


class TokenLimitRow(BaseModel):
    user_id: str
    user_name: str
    user_email: str
    monthly_token_limit: int


class SetTokenLimitRequest(BaseModel):
    monthly_token_limit: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _period_start(period: str) -> datetime:
    now = datetime.now(timezone.utc)
    if period == "week":
        return now - timedelta(days=7)
    elif period == "year":
        return now - timedelta(days=365)
    else:  # default: month
        return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _period_label(period: str) -> str:
    now = datetime.now(timezone.utc)
    if period == "week":
        return f"{(now - timedelta(days=7)).strftime('%Y-%m-%d')} / {now.strftime('%Y-%m-%d')}"
    elif period == "year":
        return now.strftime("%Y")
    else:
        return now.strftime("%Y-%m")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/summary", response_model=TokenUsageSummaryResponse)
async def get_token_usage_summary(
    period: str = "month",
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> TokenUsageSummaryResponse:
    """Return aggregated token usage grouped by user and project for the given period."""
    start = _period_start(period)

    # Build base query filtered by period
    base_q = select(
        TokenUsageLog.user_id,
        TokenUsageLog.project_id,
        func.sum(TokenUsageLog.tokens_input).label("tokens_input"),
        func.sum(TokenUsageLog.tokens_output).label("tokens_output"),
        func.sum(TokenUsageLog.tokens_input + TokenUsageLog.tokens_output).label("tokens_total"),
        func.sum(TokenUsageLog.cost_usd).label("cost_usd"),
        func.count(TokenUsageLog.id).label("operation_count"),
    ).where(TokenUsageLog.created_at >= start)

    if current_user.role == "admin":
        # admin: only projects where owner_id == current_user.id
        owned_proj_result = await db.execute(
            select(Project.id).where(Project.owner_id == current_user.id)
        )
        owned_proj_ids = [row[0] for row in owned_proj_result.fetchall()]
        if not owned_proj_ids:
            return TokenUsageSummaryResponse(
                period=_period_label(period), rows=[], totals={}
            )
        base_q = base_q.where(TokenUsageLog.project_id.in_(owned_proj_ids))

    base_q = base_q.group_by(TokenUsageLog.user_id, TokenUsageLog.project_id)
    result = await db.execute(base_q)
    rows_raw = result.fetchall()

    # Collect user IDs and project IDs for name lookups
    user_ids = {r.user_id for r in rows_raw if r.user_id}
    project_ids = {r.project_id for r in rows_raw if r.project_id}

    user_map: dict[str, str] = {}
    if user_ids:
        u_result = await db.execute(select(User.id, User.name).where(User.id.in_(user_ids)))
        user_map = {row[0]: row[1] for row in u_result.fetchall()}

    project_map: dict[int, str] = {}
    if project_ids:
        p_result = await db.execute(
            select(Project.id, Project.name).where(Project.id.in_(project_ids))
        )
        project_map = {row[0]: row[1] for row in p_result.fetchall()}

    # Load limits for users
    limit_map: dict[str, int] = {}
    if user_ids:
        lim_result = await db.execute(
            select(UserTokenLimit.user_id, UserTokenLimit.monthly_token_limit).where(
                UserTokenLimit.user_id.in_(user_ids)
            )
        )
        limit_map = {row[0]: row[1] for row in lim_result.fetchall()}

    rows: list[TokenUsageSummaryRow] = []
    total_tokens = 0
    total_cost = 0.0
    total_ops = 0

    for r in rows_raw:
        monthly_limit = limit_map.get(r.user_id, 0) if r.user_id else 0
        tokens_total = r.tokens_total or 0
        percent_used = (tokens_total / monthly_limit * 100) if monthly_limit > 0 else None

        rows.append(
            TokenUsageSummaryRow(
                user_id=r.user_id,
                user_name=user_map.get(r.user_id) if r.user_id else None,
                project_id=r.project_id,
                project_name=project_map.get(r.project_id) if r.project_id else None,
                tokens_input=r.tokens_input or 0,
                tokens_output=r.tokens_output or 0,
                tokens_total=tokens_total,
                cost_usd=round(r.cost_usd or 0.0, 6),
                operation_count=r.operation_count or 0,
                monthly_limit=monthly_limit,
                percent_used=round(percent_used, 1) if percent_used is not None else None,
            )
        )
        total_tokens += tokens_total
        total_cost += r.cost_usd or 0.0
        total_ops += r.operation_count or 0

    return TokenUsageSummaryResponse(
        period=_period_label(period),
        rows=rows,
        totals={
            "tokens_total": total_tokens,
            "cost_usd": round(total_cost, 6),
            "operation_count": total_ops,
        },
    )


@router.get("/trend", response_model=TokenUsageTrendResponse)
async def get_token_usage_trend(
    period: str = "month",
    project_id: Optional[int] = None,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> TokenUsageTrendResponse:
    """Return daily token usage trend for the given period."""
    start = _period_start(period)

    q = select(
        func.strftime("%Y-%m-%d", TokenUsageLog.created_at).label("day"),
        func.sum(TokenUsageLog.tokens_input + TokenUsageLog.tokens_output).label("tokens"),
        func.sum(TokenUsageLog.cost_usd).label("cost_usd"),
    ).where(TokenUsageLog.created_at >= start)

    if project_id is not None:
        # Verify access for admin
        if current_user.role == "admin":
            proj_result = await db.execute(
                select(Project).where(Project.id == project_id, Project.owner_id == current_user.id)
            )
            if proj_result.scalar_one_or_none() is None:
                raise HTTPException(status_code=403, detail="Access denied to this project")
        q = q.where(TokenUsageLog.project_id == project_id)
    elif current_user.role == "admin":
        owned_proj_result = await db.execute(
            select(Project.id).where(Project.owner_id == current_user.id)
        )
        owned_proj_ids = [row[0] for row in owned_proj_result.fetchall()]
        if owned_proj_ids:
            q = q.where(TokenUsageLog.project_id.in_(owned_proj_ids))

    q = q.group_by(text("day")).order_by(text("day"))
    result = await db.execute(q)
    rows = result.fetchall()

    labels = [r.day for r in rows]
    tokens = [r.tokens or 0 for r in rows]
    costs = [round(r.cost_usd or 0.0, 6) for r in rows]

    return TokenUsageTrendResponse(labels=labels, tokens=tokens, cost_usd=costs)


@router.get("/limits", response_model=list[TokenLimitRow])
async def get_token_limits(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> list[TokenLimitRow]:
    """Return token limits for users (super_admin: all; admin: own users)."""
    if current_user.role == "super_admin":
        users_result = await db.execute(
            select(User.id, User.name, User.email).where(User.is_active == True)
        )
    else:
        # admin: users assigned to their projects
        owned_proj_result = await db.execute(
            select(Project.id).where(Project.owner_id == current_user.id)
        )
        owned_proj_ids = [row[0] for row in owned_proj_result.fetchall()]
        if not owned_proj_ids:
            return []
        from app.models.user_project import UserProject
        assigned_ids_result = await db.execute(
            select(UserProject.user_id)
            .where(UserProject.project_id.in_(owned_proj_ids))
            .distinct()
        )
        assigned_ids = [row[0] for row in assigned_ids_result.fetchall()]
        if not assigned_ids:
            return []
        users_result = await db.execute(
            select(User.id, User.name, User.email).where(
                User.id.in_(assigned_ids), User.is_active == True
            )
        )

    users = users_result.fetchall()
    user_ids = [u[0] for u in users]

    limit_map: dict[str, int] = {}
    if user_ids:
        lim_result = await db.execute(
            select(UserTokenLimit.user_id, UserTokenLimit.monthly_token_limit).where(
                UserTokenLimit.user_id.in_(user_ids)
            )
        )
        limit_map = {row[0]: row[1] for row in lim_result.fetchall()}

    return [
        TokenLimitRow(
            user_id=u[0],
            user_name=u[1],
            user_email=u[2],
            monthly_token_limit=limit_map.get(u[0], 0),
        )
        for u in users
    ]


@router.put("/limits/{user_id}", response_model=TokenLimitRow)
async def set_token_limit(
    user_id: str,
    body: SetTokenLimitRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("super_admin")),
) -> TokenLimitRow:
    """Set or update the monthly token limit for a user (super_admin only)."""
    # Verify the user exists
    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Upsert
    existing_result = await db.execute(
        select(UserTokenLimit).where(UserTokenLimit.user_id == user_id)
    )
    limit_row = existing_result.scalar_one_or_none()
    if limit_row:
        limit_row.monthly_token_limit = body.monthly_token_limit
    else:
        limit_row = UserTokenLimit(
            user_id=user_id,
            monthly_token_limit=body.monthly_token_limit,
        )
        db.add(limit_row)

    await db.commit()
    await db.refresh(limit_row)

    return TokenLimitRow(
        user_id=user.id,
        user_name=user.name,
        user_email=user.email,
        monthly_token_limit=limit_row.monthly_token_limit,
    )
