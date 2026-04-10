"""Publish post skill — pushes approved content to Instagram and Facebook."""
from app.models.project import Project
from app.skills.base import BaseSkill
from app.services.meta.client import MetaClient
from app.services.meta.instagram import InstagramService
from app.services.meta.pages import PagesService
from app.core.security import get_project_token


class PublishPostSkill(BaseSkill):
    """Publishes an approved content post to Instagram and/or Facebook."""

    @property
    def name(self) -> str:
        return "publish_post"

    @property
    def description(self) -> str:
        return "Publish an approved ContentPost to Instagram and Facebook via Meta Graph API"

    async def execute(self, payload: dict, db=None) -> dict:
        """Publish a content post.

        Args:
            payload: {
                "caption": str,
                "image_url": str | None,
                "targets": list["instagram" | "facebook"]
            }
            db: optional AsyncSession for three-tier token resolution

        Returns:
            {"instagram_media_id": str | None, "facebook_post_id": str | None, "status": "success" | "failed"}
        """
        access_token = await get_project_token(self.project, db) or ""
        client = MetaClient(access_token=access_token)

        caption = payload.get("caption", "")
        image_url = payload.get("image_url")
        targets = payload.get("targets", ["instagram", "facebook"])

        result: dict = {"status": "success", "instagram_media_id": None, "facebook_post_id": None}

        if "instagram" in targets and self.project.instagram_account_id:
            ig_service = InstagramService(client)
            if image_url:
                container = await ig_service.create_media_container(
                    self.project.instagram_account_id, image_url, caption
                )
                publish = await ig_service.publish_media(
                    self.project.instagram_account_id, container.get("id", "stub-id")
                )
                result["instagram_media_id"] = publish.get("id", "stub-ig-id")

        if "facebook" in targets and self.project.facebook_page_id:
            pages_service = PagesService(client)
            post = await pages_service.publish_post(self.project.facebook_page_id, caption)
            result["facebook_post_id"] = post.get("id", "stub-fb-id")

        return result
