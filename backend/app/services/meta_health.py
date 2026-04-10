"""Meta Health Monitor service — fetches and aggregates health signals for a project."""
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.project import Project
from app.models.meta_api_cache import AuditLog
from app.services.cache_helper import get_or_fetch_cache, CACHE_TTLS
from app.core.config import settings
from app.core.security import get_project_token

META_BASE = "https://graph.facebook.com/v19.0"

# Map numeric account_status codes to human-readable labels and colors
ACCOUNT_STATUS_MAP: dict[int, tuple[str, str, str]] = {
    1: ("ACTIVE", "Activa", "green"),
    2: ("DISABLED", "Deshabilitada", "red"),
    3: ("UNSETTLED", "Deuda pendiente", "red"),
    7: ("PENDING_RISK_REVIEW", "Revisión de riesgo pendiente", "yellow"),
    8: ("PENDING_SETTLEMENT", "Liquidación pendiente", "yellow"),
    9: ("IN_GRACE_PERIOD", "Período de gracia", "yellow"),
    100: ("PENDING_CLOSURE", "Cierre pendiente", "yellow"),
    101: ("CLOSED", "Cerrada", "red"),
    201: ("ANY_ACTIVE", "Activa (agencia)", "green"),
    202: ("ANY_CLOSED", "Cerrada (agencia)", "red"),
}


async def _get_token(project: Project, db: AsyncSession) -> str | None:
    """Return the project Meta access token, fallback to global setting."""
    return await get_project_token(project, db)


async def _log_audit(
    db: AsyncSession,
    project_id: int,
    action: str,
    endpoint: str,
    response_status: int | None = None,
    error_message: str | None = None,
) -> None:
    """Write an entry to the audit log, swallowing any write errors."""
    try:
        audit = AuditLog(
            project_id=project_id,
            action=action,
            endpoint=endpoint,
            response_status=response_status,
            error_message=error_message,
            timestamp=datetime.utcnow(),
        )
        db.add(audit)
        await db.commit()
    except Exception:
        await db.rollback()


# ---------------------------------------------------------------------------
# Individual health fetchers
# ---------------------------------------------------------------------------

async def get_account_status(db: AsyncSession, project: Project) -> tuple[dict, bool]:
    """Fetch ad account status. Returns (data, is_stale)."""

    async def _fetch() -> dict:
        token = await _get_token(project, db)
        ad_account_id = (project.ad_account_id or "").removeprefix("act_")
        if not token or not ad_account_id:
            return {"error": "missing_credentials"}

        endpoint = f"{META_BASE}/act_{ad_account_id}"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                endpoint,
                params={
                    "fields": "account_status,disable_reason,amount_spent",
                    "access_token": token,
                },
            )
        if not resp.is_success:
            await _log_audit(
                db, project.id, "meta_account_status_error", endpoint,
                response_status=resp.status_code, error_message=resp.text[:500],
            )
            resp.raise_for_status()
        return resp.json()

    try:
        data, is_stale = await get_or_fetch_cache(
            db, project.id, "account_status", _fetch, CACHE_TTLS["account_status"]
        )
        return data, is_stale
    except Exception as exc:
        await _log_audit(db, project.id, "account_status_failed", "meta_account_status", error_message=str(exc))
        return {"error": str(exc)}, True


async def get_campaign_stats(db: AsyncSession, project: Project) -> tuple[dict, bool]:
    """Fetch campaign stats for last 7 days. Returns (data, is_stale)."""

    async def _fetch() -> dict:
        token = await _get_token(project, db)
        ad_account_id = (project.ad_account_id or "").removeprefix("act_")
        if not token or not ad_account_id:
            return {"data": [], "error": "missing_credentials"}

        endpoint = f"{META_BASE}/act_{ad_account_id}/campaigns"
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                endpoint,
                params={
                    # date_preset must be specified inside the insights sub-field,
                    # not as a top-level param — top-level date_preset is silently ignored
                    "fields": "name,status,effective_status,daily_budget,insights.date_preset(last_7d){spend,impressions}",
                    "access_token": token,
                },
            )
        if not resp.is_success:
            await _log_audit(
                db, project.id, "meta_campaign_stats_error", endpoint,
                response_status=resp.status_code, error_message=resp.text[:500],
            )
            resp.raise_for_status()
        return resp.json()

    try:
        data, is_stale = await get_or_fetch_cache(
            db, project.id, "campaign_stats", _fetch, CACHE_TTLS["campaign_stats"]
        )
        return data, is_stale
    except Exception as exc:
        await _log_audit(db, project.id, "campaign_stats_failed", "meta_campaign_stats", error_message=str(exc))
        return {"data": [], "error": str(exc)}, True


async def get_token_status(db: AsyncSession, project: Project) -> tuple[dict, bool]:
    """Debug the project token via Meta. Returns (data, is_stale)."""

    async def _fetch() -> dict:
        token = await _get_token(project, db)
        app_id = getattr(settings, "META_APP_ID", "")
        app_secret = getattr(settings, "META_APP_SECRET", "")
        if not token:
            return {"error": "missing_token"}

        # Build the app_access_token for debug_token call
        app_token = f"{app_id}|{app_secret}" if app_id and app_secret else token

        endpoint = f"{META_BASE}/debug_token"
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                endpoint,
                params={
                    "input_token": token,
                    "access_token": app_token,
                },
            )
        if not resp.is_success:
            await _log_audit(
                db, project.id, "meta_token_status_error", endpoint,
                response_status=resp.status_code, error_message=resp.text[:500],
            )
            resp.raise_for_status()
        return resp.json()

    try:
        data, is_stale = await get_or_fetch_cache(
            db, project.id, "token_status", _fetch, CACHE_TTLS["token_status"]
        )
        return data, is_stale
    except Exception as exc:
        await _log_audit(db, project.id, "token_status_failed", "meta_debug_token", error_message=str(exc))
        return {"error": str(exc)}, True


async def get_organic_stats(db: AsyncSession, project: Project) -> tuple[dict, bool]:
    """Fetch Facebook page + Instagram account info. Returns (data, is_stale)."""

    async def _fetch() -> dict:
        token = await _get_token(project, db)
        page_id = project.facebook_page_id or ""
        ig_id = project.instagram_account_id or ""
        if not token:
            return {"error": "missing_credentials"}

        results: dict[str, Any] = {}

        async with httpx.AsyncClient(timeout=15.0) as client:
            if page_id:
                resp = await client.get(
                    f"{META_BASE}/{page_id}",
                    params={"fields": "name,is_published", "access_token": token},
                )
                results["facebook_page"] = resp.json() if resp.is_success else {"error": resp.text[:200]}

            if ig_id:
                resp = await client.get(
                    f"{META_BASE}/{ig_id}",
                    params={"fields": "username,media_count", "access_token": token},
                )
                results["instagram"] = resp.json() if resp.is_success else {"error": resp.text[:200]}

        return results

    try:
        data, is_stale = await get_or_fetch_cache(
            db, project.id, "organic_stats", _fetch, CACHE_TTLS["organic_stats"]
        )
        return data, is_stale
    except Exception as exc:
        await _log_audit(db, project.id, "organic_stats_failed", "meta_organic_stats", error_message=str(exc))
        return {"error": str(exc)}, True


# ---------------------------------------------------------------------------
# Shape builders
# ---------------------------------------------------------------------------

def _build_ad_account_shape(raw: dict) -> dict:
    status_code = raw.get("account_status", 0)
    status_info = ACCOUNT_STATUS_MAP.get(int(status_code) if status_code else 0, ("UNKNOWN", "Desconocido", "yellow"))
    status_str, status_label, status_color = status_info
    spend_raw = raw.get("amount_spent", "0") or "0"
    try:
        spend_today = f"{float(spend_raw) / 100:.2f}"
    except (ValueError, TypeError):
        spend_today = "0.00"
    return {
        "status": status_str,
        "status_label": status_label,
        "status_color": status_color,
        "disable_reason": raw.get("disable_reason"),
        "spend_lifetime": spend_today,  # amount_spent = lifetime total, not today's
        "ads_disapproved_7d": 0,  # Requires a separate /ads call; default 0 for now
    }


def _build_campaigns_shape(raw: dict) -> list[dict]:
    campaigns = []
    for c in raw.get("data", []):
        insights_data = c.get("insights", {}).get("data", [{}])
        ins = insights_data[0] if insights_data else {}
        daily_budget_raw = c.get("daily_budget", "0") or "0"
        try:
            daily_budget = f"{float(daily_budget_raw) / 100:.2f}"
        except (ValueError, TypeError):
            daily_budget = "0.00"
        campaigns.append({
            "name": c.get("name", ""),
            "status": c.get("effective_status", c.get("status", "UNKNOWN")),
            "daily_budget": daily_budget,
            "spend_7d": ins.get("spend", "0.00"),
            "impressions_7d": int(ins.get("impressions", 0)),
        })
    return campaigns


def _build_token_shape(raw: dict) -> dict:
    token_data = raw.get("data", {})
    is_valid = bool(token_data.get("is_valid", False))
    expires_at_ts = token_data.get("expires_at")

    expires_at_str: str | None = None
    days_remaining: int | None = None
    color = "red"

    if expires_at_ts:
        try:
            exp_dt = datetime.fromtimestamp(int(expires_at_ts), tz=timezone.utc)
            expires_at_str = exp_dt.strftime("%Y-%m-%d")
            now = datetime.now(tz=timezone.utc)
            days_remaining = (exp_dt - now).days
            if days_remaining > 30:
                color = "green"
            elif days_remaining > 0:
                color = "yellow"
            else:
                color = "red"
        except (ValueError, TypeError, OSError):
            pass
    elif is_valid:
        # Long-lived token with no expiry (never-expiring system user token)
        color = "green"
        expires_at_str = None
        days_remaining = None

    if "error" in raw and not is_valid:
        color = "red"

    return {
        "is_valid": is_valid,
        "expires_at": expires_at_str,
        "days_remaining": days_remaining,
        "color": color,
    }


def _build_organic_shape(raw: dict) -> dict:
    fb_raw = raw.get("facebook_page", {})
    ig_raw = raw.get("instagram", {})
    return {
        "facebook_page": {
            "name": fb_raw.get("name"),
            "is_published": fb_raw.get("is_published"),
        } if fb_raw and "error" not in fb_raw else None,
        "instagram": {
            "username": ig_raw.get("username"),
            "media_count": ig_raw.get("media_count"),
        } if ig_raw and "error" not in ig_raw else None,
    }


def _compute_health_color(ad_account: dict, token: dict, campaigns: list[dict]) -> str:
    """Global health color: green / yellow / red."""
    # Red conditions
    if ad_account.get("status_color") == "red":
        return "red"
    if not token.get("is_valid"):
        return "red"
    days = token.get("days_remaining")
    if days is not None and days <= 0:
        return "red"

    # Yellow conditions
    if ad_account.get("status_color") == "yellow":
        return "yellow"
    if days is not None and days < 30:
        return "yellow"
    if ad_account.get("ads_disapproved_7d", 0) > 0:
        return "yellow"

    return "green"


# ---------------------------------------------------------------------------
# Main aggregator
# ---------------------------------------------------------------------------

async def get_project_health(db: AsyncSession, project_id: int) -> dict:
    """
    Aggregate health data for a project from 4 parallel Meta API calls.
    Returns the full health shape.
    """
    result = await db.execute(select(Project).where(Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise ValueError(f"Project {project_id} not found")

    # Run fetchers sequentially — they share a single AsyncSession which is not
    # concurrency-safe (concurrent commits cause IllegalStateChangeError in SQLAlchemy).
    acct_raw, acct_stale = await get_account_status(db, project)
    camp_raw, camp_stale = await get_campaign_stats(db, project)
    token_raw, token_stale = await get_token_status(db, project)
    org_raw, org_stale = await get_organic_stats(db, project)

    is_stale = acct_stale or camp_stale or token_stale or org_stale

    ad_account_shape = _build_ad_account_shape(acct_raw)
    campaigns_shape = _build_campaigns_shape(camp_raw)
    token_shape = _build_token_shape(token_raw)
    organic_shape = _build_organic_shape(org_raw)
    health_color = _compute_health_color(ad_account_shape, token_shape, campaigns_shape)

    return {
        "project_id": project_id,
        "project_name": project.name,
        "last_updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "is_stale": is_stale,
        "health_color": health_color,
        "ad_account": ad_account_shape,
        "campaigns": campaigns_shape,
        "token": token_shape,
        "organic": organic_shape,
    }
