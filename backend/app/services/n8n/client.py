"""n8n webhook client — triggers n8n automation workflows."""
import httpx
from fastapi import HTTPException


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

    async def get_executions(self, workflow_id: str) -> list[dict]:
        """Get recent executions for a workflow."""
        return []
