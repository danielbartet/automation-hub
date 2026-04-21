"""Claude API client — generates carousel content for projects."""
import json
import logging
import anthropic
from anthropic import AsyncAnthropic
from app.core.config import settings

logger = logging.getLogger(__name__)

MARKET_INTELLIGENCE: dict[str, dict[str, str]] = {
    "LATAM": {
        "psychology": "loss aversion, community proof, family/collective identity",
        "price_sensitivity": "high — anchor with monthly not annual pricing",
        "trust_signals": "testimonials from local cities, Spanish-language social proof",
        "platform_behavior": "Instagram Stories > Feed, WhatsApp sharing culture",
        "copy_style": "direct, conversational, avoid corporate tone",
    },
    "North America": {
        "psychology": "individual achievement, ROI-first, time savings",
        "price_sensitivity": "medium — value over price",
        "trust_signals": "case studies, data, authoritative sources",
        "platform_behavior": "LinkedIn for B2B, Instagram for B2C, email converts well",
        "copy_style": "benefit-led, clear CTA, short sentences",
    },
    "Europe": {
        "psychology": "quality, sustainability, privacy-conscious",
        "price_sensitivity": "low for quality products",
        "trust_signals": "certifications, transparency, origin story",
        "platform_behavior": "platform varies by country, email high open rates",
        "copy_style": "formal-moderate, nuanced, avoid hype language",
    },
    "Global": {
        "psychology": "universal human motivations: status, belonging, security, growth",
        "price_sensitivity": "medium",
        "trust_signals": "universal social proof, data, transformation stories",
        "platform_behavior": "optimize for Instagram + Facebook baseline",
        "copy_style": "clear, inclusive, benefit-led, minimal jargon",
    },
}

VALID_FORMATS = ("carousel_6_slides", "single_image", "story_vertical")

VALID_ANGLES = ("Transformation", "Educational", "Social Proof", "Urgency", "Identity", "Comparative")


def _detect_angle_from_content(data: dict) -> str:
    """
    Infer a narrative angle from generated content using keyword matching.
    Falls back to 'Educational' when no clear signal is found.
    """
    text = " ".join([
        data.get("topic", ""),
        data.get("category", ""),
        " ".join(
            (s.get("headline", "") + " " + s.get("body", "") + " " + s.get("subtext", ""))
            for s in data.get("slides", [])
        ),
    ]).lower()

    if any(kw in text for kw in ("transform", "cambio", "antes", "after", "journey", "resultado")):
        return "Transformation"
    if any(kw in text for kw in ("proof", "testimonio", "resultado", "clients", "clientes", "usuarios")):
        return "Social Proof"
    if any(kw in text for kw in ("urgent", "ahora", "hoy", "warning", "riesgo", "verdad incómoda", "stop")):
        return "Urgency"
    if any(kw in text for kw in ("identidad", "comunidad", "somos", "nosotros", "quien", "valores")):
        return "Identity"
    if any(kw in text for kw in ("vs", "versus", "comparar", "antes vs", "old way", "nuevo", "diferencia")):
        return "Comparative"
    return "Educational"


VOICE_STYLES: dict[str, str] = {
    "formal": "Use precise, authoritative language. Avoid contractions. Write in third person when addressing the brand.",
    "conversational": "Write as if talking to a friend. Use 'you' directly. Keep it warm and approachable.",
    "bold": "Be direct and provocative. Short sentences. Strong statements. Never hedge.",
    "educational": "Explain concepts clearly. Use analogies and examples. Break down complexity.",
    "playful": "Light tone, humor welcome. Avoid corporate language. Emojis are acceptable when natural.",
}

FORMAT_SUGGESTIONS_BY_VOICE: dict[str, str] = {
    "playful": "trending/meme formats, short video hooks, entertaining reels",
    "educational": "how-to/tutorial formats, step-by-step carousels, frameworks and checklists",
    "bold": "single strong statement posts, controversy hooks, unpopular opinion formats",
    "formal": "thought leadership posts, data-driven analysis, authoritative long-form",
    "conversational": "Q&A format, behind-the-scenes, polls, personal stories",
}

MODEL_PRICING = {
    "claude-sonnet-4-6": {"input": 3.0, "output": 15.0},
}


def compute_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    pricing = MODEL_PRICING.get(model, {"input": 3.0, "output": 15.0})
    return (input_tokens * pricing["input"] + output_tokens * pricing["output"]) / 1_000_000


class ClaudeClient:
    """Wrapper for Anthropic Claude API calls."""

    MODEL = "claude-sonnet-4-6"

    def __init__(self) -> None:
        self.client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)

    def _build_system_prompt(self, project, num_slides: int = 6) -> str:
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        categories = config.get("content_categories", ["educational", "inspirational"])
        language = config.get("language", "en")
        additional_rules = config.get("additional_rules", [])
        market_region = config.get("market_region")
        if not market_region:
            logger.warning(
                "Project has no market_region set in content_config — using Global defaults"
            )
            market_region = "Global"
        price_range = config.get("price_range", "")
        social_proof_examples = config.get("social_proof_examples", "")
        offer = config.get("offer", "")

        categories_text = "\n".join([f"{i+1}. {cat}" for i, cat in enumerate(categories)])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""

        # Brand voice instruction
        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        # Regional intelligence block
        intel = MARKET_INTELLIGENCE.get(market_region, MARKET_INTELLIGENCE["Global"])
        regional_block = f"""MARKET INTELLIGENCE ({market_region}):
- Consumer psychology: {intel['psychology']}
- Price sensitivity: {intel['price_sensitivity']}
- Trust signals that convert: {intel['trust_signals']}
- Platform behavior: {intel['platform_behavior']}
- Copy style: {intel['copy_style']}"""

        # Brand assets block
        brand_assets = []
        if price_range:
            brand_assets.append(f"- Precio: {price_range}")
        if social_proof_examples:
            brand_assets.append(f"- Prueba social: {social_proof_examples}")
        if offer:
            brand_assets.append(f"- Oferta actual: {offer}")
        brand_assets_block = ("BRAND ASSETS (usa estos datos concretos en el copy cuando aplique):\n" + "\n".join(brand_assets)) if brand_assets else ""

        # Build the slides JSON example dynamically based on num_slides
        middle_slides = num_slides - 2  # exclude hook (slide 1) and close (last slide)
        slides_example_lines = [
            f'    {{"slide_number": 1, "type": "hook", "headline": "max 8 words", "subtext": "max 20 words"}}',
        ]
        for i in range(2, 2 + middle_slides):
            slides_example_lines.append(
                f'    {{"slide_number": {i}, "type": "content", "headline": "max 6 words", "body": "max 40 words"}}'
            )
        slides_example_lines.append(
            f'    {{"slide_number": {num_slides}, "type": "close", "headline": "max 8 words", "cta": "max 15 words"}}'
        )
        slides_example = ",\n".join(slides_example_lines)

        return f"""You are a Senior Marketing Strategist and Expert Copywriter specialized in social media content for {market_region} audiences.

COPYWRITING FRAMEWORKS — apply based on audience temperature:
- Cold audience (no prior contact): Use PAS (Problem, Agitate, Solution)
  Lead with a specific pain, agitate its consequences, present the solution naturally
- Warm audience (knows the brand): Use AIDA (Attention, Interest, Desire, Action)
- Hot audience / retargeting: Use FAB (Features, Advantages, Benefits)
  Translate every feature into a life-changing benefit

HOOK ENGINEERING — every Slide 1 must:
- Stop the scroll in 0.3 seconds
- Score 3+ on the 4U scale: Urgent, Unique, Ultra-specific, Useful
- Use one of these proven patterns:
  * Identity: "Los [persona] que [specific behavior] entienden algo que el resto no."
  * Shock/contrast: "[Surprising stat]. Esto es lo que cambio."
  * Specificity: "[Specific result] en [timeframe]. Esto es lo que hice diferente."
  * Uncomfortable truth: "[Provocative claim that threatens their status quo]."
- Maximum 7 words on the main line

NARRATIVE ANGLES — rotate, never repeat consecutively:
1. Transformation: from current painful state to desired future state
2. Educational: frameworks, systems, how-to with genuine depth
3. Social Proof: specific numbers, real results, community validation
4. Urgency/Uncomfortable Truths: what happens if nothing changes
5. Identity/Community: shared values, who we are as a group
6. Comparative: old way vs new way, with vs without, before vs after

{regional_block}

QUALITY GATES — before finalizing any content, verify:
1. Hook scores 3U+ (Urgent, Unique, Ultra-specific, Useful)
2. Contains at least one specific detail (number, name, timeframe)
3. Person feels they gained something even without buying
4. Exactly ONE action in the CTA slide
5. Sounds like THIS brand, not any brand
6. Does NOT use: "fundamental", "esencial", "crucial", "importante destacar", "en el mundo actual"

SLIDE STRUCTURE RULES:
- Slide 1: Hook ONLY. Maximum 7 words main line. No context, no explanation.
- Slides 2-{num_slides - 1}: ONE idea per slide, fully resolved. Headline (10 words max) + body (25 words max)
- Slide {num_slides}: CTA. Single action. Centered. Clear outcome + next step.

CAPTION RULES:
- Line 1: Hook that earns the "Ver mas" expand
- Body: Value delivery or story that deepens the post
- Last line: Single CTA
- Hashtags: 3-5 highly specific (not generic like #marketing or #tech)

You are the content generation system for {brand_name}.

BRAND POSITIONING:
- Brand name: {brand_name}
- Core message: {core_message}
- Target audience: {target_audience}

TONE:
{tone}

BRAND VOICE ({brand_voice}):
{voice_instruction}

CONTENT CATEGORIES (rotate between these):
{categories_text}

{brand_assets_block}

{f"ADDITIONAL RULES:{chr(10)}{rules_text}" if rules_text else ""}

OUTPUT FORMAT:
Always respond with a valid JSON object and nothing else:
{{
  "category": "string (one of the categories above)",
  "topic": "string (specific topic of this content)",
  "narrative_angle": "one of: Transformation | Educational | Social Proof | Urgency | Identity | Comparative",
  "slides": [
{slides_example}
  ],
  "caption": "150-200 chars",
  "hashtags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}}

RULES:
- Always return valid JSON, nothing else before or after
- The "slides" array must contain exactly {num_slides} objects/slides
- Generate ALL content in: {language}
- Never use generic or cliché phrases
- Slide 1 must make someone stop scrolling
- Each slide must have one single clear idea
- Rotate categories — never generate the same category twice in a row"""

    async def generate_carousel_content(self, project, num_slides: int = 6) -> tuple[dict, dict]:
        """Generate carousel content for a project using Claude."""
        num_slides = max(3, min(10, num_slides))
        return await self.generate_content_by_type(project, content_type="carousel_6_slides", num_slides=num_slides)

    async def generate_content_by_type(
        self,
        project,
        content_type: str = "carousel_6_slides",
        category: str | None = None,
        hint: str | None = None,
        competitor_ads: list[dict] | None = None,
        content_config: dict | None = None,
        num_slides: int = 6,
    ) -> tuple[dict, dict]:
        """Generate content for a project based on content_type.

        Supports: carousel_6_slides | single_image | story_vertical | story | text_post
        Optional category and hint are injected into the user message when provided.
        competitor_ads: optional list of competitor ad dicts — injected as context when present.
        content_config: project content_config dict — injected into brand context blocks.
        Returns (content_dict, usage_dict).
        """
        cfg = content_config or project.content_config or {}

        if content_type in ("story", "story_vertical"):
            system_prompt = self._build_story_system_prompt(project, content_config=cfg)
            user_msg = f"Generate one story post for {project.name} following your instructions exactly."
        elif content_type in ("single_image", "image"):
            system_prompt = self._build_single_image_system_prompt(project, content_config=cfg)
            user_msg = f"Generate one single-image post for {project.name} following your instructions exactly."
        elif content_type == "text_post":
            system_prompt = self._build_text_post_system_prompt(project, content_config=cfg)
            user_msg = f"Generate one text post for {project.name} following your instructions exactly."
        else:
            # Default: carousel_6_slides
            num_slides = max(3, min(10, num_slides))
            system_prompt = self._build_system_prompt(project, num_slides=num_slides)
            user_msg = f"Generate one carousel for {project.name} following your instructions exactly."

        # Append optional modifiers
        extras: list[str] = []
        if category:
            extras.append(f"Focus on the category: {category}")
        if hint:
            extras.append(f"IMPORTANT: Generate content specifically about this topic: {hint}. Keep this as the main subject while following all brand guidelines.")
        if extras:
            user_msg += " " + " | ".join(extras)

        # Append competitor context block
        if competitor_ads:
            comp_lines = []
            for ad in competitor_ads[:4]:
                page = ad.get("page_name", "?")
                body = (ad.get("ad_creative_bodies") or [""])[0][:80]
                comp_lines.append(f"- {page}: \"{body}\"")
            comp_block = "\n\nCOMPETITOR ADS CURRENTLY RUNNING (use OPPOSITE angle and messaging):\n" + "\n".join(comp_lines)
        else:
            comp_block = ""

        user_msg += comp_block

        try:
            response = await self.client.messages.create(
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
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error: %s", e)
            raise
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }

        content = response.content[0].text.strip()
        # Strip markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        try:
            result = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error("generate_content_by_type: failed to parse Claude JSON response: %s", e)
            raise

        # Extract or infer the narrative angle and attach it to the response dict
        raw_angle = result.get("narrative_angle", "")
        if raw_angle in VALID_ANGLES:
            result["narrative_angle"] = raw_angle
        else:
            result["narrative_angle"] = _detect_angle_from_content(result)

        # Carousel slide structure validation (log only — never block)
        if content_type not in ("single_image", "image", "story", "story_vertical", "text_post"):
            slides = result.get("slides", [])
            if len(slides) >= 2:
                first_slide = slides[0]
                last_slide = slides[-1]
                if not first_slide.get("hook") and not first_slide.get("title") and not first_slide.get("headline"):
                    logger.warning("Carousel validation: slide 1 missing hook/title/headline")
                has_cta = (
                    last_slide.get("cta")
                    or last_slide.get("call_to_action")
                    or any(
                        word in str(last_slide).lower()
                        for word in ["descubre", "aprende", "visita", "link", "bio", "sigue", "click"]
                    )
                )
                if not has_cta:
                    logger.warning("Carousel validation: last slide missing CTA")

        return result, usage

    def _build_single_image_system_prompt(self, project, content_config: dict | None = None) -> str:
        config = content_config or project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "")
        language = config.get("language", "es")
        content_categories = config.get("content_categories", [])
        price_range = config.get("price_range", "")
        social_proof_examples = config.get("social_proof_examples", "")
        offer = config.get("offer", "")

        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        brand_assets = []
        if price_range:
            brand_assets.append(f"- Precio: {price_range}")
        if social_proof_examples:
            brand_assets.append(f"- Prueba social: {social_proof_examples}")
        if offer:
            brand_assets.append(f"- Oferta actual: {offer}")
        brand_assets_block = ("BRAND ASSETS (usa estos datos concretos en el copy cuando aplique):\n" + "\n".join(brand_assets)) if brand_assets else ""

        return f"""You are a Senior Social Media Copywriter specialized in high-impact single-image posts.

BRAND VOICE: {voice_instruction}

SINGLE IMAGE RULES:
- ONE bold idea. No explanations, no lists.
- Headline: max 8 words — must stop the scroll instantly
- Subtext: max 20 words — one supporting detail or stat
- CTA: max 10 words — single clear action
- Score 3U+ on 4U scale (Urgent, Unique, Ultra-specific, Useful)
- The image concept must be specific and actionable for a designer

CONTEXTO DE MARCA:
{f"- Marca: {brand_name}" if brand_name else ""}
{f"- Audiencia objetivo: {target_audience}" if target_audience else "- Audiencia: profesionales en redes sociales"}
{f"- Mensaje central: {core_message}" if core_message else ""}
{f"- Categorías de contenido: {', '.join(content_categories)}" if content_categories else ""}
- Tono: {tone}
- Idioma: {language}

{brand_assets_block}

FRAMEWORKS DE COPYWRITING (elige el más adecuado):
- PAS: Problema → Agitación → Solución
- AIDA: Atención → Interés → Deseo → Acción
- 4U: Útil, Urgente, Único, Ultra-específico

OUTPUT FORMAT — valid JSON only:
{{
  "format": "single_image",
  "narrative_angle": "one of: Transformation | Educational | Social Proof | Urgency | Identity | Comparative",
  "category": "string",
  "topic": "string",
  "headline": "max 8 words",
  "subtext": "max 20 words",
  "cta": "max 10 words",
  "image_concept": "specific visual description for designer — what to show, mood, composition",
  "caption": "150-200 chars",
  "hashtags": ["tag1", "tag2", "tag3"]
}}

Generate ALL content in: {language}
Return valid JSON only, nothing else."""

    def _build_story_system_prompt(self, project, content_config: dict | None = None) -> str:
        config = content_config or project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "")
        language = config.get("language", "es")
        content_categories = config.get("content_categories", [])
        price_range = config.get("price_range", "")
        social_proof_examples = config.get("social_proof_examples", "")
        offer = config.get("offer", "")

        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        brand_assets = []
        if price_range:
            brand_assets.append(f"- Precio: {price_range}")
        if social_proof_examples:
            brand_assets.append(f"- Prueba social: {social_proof_examples}")
        if offer:
            brand_assets.append(f"- Oferta actual: {offer}")
        brand_assets_block = ("BRAND ASSETS (usa estos datos concretos en el copy cuando aplique):\n" + "\n".join(brand_assets)) if brand_assets else ""

        return f"""You are a Senior Social Media Copywriter specialized in Instagram/Facebook Stories.

BRAND VOICE: {voice_instruction}

STORY RULES:
- Vertical format (9:16). Minimal text — max 3 lines visible.
- Conversational, personal, direct — like talking to a friend
- Hook in first 0.5 seconds — use a question or bold claim
- One CTA that feels natural, not salesy (swipe up, DM, reply)
- Visual must work without sound

CONTEXTO DE MARCA:
{f"- Marca: {brand_name}" if brand_name else ""}
{f"- Audiencia objetivo: {target_audience}" if target_audience else "- Audiencia: profesionales en redes sociales"}
{f"- Mensaje central: {core_message}" if core_message else ""}
{f"- Categorías de contenido: {', '.join(content_categories)}" if content_categories else ""}
- Tono: {tone}
- Idioma: {language}

{brand_assets_block}

FRAMEWORKS DE COPYWRITING (elige el más adecuado):
- PAS: Problema → Agitación → Solución
- AIDA: Atención → Interés → Deseo → Acción
- 4U: Útil, Urgente, Único, Ultra-específico

OUTPUT FORMAT — valid JSON only:
{{
  "format": "story_vertical",
  "narrative_angle": "one of: Transformation | Educational | Social Proof | Urgency | Identity | Comparative",
  "category": "string",
  "topic": "string",
  "hook_text": "bold opening line, max 6 words",
  "body_text": "1-2 lines max, conversational",
  "cta_text": "natural CTA, max 8 words",
  "background_concept": "color/gradient/image description for the story background",
  "sticker_suggestion": "optional interactive element (poll, question, slider)",
  "caption": "80-120 chars (stories don't need long captions)",
  "hashtags": ["tag1", "tag2", "tag3"]
}}

Generate ALL content in: {language}
Return valid JSON only, nothing else."""

    def _build_text_post_system_prompt(self, project, content_config: dict | None = None) -> str:
        config = content_config or project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        tone = config.get("tone", "professional, clear")
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "en")
        content_categories = config.get("content_categories", [])
        additional_rules = config.get("additional_rules", [])
        rules_text = "\n".join([f"- {rule}" for rule in additional_rules]) if additional_rules else ""
        price_range = config.get("price_range", "")
        social_proof_examples = config.get("social_proof_examples", "")
        offer = config.get("offer", "")

        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        brand_assets = []
        if price_range:
            brand_assets.append(f"- Precio: {price_range}")
        if social_proof_examples:
            brand_assets.append(f"- Prueba social: {social_proof_examples}")
        if offer:
            brand_assets.append(f"- Oferta actual: {offer}")
        brand_assets_block = ("BRAND ASSETS (usa estos datos concretos en el copy cuando aplique):\n" + "\n".join(brand_assets)) if brand_assets else ""

        return f"""You are the content generation system for {brand_name}.

BRAND VOICE: {voice_instruction}

CONTEXTO DE MARCA:
{f"- Marca: {brand_name}" if brand_name else ""}
{f"- Audiencia objetivo: {target_audience}" if target_audience else "- Audiencia: profesionales en redes sociales"}
{f"- Mensaje central: {core_message}" if core_message else ""}
{f"- Categorías de contenido: {', '.join(content_categories)}" if content_categories else ""}
- Tono: {tone}
- Idioma: {language}

{brand_assets_block}

FRAMEWORKS DE COPYWRITING (elige el más adecuado):
- PAS: Problema → Agitación → Solución
- AIDA: Atención → Interés → Deseo → Acción
- 4U: Útil, Urgente, Único, Ultra-específico

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

    async def generate_content(self, prompt: str, system_prompt: str = "") -> tuple[str, dict]:
        """Generate text content — generic helper. Returns (text, usage_dict)."""
        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=1000,
                system=system_prompt or "You are a helpful assistant.",
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error: %s", e)
            raise
        if not response.content:
            raise ValueError("Empty response from Claude")
        usage = {
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
            "cache_read_tokens": getattr(response.usage, "cache_read_input_tokens", 0) or 0,
            "model": self.MODEL,
        }
        return response.content[0].text, usage

    async def generate_content_recommendation(
        self,
        project,
        recent_posts: list[dict],
        competitor_ads: list[dict],
        posting_timezone: str = "UTC",
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
        tz_note = f" (UTC — target audience timezone: {posting_timezone})" if posting_timezone and posting_timezone != "UTC" else " (UTC)"

        # Build recent posts summary (includes narrative_angle for tracking)
        recent_angles: list[str] = []
        if recent_posts:
            posts_lines = []
            for p in recent_posts:
                topic = ""
                if p.get("content") and isinstance(p["content"], dict):
                    topic = p["content"].get("topic", p["content"].get("category", ""))
                angle = p.get("narrative_angle", "")
                if angle:
                    recent_angles.append(angle)
                posts_lines.append(
                    f"- {p.get('created_at', 'N/A')} | {p.get('format', 'N/A')} | {angle or 'Unknown'} | {topic} | {p.get('status', 'N/A')}"
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

        # Build angle avoidance instruction based on last 3 posts
        recent_3_angles = recent_angles[:3]
        if recent_3_angles:
            angle_avoidance = f"CRITICAL: You MUST avoid these recently used angles: {', '.join(recent_3_angles)}. Choose from the remaining angles only."
        else:
            angle_avoidance = "No angle history — choose freely based on the day of week guidelines."

        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])
        format_suggestion = FORMAT_SUGGESTIONS_BY_VOICE.get(brand_voice, FORMAT_SUGGESTIONS_BY_VOICE["conversational"])

        system_prompt = f"""You are a social media strategist expert for {language} content.
You specialize in maximizing organic reach on Instagram and Facebook for {brand_name}.
You always respond with valid JSON only, no markdown, no explanations outside the JSON.
CRITICAL JSON RULES: All string values must be on a single line. Never include literal newlines, tabs, or unescaped quotes inside string values. Use spaces instead of newlines within strings.

BRAND VOICE: {voice_instruction}
PREFERRED FORMAT DIRECTION (based on brand voice): {format_suggestion}

Apply the 6 Narrative Angles framework when recommending content:
1. Transformation, 2. Educational, 3. Social Proof,
4. Urgency/Uncomfortable Truths, 5. Identity/Community, 6. Comparative

{angle_avoidance}

Check the last 6 posts' angles. Recommend the angle that:
a) Has not been used recently (avoid repetition)
b) Matches the day of week:
   Monday: bold statements, uncomfortable truths
   Tuesday/Wednesday: educational frameworks
   Thursday: aspirational/transformation
   Saturday: identity/community
   Sunday: reflective identity content

Rate the suggested hook with the 4U scale before including it.
Only suggest hooks that score 3U or higher.

FRAMEWORKS ADICIONALES:
- PAS (Problema-Agitación-Solución): para contenido que aborda pain points
- AIDA (Atención-Interés-Deseo-Acción): para contenido de conversión
- FAB (Features-Advantages-Benefits): para contenido educativo/producto
- BAB (Before-After-Bridge): para casos de éxito y transformación

PRINCIPIOS CIALDINI para selección de formato:
- Reciprocidad: contenido que da valor genuito primero
- Autoridad: datos, cifras, experiencia demostrable
- Prueba social: menciona resultados, comunidad, validación externa
- Escasez/urgencia: solo cuando sea auténtico al contexto

TEMPERATURA DE AUDIENCIA:
- Fría (nuevo seguidor): PAS o 4U con educación
- Tibia (engageó antes): AIDA o BAB con casos
- Caliente (cliente potencial): FAB o directo a beneficio

FORMAT SELECTION RULES — choose the best format for today:
- carousel_6_slides: educational deep-dives, frameworks, step-by-step content, transformation stories. Best Tuesday/Wednesday/Thursday.
- single_image: bold statements, quotes, uncomfortable truths, social proof with one strong stat. Best Monday/Friday.
- story_vertical: casual/personal content, behind-the-scenes, community building, time-sensitive CTAs. Best any day for warm audiences.
Consider what formats competitors are using — differentiate when possible."""

        user_prompt = f"""Today is {weekday}, {date_str} at {time_str}{tz_note}.
Posting timezone: {posting_timezone} — factor this into best_time_to_post recommendations.

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
    "format": "carousel_6_slides | single_image | story_vertical",
    "format_reason": "why this format fits today's angle and audience temperature",
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
      "topic_hint": "the suggested_topic value here",
      "format_hint": "the recommended format value here"
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
        response = await self.client.messages.create(
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

    async def generate_caption(self, topic: str, tone: str, language: str = "es", content_config: dict | None = None) -> str:
        """Generate a social media caption for a topic."""
        cfg = content_config or {}
        brand_name = cfg.get("brand_name", "")
        target_audience = cfg.get("target_audience", "")
        core_message = cfg.get("core_message", "")
        content_categories = cfg.get("content_categories", [])
        price_range = cfg.get("price_range", "")
        social_proof_examples = cfg.get("social_proof_examples", "")
        offer = cfg.get("offer", "")

        brand_assets = []
        if price_range:
            brand_assets.append(f"- Precio: {price_range}")
        if social_proof_examples:
            brand_assets.append(f"- Prueba social: {social_proof_examples}")
        if offer:
            brand_assets.append(f"- Oferta actual: {offer}")
        brand_assets_block = ("BRAND ASSETS (usa estos datos concretos en el copy cuando aplique):\n" + "\n".join(brand_assets)) if brand_assets else ""

        system_prompt = f"""Eres un experto en copywriting para redes sociales.
Tu objetivo: escribir captions que detengan el scroll, generen engagement y conecten emocionalmente.

FRAMEWORKS A APLICAR (elige el más adecuado para el tema):
- PAS: Problema → Agitación → Solución
- AIDA: Atención → Interés → Deseo → Acción
- 4U: Útil, Urgente, Único, Ultra-específico
- BAB: Before → After → Bridge

CONTEXTO DE MARCA:
{f"- Marca: {brand_name}" if brand_name else ""}
{f"- Audiencia objetivo: {target_audience}" if target_audience else "- Audiencia: profesionales en redes sociales"}
{f"- Mensaje central: {core_message}" if core_message else ""}
{f"- Categorías de contenido: {', '.join(content_categories)}" if content_categories else ""}
- Tono: {tone}
- Idioma: {language}

{brand_assets_block}

PRINCIPIOS DE PERSUASIÓN (Cialdini):
- Escasez/urgencia cuando sea auténtico
- Prueba social con datos concretos
- Autoridad con afirmaciones verificables

LÍMITES TÉCNICOS META:
- Caption máximo: 2200 caracteres
- Los primeros 125 caracteres son críticos (se muestran antes del "ver más")
- Incluye 3-5 hashtags relevantes al final

REGLAS:
- NO uses frases genéricas ("En el mundo de hoy...", "Es importante...")
- SÍ usa hook potente en la primera línea
- SÍ termina con CTA claro
- NO incluyas comillas alrededor del caption
- Devuelve SOLO el caption, sin explicaciones"""

        prompt = f"Escribe un caption para: {topic}"

        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=500,
                system=system_prompt,
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit in generate_caption: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error in generate_caption: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error in generate_caption: %s", e)
            raise

        if not response.content:
            raise ValueError("Empty response from Claude in generate_caption")

        caption = response.content[0].text.strip()
        if not caption:
            raise ValueError("Empty caption returned by Claude")
        return caption

    def _enforce_meta_limits(self, concept: dict) -> dict:
        """Truncate ad copy fields to Meta platform limits at word boundaries."""
        limits = {
            "body": 125,
            "hook_3s": 80,
            "headline": 40,
            "description": 30,
        }
        for field, max_len in limits.items():
            value = concept.get(field, "")
            if value and len(value) > max_len:
                truncated = value[:max_len].rsplit(" ", 1)[0]
                logger.warning(
                    f"Meta copy limit: field '{field}' truncated from {len(value)} to {len(truncated)} chars (limit: {max_len})"
                )
                concept[field] = truncated
        return concept

    def _validate_pda_diversity(self, concepts: list[dict]) -> None:
        """Log warnings if PDA (Persona-Desire-Awareness) diversity is insufficient."""
        personas = [c.get("persona") for c in concepts if c.get("persona")]
        awarenesses = [c.get("awareness") for c in concepts if c.get("awareness")]

        unique_personas = len(set(personas))
        unique_awarenesses = len(set(awarenesses))

        if unique_personas < 3:
            logger.warning(
                f"PDA diversity warning: only {unique_personas} distinct personas found in concept batch (recommend ≥3)"
            )
        if unique_awarenesses < 2:
            logger.warning(
                f"PDA diversity warning: only {unique_awarenesses} distinct awareness levels found (recommend ≥2)"
            )

    def _validate_ad_concepts(self, concepts: list[dict]) -> int:
        """Validate each concept for required fields. Logs warnings. Returns count of valid concepts."""
        valid_count = 0
        valid_angles = {"transformation", "educational", "social_proof", "urgency", "identity_community", "comparative"}

        for i, concept in enumerate(concepts):
            errors = []

            # Check required text fields — using field names from the actual schema
            for field in ["body", "hook_3s", "headline"]:
                if not concept.get(field):
                    errors.append(f"missing or empty '{field}'")

            # Check narrative angle — the schema uses 'psychological_angle' for concepts
            angle = concept.get("psychological_angle") or concept.get("narrative_angle")
            if not angle:
                errors.append("missing 'psychological_angle'")
            # Note: ad concepts use Logical/Emotional/Social Proof/Problem-Solution angles,
            # not the carousel content angles. We validate presence only, not the specific value.

            if errors:
                logger.warning(f"Concept {i} failed validation: {'; '.join(errors)}")
            else:
                valid_count += 1

        logger.info(f"generate_ad_concepts: {valid_count}/{len(concepts)} concepts passed full validation")
        return valid_count

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
        inspiration: dict | None = None,
    ) -> dict:
        """Generate Andromeda-compliant ad concepts for a project."""
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        core_message = product_description or config.get("core_message", "")
        target_audience = config.get("target_audience", "general audience")
        language = config.get("language", "es")
        price_range = config.get("price_range", "")
        social_proof_examples = config.get("social_proof_examples", "")
        offer = config.get("offer", "")

        brand_assets_lines = []
        if price_range:
            brand_assets_lines.append(f"- Precio del producto: {price_range}")
        if social_proof_examples:
            brand_assets_lines.append(f"- Prueba social disponible: {social_proof_examples}")
        if offer:
            brand_assets_lines.append(f"- Oferta actual: {offer}")
        brand_assets_ad_block = ("\nBRAND ASSETS — use these concrete data points in copy when relevant:\n" + "\n".join(brand_assets_lines)) if brand_assets_lines else ""

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

        conversion_block = ""
        if campaign_objective == "OUTCOME_SALES" or existing_hooks:
            conversion_block = """
CONVERSION CAMPAIGN RULES (audience already knows the brand):
- Skip awareness and education — they know the problem
- Lead with FAB: Feature → Advantage → specific Benefit for THEIR life
- Include minimum 2 Social Proof concepts (specific numbers, real results)
- Include minimum 1 Urgency concept (real scarcity only, never fake)
- Price can and should appear in the copy — justify it with comparison
  ("menos que un cafe por semana", "lo que gastas en una suscripcion")
- Loss aversion framing beats gain framing:
  "deja de ser el primero en ser reemplazado" beats "conviertete en arquitecto"
- Every hook must score 3U+ on the 4U scale
- CTA must be direct: "Comprar ahora", "Ver el pack", not "Mas informacion"
"""

        inspiration_block = ""
        if inspiration:
            competitor_body = inspiration.get("competitor_body", "")
            competitor_rationale = inspiration.get("competitor_rationale", "")
            inspiration_block = f"""
COMPETITOR INSPIRATION:
Ad copy from a competitor ad that is performing well:
"{competitor_body}"

Strategic angle observed: {competitor_rationale}

Use this as directional inspiration — adapt the angle and emotional trigger for our brand.
Do NOT copy the text. Translate the strategic insight into original concepts that reflect {brand_name}'s voice and positioning.
"""

        brand_voice = config.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        system_prompt = f"""You are an expert Meta Ads creative strategist specializing in the Andromeda algorithm.

Generate {count} advertising concepts for {brand_name}.

BRAND VOICE: {voice_instruction}

Brand context:
- Product/service: {core_message}
- Target audience: {target_audience}
- Campaign objective: {campaign_objective}
- Language: {language}{brand_assets_ad_block}
{objective_block}{audience_block}{inspiration_block}
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
{fatigue_block}{conversion_block}
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

        try:
            response = await self.client.messages.create(
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
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error: %s", e)
            raise
        content = response.content[0].text.strip()
        # Strip markdown code blocks if present
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        try:
            result = json.loads(content)
        except json.JSONDecodeError as e:
            logger.error("generate_ad_concepts: failed to parse Claude JSON response: %s", e)
            raise
        if "concepts" not in result:
            raise ValueError(f"Claude response missing 'concepts' key. Got: {list(result.keys())}")
        concepts = result.get("concepts", [])
        concepts = self._validate_entity_diversity(concepts)
        concepts = [self._enforce_meta_limits(c) for c in concepts]
        self._validate_pda_diversity(concepts)
        self._validate_ad_concepts(concepts)
        result["concepts"] = concepts
        return result

    @staticmethod
    def _parse_competitors(competitors_raw) -> list[str]:
        """Parse competitors from content_config into a clean list of handles.

        Handles backward-compatible formats:
        - list of str (new): ["@midudev", "hola.devs"]
        - list of dict with 'handle' key: [{"handle": "@midudev", ...}]
        - comma/newline-separated str (legacy): "@midudev\nhola.devs, codewithchris"
        - empty / None: returns []
        """
        if not competitors_raw:
            return []
        if isinstance(competitors_raw, list):
            result = []
            for item in competitors_raw:
                if isinstance(item, dict):
                    handle = item.get("handle") or item.get("name") or ""
                else:
                    handle = str(item)
                handle = handle.strip().lstrip("@")
                if handle:
                    result.append(handle)
            return result
        return [
            c.strip().lstrip("@")
            for c in str(competitors_raw).replace("\n", ",").split(",")
            if c.strip()
        ]

    @staticmethod
    def _jaccard_similarity(text1: str, text2: str) -> float:
        words1 = set(text1.lower().split())
        words2 = set(text2.lower().split())
        if not words1 or not words2:
            return 0.0
        return len(words1 & words2) / len(words1 | words2)

    def _validate_entity_diversity(self, concepts: list[dict]) -> list[dict]:
        """
        Removes concepts that are too semantically similar to each other.
        Uses simple keyword overlap as a proxy for Entity ID similarity.
        If two concepts share more than 60% of significant words in their
        hook_3s + body combined, remove the one with higher entity_id_risk.
        Returns the filtered list with a minimum of 6 concepts.
        """
        import re

        def significant_words(text: str) -> set:
            stop_words = {'el', 'la', 'los', 'las', 'de', 'del', 'que', 'en',
                          'un', 'una', 'y', 'o', 'a', 'es', 'se', 'no', 'tu',
                          'te', 'para', 'por', 'con', 'su', 'si', 'al', 'lo'}
            words = re.findall(r'\b\w+\b', text.lower())
            return {w for w in words if w not in stop_words and len(w) > 3}

        def similarity(c1: dict, c2: dict) -> float:
            text1 = f"{c1.get('hook_3s', '')} {c1.get('body', '')}"
            text2 = f"{c2.get('hook_3s', '')} {c2.get('body', '')}"
            words1 = significant_words(text1)
            words2 = significant_words(text2)
            if not words1 or not words2:
                return 0.0
            intersection = len(words1 & words2)
            union = len(words1 | words2)
            return intersection / union if union > 0 else 0.0

        validated = []
        for concept in concepts:
            too_similar = False
            for existing in validated:
                if similarity(concept, existing) > 0.60:
                    if concept.get('entity_id_risk') == 'LOW':
                        validated.remove(existing)
                    else:
                        too_similar = True
                    break
            if not too_similar:
                validated.append(concept)

        # Never return fewer than 6 concepts
        if len(validated) < 6:
            for c in concepts:
                if c not in validated:
                    validated.append(c)
                if len(validated) >= 6:
                    break

        return validated

    async def analyze_competitor_brief(
        self,
        competitor_ads: list[dict],
        content_config: dict | None = None,
    ) -> dict:
        """Analyze competitor ads and return a structured weekly intelligence brief.

        Returns a dict with keys: hook_patterns, angle_distribution, cta_distribution,
        copy_length, dominant_style, opportunity_gap, weekly_recommendation.
        """
        cfg = content_config or {}
        market_region = cfg.get("market_region", "Global")
        target_audience = cfg.get("target_audience", "")
        language = cfg.get("language", "en")

        ads_payload = json.dumps(
            [
                {
                    "page_name": ad.get("page_name", ad.get("competitor", "")),
                    "body": (ad.get("body") or (ad.get("ad_creative_bodies") or [""])[0])[:200],
                    "headline": ad.get("title", ad.get("headline", "")),
                    "cta": ad.get("cta", ""),
                    "days_active": ad.get("days_active", 0),
                }
                for ad in competitor_ads[:30]
            ],
            ensure_ascii=False,
        )

        system_prompt = f"""You are a competitive intelligence analyst specializing in digital advertising for {market_region} markets.

Target audience context: {target_audience}
Language: {language}

Analyze the provided competitor ads and identify:
1. Hook patterns — common opening structures (e.g. "How to X in Y", question hooks, shock stats)
2. Angle distribution — what percentage use each narrative angle
3. CTA distribution — most common call-to-action phrases
4. Copy length patterns — median, min, max character counts for ad body
5. Dominant style — one sentence describing the dominant creative approach
6. Opportunity gap — what NO competitor is currently doing (the whitespace)
7. Weekly recommendation — one concrete, actionable recommendation for this week

Return ONLY valid JSON matching this exact schema, no other text:
{{
  "hook_patterns": [{{"pattern": "string", "frequency": 0.00}}],
  "angle_distribution": {{"Transformation": 0.00, "Educational": 0.00, "Social Proof": 0.00, "Urgency": 0.00, "Identity": 0.00, "Comparative": 0.00}},
  "cta_distribution": {{"Learn More": 0.00}},
  "copy_length": {{"median": 0, "min": 0, "max": 0}},
  "dominant_style": "string",
  "opportunity_gap": "string",
  "weekly_recommendation": "string"
}}"""

        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=1500,
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
                        "content": f"Analyze these {len(competitor_ads)} competitor ads:\n{ads_payload}",
                    }
                ],
                extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
            )
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit in analyze_competitor_brief: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error in analyze_competitor_brief: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error in analyze_competitor_brief: %s", e)
            raise

        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()

        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            logger.error("analyze_competitor_brief: failed to parse Claude JSON: %s", e)
            raise

    async def generate_hook_variations(
        self,
        topic: str,
        num_hooks: int = 5,
        content_config: dict = None,
    ) -> list[dict]:
        """Generates N hook variations for a given topic.

        Returns: [{hook_type, hook, rationale}]
        """
        cfg = content_config or {}
        market_region = cfg.get("market_region", "Global")
        brand_voice = cfg.get("brand_voice", "conversational")
        voice_instruction = VOICE_STYLES.get(brand_voice, VOICE_STYLES["conversational"])

        # Regional context for the hook
        intel = MARKET_INTELLIGENCE.get(market_region, MARKET_INTELLIGENCE["Global"])
        regional_copy_style = intel.get("copy_style", "clear, benefit-led")

        system_prompt = f"""You are a copywriter expert in social media hooks.
Generate exactly {num_hooks} hooks for the topic: "{topic}"
Each hook must be a DIFFERENT type from: question, statistic, bold_statement, story_opener, how_to, controversial
Each hook must be under 125 characters.
Brand voice ({brand_voice}): {voice_instruction}
Regional copy style ({market_region}): {regional_copy_style}
Return ONLY a valid JSON array. No preamble, no explanation, only JSON:
[{{"hook_type": "...", "hook": "...", "rationale": "..."}}]"""

        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=1000,
                system=system_prompt,
                messages=[
                    {
                        "role": "user",
                        "content": f"Generate {num_hooks} hook variations for the topic: {topic}",
                    }
                ],
            )
        except anthropic.RateLimitError as e:
            logger.warning("Claude rate limit in generate_hook_variations: %s", e)
            raise
        except anthropic.APIConnectionError as e:
            logger.warning("Claude connection error in generate_hook_variations: %s", e)
            raise
        except anthropic.APIError as e:
            logger.error("Claude API error in generate_hook_variations: %s", e)
            raise

        raw = response.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```", 2)[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.rsplit("```", 1)[0].strip()

        try:
            hooks = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error("generate_hook_variations: failed to parse Claude JSON: %s", e)
            raise

        if not isinstance(hooks, list):
            raise ValueError("generate_hook_variations: expected a JSON array from Claude")

        # Enforce 125-char limit on each hook
        for h in hooks:
            if len(h.get("hook", "")) > 125:
                h["hook"] = h["hook"][:125].rsplit(" ", 1)[0]

        return hooks

    async def generate_ab_test_variants(
        self,
        concept: dict,
        num_variants: int = 3,
        content_config: dict | None = None,
    ) -> list[dict]:
        """
        Given an existing ad concept, generates N hook variants.
        Same core message, different opening hooks and headlines.
        Returns list of dicts: [{hook_type, hook, headline, rationale}]
        """
        config = content_config or {}
        brand_name = config.get("brand_name", "the brand")
        language = config.get("language", "en")

        original_hook = concept.get("hook_3s") or concept.get("body", "")
        original_headline = concept.get("headline", "")
        original_body = concept.get("body", "")

        system_prompt = f"""You are an expert Meta Ads copywriter specializing in hook optimization.
Your task is to generate {num_variants} A/B test hook variants for an existing ad concept.

ORIGINAL CONCEPT:
- Hook: {original_hook}
- Headline: {original_headline}
- Body: {original_body}

REQUIREMENTS:
- Keep the SAME core message and value proposition
- Change ONLY the opening hook and headline
- Each variant must use a DIFFERENT hook type:
  * question: Opens with a provocative question
  * statistic: Opens with a surprising data point or number
  * bold_statement: Opens with a confident, contrarian claim
  * story_opener: Opens with a micro-narrative ("Last Tuesday...")
  * how_to: Opens with an actionable promise
- Apply Meta limits: headline ≤ 40 chars, hook ≤ 125 chars
- Language: {language}
- Brand: {brand_name}

Return ONLY valid JSON array. No markdown, no explanation.
[
  {{
    "hook_type": "question",
    "hook": "...",
    "headline": "...",
    "rationale": "Why this variant might outperform the original"
  }},
  ...
]"""

        response = await self.client.messages.create(
            model=self.MODEL,
            max_tokens=1000,
            messages=[{"role": "user", "content": f"Generate {num_variants} hook variants for A/B testing."}],
            system=system_prompt,
        )

        raw = response.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        variants = json.loads(raw)

        # Enforce meta limits
        for v in variants:
            if len(v.get("hook", "")) > 125:
                v["hook"] = v["hook"][:125].rsplit(" ", 1)[0]
            if len(v.get("headline", "")) > 40:
                v["headline"] = v["headline"][:40].rsplit(" ", 1)[0]

        return variants

    async def analyze_competitor_ads(self, ads: list[dict], brand_config: dict) -> list[dict]:
        """Analyze a batch of competitor ads (up to 20) and return 1:1 analysis list."""
        brand_name = brand_config.get("brand_name", "")
        language = brand_config.get("language", "es")

        default_analysis = lambda i: {
            "index": i,
            "hook_analysis": "",
            "psychological_angle": "",
            "inferred_objective": "OUTCOME_AWARENESS",
            "audience_signal": "",
            "strength": "",
            "opportunity": "",
            "days_active_signal": "",
        }

        if not ads:
            return []

        ads_payload = json.dumps(
            [
                {
                    "index": i,
                    "page_name": ad.get("page_name", ""),
                    "body": ad.get("body", ""),
                    "title": ad.get("title", ""),
                    "days_active": ad.get("days_active", 0),
                    "platforms": ad.get("platforms", []),
                }
                for i, ad in enumerate(ads)
            ],
            ensure_ascii=False,
        )

        system_prompt = f"""You are a paid advertising strategist analyzing competitor ads for {brand_name}.
Language for analysis: {language}.

For each ad in the input array, provide strategic intelligence.
inferred_objective MUST be exactly one of: OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS

Return ONLY valid JSON — an array aligned 1:1 with the input:
[
  {{
    "index": 0,
    "hook_analysis": "what makes the opening attention-grabbing or weak",
    "psychological_angle": "Logical | Emotional | Social Proof | Problem-Solution | Urgency | Identity",
    "inferred_objective": "OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS",
    "audience_signal": "who this ad is targeting based on messaging signals",
    "strength": "what this ad does well that could be replicated",
    "opportunity": "gap or weakness that {brand_name} could exploit",
    "days_active_signal": "what the days_active count signals about performance"
  }}
]"""

        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=3000,
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
                        "content": f"Analyze these competitor ads:\n{ads_payload}",
                    }
                ],
                extra_headers={"anthropic-beta": "prompt-caching-2024-07-31"},
            )
            content = response.content[0].text.strip()
            if content.startswith("```"):
                content = content.split("```", 2)[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.rsplit("```", 1)[0].strip()
            analyses = json.loads(content)
            if not isinstance(analyses, list):
                return [default_analysis(i) for i in range(len(ads))]
            result = []
            index_map = {item["index"]: item for item in analyses if isinstance(item, dict) and "index" in item}
            for i in range(len(ads)):
                if i in index_map:
                    result.append(index_map[i])
                elif i < len(analyses):
                    item = analyses[i]
                    item["index"] = i
                    result.append(item)
                else:
                    result.append(default_analysis(i))
            return result
        except Exception:
            return [default_analysis(i) for i in range(len(ads))]

    async def research_competitors_by_name(self, competitors: list[str], brand_config: dict) -> list[dict]:
        """Use Claude's knowledge to synthesize competitor insights when Meta Ad Library returns no ads.

        Returns a list of dicts in the same format as get_competitor_ads() so the existing
        pipeline works unchanged. Each entry is flagged with _synthetic=True.
        """
        if not competitors:
            return []

        language = brand_config.get("language", "es")
        brand_name = brand_config.get("brand_name", "")
        content_categories = brand_config.get("content_categories", [])
        target_audience = brand_config.get("target_audience", "")

        # Cap at 3 competitors
        top_competitors = competitors[:3]

        competitors_json = json.dumps(top_competitors, ensure_ascii=False)
        brand_context = json.dumps({
            "brand_name": brand_name,
            "content_categories": content_categories,
            "target_audience": target_audience,
        }, ensure_ascii=False)

        system_prompt = f"""Eres un estratega de publicidad digital con profundo conocimiento del ecosistema de redes sociales y marketing de contenidos en habla hispana.
Tu tarea: analizar competidores de una marca basándote en tu conocimiento de su estilo de contenido, mensajes, y estrategia de comunicación.
Idioma de respuesta: {language}.
Marca cliente: {brand_name}. Audiencia objetivo: {target_audience}.

Para cada competidor de la lista, genera UN ejemplo representativo de anuncio/publicación en su estilo, junto con un análisis estratégico.

Devuelve SOLAMENTE JSON válido — un array con un objeto por competidor:
[
  {{
    "competitor": "nombre_handle",
    "page_name": "Nombre de Página Conocido o el handle si no se conoce",
    "body": "ejemplo de copy de anuncio representativo de su estilo real (2-4 oraciones)",
    "title": "titular representativo de su estilo",
    "ad_creative_bodies": ["ejemplo de copy de anuncio representativo de su estilo real"],
    "days_active": 30,
    "platforms": ["instagram", "facebook"],
    "snapshot_url": "",
    "analysis": {{
      "index": 0,
      "hook_analysis": "qué hace llamativo o débil su apertura habitual",
      "psychological_angle": "Logical | Emotional | Social Proof | Problem-Solution | Urgency | Identity",
      "inferred_objective": "OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS",
      "audience_signal": "a quién se dirige este competidor según sus mensajes",
      "strength": "qué hace bien este competidor que podría replicarse",
      "opportunity": "brecha o debilidad que {brand_name} podría aprovechar",
      "days_active_signal": "basado en conocimiento de marca (dato sintético)"
    }},
    "_synthetic": true
  }}
]

IMPORTANTE: El campo "body" y "title" deben ser ejemplos REALES y representativos del estilo auténtico de comunicación de cada competidor, no genéricos. Si no conoces el competidor, crea un ejemplo plausible basado en su nicho."""

        try:
            response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=2000,
                system=[{"type": "text", "text": system_prompt}],
                messages=[
                    {
                        "role": "user",
                        "content": f"Competidores a analizar: {competitors_json}\nContexto de marca: {brand_context}",
                    }
                ],
            )
            content = response.content[0].text.strip()
            if content.startswith("```"):
                content = content.split("```", 2)[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.rsplit("```", 1)[0].strip()
            result = json.loads(content)
            if not isinstance(result, list):
                return []
            # Ensure required fields and correct index in analysis
            cleaned = []
            for i, item in enumerate(result):
                if not isinstance(item, dict):
                    continue
                # Ensure analysis.index is correct
                if isinstance(item.get("analysis"), dict):
                    item["analysis"]["index"] = i
                item["_synthetic"] = True
                cleaned.append(item)
            return cleaned
        except Exception as e:
            logger.warning("research_competitors_by_name failed: %s", e)
            return []

    async def adapt_competitor_ad(self, project, competitor_ad: dict, analysis: dict) -> dict:
        """Generate a campaign concept adapted from a competitor ad for the given project."""
        config = project.content_config or {}
        brand_name = config.get("brand_name", project.name)
        core_message = config.get("core_message", "")
        target_audience = config.get("target_audience", "")
        tone = config.get("tone", "")
        language = config.get("language", "es")

        valid_objectives = {"OUTCOME_LEADS", "OUTCOME_SALES", "OUTCOME_TRAFFIC", "OUTCOME_AWARENESS"}

        system_prompt = f"""You are a paid advertising strategist.
Brand: {brand_name}
Core message: {core_message}
Target audience: {target_audience}
Tone: {tone}
Language: {language}

Adapt the competitor ad intelligence into a campaign concept for {brand_name}.
objective MUST be exactly one of: OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS

Return ONLY valid JSON:
{{
  "campaign_name": "short descriptive name for the campaign",
  "objective": "OUTCOME_LEADS | OUTCOME_SALES | OUTCOME_TRAFFIC | OUTCOME_AWARENESS",
  "ad_copy": "primary text for the ad (max 125 chars)",
  "headline": "ad headline (max 40 chars)",
  "rationale": "1-2 sentences explaining why this adaptation works for the brand"
}}"""

        competitor_payload = json.dumps(
            {
                "competitor_ad": {
                    "page_name": competitor_ad.get("page_name", ""),
                    "body": competitor_ad.get("body", ""),
                    "title": competitor_ad.get("title", ""),
                    "days_active": competitor_ad.get("days_active", 0),
                },
                "analysis": {
                    "hook_analysis": analysis.get("hook_analysis", ""),
                    "psychological_angle": analysis.get("psychological_angle", ""),
                    "inferred_objective": analysis.get("inferred_objective", ""),
                    "strength": analysis.get("strength", ""),
                    "opportunity": analysis.get("opportunity", ""),
                },
            },
            ensure_ascii=False,
        )

        user_message = f"Adapt this competitor ad for {brand_name}:\n{competitor_payload}"

        response = await self.client.messages.create(
            model=self.MODEL,
            max_tokens=500,
            messages=[
                {
                    "role": "user",
                    "content": user_message,
                }
            ],
            system=system_prompt,
        )
        content = response.content[0].text.strip()
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
            content = content.rsplit("```", 1)[0].strip()
        result = json.loads(content)
        if result.get("objective") not in valid_objectives:
            result["objective"] = "OUTCOME_LEADS"

        # Enforce Meta ad copy length limits
        if result.get("ad_copy") and len(result["ad_copy"]) > 125:
            logger.warning(
                "adapt_competitor_ad: ad_copy truncated from %d to 125 chars", len(result["ad_copy"])
            )
            result["ad_copy"] = result["ad_copy"][:125].rsplit(" ", 1)[0]

        if result.get("headline") and len(result["headline"]) > 40:
            logger.warning(
                "adapt_competitor_ad: headline truncated from %d to 40 chars", len(result["headline"])
            )
            result["headline"] = result["headline"][:40].rsplit(" ", 1)[0]

        # Jaccard similarity check — retry if adapted copy is too similar to competitor original
        competitor_text = competitor_ad.get("body", "") + " " + competitor_ad.get("title", "")
        adapted_text = result.get("ad_copy", "") + " " + result.get("headline", "")
        similarity = self._jaccard_similarity(competitor_text, adapted_text)

        if similarity > 0.6:
            logger.warning(
                f"adapt_competitor_ad similarity too high ({similarity:.2f}) — retrying with stricter prompt"
            )
            retry_user_message = (
                "IMPORTANT: The previous adaptation was too similar to the original. "
                "Make it significantly different — change the angle, hook, and structure completely. "
                "Do not reuse the same opening words or sentence structure.\n\n"
                + user_message
            )
            retry_response = await self.client.messages.create(
                model=self.MODEL,
                max_tokens=500,
                messages=[{"role": "user", "content": retry_user_message}],
                system=system_prompt,
            )
            retry_content = retry_response.content[0].text.strip()
            if retry_content.startswith("```"):
                retry_content = retry_content.split("```", 2)[1]
                if retry_content.startswith("json"):
                    retry_content = retry_content[4:]
                retry_content = retry_content.rsplit("```", 1)[0].strip()
            retry_result = json.loads(retry_content)
            if retry_result.get("objective") not in valid_objectives:
                retry_result["objective"] = "OUTCOME_LEADS"
            if retry_result.get("ad_copy") and len(retry_result["ad_copy"]) > 125:
                retry_result["ad_copy"] = retry_result["ad_copy"][:125].rsplit(" ", 1)[0]
            if retry_result.get("headline") and len(retry_result["headline"]) > 40:
                retry_result["headline"] = retry_result["headline"][:40].rsplit(" ", 1)[0]

            retry_adapted = retry_result.get("ad_copy", "") + " " + retry_result.get("headline", "")
            retry_sim = self._jaccard_similarity(competitor_text, retry_adapted)
            if retry_sim > 0.6:
                logger.warning(
                    f"adapt_competitor_ad retry still similar ({retry_sim:.2f}) — returning retry result anyway"
                )
            return retry_result

        return result
