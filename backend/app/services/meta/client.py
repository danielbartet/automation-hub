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
        """Parse Meta API rate limit headers and log warnings."""
        import json as _json

        header_map = {
            "X-App-Usage": "app_usage",
            "X-Ad-Account-Usage": "account_usage",
            "X-Business-Use-Case-Usage": "buc_usage",
        }

        for header_name, key in header_map.items():
            raw = response.headers.get(header_name)
            if not raw:
                continue
            try:
                data = _json.loads(raw)
                self._usage[key] = data

                # X-App-Usage fields: call_count, total_time, total_cputime
                if key == "app_usage":
                    for field, val in data.items():
                        if isinstance(val, (int, float)):
                            if val > 95:
                                logger.error(f"Meta API usage critical: {header_name}.{field} = {val}% — throttling imminent")
                            elif val > 85:
                                logger.warning(f"Meta API usage high: {header_name}.{field} = {val}%")

                # X-Ad-Account-Usage field: acc_id_util_pct
                elif key == "account_usage":
                    pct = data.get("acc_id_util_pct", 0)
                    if pct > 95:
                        logger.error(f"Meta API usage critical: {header_name} = {pct}% — throttling imminent")
                    elif pct > 85:
                        logger.warning(f"Meta API usage high: {header_name} = {pct}%")
            except Exception:
                pass

    def get_usage(self) -> dict:
        """Return the latest parsed Meta API rate limit usage headers."""
        return self._usage

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
