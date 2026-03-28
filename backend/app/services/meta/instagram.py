"""Instagram Graph API service — stub."""
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
