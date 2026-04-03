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
        return await self.generate_content_by_type(project, content_type="carousel_6_slides")

    async def generate_content_by_type(
        self,
        project,
        content_type: str = "carousel_6_slides",
        category: str | None = None,
        hint: str | None = None,
    ) -> dict:
        """Generate content for a project based on content_type.

        Supports: carousel_6_slides | single_image | text_post
        Optional category and hint are injected into the user message when provided.
        """
        if content_type == "single_image":
            system_prompt = self._build_single_image_system_prompt(project)
            user_msg = f"Generate one single-image post for {project.name} following your instructions exactly."
        elif content_type == "text_post":
            system_prompt = self._build_text_post_system_prompt(project)
            user_msg = f"Generate one text post for {project.name} following your instructions exactly."
        else:
            # Default: carousel_6_slides
            system_prompt = self._build_system_prompt(project)
            user_msg = f"Generate one carousel for {project.name} following your instructions exactly."

        # Append optional modifiers
        extras: list[str] = []
        if category:
            extras.append(f"Focus on the category: {category}")
        if hint:
            extras.append(f"IMPORTANT: Generate content specifically about this topic: {hint}. Keep this as the main subject while following all brand guidelines.")
        if extras:
            user_msg += " " + " | ".join(extras)

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
                    "content": user_msg,
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

    def _build_single_image_system_prompt(self, project) -> str:
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "en")
        additional_rules = config.get("additional_rules", [])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""

        return f"""You are the content generation system for {brand_name}.

BRAND POSITIONING:
- Brand name: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}

TONE:
{tone}

{f"ADDITIONAL RULES:{chr(10)}{rules_text}" if rules_text else ""}

OUTPUT FORMAT:
Always respond with a valid JSON object and nothing else:
{{
  "format": "single_image",
  "category": "string (topic category)",
  "topic": "string (specific topic of this post)",
  "headline": "max 10 words — one strong hook line",
  "subtext": "max 20 words — supporting idea",
  "caption": "max 150 chars — social media caption",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

RULES:
- Always return valid JSON, nothing else before or after
- Generate ALL content in: {language}
- Headline must stop the scroll in under 2 seconds
- Never use generic or cliché phrases"""

    def _build_text_post_system_prompt(self, project) -> str:
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "en")
        additional_rules = config.get("additional_rules", [])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""

        return f"""You are the content generation system for {brand_name}.

BRAND POSITIONING:
- Brand name: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}

TONE:
{tone}

{f"ADDITIONAL RULES:{chr(10)}{rules_text}" if rules_text else ""}

OUTPUT FORMAT:
Always respond with a valid JSON object and nothing else:
{{
  "format": "text_post",
  "category": "string (topic category)",
  "topic": "string (specific topic of this post)",
  "title": "max 12 words — attention-grabbing opener",
  "body": "2-3 short paragraphs, max 300 chars total",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

RULES:
- Always return valid JSON, nothing else before or after
- Generate ALL content in: {language}
- Body must have one clear takeaway per paragraph
- Never use generic or cliché phrases"""

    async def generate_content(self, prompt: str, system_prompt: str = "") -> str:
        """Generate text content — generic helper."""
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=500,
            system=system_prompt or "You are a helpful assistant.",
            messages=[{"role": "user", "content": prompt}],
        )
        return response.content[0].text

    async def generate_content_recommendation(
        self,
        project,
        recent_posts: list[dict],
        competitor_ads: list[dict],
    ) -> dict:
        """Generate a 'what to post today' recommendation."""
        import re
        from datetime import datetime, timezone

        config = project.content_config or {}
        language = config.get("language", "es")
        brand_name = config.get("brand_name", project.name)
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "")
        business_objective = config.get("business_objective", "")
        content_categories = config.get("content_categories", [])
        posting_frequency = config.get("posting_frequency", "")

        now = datetime.now(timezone.utc)
        weekdays_es = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
        weekdays_en = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        weekday_idx = now.weekday()
        weekday = weekdays_es[weekday_idx] if language == "es" else weekdays_en[weekday_idx]
        date_str = now.strftime("%d/%m/%Y")
        time_str = now.strftime("%H:%M")

        # Build recent posts summary
        if recent_posts:
            posts_lines = []
            for p in recent_posts:
                topic = ""
                if p.get("content") and isinstance(p["content"], dict):
                    topic = p["content"].get("topic", p["content"].get("category", ""))
                posts_lines.append(
                    f"- {p.get('created_at', 'N/A')} | {p.get('format', 'N/A')} | {topic} | {p.get('status', 'N/A')}"
                )
            posts_summary = "\n".join(posts_lines)
        else:
            posts_summary = "No hay publicaciones recientes."

        # Build competitor ads summary
        if competitor_ads:
            comp_lines = []
            for ad in competitor_ads[:10]:  # limit to top 10 for prompt size
                body_preview = (ad.get("body", "") or "")[:100]
                comp_lines.append(
                    f"- {ad['competitor']} | \"{body_preview}\" | {ad['days_active']} días activo | {', '.join(ad.get('platforms', []))}"
                )
            comp_summary = "\n".join(comp_lines)
        else:
            comp_summary = "No hay datos de competidores disponibles."

        system_prompt = f"""You are a social media strategist expert for {language} content.
You specialize in maximizing organic reach on Instagram and Facebook for {brand_name}.
You always respond with valid JSON only, no markdown, no explanations outside the JSON.
CRITICAL JSON RULES: All string values must be on a single line. Never include literal newlines, tabs, or unescaped quotes inside string values. Use spaces instead of newlines within strings."""

        user_prompt = f"""Today is {weekday}, {date_str} at {time_str} UTC.

Project context:
- Brand: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}
- Objective: {business_objective}
- Content categories: {', '.join(content_categories)}
- Posting frequency: {posting_frequency}

Recent posting history (last 10 posts):
{posts_summary}

Active competitor ads (sorted by days active — longer = likely performing):
{comp_summary}

Instructions:
1. Analyze posting gaps — when was the last post? What formats haven't been used recently?
2. Analyze competitor ads — what angles are they using? What's NOT being covered?
3. Consider today's day of week and time for optimal engagement:
   - Monday/Lunes: high engagement, good for bold statements
   - Tuesday/Miércoles: best for educational content
   - Thursday/Jueves: aspirational content performs well
   - Friday/Viernes: lighter content, community building
   - Weekend/Fin de semana: reflective, identity content
4. Recommend what to post TODAY with maximum differentiation from competitors.
5. For "suggested_category", you MUST pick exactly one value from this list: {', '.join(content_categories) if content_categories else 'any'}

Return ONLY valid JSON (no markdown, no code blocks):
{{
  "should_post_today": true,
  "urgency": "high",
  "urgency_reason": "string",
  "recommendation": {{
    "format": "carousel_6_slides",
    "format_reason": "why this format today",
    "content_angle": "Logical",
    "angle_reason": "why this angle",
    "suggested_category": "{content_categories[0] if content_categories else ''}",
    "suggested_topic": "specific topic",
    "suggested_hook": "exact opening line",
    "suggested_cta": "what action to ask",
    "best_time_to_post": "HH:MM",
    "best_time_reason": "why this time",
    "what_to_avoid": "what NOT to post today"
  }},
  "competitive_insight": {{
    "competitors_analyzed": ["handle1"],
    "dominant_angle": "what competitors mostly use",
    "opportunity": "what angle is NOT covered"
  }},
  "quick_actions": [
    {{
      "label": "Generar este contenido ahora",
      "action": "generate",
      "topic_hint": "the suggested_topic value here"
    }},
    {{
      "label": "Ver otra sugerencia",
      "action": "regenerate"
    }},
    {{
      "label": "Planificar la semana",
      "action": "plan_week"
    }}
  ]
}}"""

        # Use direct API call with enough tokens for the full JSON response
        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=2000,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        response_text = response.content[0].text

        # Strip markdown code blocks if present
        response_text = re.sub(r'^```(?:json)?\s*', '', response_text.strip())
        response_text = re.sub(r'\s*```$', '', response_text.strip())

        # Try direct parse; if it fails, sanitize newlines inside strings then retry
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            # Replace literal newlines inside JSON string values (between quotes)
            # This handles the case where Claude puts \n in string content
            def fix_newlines_in_strings(s: str) -> str:
                result = []
                in_string = False
                escape_next = False
                for ch in s:
                    if escape_next:
                        result.append(ch)
                        escape_next = False
                    elif ch == '\\' and in_string:
                        result.append(ch)
                        escape_next = True
                    elif ch == '"':
                        in_string = not in_string
                        result.append(ch)
                    elif ch in ('\n', '\r', '\t') and in_string:
                        result.append(' ')
                    else:
                        result.append(ch)
                return ''.join(result)

            cleaned = fix_newlines_in_strings(response_text)
            return json.loads(cleaned)

    async def generate_caption(self, topic: str, tone: str, language: str = "es") -> str:
        """Generate a social media caption for a topic."""
        prompt = f"Write a social media caption about '{topic}' in {language} with {tone} tone. Max 200 characters."
        return await self.generate_content(prompt)

    async def generate_ad_concepts(
        self,
        project,
        campaign_objective: str,
        count: int = 12,
        product_description: str | None = None,
        existing_hooks: list[str] | None = None,
        destination_url: str | None = None,
        audience_type: str = "broad",
        pixel_event: str | None = None,
    ) -> dict:
        """Generate Andromeda-compliant ad concepts for a project."""
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        core_message = product_description or config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "es")

        fatigue_block = ""
        if existing_hooks:
            hooks_list = "\n".join(f"- {h}" for h in existing_hooks)
            fatigue_block = f"""
IMPORTANT: These are the EXISTING hooks that are fatigued — generate concepts that are
conceptually OPPOSITE to these:
{hooks_list}
Do NOT reuse the same psychological angle or visual approach as any of the existing hooks.
"""

        # Additional context blocks based on objective and audience
        objective_block = ""
        if "SALES" in campaign_objective.upper():
            dest = destination_url or "the product page"
            objective_block = f"""
CAMPAIGN CONTEXT — SALES/CONVERSIONS:
Destination: {dest}
Key difference from LEADS campaigns:
- People already know the brand OR are similar to existing customers
- Focus on: specific offer, price justification, testimonials, urgency
- Avoid: purely educational content (they're past that stage)
- Include at least 2 concepts with Social Proof angle (testimonials, results)
- Include at least 1 concept with urgency/scarcity angle
"""

        audience_block = ""
        if audience_type in ("retargeting_lookalike", "custom"):
            audience_block = """
AUDIENCE CONTEXT — RETARGETING:
Audience: people who already visited the site or are on the leads list.
They know the brand. Skip the awareness/education angle.
Focus on: why buy NOW, specific offer details, what they'll get.
"""

        system_prompt = f"""You are an expert Meta Ads creative strategist specializing in the Andromeda algorithm.

Generate {count} advertising concepts for {brand_name}.

Brand context:
- Product/service: {core_message}
- Target audience: {target_audience}
- Campaign objective: {campaign_objective}
- Language: {language}
{objective_block}{audience_block}
ANDROMEDA RULES (mandatory):
1. Each concept must have a unique Entity ID — less than 60% semantic similarity between any two
2. Vary P.D.A. for every concept:
   - Persona: who is being addressed
   - Desire: what outcome they want
   - Awareness: Problem-aware / Solution-aware / Product-aware
3. Rotate psychological angles: Logical / Emotional / Social Proof / Problem-Solution
4. Each concept needs a disruptive 3-second hook
5. Vary formats: some for video (Reels 9:16), some for static (Feed 1:1 or 4:5)
6. Minimum 3 different psychological angles across the full set
7. No two concepts with same P.D.A. combination
{fatigue_block}
Return ONLY valid JSON:
{{
  "concepts": [
    {{
      "id": 1,
      "persona": "string",
      "desire": "string",
      "awareness": "Problem-aware | Solution-aware | Product-aware",
      "psychological_angle": "Logical | Emotional | Social Proof | Problem-Solution",
      "hook_3s": "exact opening line or visual description",
      "body": "main message max 125 chars",
      "cta": "Learn More | Sign Up | Shop Now | Contact Us",
      "format": "Reels 9:16 | Feed 1:1 | Feed 4:5",
      "visual_style": "typographic | data_visual | ugc_style | minimal",
      "entity_id_risk": "LOW | MEDIUM",
      "entity_id_reason": "why this is distinct from others"
    }}
  ],
  "diversity_audit": {{
    "angles_covered": [],
    "formats_covered": [],
    "pda_combinations": 0,
    "estimated_unique_entity_ids": 0,
    "warnings": []
  }}
}}"""

        response = self.client.messages.create(
            model=self.MODEL,
            max_tokens=4000,
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
                    "content": f"Generate {count} ad concepts for {brand_name} following the Andromeda rules exactly.",
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
