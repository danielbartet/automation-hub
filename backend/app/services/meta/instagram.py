"""Instagram Graph API service."""
import asyncio

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

    async def wait_for_container(self, container_id: str, max_attempts: int = 10, wait_seconds: float = 2.0) -> bool:
        """Poll container status until FINISHED or timeout. Returns True if ready."""
        for attempt in range(max_attempts):
            result = await self.client.get(f"/{container_id}", {"fields": "status_code"})
            status = result.get("status_code", "")
            if status == "FINISHED":
                return True
            if status == "ERROR":
                raise Exception(f"Media container {container_id} failed with ERROR status")
            await asyncio.sleep(wait_seconds)
        raise Exception(f"Media container {container_id} not ready after {max_attempts} attempts")

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
