"""Facebook Pages service."""
from app.services.meta.client import MetaClient


class PagesService:
    """Manages Facebook Page operations."""

    def __init__(self, client: MetaClient) -> None:
        self.client = client

    async def get_page_info(self, page_id: str) -> dict:
        """Fetch page info."""
        return await self.client.get(f"/{page_id}")

    async def publish_post(self, page_id: str, message: str, link: str | None = None) -> dict:
        """Publish a text post to a Facebook Page."""
        return await self.client.post(f"/{page_id}/feed", {"message": message, "link": link})

    async def get_page_posts(self, page_id: str, limit: int = 25) -> dict:
        """Fetch published posts from a Facebook Page.

        Returns a dict with 'data' list of posts. Each post has:
        id, message, story, created_time, permalink_url, full_picture.
        """
        return await self.client.get(
            f"/{page_id}/posts",
            {
                "fields": "id,message,story,created_time,permalink_url,full_picture",
                "limit": limit,
            },
        )
