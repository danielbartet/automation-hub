"""Content generation skill — uses Claude to produce social media copy."""
from app.models.project import Project
from app.skills.base import BaseSkill
from app.services.claude.client import ClaudeClient


class ContentGenerationSkill(BaseSkill):
    """Generates social media captions and image prompts via Claude API."""

    def __init__(self, project: Project) -> None:
        super().__init__(project)
        self.claude = ClaudeClient()

    @property
    def name(self) -> str:
        return "content_generation"

    @property
    def description(self) -> str:
        return "Generate social media captions and image prompts using Claude API"

    async def execute(self, payload: dict) -> dict:
        """Generate content for the given topic and format.

        Args:
            payload: {
                "topic": str,
                "format": "carousel" | "single_image" | "text",
                "tone": str (optional, falls back to project default)
            }

        Returns:
            {"caption": str, "image_prompt": str | None, "status": "success"}
        """
        topic = payload.get("topic", "")
        tone = payload.get("tone", "direct, technical")
        language = "es"

        caption = await self.claude.generate_caption(topic=topic, tone=tone, language=language)
        return {
            "caption": caption,
            "image_prompt": f"[STUB] Visual for: {topic}",
            "status": "success",
        }
