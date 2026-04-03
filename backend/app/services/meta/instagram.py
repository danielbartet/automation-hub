"""Instagram Graph API service."""
import asyncio
import logging

from app.services.meta.client import MetaClient

logger = logging.getLogger(__name__)


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

    async def create_carousel_item(self, ig_account_id: str, image_url: str) -> dict:
        """Create a carousel item container for a single image (no caption, is_carousel_item=true).

        Returns the API response dict containing the item container id.
        """
        return await self.client.post(
            f"/{ig_account_id}/media",
            {"image_url": image_url, "is_carousel_item": "true"},
        )

    async def create_carousel_container(self, ig_account_id: str, children_ids: list[str], caption: str) -> dict:
        """Create a carousel container referencing the individual item containers.

        children_ids: list of container ids returned by create_carousel_item.
        Returns the API response dict containing the carousel container id.
        """
        children_str = ",".join(children_ids)
        return await self.client.post(
            f"/{ig_account_id}/media",
            {"media_type": "CAROUSEL", "children": children_str, "caption": caption},
        )

    async def publish_carousel(self, ig_account_id: str, image_urls: list[str], caption: str) -> str:
        """Orchestrate the 3-step Instagram carousel publish flow.

        If only one image_url is provided, falls back to the existing single-image flow.
        Returns the published media id.
        """
        if len(image_urls) == 1:
            container = await self.create_media_container(ig_account_id, image_urls[0], caption)
            creation_id = container.get("id")
            if not creation_id:
                raise Exception("Instagram single-image container returned no id")
            await self.wait_for_container(creation_id)
            published = await self.publish_media(ig_account_id, creation_id)
            media_id = published.get("id")
            if not media_id:
                raise Exception("Instagram publish_media returned no id")
            return media_id

        # Step 1: create one carousel item per image
        children_ids: list[str] = []
        for i, url in enumerate(image_urls):
            logger.info("Instagram carousel: creating item %d/%d", i + 1, len(image_urls))
            try:
                item = await self.create_carousel_item(ig_account_id, url)
            except Exception as exc:
                logger.error("Instagram carousel: failed to create item %d (%s): %s", i + 1, url, exc)
                raise
            item_id = item.get("id")
            if not item_id:
                raise Exception(f"Instagram carousel item {i + 1} returned no id")
            children_ids.append(item_id)

        # Step 2: create the carousel container
        logger.info("Instagram carousel: creating carousel container with %d children", len(children_ids))
        container = await self.create_carousel_container(ig_account_id, children_ids, caption)
        carousel_id = container.get("id")
        if not carousel_id:
            raise Exception("Instagram carousel container returned no id")

        # Step 3: wait for container to be ready, then publish
        await self.wait_for_container(carousel_id)
        published = await self.publish_media(ig_account_id, carousel_id)
        media_id = published.get("id")
        if not media_id:
            raise Exception("Instagram carousel publish_media returned no id")
        logger.info("Instagram carousel published — media_id=%s", media_id)
        return media_id

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
