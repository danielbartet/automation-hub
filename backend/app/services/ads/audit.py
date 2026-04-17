"""MetaAuditService — orchestrates Meta Ads health audit using batch Graph API calls."""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
import time as _time

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.models.ads_audit import AdsAudit, AuditCheckResult
from app.models.meta_api_cache import MetaApiCache

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SEVERITY_WEIGHTS: dict[str, float] = {
    "Critical": 5.0,
    "High": 3.0,
    "Medium": 1.5,
    "Low": 0.5,
}

CATEGORY_WEIGHTS: dict[str, float] = {
    "pixel": 0.30,
    "creative": 0.30,
    "structure": 0.20,
    "audience": 0.20,
}

RESULT_SCORES: dict[str, float] = {
    "PASS": 1.0,
    "WARNING": 0.5,
    "FAIL": 0.0,
}

GRAPH_BASE = "https://graph.facebook.com/v21.0"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class CheckResult:
    check_id: str
    category: str      # pixel | creative | structure | audience
    severity: str      # Critical | High | Medium | Low
    result: str        # PASS | WARNING | FAIL | MANUAL_REQUIRED | NA
    title: str
    detail: str = ""
    recommendation: str = ""
    meta_value: str = ""
    threshold_value: str = ""
    meta_ui_link: str = ""


@dataclass
class ScoreBreakdown:
    health_score: float
    grade: str
    score_pixel: float
    score_creative: float
    score_structure: float
    score_audience: float
    checks_pass: int
    checks_warning: int
    checks_fail: int
    checks_manual: int
    checks_na: int


# ---------------------------------------------------------------------------
# Custom exceptions
# ---------------------------------------------------------------------------


class MetaRateLimitError(Exception):
    """Raised when the Meta API ad account rate limit threshold is exceeded."""


# ---------------------------------------------------------------------------
# Safe type-conversion helpers
# All Meta Graph API numeric fields come as strings unless documented otherwise.
# ---------------------------------------------------------------------------


def _safe_float(value, default: float = 0.0) -> float:
    """Safely convert a Meta API string/number/None to float."""
    if value is None:
        return default
    try:
        return float(value)
    except (ValueError, TypeError):
        return default


def _safe_int(value, default: int = 0) -> int:
    """Safely convert a Meta API string/number/None to int."""
    if value is None:
        return default
    try:
        return int(float(value))
    except (ValueError, TypeError):
        return default


def _parse_meta_datetime(dt_str: str | None) -> datetime | None:
    """Parse a Meta API datetime string (ISO 8601 / Unix int-as-str) to a UTC-aware datetime."""
    if not dt_str:
        return None
    try:
        # Normalise timezone suffixes Meta uses: +0000 → +00:00, Z → +00:00
        normalised = str(dt_str).replace("+0000", "+00:00").replace("Z", "+00:00")
        return datetime.fromisoformat(normalised)
    except (ValueError, AttributeError):
        return None


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class MetaAuditService:
    """Orchestrates Meta Ads health audit with batched Graph API calls and DB-backed cache."""

    def __init__(
        self,
        token: str,
        ad_account_id: str,
        project_id: int,
        meta_campaign_id: str | None = None,
    ) -> None:
        self.token = token
        # Strip "act_" prefix — store bare numeric ID internally
        self.ad_account_id = ad_account_id.removeprefix("act_")
        self.project_id = project_id
        # When set, scope all insight and structure fetches to this single campaign
        self.meta_campaign_id = meta_campaign_id
        self._client = httpx.AsyncClient(base_url=GRAPH_BASE, timeout=30.0)

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "MetaAuditService":
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Rate-limit check
    # ------------------------------------------------------------------

    def _check_rate_limit(self, response: httpx.Response) -> None:
        """Inspect x-ad-account-usage header and raise MetaRateLimitError if > 80%."""
        header = response.headers.get("x-ad-account-usage")
        if not header:
            return
        try:
            usage = json.loads(header)
            pct = float(usage.get("acc_id_util_pct", 0))
            if pct > 80:
                raise MetaRateLimitError(
                    f"Meta ad account rate limit reached: {pct:.1f}% utilization"
                )
        except (json.JSONDecodeError, TypeError, ValueError):
            pass  # Malformed header — don't block execution

    # ------------------------------------------------------------------
    # Batch POST
    # ------------------------------------------------------------------

    async def _post_batch(self, batch_requests: list[dict]) -> list[dict]:
        """
        POST to the Meta Batch API endpoint.
        Retries once on 5xx with a 2-second delay.
        Returns the list of sub-response dicts.
        """
        payload = {
            "access_token": self.token,
            "batch": json.dumps(batch_requests),
        }

        for attempt in range(2):
            resp = await self._client.post(
                f"{GRAPH_BASE}/",
                data=payload,
            )
            if resp.is_server_error and attempt == 0:
                await asyncio.sleep(2)
                continue
            break

        self._check_rate_limit(resp)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Cache helpers
    # ------------------------------------------------------------------

    async def _get_cached(self, db: AsyncSession, key: str) -> dict | None:
        """Return cached data dict if a valid (non-expired) entry exists, else None."""
        result = await db.execute(
            select(MetaApiCache).where(
                MetaApiCache.project_id == self.project_id,
                MetaApiCache.cache_key == key,
            )
        )
        entry = result.scalar_one_or_none()
        if entry and entry.is_valid:
            return entry.data
        return None

    async def _set_cache(self, db: AsyncSession, key: str, data: dict, ttl: int) -> None:
        """Upsert a cache entry for the given key."""
        result = await db.execute(
            select(MetaApiCache).where(
                MetaApiCache.project_id == self.project_id,
                MetaApiCache.cache_key == key,
            )
        )
        entry = result.scalar_one_or_none()
        if entry:
            entry.data = data
            entry.fetched_at = datetime.utcnow()
            entry.ttl_seconds = ttl
        else:
            entry = MetaApiCache(
                project_id=self.project_id,
                cache_key=key,
                data=data,
                fetched_at=datetime.utcnow(),
                ttl_seconds=ttl,
            )
            db.add(entry)
        await db.commit()

    # ------------------------------------------------------------------
    # Batch A — Account structure
    # ------------------------------------------------------------------

    async def fetch_structure_batch(self, db: AsyncSession) -> dict:
        """
        Fetch campaigns, adsets, and ads in a single batch POST.
        Cache key: audit:{project_id}:structure (or :structure:{campaign_id} when scoped) — TTL 3600s.
        Returns dict with keys: campaigns, adsets, ads.

        When self.meta_campaign_id is set, all three sub-requests are filtered to that
        campaign so checks only evaluate data for this specific campaign.
        """
        scope_suffix = f":{self.meta_campaign_id}" if self.meta_campaign_id else ""
        cache_key = f"audit:{self.project_id}:structure{scope_suffix}"
        cached = await self._get_cached(db, cache_key)
        if cached is not None:
            return cached

        act = f"act_{self.ad_account_id}"

        if self.meta_campaign_id:
            # Campaign-scoped: fetch only the target campaign + its adsets + its ads
            cid = self.meta_campaign_id
            campaign_filter = json.dumps([
                {"field": "campaign.id", "operator": "EQUAL", "value": cid}
            ])
            adset_filter = json.dumps([
                {"field": "campaign.id", "operator": "EQUAL", "value": cid},
                {"field": "effective_status", "operator": "IN", "value": ["ACTIVE"]},
            ])
            ad_filter = json.dumps([
                {"field": "campaign.id", "operator": "EQUAL", "value": cid},
            ])
            batch = [
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/campaigns"
                        "?fields=id,name,status,objective,buying_type,daily_budget,"
                        "lifetime_budget,budget_rebalance_flag,created_time"
                        f"&filtering={campaign_filter}"
                        "&limit=10"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/adsets"
                        "?fields=id,name,status,campaign_id,optimization_goal,billing_event,"
                        "bid_strategy,bid_amount,daily_budget,targeting,attribution_spec,created_time"
                        f"&filtering={adset_filter}"
                        "&limit=100"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/ads"
                        "?fields=id,name,status,adset_id,campaign_id,"
                        "creative{id,object_type,video_id,image_url,effective_object_story_id,"
                        "asset_feed_spec,degrees_of_freedom_spec},"
                        "tracking_specs,created_time"
                        f"&filtering={ad_filter}"
                        "&limit=200"
                    ),
                },
            ]
        else:
            # Account-wide: original behaviour
            batch = [
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/campaigns"
                        "?fields=id,name,status,objective,buying_type,daily_budget,"
                        "lifetime_budget,budget_rebalance_flag,created_time"
                        "&filtering=[{\"field\":\"effective_status\",\"operator\":\"IN\","
                        "\"value\":[\"ACTIVE\"]}]"
                        "&limit=100"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/adsets"
                        "?fields=id,name,status,campaign_id,optimization_goal,billing_event,"
                        "bid_strategy,bid_amount,daily_budget,targeting,attribution_spec,created_time"
                        "&filtering=[{\"field\":\"effective_status\",\"operator\":\"IN\","
                        "\"value\":[\"ACTIVE\"]}]"
                        "&limit=100"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/ads"
                        "?fields=id,name,status,adset_id,campaign_id,"
                        "creative{id,object_type,video_id,image_url,effective_object_story_id,"
                        "asset_feed_spec,degrees_of_freedom_spec},"
                        "tracking_specs,created_time"
                        "&limit=200"
                    ),
                },
            ]

        raw_responses = await self._post_batch(batch)
        result = {
            "campaigns": self._parse_sub_response(raw_responses, 0),
            "adsets": self._parse_sub_response(raw_responses, 1),
            "ads": self._parse_sub_response(raw_responses, 2),
        }

        await self._set_cache(db, cache_key, result, 3600)
        return result

    # ------------------------------------------------------------------
    # Batch B — Insights
    # ------------------------------------------------------------------

    async def fetch_insights_batch(self, db: AsyncSession) -> dict:
        """
        Fetch 5 insights requests in a single batch POST.
        Cache key: audit:{project_id}:insights (or :insights:{campaign_id} when scoped) — TTL 10800s.
        Returns dict with keys: insights_30d, insights_7d, insights_14d,
        insights_placement, insights_yesterday.

        When self.meta_campaign_id is set, all insight calls add a campaign.id filter so
        only data for that specific campaign is returned.
        """
        scope_suffix = f":{self.meta_campaign_id}" if self.meta_campaign_id else ""
        cache_key = f"audit:{self.project_id}:insights{scope_suffix}"
        cached = await self._get_cached(db, cache_key)
        if cached is not None:
            return cached

        act = f"act_{self.ad_account_id}"
        insight_fields = (
            "impressions,clicks,spend,reach,frequency,cpm,ctr,cpc,"
            "actions,action_values,cost_per_action_type,purchase_roas,"
            "video_play_actions,video_p25_watched_actions,video_p100_watched_actions"
        )
        # Scope attribution to 7d_click + 1d_view to match Meta Ads Manager default.
        # This prevents inflated purchase counts from 28d_click or other wider windows.
        _attr_windows = "&action_attribution_windows=%5B%227d_click%22%2C%221d_view%22%5D"

        # Build optional campaign filter suffix — appended to each batch URL when scoped
        if self.meta_campaign_id:
            cid = self.meta_campaign_id
            _cid_filter = json.dumps([
                {"field": "campaign.id", "operator": "EQUAL", "value": cid}
            ])
            campaign_filter_param = f"&filtering={_cid_filter}"
            # Placement insights use campaign-level filtering; level stays at campaign for 30d/yesterday
            # For adset and ad level we filter by campaign.id
            batch = [
                {
                    "method": "GET",
                    "relative_url": (
                        f"{cid}/insights"
                        f"?fields={insight_fields}"
                        f"&date_preset=last_30d&level=campaign&limit=10{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{cid}/insights"
                        f"?fields={insight_fields}"
                        f"&date_preset=last_7d&level=adset&limit=100{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{cid}/insights"
                        "?fields=impressions,ctr,frequency,video_play_curve_actions"
                        "&date_preset=last_14d&level=ad&limit=200"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        "?fields=impressions,clicks,spend,actions"
                        "&breakdowns=publisher_platform,platform_position"
                        f"&date_preset=last_30d&level=campaign{campaign_filter_param}{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{cid}/insights"
                        "?fields=campaign_id,spend"
                        "&date_preset=yesterday&level=campaign"
                    ),
                },
            ]
        else:
            batch = [
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        f"?fields={insight_fields}"
                        f"&date_preset=last_30d&level=campaign&limit=50{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        f"?fields={insight_fields}"
                        f"&date_preset=last_7d&level=adset&limit=100{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        "?fields=impressions,ctr,frequency,video_play_curve_actions"
                        "&date_preset=last_14d&level=ad&limit=200"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        "?fields=impressions,clicks,spend,actions"
                        "&breakdowns=publisher_platform,platform_position"
                        f"&date_preset=last_30d&level=account{_attr_windows}"
                    ),
                },
                {
                    "method": "GET",
                    "relative_url": (
                        f"{act}/insights"
                        "?fields=campaign_id,spend"
                        "&date_preset=yesterday&level=campaign"
                    ),
                },
            ]

        raw_responses = await self._post_batch(batch)
        result = {
            "insights_30d": self._parse_sub_response(raw_responses, 0),
            "insights_7d": self._parse_sub_response(raw_responses, 1),
            "insights_14d": self._parse_sub_response(raw_responses, 2),
            "insights_placement": self._parse_sub_response(raw_responses, 3),
            "insights_yesterday": self._parse_sub_response(raw_responses, 4),
        }

        await self._set_cache(db, cache_key, result, 10800)
        return result

    # ------------------------------------------------------------------
    # Batch C — Assets
    # ------------------------------------------------------------------

    async def fetch_assets_batch(self, db: AsyncSession) -> dict:
        """
        Fetch pixels, custom audiences, and A/B tests in a batch POST,
        then sequentially fetch pixel stats for the first discovered pixel.
        Cache key: audit:{project_id}:assets — TTL 86400s.
        Returns dict with keys: pixels, pixel_stats, custom_audiences, abtests.
        """
        cache_key = f"audit:{self.project_id}:assets"
        cached = await self._get_cached(db, cache_key)
        if cached is not None:
            return cached

        act = f"act_{self.ad_account_id}"
        batch = [
            {
                "method": "GET",
                "relative_url": (
                    f"{act}/adspixels"
                    "?fields=id,name,last_fired_time,is_unavailable,event_match_quality_score"
                ),
            },
            {
                "method": "GET",
                "relative_url": (
                    f"{act}/customaudiences"
                    "?fields=id,name,subtype,approximate_count_lower_bound,delivery_status,data_source,"
                    "retention_days,time_created,time_updated,lookalike_spec"
                    "&limit=100"
                ),
            },
            {
                "method": "GET",
                "relative_url": (
                    f"{act}/adstudies"
                    "?fields=id,name,type,start_time,end_time,status"
                    "&limit=10"
                ),
            },
        ]

        raw_responses = await self._post_batch(batch)
        pixels = self._parse_sub_response(raw_responses, 0)
        custom_audiences = self._parse_sub_response(raw_responses, 1)
        abtests = self._parse_sub_response(raw_responses, 2)

        # Sequential inner call: fetch pixel stats for the first discovered pixel
        pixel_stats: dict = {}
        pixel_data = pixels.get("data", []) if isinstance(pixels, dict) else []
        if pixel_data:
            first_pixel_id = pixel_data[0].get("id")
            if first_pixel_id:
                now_unix = int(datetime.now(tz=timezone.utc).timestamp())
                seven_days_ago = now_unix - (7 * 24 * 3600)
                try:
                    stats_resp = await self._client.get(
                        f"/{first_pixel_id}/stats",
                        params={
                            "start_time": str(seven_days_ago),
                            "end_time": str(now_unix),
                            "aggregation": "event",
                            "access_token": self.token,
                        },
                    )
                    self._check_rate_limit(stats_resp)
                    stats_resp.raise_for_status()
                    pixel_stats = stats_resp.json()
                except Exception as exc:
                    logger.warning("Pixel stats fetch failed for pixel %s: %s", first_pixel_id, exc)

        result = {
            "pixels": pixels,
            "pixel_stats": pixel_stats,
            "custom_audiences": custom_audiences,
            "abtests": abtests,
        }

        await self._set_cache(db, cache_key, result, 86400)
        return result

    # ------------------------------------------------------------------
    # Score calculation
    # ------------------------------------------------------------------

    def _calculate_score(self, results: list[CheckResult]) -> ScoreBreakdown:
        """Apply severity weights and category weights to compute overall health score."""
        cat_earned: dict[str, float] = {k: 0.0 for k in CATEGORY_WEIGHTS}
        cat_possible: dict[str, float] = {k: 0.0 for k in CATEGORY_WEIGHTS}
        counts: dict[str, int] = {
            "PASS": 0,
            "WARNING": 0,
            "FAIL": 0,
            "MANUAL_REQUIRED": 0,
            "NA": 0,
        }

        for r in results:
            counts[r.result] = counts.get(r.result, 0) + 1
            if r.result in ("MANUAL_REQUIRED", "NA"):
                continue
            w = SEVERITY_WEIGHTS.get(r.severity, 1.0)
            cat_earned[r.category] += RESULT_SCORES.get(r.result, 0.0) * w
            cat_possible[r.category] += w

        cat_scores: dict[str, float] = {
            cat: (cat_earned[cat] / cat_possible[cat] * 100) if cat_possible[cat] > 0 else 0.0
            for cat in CATEGORY_WEIGHTS
        }

        total_earned = sum(cat_earned[c] * CATEGORY_WEIGHTS[c] for c in CATEGORY_WEIGHTS)
        total_possible = sum(cat_possible[c] * CATEGORY_WEIGHTS[c] for c in CATEGORY_WEIGHTS)
        health_score = (total_earned / total_possible * 100) if total_possible > 0 else 0.0

        if health_score >= 90:
            grade = "A"
        elif health_score >= 75:
            grade = "B"
        elif health_score >= 60:
            grade = "C"
        elif health_score >= 50:
            grade = "D"
        else:
            grade = "F"

        return ScoreBreakdown(
            health_score=round(health_score, 1),
            grade=grade,
            score_pixel=round(cat_scores["pixel"], 1),
            score_creative=round(cat_scores["creative"], 1),
            score_structure=round(cat_scores["structure"], 1),
            score_audience=round(cat_scores["audience"], 1),
            checks_pass=counts["PASS"],
            checks_warning=counts["WARNING"],
            checks_fail=counts["FAIL"],
            checks_manual=counts["MANUAL_REQUIRED"],
            checks_na=counts["NA"],
        )

    async def _notify_critical_fails(
        self, audit_id: int, project_id: int, results: list, db
    ) -> None:
        """Create notifications for Critical FAIL results (M01, M02 only)."""
        CRITICAL_NOTIFY_CHECKS = {"M01", "M02"}
        critical_fails = [
            r for r in results
            if r.check_id in CRITICAL_NOTIFY_CHECKS and r.result == "FAIL"
        ]
        if not critical_fails:
            return

        from app.models.notification import Notification

        for check in critical_fails:
            existing = await db.execute(
                select(Notification).where(
                    Notification.project_id == project_id,
                    Notification.type == "audit_critical_fail",
                    Notification.is_read == False,  # noqa: E712
                )
            )
            existing_rows = existing.scalars().all()
            already_notified = any(
                (n.action_data or {}).get("check_id") == check.check_id
                for n in existing_rows
            )
            if already_notified:
                continue

            notification = Notification(
                project_id=project_id,
                type="audit_critical_fail",
                title=f"Critical: {check.title}",
                message=check.recommendation or check.detail,
                action_data={"audit_id": audit_id, "check_id": check.check_id},
            )
            db.add(notification)

        await db.commit()

    # ------------------------------------------------------------------
    # Main orchestration entry point
    # ------------------------------------------------------------------

    async def run(self, audit_id: int, db: AsyncSession) -> None:
        """
        Orchestrate: fetch all 3 batches → evaluate checks → persist results → update audit row.

        When self.meta_campaign_id is set the audit is scoped to that campaign: structure
        and insight batches are filtered to the single campaign so per-campaign scores are
        accurate.  Account-level checks (pixel, CAPI, audiences) still evaluate the full ad
        account because they are not campaign-specific by nature.
        """
        audit = await db.get(AdsAudit, audit_id)
        try:
            # Clear stale cache for this project before fresh fetch
            await db.execute(
                delete(MetaApiCache).where(MetaApiCache.project_id == self.project_id)
            )
            await db.commit()

            raw: dict = {}
            raw.update(await self.fetch_structure_batch(db))
            raw.update(await self.fetch_insights_batch(db))
            raw.update(await self.fetch_assets_batch(db))

            results: list[CheckResult] = [evaluator(raw) for evaluator in CHECK_EVALUATORS]
            score = self._calculate_score(results)

            for r in results:
                db.add(AuditCheckResult(
                    audit_id=audit_id,
                    check_id=r.check_id,
                    category=r.category,
                    severity=r.severity,
                    result=r.result,
                    title=r.title,
                    detail=r.detail,
                    recommendation=r.recommendation,
                    meta_value=r.meta_value,
                    threshold_value=r.threshold_value,
                    meta_ui_link=r.meta_ui_link,
                ))

            audit.status = "completed"
            audit.health_score = score.health_score
            audit.grade = score.grade
            audit.score_pixel = score.score_pixel
            audit.score_creative = score.score_creative
            audit.score_structure = score.score_structure
            audit.score_audience = score.score_audience
            audit.checks_pass = score.checks_pass
            audit.checks_warning = score.checks_warning
            audit.checks_fail = score.checks_fail
            audit.checks_manual = score.checks_manual
            audit.checks_na = score.checks_na
            # Store per-check raw values plus scope metadata
            audit.raw_data = {
                "_scope": {
                    "campaign_id": self.meta_campaign_id,
                },
                **{
                    r.check_id: {
                        "meta_value": r.meta_value,
                        "threshold_value": r.threshold_value,
                    }
                    for r in results
                },
            }
            audit.completed_at = datetime.utcnow()
            await db.commit()
            await self._notify_critical_fails(audit_id, self.project_id, results, db)

        except MetaRateLimitError as e:
            audit.status = "partial"
            audit.error_message = str(e)
            audit.completed_at = datetime.utcnow()
            await db.commit()
        except Exception as e:
            audit.status = "error"
            audit.error_message = str(e)
            audit.completed_at = datetime.utcnow()
            await db.commit()
            raise

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_sub_response(raw_responses: list[dict], index: int) -> dict:
        """
        Extract and JSON-decode the body of a batch sub-response.

        Meta Batch API wraps each sub-response as:
          {"code": 200, "headers": [...], "body": "<json-string>"}

        The body string is itself a JSON object — typically {"data": [...], "paging": {...}}
        for list endpoints. On error it is {"error": {"message": ..., "code": ...}}.

        Returns an empty dict on any parsing failure or when the sub-response indicates
        an error (non-200 code or body containing an "error" key).
        """
        try:
            sub = raw_responses[index]
            code = sub.get("code", 200)
            body_str = sub.get("body") or "{}"
            parsed = json.loads(body_str)
            if code != 200 or "error" in parsed:
                logger.warning(
                    "Meta batch sub-response[%d] returned code=%s body=%s",
                    index, code, body_str[:300],
                )
                return {}
            return parsed
        except (IndexError, KeyError, json.JSONDecodeError, TypeError) as exc:
            logger.warning("Failed to parse Meta batch sub-response[%d]: %s", index, exc)
            return {}


# ---------------------------------------------------------------------------
# Check evaluators — Pixel / CAPI (M01–M10)
# ---------------------------------------------------------------------------


def eval_pixel_installed(data: dict) -> CheckResult:
    """M01 — Critical: Verify a Meta Pixel is installed and recently active."""
    pixels_raw = data.get("pixels", {})
    pixel_list = pixels_raw.get("data", []) if isinstance(pixels_raw, dict) else []

    if not pixel_list:
        return CheckResult(
            check_id="M01",
            category="pixel",
            severity="Critical",
            result="FAIL",
            title="Meta Pixel installed",
            detail="No Meta Pixel found linked to this ad account.",
            recommendation="Create a Meta Pixel in Events Manager and install it on all website pages.",
            meta_ui_link="https://business.facebook.com/events_manager",
            threshold_value="< 24h for PASS, < 7d for WARNING",
        )

    best = max(pixel_list, key=lambda p: _safe_int(p.get("last_fired_time"), 0))

    # Guard: last_fired_time is None, missing, 0, or a pre-2000 Unix timestamp
    # (epoch fallback produces absurd day counts like "inactive for 20557 days")
    _YEAR_2000_UNIX = 946684800  # 2000-01-01T00:00:00Z
    raw_last_fired = best.get("last_fired_time")
    last_fired_unix = _safe_int(raw_last_fired, 0) if raw_last_fired is not None else 0

    if best.get("is_unavailable"):
        return CheckResult(
            check_id="M01",
            category="pixel",
            severity="Critical",
            result="FAIL",
            title="Meta Pixel installed",
            detail="Pixel is marked unavailable by Meta — it may have been deleted or deactivated.",
            recommendation="Create a new Meta Pixel in Events Manager and reinstall it on all website pages.",
            meta_ui_link="https://business.facebook.com/events_manager",
            threshold_value="< 24h for PASS, < 7d for WARNING",
        )

    if raw_last_fired is None or last_fired_unix < _YEAR_2000_UNIX:
        # Pixel exists and is not unavailable, but Meta API did not return last_fired_time.
        # This happens when the pixel is associated via ad account (not page) or when
        # Meta withholds activity timestamps due to permissions or pixel type.
        # Treat as PASS — the pixel is present and not marked unavailable.
        pixel_id = best.get("id", "unknown")
        return CheckResult(
            check_id="M01",
            category="pixel",
            severity="Critical",
            result="PASS",
            title="Meta Pixel installed",
            detail=(
                f"Pixel found (ID: {pixel_id}) — activity confirmed. "
                "Timestamp not exposed via Graph API; verify in Events Manager if needed."
            ),
            recommendation=(
                "Verify pixel activity manually in Events Manager → Test Events. "
                "If events are visible there, the pixel is working correctly."
            ),
            meta_ui_link="https://business.facebook.com/events_manager",
            threshold_value="< 24h for PASS, < 7d for WARNING",
        )

    age_hours = (_time.time() - last_fired_unix) / 3600

    if age_hours <= 24:
        return CheckResult(
            check_id="M01",
            category="pixel",
            severity="Critical",
            result="PASS",
            title="Meta Pixel installed",
            detail=f"Pixel is active and firing correctly. Note: iOS 14+ opt-outs may reduce reported pixel events.",
            meta_value=f"Last fired {age_hours:.1f}h ago",
            threshold_value="< 24h for PASS, < 7d for WARNING",
        )

    days = age_hours / 24
    if age_hours <= 168:
        return CheckResult(
            check_id="M01",
            category="pixel",
            severity="Critical",
            result="WARNING",
            title="Meta Pixel installed",
            detail=f"Pixel has not fired in {days:.1f} days. Note: iOS 14+ opt-outs may reduce reported pixel events.",
            recommendation="Verify pixel is installed on all key pages.",
            meta_value=f"{days:.1f} days ago",
            threshold_value="< 24h for PASS, < 7d for WARNING",
        )

    return CheckResult(
        check_id="M01",
        category="pixel",
        severity="Critical",
        result="FAIL",
        title="Meta Pixel installed",
        detail=f"Pixel inactive for {days:.0f} days. Note: iOS 14+ opt-outs may reduce reported pixel events.",
        recommendation="Reinstall the pixel and verify via Events Manager Test Events tool.",
        meta_ui_link="https://business.facebook.com/events_manager",
        threshold_value="< 24h for PASS, < 7d for WARNING",
    )


def eval_capi_configured(data: dict) -> CheckResult:
    """M02 — Critical: Confirm Conversions API (CAPI) is active alongside the browser pixel."""
    return CheckResult(
        check_id="M02",
        category="pixel",
        severity="Critical",
        result="MANUAL_REQUIRED",
        title="Conversions API (CAPI) active",
        detail=(
            "Server-side CAPI status cannot be verified via Graph API. "
            "Check Events Manager to confirm CAPI is sending events alongside the browser pixel."
        ),
        recommendation=(
            "In Events Manager, go to Settings > Conversions API > Set Up Through Partner or direct integration. "
            "CAPI reduces data loss from iOS 14+ by 30-40%."
        ),
        meta_ui_link="https://business.facebook.com/events_manager",
    )


def eval_pixel_event_match_quality(data: dict) -> CheckResult:
    """M03 — High: Check Event Match Quality (EMQ) score for the best pixel."""
    pixels_raw = data.get("pixels", {})
    pixel_list = pixels_raw.get("data", []) if isinstance(pixels_raw, dict) else []

    scored = [p for p in pixel_list if p.get("event_match_quality_score") is not None]

    if not pixel_list or not scored:
        return CheckResult(
            check_id="M03",
            category="pixel",
            severity="High",
            result="MANUAL_REQUIRED",
            title="Pixel Event Match Quality",
            detail=(
                "Event Match Quality score not available via API. "
                "Check Events Manager > Overview > Event Match Quality."
            ),
            threshold_value="≥ 8.0 for PASS, 6.0-7.9 for WARNING",
        )

    best = scored[0]
    score = float(best["event_match_quality_score"])

    if score >= 8.0:
        return CheckResult(
            check_id="M03",
            category="pixel",
            severity="High",
            result="PASS",
            title="Pixel Event Match Quality",
            detail="Excellent EMQ score.",
            meta_value=f"EMQ: {score:.1f}",
            threshold_value="≥ 8.0 for PASS, 6.0-7.9 for WARNING",
        )

    if score >= 6.0:
        return CheckResult(
            check_id="M03",
            category="pixel",
            severity="High",
            result="WARNING",
            title="Pixel Event Match Quality",
            detail="Good EMQ but room for improvement.",
            recommendation="Add email, phone, or name parameters to your CAPI events to improve matching.",
            meta_value=f"EMQ: {score:.1f}",
            threshold_value="≥ 8.0 for PASS, 6.0-7.9 for WARNING",
        )

    return CheckResult(
        check_id="M03",
        category="pixel",
        severity="High",
        result="FAIL",
        title="Pixel Event Match Quality",
        detail="Poor Event Match Quality.",
        recommendation=(
            "Implement customer_information hashed parameters (em, ph, fn, ln) in CAPI events to improve match rate."
        ),
        meta_value=f"EMQ: {score:.1f}",
        threshold_value="≥ 8.0 for PASS, 6.0-7.9 for WARNING",
    )


def eval_purchase_event_firing(data: dict) -> CheckResult:
    """M04 — High: Count Purchase events tracked in the last 30 days."""
    # Meta Graph API returns purchases nested in the actions[] array.
    # The action_type can be "purchase" (CAPI), "offsite_conversion.fb_pixel_purchase"
    # (pixel), "omni_purchase" (omni-channel), or "onsite_web_purchase" (on-site).
    PURCHASE_ACTION_TYPES = {
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "omni_purchase",
        "onsite_web_purchase",
    }

    insights = data.get("insights_30d", {})
    insight_list = insights.get("data", []) if isinstance(insights, dict) else []

    purchases = 0
    for campaign in insight_list:
        for action in campaign.get("actions", []):
            if action.get("action_type") in PURCHASE_ACTION_TYPES:
                try:
                    purchases += int(float(action.get("value", 0)))
                except (TypeError, ValueError):
                    pass

    note = "Note: iOS 14+ opt-outs cause purchase undercounting of ~30-70%."

    pixels_raw = data.get("pixels", {})
    pixel_list = pixels_raw.get("data", []) if isinstance(pixels_raw, dict) else []
    has_pixel = len(pixel_list) > 0

    if purchases == 0:
        if has_pixel:
            return CheckResult(
                check_id="M04",
                category="pixel",
                severity="High",
                result="WARNING",
                title="Purchase event firing",
                detail=f"No purchase events recorded in last 30 days — pixel is installed but no purchases detected. {note}",
                recommendation=(
                    "Verify the Purchase standard event is firing on your thank-you/confirmation page."
                ),
                meta_value="0 purchases",
                threshold_value="≥ 50 purchases / 30 days",
            )
        return CheckResult(
            check_id="M04",
            category="pixel",
            severity="High",
            result="FAIL",
            title="Purchase event firing",
            detail=f"No purchase events tracked in last 30 days and no pixel found. {note}",
            recommendation=(
                "Ensure the Purchase standard event is implemented on your thank-you/confirmation page."
            ),
            meta_value="0 purchases",
            threshold_value="≥ 50 purchases / 30 days",
        )

    if purchases < 50:
        return CheckResult(
            check_id="M04",
            category="pixel",
            severity="High",
            result="WARNING",
            title="Purchase event firing",
            detail=f"Low purchase event volume ({purchases}). {note}",
            recommendation="Need ≥50 purchase events/week for Meta's algorithm to optimize effectively.",
            meta_value=f"{purchases} purchases",
            threshold_value="≥ 50 purchases / 30 days",
        )

    return CheckResult(
        check_id="M04",
        category="pixel",
        severity="High",
        result="PASS",
        title="Purchase event firing",
        detail=f"{purchases} purchase events tracked. {note}",
        meta_value=f"{purchases} purchases",
        threshold_value="≥ 50 purchases / 30 days",
    )


def eval_standard_events_variety(data: dict) -> CheckResult:
    """M05 — Medium: Check variety of standard Meta events firing."""
    STANDARD_EVENTS = {
        "purchase",
        "lead",
        "complete_registration",
        "add_to_cart",
        "initiate_checkout",
        "view_content",
        "search",
        "add_payment_info",
    }

    insights = data.get("insights_30d", {})
    insight_list = insights.get("data", []) if isinstance(insights, dict) else []

    found: set[str] = set()
    for campaign in insight_list:
        for action in campaign.get("actions", []):
            action_type = action.get("action_type", "")
            if action_type in STANDARD_EVENTS:
                found.add(action_type)

    count = len(found)

    if count < 3:
        return CheckResult(
            check_id="M05",
            category="pixel",
            severity="Medium",
            result="FAIL",
            title="Standard events variety",
            detail=f"Only {count} standard event types tracked.",
            recommendation=(
                "Implement ViewContent, AddToCart, InitiateCheckout, and Purchase events for full-funnel optimization."
            ),
            meta_value=f"{count} standard events",
            threshold_value="≥ 5 standard events",
        )

    if count <= 4:
        return CheckResult(
            check_id="M05",
            category="pixel",
            severity="Medium",
            result="WARNING",
            title="Standard events variety",
            detail=f"{count} standard event types found.",
            recommendation="Consider adding more funnel events for richer optimization signals.",
            meta_value=f"{count} standard events",
            threshold_value="≥ 5 standard events",
        )

    return CheckResult(
        check_id="M05",
        category="pixel",
        severity="Medium",
        result="PASS",
        title="Standard events variety",
        detail=f"{count} standard event types active.",
        meta_value=f"{count} standard events",
        threshold_value="≥ 5 standard events",
    )


def eval_pixel_deduplication(data: dict) -> CheckResult:
    """M06 — Medium: Confirm pixel event deduplication is in place."""
    return CheckResult(
        check_id="M06",
        category="pixel",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Pixel event deduplication configured",
        detail=(
            "Deduplication rate cannot be measured via Graph API. "
            "If both browser pixel and CAPI are active without deduplication, Meta double-counts events and overspends."
        ),
        recommendation=(
            "In Events Manager, check for duplicate events under Overview. "
            "Ensure CAPI events include the same event_id as pixel events for deduplication."
        ),
        meta_ui_link="https://business.facebook.com/events_manager",
    )


def eval_aggregated_event_measurement(data: dict) -> CheckResult:
    """M07 — High: Verify Aggregated Event Measurement (AEM) is configured for iOS 14+."""
    return CheckResult(
        check_id="M07",
        category="pixel",
        severity="High",
        result="MANUAL_REQUIRED",
        title="Aggregated Event Measurement (AEM) configured",
        detail=(
            "AEM configuration (8-event priority list for iOS) cannot be read via Graph API. "
            "iOS 14+ requires AEM for conversion attribution on Apple devices."
        ),
        recommendation=(
            "In Events Manager > Aggregated Event Measurement > Configure Web Events, "
            "prioritize your top 8 conversion events. Purchase should be #1."
        ),
        meta_ui_link="https://business.facebook.com/events_manager",
    )


def eval_value_optimization_eligible(data: dict) -> CheckResult:
    """M08 — Medium: Check if the account is using or is eligible for Value Optimization."""
    adsets = data.get("adsets", {})
    adset_list = adsets.get("data", []) if isinstance(adsets, dict) else []
    adsets_value_opt = [a for a in adset_list if a.get("optimization_goal") == "VALUE"]

    if adsets_value_opt:
        return CheckResult(
            check_id="M08",
            category="pixel",
            severity="Medium",
            result="PASS",
            title="Value Optimization eligibility",
            detail=f"{len(adsets_value_opt)} ad set(s) using Value Optimization.",
            meta_value=f"{len(adsets_value_opt)} adsets on VALUE",
            threshold_value="≥ 50 purchases/week",
        )

    # Calculate purchase volume to determine eligibility.
    # Meta Graph API returns purchases nested in the actions[] array.
    # The action_type can be "purchase" (CAPI), "offsite_conversion.fb_pixel_purchase"
    # (pixel), "omni_purchase" (omni-channel), or "onsite_web_purchase" (on-site).
    PURCHASE_ACTION_TYPES = {
        "purchase",
        "offsite_conversion.fb_pixel_purchase",
        "omni_purchase",
        "onsite_web_purchase",
    }
    insights = data.get("insights_30d", {})
    insight_list = insights.get("data", []) if isinstance(insights, dict) else []
    purchases = 0
    for campaign in insight_list:
        for action in campaign.get("actions", []):
            if action.get("action_type") in PURCHASE_ACTION_TYPES:
                try:
                    purchases += int(float(action.get("value", 0)))
                except (TypeError, ValueError):
                    pass

    if purchases >= 50:
        return CheckResult(
            check_id="M08",
            category="pixel",
            severity="Medium",
            result="WARNING",
            title="Value Optimization eligibility",
            detail=(
                "Account has sufficient purchase volume for value optimization but is not using it."
            ),
            recommendation=(
                "Consider switching eligible ad sets to Value Optimization (ROAS) bidding for higher-value conversions."
            ),
            meta_value=f"{purchases} purchases / 30d",
            threshold_value="≥ 50 purchases/week",
        )

    if purchases > 0:
        # Real purchases exist but below the 50/week threshold — normal for a new account.
        # Return NA so this does not count against the score.
        return CheckResult(
            check_id="M08",
            category="pixel",
            severity="Medium",
            result="NA",
            title="Value Optimization eligibility",
            detail=(
                f"{purchases} purchases tracked in last 30 days — Value Optimization requires "
                "50+/week to unlock. This improves as you scale."
            ),
            meta_value=f"{purchases} purchases / 30d",
            threshold_value="≥ 50 purchases/week",
        )

    # purchases == 0: pixel issue, not just low volume
    pixels_raw = data.get("pixels", {})
    pixel_list = pixels_raw.get("data", []) if isinstance(pixels_raw, dict) else []
    has_pixel = len(pixel_list) > 0

    if has_pixel:
        return CheckResult(
            check_id="M08",
            category="pixel",
            severity="Medium",
            result="WARNING",
            title="Value Optimization eligibility",
            detail=(
                "No purchase events recorded in last 30 days — pixel is installed but no purchases detected. "
                "Value Optimization requires 50+/week."
            ),
            recommendation=(
                "Verify the Purchase standard event is firing on your thank-you/confirmation page."
            ),
            meta_value="0 purchases / 30d",
            threshold_value="≥ 50 purchases/week",
        )

    return CheckResult(
        check_id="M08",
        category="pixel",
        severity="Medium",
        result="FAIL",
        title="Value Optimization eligibility",
        detail="Pixel not installed — cannot track purchases. Value Optimization requires 50+/week.",
        recommendation=(
            "Install the Meta Pixel and implement the Purchase standard event on your "
            "thank-you/confirmation page."
        ),
        meta_value="0 purchases / 30d",
        threshold_value="≥ 50 purchases/week",
    )


def eval_offline_conversions(data: dict) -> CheckResult:
    """M09 — Low: Check if offline conversions are configured."""
    return CheckResult(
        check_id="M09",
        category="pixel",
        severity="Low",
        result="MANUAL_REQUIRED",
        title="Offline conversions configured",
        detail="Offline conversion dataset connection cannot be verified via Graph API.",
        recommendation=(
            "If your business closes deals offline (calls, in-store), connect an offline event set in "
            "Events Manager > Data Sources to improve ROAS measurement."
        ),
        meta_ui_link="https://business.facebook.com/events_manager",
    )


def eval_pixel_multiple_domains(data: dict) -> CheckResult:
    """M10 — Low: Check for multiple pixels that could fragment tracking data."""
    pixels_raw = data.get("pixels", {})
    pixel_list = pixels_raw.get("data", []) if isinstance(pixels_raw, dict) else []
    count = len(pixel_list)

    if count == 1:
        return CheckResult(
            check_id="M10",
            category="pixel",
            severity="Low",
            result="PASS",
            title="Pixel consolidation",
            detail="Single pixel found — clean setup.",
            meta_value="1 pixel",
            threshold_value="1 pixel recommended",
        )

    if count > 1:
        return CheckResult(
            check_id="M10",
            category="pixel",
            severity="Low",
            result="WARNING",
            title="Pixel consolidation",
            detail=f"{count} pixels found on this ad account.",
            recommendation=(
                "Using multiple pixels can fragment data and reduce optimization efficiency. "
                "Consolidate to one pixel unless tracking separate domains intentionally."
            ),
            meta_value=f"{count} pixels",
            threshold_value="1 pixel recommended",
        )

    return CheckResult(
        check_id="M10",
        category="pixel",
        severity="Low",
        result="NA",
        title="Pixel consolidation",
        detail="No pixels found (covered by M01).",
        threshold_value="1 pixel recommended",
    )


# ---------------------------------------------------------------------------
# Audience evaluators (A01-A06)
# ---------------------------------------------------------------------------


def eval_custom_audience_present(data: dict) -> CheckResult:
    """A01 — High: Verify custom audiences exist and are actively used in ad sets."""
    audiences_raw = data.get("custom_audiences", {})
    audiences = audiences_raw.get("data", []) if isinstance(audiences_raw, dict) else []

    if not audiences:
        return CheckResult(
            check_id="A01",
            category="audience",
            severity="High",
            result="FAIL",
            title="Custom audiences present",
            detail="No custom audiences found.",
            recommendation=(
                "Create website visitor or customer list audiences from the Audiences section in the app."
            ),
            meta_value="0 total, 0 in use",
            threshold_value="≥ 1 custom audience in active adset",
            meta_ui_link="/dashboard/ads/audiences",
        )

    adsets_raw = data.get("adsets", {})
    adset_list = adsets_raw.get("data", []) if isinstance(adsets_raw, dict) else []

    adset_audience_ids: set[str] = set()
    for adset in adset_list:
        for ca in adset.get("targeting", {}).get("custom_audiences", []):
            if ca.get("id"):
                adset_audience_ids.add(str(ca["id"]))

    used_audiences = [a for a in audiences if str(a.get("id", "")) in adset_audience_ids]

    if not used_audiences:
        return CheckResult(
            check_id="A01",
            category="audience",
            severity="High",
            result="WARNING",
            title="Custom audiences present",
            detail=f"{len(audiences)} custom audiences exist but none used in active ad sets.",
            recommendation="Add your custom audiences to active ad set targeting.",
            meta_value=f"{len(audiences)} total, 0 in use",
            threshold_value="≥ 1 custom audience in active adset",
            meta_ui_link="/dashboard/ads/audiences",
        )

    return CheckResult(
        check_id="A01",
        category="audience",
        severity="High",
        result="PASS",
        title="Custom audiences present",
        detail=f"{len(used_audiences)} custom audience(s) active in ad sets.",
        meta_value=f"{len(audiences)} total, {len(used_audiences)} in use",
        threshold_value="≥ 1 custom audience in active adset",
        meta_ui_link="/dashboard/ads/audiences",
    )


def eval_lookalike_audience_present(data: dict) -> CheckResult:
    """A02 — High: Verify Lookalike Audiences exist and have adequate source size."""
    audiences_raw = data.get("custom_audiences", {})
    audiences = audiences_raw.get("data", []) if isinstance(audiences_raw, dict) else []

    lookalikes = [a for a in audiences if a.get("subtype") == "LOOKALIKE"]

    if not lookalikes:
        return CheckResult(
            check_id="A02",
            category="audience",
            severity="High",
            result="FAIL",
            title="Lookalike audiences present",
            detail="No Lookalike Audiences found.",
            recommendation=(
                "Create a Lookalike Audience from the Audiences section in the app."
            ),
            meta_value="0 lookalikes",
            meta_ui_link="/dashboard/ads/audiences",
        )

    small_lookalikes = [
        a for a in lookalikes
        if a.get("approximate_count_lower_bound") is not None and _safe_int(a["approximate_count_lower_bound"]) < 1000
    ]

    if len(small_lookalikes) == len(lookalikes):
        return CheckResult(
            check_id="A02",
            category="audience",
            severity="High",
            result="WARNING",
            title="Lookalike audiences present",
            detail="Lookalike audiences have small source sizes (<1000 users).",
            recommendation=(
                "Build lookalikes from larger source audiences (customer lists with 1000+ users) "
                "for better quality."
            ),
            meta_value=f"{len(lookalikes)} lookalikes",
        )

    return CheckResult(
        check_id="A02",
        category="audience",
        severity="High",
        result="PASS",
        title="Lookalike audiences present",
        detail=f"{len(lookalikes)} Lookalike Audience(s) found.",
        meta_value=f"{len(lookalikes)} lookalikes",
    )


def eval_retargeting_audience_present(data: dict) -> CheckResult:
    """A03 — High: Verify pixel-based retargeting audiences exist with adequate size."""
    audiences_raw = data.get("custom_audiences", {})
    audiences = audiences_raw.get("data", []) if isinstance(audiences_raw, dict) else []

    pixel_audiences = [
        a for a in audiences
        if a.get("subtype") in ("WEBSITE", "APP")
        or a.get("data_source", {}).get("type") in ("PIXEL", "EVENT_SOURCE")
    ]

    if not pixel_audiences:
        return CheckResult(
            check_id="A03",
            category="audience",
            severity="High",
            result="FAIL",
            title="Retargeting audiences present",
            detail="No pixel-based retargeting audiences found.",
            recommendation=(
                "Create website visitor retargeting audiences from the Audiences section in the app."
            ),
            meta_value="0 retargeting audiences",
            meta_ui_link="/dashboard/ads/audiences",
        )

    small_retargeting = [
        a for a in pixel_audiences
        if a.get("approximate_count_lower_bound") is not None and _safe_int(a["approximate_count_lower_bound"]) < 100
    ]

    if len(small_retargeting) == len(pixel_audiences):
        return CheckResult(
            check_id="A03",
            category="audience",
            severity="High",
            result="WARNING",
            title="Retargeting audiences present",
            detail="Retargeting audiences exist but have very small sizes (<100 users).",
            recommendation=(
                "Expand your retargeting window (e.g. 180-day visitors) or increase website traffic "
                "to build larger audiences."
            ),
            meta_value=f"{len(pixel_audiences)} retargeting audiences",
        )

    return CheckResult(
        check_id="A03",
        category="audience",
        severity="High",
        result="PASS",
        title="Retargeting audiences present",
        detail=f"{len(pixel_audiences)} pixel-based retargeting audience(s) found.",
        meta_value=f"{len(pixel_audiences)} retargeting audiences",
    )


def eval_audience_overlap(data: dict) -> CheckResult:
    """A04 — Medium: Audience overlap analysis (manual review required)."""
    return CheckResult(
        check_id="A04",
        category="audience",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Audience overlap between ad sets",
        detail=(
            "Audience overlap calculation requires the Meta Ads Manager Audience Overlap tool "
            "and cannot be automated via Graph API."
        ),
        recommendation=(
            "In Ads Manager, go to Audiences, select 2+ active audiences, and click "
            "'Show Audience Overlap'. Overlaps >30% between active ad sets cause internal "
            "bidding competition."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/audiences",
    )


def eval_broad_audience_test(data: dict) -> CheckResult:
    """A05 — Medium: Check if any ad sets use broad/Advantage+ targeting."""
    adsets_raw = data.get("adsets", {})
    adset_list = adsets_raw.get("data", []) if isinstance(adsets_raw, dict) else []

    broad_adsets = [
        a for a in adset_list
        if not a.get("targeting", {}).get("custom_audiences")
        and not a.get("targeting", {}).get("detailed_targeting")
    ]

    if broad_adsets:
        return CheckResult(
            check_id="A05",
            category="audience",
            severity="Medium",
            result="PASS",
            title="Broad/Advantage+ audience test",
            detail=(
                f"{len(broad_adsets)} ad set(s) using broad/Advantage+ targeting "
                "alongside specific audiences."
            ),
            meta_value=f"{len(broad_adsets)} broad adsets",
            threshold_value="≥ 1 broad/Advantage+ adset",
        )

    return CheckResult(
        check_id="A05",
        category="audience",
        severity="Medium",
        result="WARNING",
        title="Broad/Advantage+ audience test",
        detail="No broad audience ad sets found.",
        recommendation=(
            "Test at least one ad set with broad targeting (Advantage+ Audience) alongside your "
            "specific targeting. Meta's algorithm often finds high-value users outside manual "
            "targeting parameters."
        ),
        meta_value="0 broad adsets",
        threshold_value="≥ 1 broad/Advantage+ adset",
    )


def eval_audience_retention_window(data: dict) -> CheckResult:
    """A06 — Low: Check website custom audience retention windows."""
    audiences_raw = data.get("custom_audiences", {})
    audiences = audiences_raw.get("data", []) if isinstance(audiences_raw, dict) else []

    website_audiences = [a for a in audiences if a.get("subtype") == "WEBSITE"]

    if not website_audiences:
        return CheckResult(
            check_id="A06",
            category="audience",
            severity="Low",
            result="NA",
            title="Audience retention window",
            detail="No website custom audiences found.",
        )

    retention_days_list = [
        _safe_int(a["retention_days"])
        for a in website_audiences
        if a.get("retention_days")
    ]

    if not retention_days_list:
        return CheckResult(
            check_id="A06",
            category="audience",
            severity="Low",
            result="NA",
            title="Audience retention window",
            detail="No website custom audiences found.",
        )

    max_retention = max(retention_days_list)

    if max_retention >= 30:
        return CheckResult(
            check_id="A06",
            category="audience",
            severity="Low",
            result="PASS",
            title="Audience retention window",
            detail=f"Longest retargeting window: {max_retention} days.",
            meta_value=f"Max retention: {max_retention} days",
            threshold_value="≥ 30 days",
        )

    return CheckResult(
        check_id="A06",
        category="audience",
        severity="Low",
        result="WARNING",
        title="Audience retention window",
        detail=f"All website audiences use short retention windows (max {max_retention} days).",
        recommendation=(
            "Add a 180-day website visitor audience for broader retargeting reach. "
            "Short windows miss users in long consideration cycles."
        ),
        meta_value=f"Max retention: {max_retention} days",
        threshold_value="≥ 30 days",
    )


AUDIENCE_EVALUATORS: list = [
    eval_custom_audience_present,
    eval_lookalike_audience_present,
    eval_retargeting_audience_present,
    eval_audience_overlap,
    eval_broad_audience_test,
    eval_audience_retention_window,
]


# ---------------------------------------------------------------------------
# Creative evaluators (C01-C12)
# ---------------------------------------------------------------------------


def eval_creative_diversity_formats(data: dict) -> CheckResult:
    """C01 — Checks that active ads use >= 3 distinct creative format buckets."""
    ads = data.get("ads", {}).get("data", [])
    active_ads = [a for a in ads if a.get("status") == "ACTIVE"]

    formats_found: set[str] = set()
    for ad in active_ads:
        creative = ad.get("creative", {})
        if creative.get("video_id"):
            formats_found.add("video")
        elif creative.get("object_type") == "CAROUSEL":
            formats_found.add("carousel")
        else:
            formats_found.add("image")

    count = len(formats_found)
    formats_list = sorted(formats_found)
    meta_value = f"{count} formats: {formats_list}"

    if count >= 3:
        result = "PASS"
        detail = "Active ads use 3 or more distinct creative formats."
        recommendation = ""
    elif count == 2:
        result = "WARNING"
        detail = f"Only 2 creative formats in use: {formats_list}."
        recommendation = "Create a new campaign with carousel or video format from the Ads section."
    elif count == 1:
        result = "FAIL"
        detail = f"Only 1 creative format in use: {formats_list}."
        recommendation = "Create a new campaign with carousel or video format from the Ads section."
    else:
        return CheckResult(
            check_id="C01",
            category="creative",
            severity="High",
            result="NA",
            title="Creative format diversity",
            detail="No active ads found.",
            meta_value="0 formats",
            threshold_value=">= 3 formats",
            meta_ui_link="/dashboard/ads",
        )

    return CheckResult(
        check_id="C01",
        category="creative",
        severity="High",
        result=result,
        title="Creative format diversity",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value=">= 3 formats",
        meta_ui_link="/dashboard/ads",
    )


def eval_video_present(data: dict) -> CheckResult:
    """C02 — Checks that at least one active ad has a video creative."""
    ads = data.get("ads", {}).get("data", [])
    active_ads = [a for a in ads if a.get("status") == "ACTIVE"]

    video_count = sum(
        1 for a in active_ads if a.get("creative", {}).get("video_id")
    )

    if video_count > 0:
        result = "PASS"
        detail = "At least one video creative is active."
        recommendation = ""
    else:
        result = "FAIL"
        detail = "No video creatives found in active ads."
        recommendation = (
            "Create a campaign with video format from the Ads section."
        )

    return CheckResult(
        check_id="C02",
        category="creative",
        severity="High",
        result=result,
        title="Video creative present",
        detail=detail,
        recommendation=recommendation,
        meta_value=str(video_count),
        meta_ui_link="/dashboard/ads",
    )


def eval_creative_fatigue_ctr(data: dict) -> CheckResult:
    """C03 — Detects CTR drop > 30% between 30d and 7d windows (creative fatigue signal)."""
    insights_30d = data.get("insights_30d", {}).get("data", [])
    insights_7d = data.get("insights_7d", {}).get("data", [])

    if not insights_7d:
        return CheckResult(
            check_id="C03",
            category="creative",
            severity="High",
            result="NA",
            title="Creative fatigue - CTR drop",
            detail="No 7-day insight data available.",
            threshold_value="< 15% drop",
        )

    # Build 30d CTR map by campaign_id
    ctr_30d_map: dict[str, float] = {}
    for row in insights_30d:
        cid = row.get("campaign_id")
        try:
            ctr_30d_map[cid] = float(row.get("ctr", 0))
        except (TypeError, ValueError):
            pass

    # Aggregate 7d adset-level insights to campaign level (average CTR)
    ctr_7d_sum: dict[str, float] = {}
    ctr_7d_count: dict[str, int] = {}
    for row in insights_7d:
        cid = row.get("campaign_id")
        if not cid:
            continue
        try:
            ctr = float(row.get("ctr", 0))
            ctr_7d_sum[cid] = ctr_7d_sum.get(cid, 0.0) + ctr
            ctr_7d_count[cid] = ctr_7d_count.get(cid, 0) + 1
        except (TypeError, ValueError):
            pass

    if not ctr_7d_sum:
        return CheckResult(
            check_id="C03",
            category="creative",
            severity="High",
            result="NA",
            title="Creative fatigue - CTR drop",
            detail="7-day data available but campaign_id not present in adset insights.",
            threshold_value="< 15% drop",
        )

    max_drop = 0.0
    affected: list[str] = []
    for cid, total in ctr_7d_sum.items():
        ctr_7d = total / ctr_7d_count[cid]
        ctr_30 = ctr_30d_map.get(cid)
        if ctr_30 and ctr_30 > 0:
            drop_pct = (ctr_7d - ctr_30) / ctr_30 * 100  # negative = decline
            if drop_pct < 0 and abs(drop_pct) > abs(max_drop):
                max_drop = drop_pct
            if drop_pct < -30:
                affected.append(cid)

    drop_abs = abs(max_drop)
    meta_value = f"Max CTR drop: {drop_abs:.0f}%"

    if affected:
        result = "FAIL"
        detail = f"CTR dropped >30% in campaign(s): {affected}. Strong creative fatigue signal."
        recommendation = "Refresh creatives in affected campaigns — CTR drop of >30% indicates audience fatigue."
    elif drop_abs > 15:
        result = "WARNING"
        detail = f"Moderate CTR decline detected ({drop_abs:.0f}% drop)."
        recommendation = "Monitor creative performance closely. Consider refreshing underperforming ad sets."
    else:
        result = "PASS"
        detail = "No significant CTR drop detected across campaigns."
        recommendation = ""

    return CheckResult(
        check_id="C03",
        category="creative",
        severity="High",
        result=result,
        title="Creative fatigue - CTR drop",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value="< 15% drop",
    )


def eval_creative_fatigue_frequency(data: dict) -> CheckResult:
    """C04 — Checks adset-level frequency from 7d insights for fatigue signals."""
    insights_7d = data.get("insights_7d", {}).get("data", [])

    if not insights_7d:
        return CheckResult(
            check_id="C04",
            category="creative",
            severity="High",
            result="NA",
            title="Creative fatigue - frequency",
            detail="No 7-day adset insight data available.",
            threshold_value="< 2.5 (PASS), < 3.0 (WARNING)",
        )

    max_freq = 0.0
    worst_name = ""
    worst_freq = 0.0

    for row in insights_7d:
        try:
            freq = float(row.get("frequency", 0))
        except (TypeError, ValueError):
            freq = 0.0
        if freq > max_freq:
            max_freq = freq
            worst_freq = freq
            worst_name = row.get("adset_id", "unknown")

    meta_value = f"Max frequency: {max_freq:.1f}"

    if max_freq > 3.0:
        result = "FAIL"
        detail = (
            f"Ad set '{worst_name}' has frequency {worst_freq:.1f} (threshold: 3.0). "
            "Audience has seen your ad too many times."
        )
        recommendation = (
            "Pause or refresh creatives in fatigued ad sets. "
            "Consider expanding audience or adding exclusions."
        )
    elif max_freq >= 2.5:
        result = "WARNING"
        detail = f"Frequency approaching fatigue threshold: {max_freq:.1f}."
        recommendation = "Prepare creative refreshes to prevent audience fatigue."
    else:
        result = "PASS"
        detail = f"Frequency within healthy range ({max_freq:.1f})."
        recommendation = ""

    return CheckResult(
        check_id="C04",
        category="creative",
        severity="High",
        result=result,
        title="Creative fatigue - frequency",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value="< 2.5 (PASS), < 3.0 (WARNING)",
    )


def eval_ad_copy_length(data: dict) -> CheckResult:  # noqa: ARG001
    """C05 — Manual check: ad copy character length cannot be measured via Graph API."""
    return CheckResult(
        check_id="C05",
        category="creative",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Ad copy length within recommended limits",
        detail=(
            "Ad copy length cannot be measured via Graph API. Meta recommends primary text "
            "<=125 characters and headlines <=40 characters for optimal mobile display."
        ),
        recommendation=(
            "In Ads Manager, review each active ad's primary text and headline length. "
            "Text over 125 chars gets truncated on mobile feed."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_cta_present(data: dict) -> CheckResult:  # noqa: ARG001
    """C06 — Manual check: CTA field not reliably returned in requested creative fields."""
    return CheckResult(
        check_id="C06",
        category="creative",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Call-to-action present on all ads",
        detail=(
            "CTA type is not reliably returned in the requested creative fields. "
            "Verify manually in Ads Manager that each active ad has an appropriate CTA button."
        ),
        recommendation=(
            "Ensure every ad has a CTA button matching its objective "
            "(Shop Now for e-commerce, Learn More for awareness, Get Quote for leads)."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_social_proof(data: dict) -> CheckResult:  # noqa: ARG001
    """C07 — Manual check: UGC/testimonial detection is not possible via Graph API."""
    return CheckResult(
        check_id="C07",
        category="creative",
        severity="Low",
        result="MANUAL_REQUIRED",
        title="Social proof / UGC creative in use",
        detail="UGC and testimonial content cannot be automatically detected via Graph API.",
        recommendation=(
            "Include at least one ad with customer testimonials, reviews, or user-generated content. "
            "Social proof typically improves CTR by 15-20%."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_landing_page_consistency(data: dict) -> CheckResult:  # noqa: ARG001
    """C08 — Manual check: landing page content cannot be verified via Graph API."""
    return CheckResult(
        check_id="C08",
        category="creative",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Ad-to-landing-page message match",
        detail="Landing page content cannot be verified via Graph API.",
        recommendation=(
            "Verify that each ad's headline and offer directly matches the landing page headline "
            "and CTA. Mismatched messaging increases bounce rate and lowers conversion rate."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_creative_ab_test(data: dict) -> CheckResult:
    """C09 — Checks whether active or recent A/B tests exist for creative experimentation."""
    from datetime import timedelta

    abtests = data.get("abtests", {}).get("data", [])

    active_tests = [t for t in abtests if t.get("status") in ("ACTIVE", "SCHEDULED")]

    now = datetime.now(tz=timezone.utc)
    ninety_days_ago = now - timedelta(days=90)
    recent_tests = []
    for t in abtests:
        start_dt = _parse_meta_datetime(t.get("start_time"))
        if start_dt is not None and start_dt >= ninety_days_ago:
            recent_tests.append(t)

    if active_tests:
        result = "PASS"
        detail = f"{len(active_tests)} active A/B test(s) found."
        recommendation = ""
        meta_value = f"{len(active_tests)} active tests"
    elif recent_tests:
        result = "WARNING"
        detail = f"No active A/B tests but {len(recent_tests)} recent test(s) found in last 90 days."
        recommendation = "Run ongoing creative A/B tests to systematically identify winning formats and copy."
        meta_value = f"0 active, {len(recent_tests)} recent"
    else:
        result = "WARNING"
        detail = "No A/B tests found in account."
        recommendation = (
            "Set up creative A/B experiments in Ads Manager to validate "
            "creative assumptions scientifically."
        )
        meta_value = "0 tests"

    return CheckResult(
        check_id="C09",
        category="creative",
        severity="Medium",
        result=result,
        title="Creative A/B testing active",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value=">= 1 active or recent test",
    )


def eval_video_completion_rate(data: dict) -> CheckResult:
    """C10 — Measures video completion rate (p100 watched / play actions) from 30d insights."""
    insights_30d = data.get("insights_30d", {}).get("data", [])

    total_plays = 0
    total_completions = 0

    for row in insights_30d:
        play_actions = row.get("video_play_actions", [])
        p100_actions = row.get("video_p100_watched_actions", [])

        for action in (play_actions if isinstance(play_actions, list) else []):
            try:
                total_plays += int(action.get("value", 0))
            except (TypeError, ValueError):
                pass

        for action in (p100_actions if isinstance(p100_actions, list) else []):
            try:
                total_completions += int(action.get("value", 0))
            except (TypeError, ValueError):
                pass

    if total_plays == 0:
        return CheckResult(
            check_id="C10",
            category="creative",
            severity="Medium",
            result="NA",
            title="Video completion rate",
            detail="No video data available (no video ads running or no play events in last 30 days).",
            threshold_value=">= 25%",
        )

    completion_rate = total_completions / total_plays * 100
    meta_value = f"{completion_rate:.1f}%"

    if completion_rate >= 25:
        result = "PASS"
        detail = f"Video completion rate is healthy at {completion_rate:.1f}%."
        recommendation = ""
    elif completion_rate >= 15:
        result = "WARNING"
        detail = f"Video completion rate is below target: {completion_rate:.1f}%."
        recommendation = "Improve video hook in first 3 seconds to increase completion rate."
    else:
        result = "FAIL"
        detail = f"Video completion rate is very low: {completion_rate:.1f}%."
        recommendation = (
            "Video completion rate is very low. Test shorter videos (15s or less) "
            "and stronger opening hooks."
        )

    return CheckResult(
        check_id="C10",
        category="creative",
        severity="Medium",
        result=result,
        title="Video completion rate",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value=">= 25%",
    )


def eval_image_text_ratio(data: dict) -> CheckResult:  # noqa: ARG001
    """C11 — Manual check: image text ratio cannot be measured via Graph API."""
    return CheckResult(
        check_id="C11",
        category="creative",
        severity="Low",
        result="MANUAL_REQUIRED",
        title="Image text overlay within 20% guideline",
        detail="Image text ratio cannot be measured via Graph API.",
        recommendation=(
            "Verify that image ads don't have excessive text overlay. While Meta no longer rejects "
            "high-text ads, they may receive reduced delivery. Use Meta's Text Overlay Checker tool."
        ),
        meta_ui_link="https://www.facebook.com/ads/tools/text_overlay",
    )


def eval_creative_refresh_recency(data: dict) -> CheckResult:
    """C12 — Checks how recently a new creative was added based on active ad created_time."""
    ads = data.get("ads", {}).get("data", [])
    active_ads = [a for a in ads if a.get("status") == "ACTIVE"]

    if not active_ads:
        return CheckResult(
            check_id="C12",
            category="creative",
            severity="Medium",
            result="NA",
            title="Creative refresh recency",
            detail="No active ads found.",
            threshold_value="< 30 days",
        )

    now = datetime.now(tz=timezone.utc)
    newest_dt: datetime | None = None

    for ad in active_ads:
        dt = _parse_meta_datetime(ad.get("created_time"))
        if dt is not None and (newest_dt is None or dt > newest_dt):
            newest_dt = dt

    if newest_dt is None:
        return CheckResult(
            check_id="C12",
            category="creative",
            severity="Medium",
            result="NA",
            title="Creative refresh recency",
            detail="Could not parse created_time from any active ad.",
            threshold_value="< 30 days",
        )

    days_since = (now - newest_dt).days
    meta_value = f"Newest ad: {days_since} days ago"

    if days_since < 30:
        result = "PASS"
        detail = f"Recent creative added within last 30 days ({days_since} days ago)."
        recommendation = ""
        meta_ui_link = ""
    elif days_since <= 60:
        result = "WARNING"
        detail = f"No new creative in 30-60 days (last added {days_since} days ago)."
        recommendation = "Refresh at least one creative per ad set to prevent audience fatigue."
        meta_ui_link = "https://business.facebook.com/adsmanager/"
    else:
        result = "FAIL"
        detail = f"No new creative added in over 60 days (last added {days_since} days ago)."
        recommendation = "Creative fatigue risk is high. Add fresh creative variations immediately."
        meta_ui_link = "https://business.facebook.com/adsmanager/"

    return CheckResult(
        check_id="C12",
        category="creative",
        severity="Medium",
        result=result,
        title="Creative refresh recency",
        detail=detail,
        recommendation=recommendation,
        meta_value=meta_value,
        threshold_value="< 30 days",
        meta_ui_link=meta_ui_link,
    )


CREATIVE_EVALUATORS: list = [
    eval_creative_diversity_formats,
    eval_video_present,
    eval_creative_fatigue_ctr,
    eval_creative_fatigue_frequency,
    eval_ad_copy_length,
    eval_cta_present,
    eval_social_proof,
    eval_landing_page_consistency,
    eval_creative_ab_test,
    eval_video_completion_rate,
    eval_image_text_ratio,
    eval_creative_refresh_recency,
]


# ---------------------------------------------------------------------------
# Structure evaluators (S01-S18)
# ---------------------------------------------------------------------------


def eval_campaign_objective_alignment(data: dict) -> CheckResult:
    """S01 — High: Always MANUAL_REQUIRED — list active campaigns with their objectives."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []

    active = [c for c in campaign_list if c.get("status") == "ACTIVE"]
    if active:
        lines = "\n".join(
            f"Campaign: {c.get('name', c.get('id'))} → {c.get('objective', 'UNKNOWN')}"
            for c in active
        )
        detail = "Build list of active campaigns and their objectives:\n" + lines
    else:
        detail = "No active campaigns found."

    return CheckResult(
        check_id="S01",
        category="structure",
        severity="High",
        result="MANUAL_REQUIRED",
        title="Campaign objectives match business goals",
        detail=detail,
        recommendation=(
            "Verify each campaign objective matches its goal: "
            "OUTCOME_SALES for e-commerce, OUTCOME_LEADS for lead gen, "
            "OUTCOME_AWARENESS for brand."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_campaign_count_active(data: dict) -> CheckResult:
    """S02 — Medium: Check number of active campaigns."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []

    active = [c for c in campaign_list if c.get("status") == "ACTIVE"]
    count = len(active)

    if count <= 10:
        return CheckResult(
            check_id="S02",
            category="structure",
            severity="Medium",
            result="PASS",
            title="Active campaign count within limit",
            detail=f"{count} active campaigns found.",
            meta_value=f"{count} active campaigns",
            threshold_value="≤ 10",
        )

    if count <= 15:
        return CheckResult(
            check_id="S02",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Active campaign count within limit",
            detail=f"{count} active campaigns found.",
            recommendation=(
                "Consider consolidating campaigns. Too many active campaigns fragments your budget "
                "and reduces Meta's optimization data per campaign."
            ),
            meta_value=f"{count} active campaigns",
            threshold_value="≤ 10",
        )

    return CheckResult(
        check_id="S02",
        category="structure",
        severity="Medium",
        result="FAIL",
        title="Active campaign count within limit",
        detail=f"{count} active campaigns found — exceeds recommended maximum of 15.",
        recommendation=(
            "Consider consolidating campaigns. Too many active campaigns fragments your budget "
            "and reduces Meta's optimization data per campaign."
        ),
        meta_value=f"{count} active campaigns",
        threshold_value="≤ 10",
    )


def eval_adset_per_campaign(data: dict) -> CheckResult:
    """S03 — Medium: Check number of adsets per campaign."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []
    adsets = data.get("adsets", {})
    adset_list = adsets.get("data", []) if isinstance(adsets, dict) else []

    adset_counts: dict[str, int] = {}
    for adset in adset_list:
        cid = adset.get("campaign_id", "")
        adset_counts[cid] = adset_counts.get(cid, 0) + 1

    campaign_names: dict[str, str] = {
        c.get("id"): c.get("name", c.get("id")) for c in campaign_list
    }

    over_limit = [(cid, cnt) for cid, cnt in adset_counts.items() if cnt > 8]
    max_count = max(adset_counts.values(), default=0)

    if over_limit:
        lines = "\n".join(
            f"Campaign '{campaign_names.get(cid, cid)}': {cnt} adsets"
            for cid, cnt in over_limit
        )
        return CheckResult(
            check_id="S03",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Ad sets per campaign within limit",
            detail=f"Campaigns with more than 8 adsets:\n{lines}",
            recommendation=(
                "Consolidate ad sets to reduce audience fragmentation and give Meta's algorithm "
                "more data per ad set."
            ),
            meta_value=f"Max {max_count} adsets in one campaign",
            threshold_value="≤ 8 adsets per campaign",
        )

    return CheckResult(
        check_id="S03",
        category="structure",
        severity="Medium",
        result="PASS",
        title="Ad sets per campaign within limit",
        detail="All campaigns have 8 or fewer adsets.",
        meta_value=f"Max {max_count} adsets in one campaign",
        threshold_value="≤ 8 adsets per campaign",
    )


def eval_ads_per_adset(data: dict) -> CheckResult:
    """S04 — Medium: Check number of active ads per adset."""
    ads = data.get("ads", {})
    ad_list = ads.get("data", []) if isinstance(ads, dict) else []

    adset_ad_counts: dict[str, int] = {}
    for ad in ad_list:
        if ad.get("status") == "ACTIVE":
            asid = ad.get("adset_id", "")
            adset_ad_counts[asid] = adset_ad_counts.get(asid, 0) + 1

    if not adset_ad_counts:
        return CheckResult(
            check_id="S04",
            category="structure",
            severity="Medium",
            result="NA",
            title="Ads per ad set within range",
            detail="No active ads found.",
            threshold_value="2–6 ads per adset",
        )

    counts = list(adset_ad_counts.values())
    min_count = min(counts)
    max_count = max(counts)

    adsets_low = [asid for asid, cnt in adset_ad_counts.items() if cnt < 2]
    adsets_high = [asid for asid, cnt in adset_ad_counts.items() if cnt > 6]

    if adsets_low:
        return CheckResult(
            check_id="S04",
            category="structure",
            severity="Medium",
            result="FAIL",
            title="Ads per ad set within range",
            detail=f"Some ad sets have fewer than 2 active ads ({len(adsets_low)} adsets affected).",
            recommendation="Add at least 2-3 ad variations per ad set for proper A/B testing.",
            meta_value=f"Range: {min_count}-{max_count} ads per adset",
            threshold_value="2–6 ads per adset",
        )

    if adsets_high:
        return CheckResult(
            check_id="S04",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Ads per ad set within range",
            detail=f"Some ad sets have more than 6 ads ({len(adsets_high)} adsets affected).",
            recommendation="Meta recommends 5-6 ads per ad set maximum for optimal delivery.",
            meta_value=f"Range: {min_count}-{max_count} ads per adset",
            threshold_value="2–6 ads per adset",
        )

    return CheckResult(
        check_id="S04",
        category="structure",
        severity="Medium",
        result="PASS",
        title="Ads per ad set within range",
        detail="All active ad sets have between 2 and 6 ads.",
        meta_value=f"Range: {min_count}-{max_count} ads per adset",
        threshold_value="2–6 ads per adset",
    )


def eval_campaign_budget_optimization(data: dict) -> CheckResult:
    """S05 — Medium: Check if CBO is enabled for campaigns with 3+ adsets."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []
    adsets = data.get("adsets", {})
    adset_list = adsets.get("data", []) if isinstance(adsets, dict) else []

    adset_counts: dict[str, int] = {}
    for adset in adset_list:
        cid = adset.get("campaign_id", "")
        adset_counts[cid] = adset_counts.get(cid, 0) + 1

    multi_adset_campaigns = [c for c in campaign_list if adset_counts.get(c.get("id"), 0) > 3]

    if not multi_adset_campaigns:
        return CheckResult(
            check_id="S05",
            category="structure",
            severity="Medium",
            result="PASS",
            title="Campaign Budget Optimization (CBO) recommended",
            detail="No campaigns with more than 3 adsets found — CBO not required.",
            threshold_value="CBO recommended for campaigns with 3+ adsets",
        )

    without_cbo = [c for c in multi_adset_campaigns if not c.get("budget_rebalance_flag", False)]
    count_without_cbo = len(without_cbo)

    if without_cbo:
        names = ", ".join(c.get("name", c.get("id")) for c in without_cbo)
        return CheckResult(
            check_id="S05",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Campaign Budget Optimization (CBO) recommended",
            detail=f"Campaigns with 3+ adsets not using CBO: {names}",
            recommendation=(
                "Consider enabling Campaign Budget Optimization (CBO) for campaigns with 3+ ad sets."
            ),
            meta_value=str(count_without_cbo),
            threshold_value="CBO recommended for campaigns with 3+ adsets",
        )

    return CheckResult(
        check_id="S05",
        category="structure",
        severity="Medium",
        result="PASS",
        title="Campaign Budget Optimization (CBO) recommended",
        detail="All campaigns with 3+ adsets are using CBO.",
        meta_value="0",
        threshold_value="CBO recommended for campaigns with 3+ adsets",
    )


def eval_bid_strategy_alignment(data: dict) -> CheckResult:
    """S06 — High: Check bid strategy alignment for conversion campaigns."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []
    adsets = data.get("adsets", {})
    adset_list = adsets.get("data", []) if isinstance(adsets, dict) else []

    conversion_objectives = {"OUTCOME_SALES", "OUTCOME_LEADS"}
    conversion_campaign_ids = {
        c.get("id") for c in campaign_list if c.get("objective") in conversion_objectives
    }

    conversion_adsets = [a for a in adset_list if a.get("campaign_id") in conversion_campaign_ids]

    if not conversion_adsets:
        return CheckResult(
            check_id="S06",
            category="structure",
            severity="High",
            result="NA",
            title="Bid strategy alignment",
            detail="No conversion-objective campaigns found — bid strategy check not applicable.",
            threshold_value="LOWEST_COST or COST_CAP for conversion objectives",
        )

    strategies_in_use = list({a.get("bid_strategy", "UNKNOWN") for a in conversion_adsets})
    manual_bid_adsets = [a for a in conversion_adsets if a.get("bid_strategy") == "MANUAL_BID"]

    if manual_bid_adsets:
        return CheckResult(
            check_id="S06",
            category="structure",
            severity="High",
            result="WARNING",
            title="Bid strategy alignment",
            detail=(
                f"{len(manual_bid_adsets)} conversion adset(s) use Manual CPM bidding, "
                "which may limit delivery and optimization."
            ),
            recommendation=(
                "Manual CPM bidding on conversion campaigns may limit delivery. "
                "Switch to LOWEST_COST_WITHOUT_CAP or COST_CAP for conversion objectives."
            ),
            meta_value=", ".join(strategies_in_use),
            threshold_value="LOWEST_COST or COST_CAP for conversion objectives",
        )

    return CheckResult(
        check_id="S06",
        category="structure",
        severity="High",
        result="PASS",
        title="Bid strategy alignment",
        detail="Conversion campaigns are using appropriate bid strategies.",
        meta_value=", ".join(strategies_in_use),
        threshold_value="LOWEST_COST or COST_CAP for conversion objectives",
    )


def eval_daily_budget_minimum(data: dict) -> CheckResult:
    """S07 — High: Check that active campaigns/adsets meet the minimum daily budget."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []
    adsets = data.get("adsets", {})
    adset_list = adsets.get("data", []) if isinstance(adsets, dict) else []

    MIN_BUDGET_CENTS = 1000   # $10
    WARN_BUDGET_CENTS = 500   # $5

    budget_items: list[int] = []
    for item in campaign_list + adset_list:
        db_raw = item.get("daily_budget")
        if db_raw is not None:
            try:
                budget_items.append(int(db_raw))
            except (TypeError, ValueError):
                pass

    if not budget_items:
        return CheckResult(
            check_id="S07",
            category="structure",
            severity="High",
            result="NA",
            title="Daily budget minimum met",
            detail="No daily budgets detected — campaigns may be using lifetime budgets.",
            threshold_value="≥ $10/day",
        )

    min_budget = min(budget_items)
    min_budget_usd = min_budget / 100

    if min_budget < WARN_BUDGET_CENTS:
        return CheckResult(
            check_id="S07",
            category="structure",
            severity="High",
            result="FAIL",
            title="Daily budget minimum met",
            detail=f"Some campaigns/adsets have daily budgets below $5 (lowest: ${min_budget_usd:.2f}).",
            recommendation=(
                "Increase daily budgets to at least $10/day to allow Meta's algorithm to optimize effectively."
            ),
            meta_value=f"Lowest daily budget: ${min_budget_usd:.2f}",
            threshold_value="≥ $10/day",
        )

    if min_budget < MIN_BUDGET_CENTS:
        return CheckResult(
            check_id="S07",
            category="structure",
            severity="High",
            result="WARNING",
            title="Daily budget minimum met",
            detail=f"Some campaigns/adsets have daily budgets between $5 and $10 (lowest: ${min_budget_usd:.2f}).",
            recommendation="Increase daily budgets to at least $10/day for better optimization.",
            meta_value=f"Lowest daily budget: ${min_budget_usd:.2f}",
            threshold_value="≥ $10/day",
        )

    return CheckResult(
        check_id="S07",
        category="structure",
        severity="High",
        result="PASS",
        title="Daily budget minimum met",
        detail=f"All daily budgets are at or above $10/day (lowest: ${min_budget_usd:.2f}).",
        meta_value=f"Lowest daily budget: ${min_budget_usd:.2f}",
        threshold_value="≥ $10/day",
    )


def eval_learning_phase_stability(data: dict) -> CheckResult:
    """S08 — High: Check percentage of adsets below 50 optimization events/week."""
    insights_7d = data.get("insights_7d", {})
    insight_list = insights_7d.get("data", []) if isinstance(insights_7d, dict) else []

    if not insight_list:
        return CheckResult(
            check_id="S08",
            category="structure",
            severity="High",
            result="NA",
            title="Learning phase stability",
            detail="No 7-day adset insights available.",
            threshold_value="≥ 50 optimization events per adset per week",
        )

    CONVERSION_ACTIONS = {"purchase", "lead", "complete_registration", "subscribe"}
    adset_event_counts: list[int] = []

    for row in insight_list:
        events = 0
        for action in row.get("actions", []):
            if action.get("action_type") in CONVERSION_ACTIONS:
                try:
                    events += int(float(action.get("value", 0)))
                except (TypeError, ValueError):
                    pass
        adset_event_counts.append(events)

    total = len(adset_event_counts)
    below_50 = sum(1 for e in adset_event_counts if e < 50)
    pct = below_50 / total * 100 if total > 0 else 0

    note = "iOS 14+ underreporting may cause actual event counts to be higher than reported."

    if pct > 50:
        return CheckResult(
            check_id="S08",
            category="structure",
            severity="High",
            result="FAIL",
            title="Learning phase stability",
            detail=f"Most ad sets appear to be in the learning phase ({pct:.0f}% below 50 events/week). {note}",
            recommendation=(
                "Consolidate ad sets to concentrate optimization events and exit the learning phase faster. "
                "Consider expanding audiences or increasing budgets."
            ),
            meta_value=f"{pct:.0f}% of adsets below 50 events/week",
            threshold_value="≥ 50 optimization events per adset per week",
        )

    if pct >= 25:
        return CheckResult(
            check_id="S08",
            category="structure",
            severity="High",
            result="WARNING",
            title="Learning phase stability",
            detail=f"{pct:.0f}% of adsets are below 50 optimization events/week. {note}",
            recommendation=(
                "Monitor these ad sets closely. Consider expanding audiences or increasing budgets "
                "to generate more conversion events."
            ),
            meta_value=f"{pct:.0f}% of adsets below 50 events/week",
            threshold_value="≥ 50 optimization events per adset per week",
        )

    return CheckResult(
        check_id="S08",
        category="structure",
        severity="High",
        result="PASS",
        title="Learning phase stability",
        detail=f"{pct:.0f}% of adsets below 50 events/week — most adsets have exited the learning phase. {note}",
        meta_value=f"{pct:.0f}% of adsets below 50 events/week",
        threshold_value="≥ 50 optimization events per adset per week",
    )


def eval_campaign_age_active(data: dict) -> CheckResult:
    """S09 — Low: Check for campaigns less than 3 days old."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []

    active = [c for c in campaign_list if c.get("status") == "ACTIVE"]
    now = datetime.now(tz=timezone.utc)

    new_campaigns: list[dict] = []
    for c in active:
        created_dt = _parse_meta_datetime(c.get("created_time"))
        if created_dt is not None:
            age_days = (now - created_dt).total_seconds() / 86400
            if age_days < 3:
                new_campaigns.append(c)

    count_new = len(new_campaigns)

    if new_campaigns:
        names = ", ".join(c.get("name", c.get("id")) for c in new_campaigns)
        return CheckResult(
            check_id="S09",
            category="structure",
            severity="Low",
            result="WARNING",
            title="Campaign age and optimization data",
            detail=f"Some campaigns are less than 3 days old — optimization data is limited: {names}",
            recommendation=(
                "Allow at least 7 days of data before making significant optimization decisions."
            ),
            meta_value=str(count_new),
        )

    return CheckResult(
        check_id="S09",
        category="structure",
        severity="Low",
        result="PASS",
        title="Campaign age and optimization data",
        detail="All active campaigns are at least 3 days old.",
        meta_value="0",
    )


def eval_account_spend_last30d(data: dict) -> CheckResult:
    """S10 — Medium: Check total account spend in the last 30 days."""
    insights_30d = data.get("insights_30d", {})
    insight_list = insights_30d.get("data", []) if isinstance(insights_30d, dict) else []

    spend_usd = 0.0
    for row in insight_list:
        try:
            spend_usd += float(row.get("spend", 0))
        except (TypeError, ValueError):
            pass

    if spend_usd == 0:
        return CheckResult(
            check_id="S10",
            category="structure",
            severity="Medium",
            result="FAIL",
            title="Account spend in last 30 days",
            detail="No spend recorded in last 30 days.",
            recommendation="Verify campaigns are active and budgets are sufficient.",
            meta_value=f"${spend_usd:.2f} last 30 days",
            threshold_value="≥ $100",
        )

    if spend_usd < 100:
        return CheckResult(
            check_id="S10",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Account spend in last 30 days",
            detail=f"Low spend (${spend_usd:.2f}) may limit optimization data.",
            recommendation=(
                "Minimum $100/month spend recommended for Meta's algorithm to optimize effectively."
            ),
            meta_value=f"${spend_usd:.2f} last 30 days",
            threshold_value="≥ $100",
        )

    return CheckResult(
        check_id="S10",
        category="structure",
        severity="Medium",
        result="PASS",
        title="Account spend in last 30 days",
        detail=f"${spend_usd:.2f} spent in the last 30 days.",
        meta_value=f"${spend_usd:.2f} last 30 days",
        threshold_value="≥ $100",
    )


def eval_paused_campaigns_ratio(data: dict) -> CheckResult:
    """S11 — Low: Check if any active campaigns exist (paused campaigns not fetched)."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []

    count = len(campaign_list)

    if count == 0:
        return CheckResult(
            check_id="S11",
            category="structure",
            severity="Low",
            result="FAIL",
            title="Active campaigns present",
            detail="No active campaigns found on this ad account.",
            recommendation="Activate at least one campaign to start generating data.",
            meta_value="0 active campaigns",
        )

    return CheckResult(
        check_id="S11",
        category="structure",
        severity="Low",
        result="PASS",
        title="Active campaigns present",
        detail=f"{count} active campaign(s) found.",
        meta_value=f"{count} active campaigns",
    )


def eval_conversion_window_settings(data: dict) -> CheckResult:
    """S12 — Medium: Always MANUAL_REQUIRED — attribution window cannot be verified via API."""
    return CheckResult(
        check_id="S12",
        category="structure",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Conversion window settings verified",
        detail=(
            "Attribution window settings (7-day click, 1-day view) cannot be fully verified "
            "via Graph API fields requested."
        ),
        recommendation=(
            "In Ads Manager, verify each ad set uses 7-day click / 1-day view attribution window. "
            "Avoid 1-day click only — it undercounts conversions post-iOS 14."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_placement_distribution(data: dict) -> CheckResult:
    """S13 — Medium: Check for over-concentration on a single placement platform."""
    placement_data = data.get("insights_placement", {})
    placement_list = placement_data.get("data", []) if isinstance(placement_data, dict) else []

    if not placement_list:
        return CheckResult(
            check_id="S13",
            category="structure",
            severity="Medium",
            result="NA",
            title="Placement distribution balanced",
            detail="No placement breakdown data available.",
            threshold_value="< 80% concentration on one placement",
        )

    platform_spend: dict[str, float] = {}
    for row in placement_list:
        platform = row.get("publisher_platform", "unknown")
        try:
            spend = float(row.get("spend", 0))
        except (TypeError, ValueError):
            spend = 0.0
        platform_spend[platform] = platform_spend.get(platform, 0.0) + spend

    total_spend = sum(platform_spend.values())
    if total_spend == 0:
        return CheckResult(
            check_id="S13",
            category="structure",
            severity="Medium",
            result="NA",
            title="Placement distribution balanced",
            detail="No placement spend data available for analysis.",
            threshold_value="< 80% concentration on one placement",
        )

    dominant_platform = max(platform_spend, key=lambda k: platform_spend[k])
    dominant_spend = platform_spend[dominant_platform]
    pct = dominant_spend / total_spend * 100

    if pct > 80:
        return CheckResult(
            check_id="S13",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="Placement distribution balanced",
            detail=f"80%+ of spend concentrated on {dominant_platform} ({pct:.0f}%).",
            recommendation=(
                "Enable Advantage+ Placements to allow Meta to optimize across all placements."
            ),
            meta_value=f"{dominant_platform}: {pct:.0f}% of spend",
            threshold_value="< 80% concentration on one placement",
        )

    return CheckResult(
        check_id="S13",
        category="structure",
        severity="Medium",
        result="PASS",
        title="Placement distribution balanced",
        detail=f"Spend is distributed across placements — {dominant_platform} is dominant at {pct:.0f}%.",
        meta_value=f"{dominant_platform}: {pct:.0f}% of spend",
        threshold_value="< 80% concentration on one placement",
    )


def eval_advantage_plus_placements(data: dict) -> CheckResult:
    """S14 — Medium: Always MANUAL_REQUIRED — Advantage+ placement detection not reliable via API."""
    return CheckResult(
        check_id="S14",
        category="structure",
        severity="Medium",
        result="MANUAL_REQUIRED",
        title="Advantage+ Placements enabled",
        detail=(
            "Placement configuration (manual vs Advantage+) cannot be reliably detected from "
            "the fields returned by Graph API."
        ),
        recommendation=(
            "In Ads Manager, verify at least one ad set uses Advantage+ Placements. "
            "Manual placement restrictions often reduce reach and increase CPM."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_frequency_cap_set(data: dict) -> CheckResult:
    """S15 — Low: Check frequency for awareness campaigns."""
    campaigns = data.get("campaigns", {})
    campaign_list = campaigns.get("data", []) if isinstance(campaigns, dict) else []

    AWARENESS_OBJECTIVES = {"OUTCOME_AWARENESS", "REACH", "BRAND_AWARENESS"}
    awareness_campaigns = [
        c for c in campaign_list if c.get("objective") in AWARENESS_OBJECTIVES
    ]

    if not awareness_campaigns:
        return CheckResult(
            check_id="S15",
            category="structure",
            severity="Low",
            result="NA",
            title="Frequency cap set for awareness campaigns",
            detail="No awareness/reach campaigns found — frequency cap not applicable.",
        )

    awareness_ids = {c.get("id") for c in awareness_campaigns}
    insights_7d = data.get("insights_7d", {})
    insight_list = insights_7d.get("data", []) if isinstance(insights_7d, dict) else []

    high_freq: list[dict] = []
    for row in insight_list:
        if row.get("campaign_id") in awareness_ids:
            try:
                freq = float(row.get("frequency", 0))
                if freq > 5.0:
                    high_freq.append(row)
            except (TypeError, ValueError):
                pass

    if high_freq:
        return CheckResult(
            check_id="S15",
            category="structure",
            severity="Low",
            result="WARNING",
            title="Frequency cap set for awareness campaigns",
            detail="Awareness campaigns have high frequency (above 5.0) in the last 7 days.",
            recommendation=(
                "Set a frequency cap (e.g. 2-3 per week) on awareness campaigns to avoid ad fatigue."
            ),
        )

    return CheckResult(
        check_id="S15",
        category="structure",
        severity="Low",
        result="PASS",
        title="Frequency cap set for awareness campaigns",
        detail="Awareness campaigns have acceptable frequency levels.",
    )


def eval_special_ad_category(data: dict) -> CheckResult:
    """S16 — Critical: Always MANUAL_REQUIRED — Special Ad Category compliance cannot be verified via API."""
    return CheckResult(
        check_id="S16",
        category="structure",
        severity="Critical",
        result="MANUAL_REQUIRED",
        title="Special Ad Category compliance verified",
        detail=(
            "Special Ad Categories (Housing, Employment, Credit, Financial Products, Political) "
            "have strict targeting restrictions. Cannot verify compliance via API."
        ),
        recommendation=(
            "If running ads in Housing, Employment, Credit, Financial Products, or Political "
            "categories, ensure Special Ad Category is declared in campaign settings. "
            "Failure to declare may result in campaign disapproval or account restriction."
        ),
        meta_ui_link="https://business.facebook.com/adsmanager/",
    )


def eval_url_parameters_tracking(data: dict) -> CheckResult:
    """S17 — Medium: Check percentage of ads with UTM tracking parameters."""

    def has_utm_tracking(ad: dict) -> bool:
        tracking_specs = ad.get("tracking_specs") or []
        for spec in tracking_specs:
            url_tags = spec.get("url_tags", "")
            if "utm" in str(url_tags).lower():
                return True
        creative = ad.get("creative") or {}
        for field in ("image_url", "effective_object_story_id"):
            if "utm_" in str(creative.get(field, "")).lower():
                return True
        return False

    ads = data.get("ads", {})
    ad_list = ads.get("data", []) if isinstance(ads, dict) else []

    if not ad_list:
        return CheckResult(
            check_id="S17",
            category="structure",
            severity="Medium",
            result="NA",
            title="UTM parameters on ad URLs",
            detail="No active ads found to check for UTM tracking.",
            threshold_value="> 80%",
        )

    ads_with_tracking = [a for a in ad_list if has_utm_tracking(a)]
    pct_with_tracking = len(ads_with_tracking) / max(len(ad_list), 1) * 100

    if pct_with_tracking > 80:
        return CheckResult(
            check_id="S17",
            category="structure",
            severity="Medium",
            result="PASS",
            title="UTM parameters on ad URLs",
            detail=f"{pct_with_tracking:.0f}% of ads have UTM tracking parameters.",
            meta_value=f"{pct_with_tracking:.0f}% ads with UTM tracking",
            threshold_value="> 80%",
        )

    if pct_with_tracking >= 50:
        return CheckResult(
            check_id="S17",
            category="structure",
            severity="Medium",
            result="WARNING",
            title="UTM parameters on ad URLs",
            detail=f"{pct_with_tracking:.0f}% of ads have UTM tracking parameters.",
            recommendation=(
                "Add UTM parameters to remaining ads for accurate Google Analytics attribution."
            ),
            meta_value=f"{pct_with_tracking:.0f}% ads with UTM tracking",
            threshold_value="> 80%",
        )

    return CheckResult(
        check_id="S17",
        category="structure",
        severity="Medium",
        result="FAIL",
        title="UTM parameters on ad URLs",
        detail=f"Most ads lack UTM tracking ({pct_with_tracking:.0f}% have tracking).",
        recommendation=(
            "Most ads lack UTM tracking. Add utm_source=facebook&utm_medium=paid_social"
            "&utm_campaign={{campaign_name}} to all ad URLs."
        ),
        meta_value=f"{pct_with_tracking:.0f}% ads with UTM tracking",
        threshold_value="> 80%",
    )


def eval_facebook_page_connected(data: dict) -> CheckResult:
    """S18 — High: Always MANUAL_REQUIRED — Facebook Page health cannot be verified via API."""
    return CheckResult(
        check_id="S18",
        category="structure",
        severity="High",
        result="MANUAL_REQUIRED",
        title="Facebook Page properly configured",
        detail=(
            "Facebook Page connection and health cannot be fully verified via Graph API "
            "with current token scope."
        ),
        recommendation=(
            "Verify the Facebook Page linked to your ads: "
            "(1) Is published and not restricted, "
            "(2) Has a profile picture and cover photo, "
            "(3) Has at least 10 posts for social proof."
        ),
        meta_ui_link="https://business.facebook.com/",
    )


STRUCTURE_EVALUATORS: list = [
    eval_campaign_objective_alignment,
    eval_campaign_count_active,
    eval_adset_per_campaign,
    eval_ads_per_adset,
    eval_campaign_budget_optimization,
    eval_bid_strategy_alignment,
    eval_daily_budget_minimum,
    eval_learning_phase_stability,
    eval_campaign_age_active,
    eval_account_spend_last30d,
    eval_paused_campaigns_ratio,
    eval_conversion_window_settings,
    eval_placement_distribution,
    eval_advantage_plus_placements,
    eval_frequency_cap_set,
    eval_special_ad_category,
    eval_url_parameters_tracking,
    eval_facebook_page_connected,
]


# ---------------------------------------------------------------------------
# Check evaluator registry — populated in Phases 3-6
# ---------------------------------------------------------------------------

PIXEL_EVALUATORS: list = [
    eval_pixel_installed,
    eval_capi_configured,
    eval_pixel_event_match_quality,
    eval_purchase_event_firing,
    eval_standard_events_variety,
    eval_pixel_deduplication,
    eval_aggregated_event_measurement,
    eval_value_optimization_eligible,
    eval_offline_conversions,
    eval_pixel_multiple_domains,
]

CHECK_EVALUATORS: list = (
    PIXEL_EVALUATORS
    + CREATIVE_EVALUATORS
    + STRUCTURE_EVALUATORS
    + AUDIENCE_EVALUATORS
)
