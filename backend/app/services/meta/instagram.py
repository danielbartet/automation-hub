"""Instagram Graph API service."""
from app.services.meta.client import MetaClient


class InstagramService:
    """Manages Instagram content publishing."""

    def __init__(self, client: MetaClient) -> None:
        self.client = client

    async def create_media_container(self, ig_account_id: str, image_url: str, caption: str) -> dict:
        """Create a media container for single image post."""
        return await self.client.post(
            f"/{ig_account_id}/media",
            {"image_url": image_url, "caption": caption},
        )

    async def publish_media(self, ig_account_id: str, creation_id: str) -> dict:
        """Publish a previously created media container."""
        return await self.client.post(
            f"/{ig_account_id}/media_publish",
            {"creation_id": creation_id},
        )

    async def get_media(self, ig_account_id: str, limit: int = 25) -> dict:
        """Fetch published media from an Instagram Business account.

        Returns a dict with 'data' list of media objects. Each item has:
        id, caption, media_type, media_url, thumbnail_url, timestamp, permalink.
        """
        return await self.client.get(
            f"/{ig_account_id}/media",
            {
                "fields": "id,caption,media_type,media_url,thumbnail_url,timestamp,permalink",
                "limit": limit,
            },
        )
