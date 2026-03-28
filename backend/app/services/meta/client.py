"""Meta Graph API base client — stub implementation."""
import httpx
from app.core.config import settings


class MetaClient:
    """Base client for Meta Graph API requests."""

    BASE_URL = "https://graph.facebook.com/v19.0"

    def __init__(self, access_token: str) -> None:
        self.access_token = access_token

    async def get(self, path: str, params: dict | None = None) -> dict:
        """Perform a GET request. Returns mock data in stub mode."""
        return {"stub": True, "path": path}

    async def post(self, path: str, data: dict | None = None) -> dict:
        """Perform a POST request. Returns mock data in stub mode."""
        return {"stub": True, "path": path}
