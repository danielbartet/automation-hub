"""Facebook Pages service."""
from app.services.meta.client import MetaClient


class PagesService:
    """Manages Facebook Page operations."""

    def __init__(self, client: MetaClient) -> None:
        self.client = client

    async def get_page_info(self, page_id: str) -> dict:
        """Fetch page info."""
        return await self.client.get(f"/{page_id}")

    async def get_page_access_token(self, page_id: str) -> str:
        """Get a page-scoped access token using the system user token."""
        result = await self.client.get(f"/{page_id}", {"fields": "access_token"})
        return result["access_token"]

    async def publish_post(self, page_id: str, message: str, image_url: str | None = None) -> dict:
        """Publish a post to a Facebook Page using a page-scoped access token.

        Uses the page access token (derived from the system user token) so that
        posts are correctly attributed to the Page rather than the system user.
        If image_url is provided, publishes a photo post; otherwise publishes
        a plain text post to the feed.
        """
        # Obtain a page-scoped token — required for /feed and /photos endpoints
        page_token = await self.get_page_access_token(page_id)
        page_client = MetaClient(page_token)

        if image_url:
            return await page_client.post(f"/{page_id}/photos", {
                "url": image_url,
                "caption": message,
            })
        else:
            return await page_client.post(f"/{page_id}/feed", {"message": message})

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
