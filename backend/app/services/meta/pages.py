"""Facebook Pages service."""
import json
import logging

from app.services.meta.client import MetaClient

logger = logging.getLogger(__name__)


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

    async def publish_carousel(self, page_id: str, image_urls: list[str], caption: str) -> dict:
        """Publish multiple images as a Facebook album post using a page-scoped access token.

        If only one image_url is provided, falls back to the existing single-image flow.
        Returns the API response dict containing the post id.
        """
        # Obtain a page-scoped token — required for /photos and /feed endpoints
        page_token = await self.get_page_access_token(page_id)
        page_client = MetaClient(page_token)

        if len(image_urls) == 1:
            return await page_client.post(f"/{page_id}/photos", {
                "url": image_urls[0],
                "caption": caption,
            })

        # Step 1: upload each photo without publishing to obtain its fbid
        media_fbids: list[str] = []
        for i, url in enumerate(image_urls):
            logger.info("Facebook carousel: uploading photo %d/%d", i + 1, len(image_urls))
            try:
                result = await page_client.post(f"/{page_id}/photos", {
                    "url": url,
                    "published": "false",
                })
            except Exception as exc:
                logger.error("Facebook carousel: failed to upload photo %d (%s): %s", i + 1, url, exc)
                raise
            photo_id = result.get("id")
            if not photo_id:
                raise Exception(f"Facebook carousel photo upload {i + 1} returned no id")
            media_fbids.append(photo_id)

        # Step 2: create a feed post with all photos attached
        logger.info("Facebook carousel: creating post with %d attached photos", len(media_fbids))
        attached_media = json.dumps([{"media_fbid": fbid} for fbid in media_fbids])
        post_result = await page_client.post(f"/{page_id}/feed", {
            "message": caption,
            "attached_media": attached_media,
        })
        post_id = post_result.get("id")
        if not post_id:
            raise Exception("Facebook carousel feed post returned no id")
        logger.info("Facebook carousel published — post_id=%s", post_id)
        return post_result

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
