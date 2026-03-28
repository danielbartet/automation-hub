"""Facebook Pages service — stub."""
from app.services.meta.client import MetaClient


class PagesService:
    """Manages Facebook Page operations."""

    def __init__(self, client: MetaClient) -> None:
        self.client = client

    async def get_page_info(self, page_id: str) -> dict:
        """Fetch page info. Stub returns empty dict."""
        return await self.client.get(f"/{page_id}")

    async def publish_post(self, page_id: str, message: str, link: str | None = None) -> dict:
        """Publish a text post to a Facebook Page."""
        return await self.client.post(f"/{page_id}/feed", {"message": message, "link": link})
