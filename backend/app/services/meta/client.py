"""Meta Graph API base client."""
import logging
import httpx

logger = logging.getLogger(__name__)


class MetaClient:
    """Base client for Meta Graph API requests."""

    BASE_URL = "https://graph.facebook.com/v19.0"

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    async def get(self, path: str, params: dict | None = None) -> dict:
        """Perform a GET request against the Meta Graph API."""
        url = f"{self.BASE_URL}{path}"
        all_params = {"access_token": self.access_token}
        if params:
            all_params.update(params)
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=all_params)
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
            if not resp.is_success:
                logger.error("Meta API POST %s → %s: %s", path, resp.status_code, resp.text)
            resp.raise_for_status()
            return resp.json()
