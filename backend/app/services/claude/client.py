"""Claude API client — generates carousel content for projects."""
import json
from anthropic import Anthropic
from app.core.config import settings


class ClaudeClient:
    """Wrapper for Anthropic Claude API calls."""

    MODEL = "claude-sonnet-4-20250514"

    def __init__(self) -> None:
        self.client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    def _build_system_prompt(self, project) -> str:
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        categories = config.get("content_categories", ["educational", "inspirational"])
        language = config.get("language", "en")
        additional_rules = config.get("additional_rules", [])

        categories_text = "\n".join([f"{i+1}. {cat}" for i, cat in enumerate(categories)])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""

        return f"""You are the content generation system for {brand_name}.

BRAND POSITIONING:
- Brand name: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}

TONE:
{tone}

CONTENT CATEGORIES (rotate between these):
{categories_text}

{f"ADDITIONAL RULES:{chr(10)}{rules_text}" if rules_text else ""}

OUTPUT FORMAT:
Always respond with a valid JSON object and nothing else:
{{
  "category": "string (one of the categories above)",
  "topic": "string (specific topic of this content)",
  "slides": [
    {{"slide_number": 1, "type": "hook", "headline": "max 8 words", "subtext": "max 20 words"}},
    {{"slide_number": 2, "type": "content", "headline": "max 6 words", "body": "max 40 words"}},
    {{"slide_number": 3, "type": "content", "headline": "max 6 words", "body": "max 40 words"}},
    {{"slide_number": 4, "type": "content", "headline": "max 6 words", "body": "max 40 words"}},
    {{"slide_number": 5, "type": "content", "headline": "max 6 words", "body": "max 40 words"}},
    {{"slide_number": 6, "type": "close", "headline": "max 8 words", "cta": "max 15 words"}}
  ],
  "caption": "150-200 chars",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

RULES:
- Always return valid JSON, nothing else before or after
- Generate ALL content in: {language}
- Never use generic or cliché phrases
- Slide 1 must make someone stop scrolling
- Each slide must have one single clear idea
- Rotate categories — never generate the same category twice in a row"""

    async def generate_carousel_content(self, project) -> dict:
        """Generate carousel content for a project using Claude."""
        system_prompt = self._build_system_prompt(project)

        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            system=[
                {
                    "type": "text",
                    "text": system_prompt,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[
                {
                    "role": "user",
                    "content": f"Generate one carousel for {project.name} following your instructions exactly.",
                }
            ],
            extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
        )

        content = response.content[0].text.strip()
        # Strip markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        return json.loads(content)

    async def generate_content(self, prompt: str, system_prompt: str = "") -> str:
        """Generate text content — generic helper."""
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=500,
            system=system_prompt or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    async def generate_caption(self, topic: str, tone: str, language: str = "es") -> str:
        """Generate a social media caption for a topic."""
        prompt = f"Write a social media caption about '{topic}' in {language} with {tone} tone. Max 200 characters."
        return await self.generate_content(prompt)
