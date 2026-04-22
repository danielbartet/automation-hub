"""Meta Graph API base client."""
import logging
import httpx

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
        from fastapi import HTTPException

        # ── 1. X-Business-Use-Case-Usage (primary) ─────────────────────────────
        buc_raw = response.headers.get("X-Business-Use-Case-Usage")
        if buc_raw:
            try:
                # Structure: {"<ad_account_id>": [{"type": "...", "call_count": N, ...}]}
                buc_data: dict = _json.loads(buc_raw)
                buc_max_overall = 0.0
                buc_call_count_agg = 0.0
                buc_total_time_agg = 0.0
                buc_cputime_agg = 0.0
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
                        if max_pct > buc_max_overall:
                            buc_max_overall = max_pct
                            buc_call_count_agg = call_count
                            buc_total_time_agg = total_time
                            buc_cputime_agg = total_cputime

                        # Store in usage dict
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

                # Persist the highest BUC snapshot to DB
                if buc_max_overall > 0:
                    try:
                        from app.models.meta_api_audit_log import MetaAppUsage
                        from app.core.database import AsyncSessionLocal
                        async with AsyncSessionLocal() as db:
                            record = MetaAppUsage(
                                call_count_pct=buc_call_count_agg,
                                total_time_pct=buc_total_time_agg,
                                total_cputime_pct=buc_cputime_agg,
                                max_pct=buc_max_overall,
                            )
                            db.add(record)
                            await db.commit()
                    except Exception:
                        pass

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
                app_max = max(call_count, total_time, total_cputime)
                for field, val in data.items():
                    if isinstance(val, (int, float)):
                        if val > 95:
                            logger.error(
                                "Meta API app usage critical: X-App-Usage.%s = %s%% — throttling imminent",
                                field, val,
                            )
                        elif val > 85:
                            logger.warning("Meta API app usage high: X-App-Usage.%s = %s%%", field, val)
                # Persist to DB
                try:
                    from app.models.meta_api_audit_log import MetaAppUsage
                    from app.core.database import AsyncSessionLocal
                    async with AsyncSessionLocal() as db:
                        record = MetaAppUsage(
                            call_count_pct=call_count,
                            total_time_pct=total_time,
                            total_cputime_pct=total_cputime,
                            max_pct=app_max,
                        )
                        db.add(record)
                        await db.commit()
                except Exception:
                    pass
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

    async def get(self, path: str, params: dict | None = None) -> dict:
        """Perform a GET request against the Meta Graph API."""
        url = f"{self.BASE_URL}{path}"
        all_params = {"access_token": self.access_token}
        if params:
            all_params.update(params)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=all_params)
            self._parse_usage_headers(resp)
            if not resp.is_success:
                logger.error("Meta API GET %s → %s: %s", path, resp.status_code, resp.text)
            resp.raise_for_status()
            return resp.json()

    async def post(self, path: str, data: dict | None = None) -> dict:
        """Perform a POST request against the Meta Graph API."""
        url = f"{self.BASE_URL}{path}"
        payload = {"access_token": self.access_token}
        if data:
            payload.update(data)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, data=payload)
            self._parse_usage_headers(resp)
            if not resp.is_success:
                logger.error("Meta API POST %s → %s: %s", path, resp.status_code, resp.text)
            resp.raise_for_status()
            return resp.json()


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
