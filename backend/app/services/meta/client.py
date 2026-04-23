"""Meta Graph API base client."""
import asyncio
import logging
import random

import httpx
from fastapi import HTTPException

logger = logging.getLogger(__name__)


class MetaClient:
    """Base client for Meta Graph API requests."""

    BASE_URL = "https://graph.facebook.com/v19.0"

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token
        self._usage: dict = {}

    def _parse_usage_headers(self, response) -> None:
        """Parse Meta API rate limit headers, log warnings, and raise HTTP 429 when blocked.

        Priority order:
          1. X-Business-Use-Case-Usage  — primary Marketing API header
          2. X-App-Usage                — fallback app-level header
          3. X-Ad-Account-Usage         — fallback account-level header
        """
        import json as _json

        # ── 1. X-Business-Use-Case-Usage (primary) ─────────────────────────────
        buc_raw = response.headers.get("X-Business-Use-Case-Usage")
        if buc_raw:
            try:
                # Structure: {"<ad_account_id>": [{"type": "...", "call_count": N, ...}]}
                buc_data: dict = _json.loads(buc_raw)
                for account_id, entries in buc_data.items():
                    if not isinstance(entries, list):
                        continue
                    for entry in entries:
                        buc_type = entry.get("type", "unknown")
                        call_count = entry.get("call_count", 0)
                        total_cputime = entry.get("total_cputime", 0)
                        total_time = entry.get("total_time", 0)
                        est_reset = entry.get("estimated_time_to_regain_access", 0)

                        max_pct = max(call_count, total_cputime, total_time)

                        # Store in usage dict keyed by "{account_id}:{buc_type}"
                        key = f"{account_id}:{buc_type}"
                        self._usage[key] = {
                            "buc": buc_type,
                            "account_id": account_id,
                            "call_count_pct": call_count,
                            "total_cputime_pct": total_cputime,
                            "total_time_pct": total_time,
                            "estimated_reset_minutes": est_reset or None,
                        }

                        if max_pct >= 95:
                            logger.error(
                                "Meta API BUC usage BLOCKED: account=%s type=%s max_pct=%s%% — raising 429",
                                account_id, buc_type, max_pct,
                            )
                            reset_minutes = est_reset if est_reset and est_reset > 0 else 60
                            raise HTTPException(
                                status_code=429,
                                detail={
                                    "code": "META_RATE_LIMIT",
                                    "buc": buc_type,
                                    "usage_pct": max_pct,
                                    "estimated_reset_minutes": reset_minutes,
                                    "message": "Meta API rate limit reached. Calls will resume automatically.",
                                },
                            )
                        elif max_pct >= 85:
                            logger.warning(
                                "Meta API BUC usage high: account=%s type=%s max_pct=%s%%",
                                account_id, buc_type, max_pct,
                            )

            except HTTPException:
                raise
            except Exception:
                pass
            # BUC header was present — skip fallback headers
            return

        # ── 2. X-App-Usage (fallback) ───────────────────────────────────────────
        app_raw = response.headers.get("X-App-Usage")
        if app_raw:
            try:
                data = _json.loads(app_raw)
                self._usage["app_usage"] = data
                call_count = float(data.get("call_count", 0))
                total_time = float(data.get("total_time", 0))
                total_cputime = float(data.get("total_cputime", 0))
                for field, val in data.items():
                    if isinstance(val, (int, float)):
                        if val > 95:
                            logger.error(
                                "Meta API app usage critical: X-App-Usage.%s = %s%% — throttling imminent",
                                field, val,
                            )
                        elif val > 85:
                            logger.warning("Meta API app usage high: X-App-Usage.%s = %s%%", field, val)
                # In-memory only; DB persistence not needed from sync method.
            except Exception:
                pass

        # ── 3. X-Ad-Account-Usage (fallback) ────────────────────────────────────
        acct_raw = response.headers.get("X-Ad-Account-Usage")
        if acct_raw:
            try:
                data = _json.loads(acct_raw)
                self._usage["account_usage"] = data
                pct = data.get("acc_id_util_pct", 0)
                if pct > 95:
                    logger.error(
                        "Meta API account usage critical: X-Ad-Account-Usage = %s%% — throttling imminent",
                        pct,
                    )
                elif pct > 85:
                    logger.warning("Meta API account usage high: X-Ad-Account-Usage = %s%%", pct)
            except Exception:
                pass

    def get_usage(self) -> dict:
        """Return the latest parsed Meta API rate limit usage headers."""
        return self._usage

    def get_rate_status(self) -> dict:
        """Return a structured rate-limit status summary suitable for the API response.

        Returns:
            {
                "status": "ok" | "warning" | "blocked",
                "usage": [{"buc": str, "call_count_pct": int, "estimated_reset_minutes": int|None}],
                "blocked_until": None  # populated externally if needed
            }
        """
        usage_list = []
        overall_status = "ok"

        for key, entry in self._usage.items():
            if not isinstance(entry, dict):
                continue
            # BUC entries have a "buc" key; fallback entries don't — skip them here
            if "buc" not in entry:
                continue

            call_count_pct = entry.get("call_count_pct", 0)
            total_cputime_pct = entry.get("total_cputime_pct", 0)
            total_time_pct = entry.get("total_time_pct", 0)
            max_pct = max(call_count_pct, total_cputime_pct, total_time_pct)
            estimated_reset = entry.get("estimated_reset_minutes")

            usage_list.append({
                "buc": entry["buc"],
                "call_count_pct": call_count_pct,
                "estimated_reset_minutes": estimated_reset,
            })

            if max_pct >= 95:
                overall_status = "blocked"
            elif max_pct >= 85 and overall_status != "blocked":
                overall_status = "warning"

        return {
            "status": overall_status,
            "usage": usage_list,
            "blocked_until": None,
        }

    def preflight_check(self, ad_account_id: str, buc_type: str, threshold: float = 80.0) -> None:
        """Raise HTTP 429 if BUC usage for this type is already above threshold.

        Call this before expensive operations to avoid wasting a call that will be rejected.
        Checks the in-memory _usage dict populated by previous _parse_usage_headers calls.
        No-op when no usage data is available yet (first call).
        """
        key = f"{ad_account_id}:{buc_type}"
        usage = self._usage.get(key)
        if usage is None:
            return  # No data yet, allow
        max_pct = max(
            usage.get("call_count_pct", 0) or 0,
            usage.get("total_cputime_pct", 0) or 0,
            usage.get("total_time_pct", 0) or 0,
        )
        if max_pct >= threshold:
            reset = usage.get("estimated_reset_minutes") or 5
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "PREFLIGHT_RATE_LIMIT",
                    "buc_type": buc_type,
                    "usage_pct": max_pct,
                    "estimated_reset_minutes": reset,
                    "message": (
                        f"Meta API {buc_type} usage at {max_pct:.1f}%. "
                        f"Try again in {reset} minute(s)."
                    ),
                },
            )

    async def get(self, path: str, params: dict | None = None) -> dict:
        """Perform a GET request against the Meta Graph API with exponential backoff on 429."""
        url = f"{self.BASE_URL}{path}"
        all_params = {"access_token": self.access_token}
        if params:
            all_params.update(params)

        last_exc: HTTPException | None = None
        for attempt in range(3):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.get(url, params=all_params)
                self._parse_usage_headers(resp)
                if resp.status_code == 429:
                    last_exc = HTTPException(
                        status_code=429,
                        detail={"code": "META_RATE_LIMIT", "message": "Meta API rate limit reached."},
                    )
                    if attempt < 2:
                        wait = (2 ** attempt) + random.uniform(0, 1)
                        logger.warning(
                            "Meta API 429 on GET %s, attempt %d/3, waiting %.1fs",
                            path, attempt + 1, wait,
                        )
                        await asyncio.sleep(wait)
                        continue
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "code": "META_RATE_LIMIT",
                            "message": "Meta API rate limit reached. Try again in a moment.",
                        },
                    )
                if not resp.is_success:
                    logger.error("Meta API GET %s → %s: %s", path, resp.status_code, resp.text)
                resp.raise_for_status()
                return resp.json()

        # Should not be reached, but satisfy type checker
        raise last_exc or HTTPException(status_code=500, detail="Meta API request failed")

    async def post(self, path: str, data: dict | None = None) -> dict:
        """Perform a POST request against the Meta Graph API with exponential backoff on 429."""
        url = f"{self.BASE_URL}{path}"
        payload = {"access_token": self.access_token}
        if data:
            payload.update(data)

        last_exc: HTTPException | None = None
        for attempt in range(3):
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, data=payload)
                self._parse_usage_headers(resp)
                if resp.status_code == 429:
                    last_exc = HTTPException(
                        status_code=429,
                        detail={"code": "META_RATE_LIMIT", "message": "Meta API rate limit reached."},
                    )
                    if attempt < 2:
                        wait = (2 ** attempt) + random.uniform(0, 1)
                        logger.warning(
                            "Meta API 429 on POST %s, attempt %d/3, waiting %.1fs",
                            path, attempt + 1, wait,
                        )
                        await asyncio.sleep(wait)
                        continue
                    raise HTTPException(
                        status_code=429,
                        detail={
                            "code": "META_RATE_LIMIT",
                            "message": "Meta API rate limit reached. Try again in a moment.",
                        },
                    )
                if not resp.is_success:
                    logger.error("Meta API POST %s → %s: %s", path, resp.status_code, resp.text)
                resp.raise_for_status()
                return resp.json()

        raise last_exc or HTTPException(status_code=500, detail="Meta API request failed")


async def persist_buc_usage(db, usage_dict: dict) -> None:
    """Save MetaBUCUsage rows from the client._usage dict after an API call.

    Call this after any endpoint that uses MetaClient to persist the latest BUC
    snapshots to the DB. Safe to call even when usage_dict is empty — no-op.

    Args:
        db: AsyncSession
        usage_dict: MetaClient._usage dict (keyed by "{account_id}:{buc_type}")
    """
    from app.models.meta_api_audit_log import MetaBUCUsage

    for key, data in usage_dict.items():
        if not isinstance(data, dict):
            continue
        # BUC entries have a "buc" key; skip fallback (app_usage / account_usage) entries
        if "buc" not in data:
            continue
        # key format: "{account_id}:{buc_type}"
        parts = key.split(":", 1)
        if len(parts) != 2:
            continue
        account_id, buc_type = parts
        call_count = data.get("call_count_pct", 0) or 0
        total_cputime = data.get("total_cputime_pct", 0) or 0
        total_time = data.get("total_time_pct", 0) or 0
        max_pct = max(call_count, total_cputime, total_time)
        row = MetaBUCUsage(
            ad_account_id=account_id,
            buc_type=buc_type,
            call_count_pct=call_count,
            total_cputime_pct=total_cputime,
            total_time_pct=total_time,
            max_pct=max_pct,
            estimated_reset_minutes=data.get("estimated_reset_minutes"),
        )
        db.add(row)
    try:
        await db.flush()
    except Exception as exc:
        logger.warning("persist_buc_usage flush failed (non-fatal): %s", exc)


async def validate_meta_token(token: str, project_id: int | None = None) -> dict:
    """
    Validates a Meta access token.
    Returns: {"valid": bool, "expires_in_days": int | None, "error": str | None}
    """
    client = MetaClient(token)
    try:
        # Step 1: verify token works
        me = await client.get("/me", params={"fields": "id,name"})
        if "error" in me:
            return {"valid": False, "expires_in_days": None, "error": me["error"].get("message", "Token invalid")}

        # Step 2: check expiry via debug_token
        debug = await client.get("/debug_token", params={"input_token": token, "access_token": token})
        data = debug.get("data", {})
        expires_at = data.get("expires_at")

        expires_in_days = None
        if expires_at and expires_at != 0:
            from datetime import datetime, timezone
            expiry = datetime.fromtimestamp(expires_at, tz=timezone.utc)
            expires_in_days = (expiry - datetime.now(timezone.utc)).days

            if expires_in_days < 3:
                logger.warning(
                    "Meta token expiring in %d days%s",
                    expires_in_days,
                    f" for project {project_id}" if project_id else "",
                )

        return {"valid": True, "expires_in_days": expires_in_days, "error": None}

    except Exception as e:
        return {"valid": False, "expires_in_days": None, "error": str(e)}
