"""n8n webhook client — triggers n8n automation workflows."""
import httpx
from fastapi import HTTPException

from app.core.config import settings


class N8nClient:
    """Client for triggering n8n workflows via webhooks."""

    def __init__(self, base_url: str = "", secret: str = "") -> None:
        self.base_url = base_url.rstrip("/") if base_url else ""
        self.secret = secret

    async def trigger_workflow(self, webhook_path: str, payload: dict) -> dict:
        """Trigger an n8n workflow via webhook."""
        url = f"{self.base_url}/{webhook_path}"
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=30.0)
            if response.status_code not in [200, 201]:
                raise HTTPException(
                    status_code=502,
                    detail=f"n8n webhook failed: {response.status_code}",
                )
            return response.json()

    async def trigger_publish(
        self,
        webhook_url: str,
        caption: str,
        image_urls: list[str],
        project_slug: str,
    ) -> dict:
        """Trigger the publish-meta workflow with content data."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook_url,
                json={
                    "caption": caption,
                    "image_urls": image_urls,
                    "project": project_slug,
                },
                timeout=30.0,
            )
            if response.status_code not in [200, 201]:
                raise HTTPException(
                    status_code=502,
                    detail=f"n8n webhook failed: {response.status_code}",
                )
            return response.json()

    async def trigger_approval(
        self,
        webhook_url: str,
        post_id: int,
        project_slug: str,
        platform: str,
        caption: str,
        media_url: str | None,
    ) -> dict:
        """Trigger the post-approved flow in n8n when a content post is approved in the app.

        n8n should configure a Webhook trigger node at the URL stored in
        ``Project.n8n_webhook_base_url + '/post-approved'`` (or wherever the
        workflow is listening).  The request is authenticated with the
        ``N8N_WEBHOOK_SECRET`` env variable sent as the ``X-Webhook-Secret``
        header.
        """
        secret = settings.N8N_WEBHOOK_SECRET
        headers: dict[str, str] = {}
        if secret:
            headers["X-Webhook-Secret"] = secret

        async with httpx.AsyncClient() as client:
            response = await client.post(
                webhook_url,
                json={
                    "post_id": post_id,
                    "project_slug": project_slug,
                    "platform": platform,
                    "content": caption,
                    "media_url": media_url,
                },
                headers=headers,
                timeout=30.0,
            )
            if response.status_code not in [200, 201]:
                raise HTTPException(
                    status_code=502,
                    detail=f"n8n approval webhook failed: {response.status_code}",
                )
            return response.json()

    async def get_executions(self, workflow_id: str) -> list[dict]:
        """Get recent executions for a workflow."""
        return []
