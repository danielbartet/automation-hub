"""HTML-based slide renderer — generates 1080x1080 PNG slides via Playwright/Chromium.

Each slide is rendered from an HTML template built entirely from media_config values.
Zero hardcoded colors — all visual tokens come from the project's media_config.
Claude API is used to generate creative HTML for each slide; fixed templates are the fallback.
"""
import html
import logging
import asyncio
import re
from datetime import datetime

from app.services.media.base import BaseImageProvider

logger = logging.getLogger(__name__)


class HTMLSlideRenderer(BaseImageProvider):
    """Render carousel slides as 1080x1080 PNG images using headless Chromium via Playwright."""

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    def _escape(self, text: str) -> str:
        """HTML-escape a text value."""
        return html.escape(str(text or ""))

    def _base_css(self, mc: dict) -> str:
        """Return global CSS variables and resets derived from media_config.

        Color resolution order (first non-empty wins):
          image_bg_color → bg_color → brand_bg_color → "#0a0a0a"
          image_primary_color → primary_color → brand_primary_color → "#00FF41"
        brand_* keys come from content_config and are injected by callers when media_config
        does not yet have explicit overrides.

        External fonts: if media_config contains font_urls (list of URLs) and font_family
        (string name), @font-face blocks are injected and the custom font is used as
        the primary font with Space Grotesk as fallback.
        """
        bg = (
            mc.get("image_bg_color")
            or mc.get("bg_color")
            or mc.get("brand_bg_color", "#0a0a0a")
        )
        primary = (
            mc.get("image_primary_color")
            or mc.get("primary_color")
            or mc.get("brand_primary_color", "#00FF41")
        )
        secondary = mc.get("image_secondary_color", mc.get("secondary_color", "#ffffff"))
        accent = mc.get("accent_color", primary)

        # External font support
        font_urls = mc.get("font_urls", [])
        font_family_name = mc.get("font_family", "CustomFont")
        if font_urls and isinstance(font_urls, list):
            # Build @font-face blocks for each URL
            custom_font_faces = "\n".join(
                f"        @font-face {{\n            font-family: '{font_family_name}';\n            src: url('{url}');\n        }}"
                for url in font_urls
            )
            font_family = f"'{font_family_name}', 'Space Grotesk', sans-serif"
        else:
            custom_font_faces = ""
            font_family = mc.get("image_fonts", mc.get("fonts", "'Space Grotesk', sans-serif"))

        logger.debug(
            "_base_css colors — bg=%s primary=%s secondary=%s accent=%s",
            bg, primary, secondary, accent,
        )

        return f"""
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 400;
            src: url('file:///app/fonts/SpaceGrotesk-Regular.ttf') format('truetype');
        }}
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 700;
            src: url('file:///app/fonts/SpaceGrotesk-Bold.ttf') format('truetype');
        }}
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 600;
            src: url('file:///app/fonts/SpaceGrotesk-SemiBold.ttf') format('truetype');
        }}
        {custom_font_faces}
        *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
        :root {{
            --bg: {bg};
            --primary: {primary};
            --secondary: {secondary};
            --accent: {accent};
            --font: {font_family};
        }}
        html, body {{
            width: 1080px;
            height: 1080px;
            background: var(--bg);
            color: var(--secondary);
            font-family: var(--font);
            -webkit-font-smoothing: antialiased;
            overflow: hidden;
        }}
        .slide {{
            width: 1080px;
            height: 1080px;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            background: var(--bg);
        }}
        """

    def _hook_layout(self, slide_data: dict, mc: dict) -> str:
        """Slide 1 — bold hook layout: giant headline + accent bar."""
        headline = self._escape(slide_data.get("headline", ""))
        brand = self._escape(mc.get("brand_handle", mc.get("brand_name", "")))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))

        return f"""
        <style>
        .hook-wrap {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 80px 72px 60px;
        }}
        .hook-bar {{
            width: 64px;
            height: 6px;
            background: var(--primary);
            margin-bottom: 40px;
            border-radius: 3px;
        }}
        .hook-headline {{
            font-size: 96px;
            font-weight: 900;
            line-height: 1.0;
            color: var(--secondary);
            letter-spacing: -2px;
            text-transform: uppercase;
        }}
        .hook-headline em {{
            color: {primary};
            font-style: normal;
        }}
        .hook-brand {{
            margin-top: auto;
            padding-top: 40px;
            font-size: 24px;
            font-weight: 600;
            color: var(--primary);
            letter-spacing: 3px;
            text-transform: uppercase;
        }}
        </style>
        <div class="hook-wrap">
            <div class="hook-bar"></div>
            <div class="hook-headline">{headline}</div>
            <div class="hook-brand">@{brand}</div>
        </div>
        """

    def _content_layout(self, slide_data: dict, mc: dict) -> str:
        """Middle slides — headline + body text layout."""
        headline = self._escape(slide_data.get("headline", ""))
        subtext = self._escape(slide_data.get("subtext", ""))
        slide_num = slide_data.get("slide_number", 1)
        total = slide_data.get("total_slides", 6)
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))

        return f"""
        <style>
        .content-wrap {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            padding: 72px 72px 60px;
        }}
        .content-counter {{
            font-size: 18px;
            font-weight: 700;
            color: {primary};
            letter-spacing: 4px;
            text-transform: uppercase;
            margin-bottom: 32px;
        }}
        .content-headline {{
            font-size: 72px;
            font-weight: 800;
            line-height: 1.1;
            color: var(--secondary);
            letter-spacing: -1.5px;
            margin-bottom: 40px;
        }}
        .content-divider {{
            width: 48px;
            height: 4px;
            background: {primary};
            border-radius: 2px;
            margin-bottom: 36px;
        }}
        .content-body {{
            font-size: 36px;
            font-weight: 400;
            line-height: 1.5;
            color: var(--secondary);
            opacity: 0.85;
        }}
        </style>
        <div class="content-wrap">
            <div class="content-counter">{slide_num:02d} / {total:02d}</div>
            <div class="content-headline">{headline}</div>
            <div class="content-divider"></div>
            <div class="content-body">{subtext}</div>
        </div>
        """

    def _cta_layout(self, slide_data: dict, mc: dict) -> str:
        """Last slide — CTA layout with brand + call-to-action."""
        headline = self._escape(slide_data.get("headline", ""))
        subtext = self._escape(slide_data.get("subtext", ""))
        brand = self._escape(mc.get("brand_handle", mc.get("brand_name", "")))
        cta_url = self._escape(mc.get("image_cta_url", mc.get("cta_url", "")))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))

        return f"""
        <style>
        .cta-wrap {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 72px;
            text-align: center;
        }}
        .cta-icon {{
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: {primary};
            display: flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 40px;
            font-size: 40px;
            color: {bg};
            font-weight: 900;
        }}
        .cta-headline {{
            font-size: 64px;
            font-weight: 900;
            line-height: 1.1;
            color: var(--secondary);
            letter-spacing: -1px;
            margin-bottom: 32px;
            text-transform: uppercase;
        }}
        .cta-body {{
            font-size: 32px;
            line-height: 1.5;
            color: var(--secondary);
            opacity: 0.75;
            margin-bottom: 48px;
        }}
        .cta-brand {{
            font-size: 28px;
            font-weight: 700;
            color: {primary};
            letter-spacing: 2px;
        }}
        .cta-url {{
            font-size: 22px;
            font-weight: 400;
            color: var(--secondary);
            opacity: 0.5;
            margin-top: 8px;
            letter-spacing: 1px;
        }}
        </style>
        <div class="cta-wrap">
            <div class="cta-icon">→</div>
            <div class="cta-headline">{headline}</div>
            <div class="cta-body">{subtext}</div>
            <div class="cta-brand">@{brand}</div>
            {f'<div class="cta-url">{cta_url}</div>' if cta_url else ''}
        </div>
        """

    # ------------------------------------------------------------------ #
    # Single-image layout (1080×1080 square)
    # ------------------------------------------------------------------ #

    def _single_image_layout(self, slide_data: dict, mc: dict) -> str:
        """Full-bleed typographic single-image layout."""
        headline = self._escape(slide_data.get("headline", ""))
        subtext = self._escape(slide_data.get("subtext", ""))
        cta = self._escape(slide_data.get("cta", ""))
        brand = self._escape(mc.get("brand_handle", mc.get("brand_name", "")))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))

        return f"""
        <style>
        .si-wrap {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 80px 72px;
            text-align: center;
            gap: 0;
        }}
        .si-bar {{
            width: 80px;
            height: 6px;
            background: {primary};
            border-radius: 3px;
            margin-bottom: 52px;
        }}
        .si-headline {{
            font-size: 88px;
            font-weight: 900;
            line-height: 1.05;
            color: var(--secondary);
            letter-spacing: -2px;
            text-transform: uppercase;
            margin-bottom: 36px;
        }}
        .si-subtext {{
            font-size: 34px;
            font-weight: 400;
            line-height: 1.5;
            color: var(--secondary);
            opacity: 0.75;
            margin-bottom: 64px;
            max-width: 800px;
        }}
        .si-cta {{
            display: inline-block;
            padding: 20px 48px;
            background: {primary};
            color: {bg};
            font-size: 26px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            border-radius: 4px;
            margin-bottom: 48px;
        }}
        .si-brand {{
            font-size: 22px;
            font-weight: 600;
            color: {primary};
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-top: auto;
        }}
        </style>
        <div class="si-wrap">
            <div class="si-bar"></div>
            <div class="si-headline">{headline}</div>
            {'<div class="si-subtext">' + subtext + '</div>' if subtext else ''}
            {'<div class="si-cta">' + cta + '</div>' if cta else ''}
            <div class="si-brand">@{brand}</div>
        </div>
        """

    def _build_single_image_html(self, slide_data: dict, mc: dict) -> str:
        """Assemble complete HTML for a single-image post (1080×1080)."""
        base_css = self._base_css(mc)
        inner = self._single_image_layout(slide_data, mc)
        is_rtl = mc.get("rtl", False)
        html_dir = ' dir="rtl"' if is_rtl else ""
        rtl_css = "\n        body { direction: rtl; text-align: right; }" if is_rtl else ""
        return f"""<!DOCTYPE html>
<html lang="es"{html_dir}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1080">
<style>
{base_css}{rtl_css}
</style>
</head>
<body>
<div class="slide">
{inner}
</div>
</body>
</html>"""

    async def render_single_image(self, slide_data: dict, media_config: dict) -> str:
        """Render a single-image post to a 1080×1080 PNG and upload to S3.

        slide_data keys: headline, subtext, cta
        """
        from app.services.storage.s3 import S3Service

        html_content = self._build_single_image_html(slide_data, media_config)
        try:
            png_bytes = await self._html_to_png(html_content)
        except Exception as exc:
            logger.error("Playwright render failed for single_image: %s", exc)
            raise

        s3 = S3Service()
        url = await s3.upload_bytes(png_bytes, folder="generated/single")
        logger.info("HTMLSlideRenderer uploaded single_image: %s", url)
        return url

    # ------------------------------------------------------------------ #
    # Story-vertical layout (1080×1920, 9:16)
    # ------------------------------------------------------------------ #

    def _story_layout(self, slide_data: dict, mc: dict) -> str:
        """Vertical story layout — hook / body / CTA in three zones."""
        hook = self._escape(slide_data.get("hook_text", slide_data.get("headline", "")))
        body = self._escape(slide_data.get("body_text", slide_data.get("subtext", "")))
        cta = self._escape(slide_data.get("cta_text", slide_data.get("cta", "")))
        brand = self._escape(mc.get("brand_handle", mc.get("brand_name", "")))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))

        return f"""
        <style>
        .story-wrap {{
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            padding: 120px 80px 100px;
        }}
        .story-top {{
            display: flex;
            flex-direction: column;
            align-items: flex-start;
        }}
        .story-brand {{
            font-size: 28px;
            font-weight: 700;
            color: {primary};
            letter-spacing: 3px;
            text-transform: uppercase;
            margin-bottom: 48px;
        }}
        .story-hook {{
            font-size: 96px;
            font-weight: 900;
            line-height: 1.0;
            color: var(--secondary);
            letter-spacing: -2px;
            text-transform: uppercase;
        }}
        .story-mid {{
            font-size: 44px;
            font-weight: 400;
            line-height: 1.5;
            color: var(--secondary);
            opacity: 0.85;
        }}
        .story-bottom {{
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
        }}
        .story-cta {{
            display: inline-block;
            padding: 24px 60px;
            background: {primary};
            color: {bg};
            font-size: 30px;
            font-weight: 700;
            letter-spacing: 2px;
            text-transform: uppercase;
            border-radius: 60px;
            text-align: center;
        }}
        .story-swipe {{
            font-size: 22px;
            color: var(--secondary);
            opacity: 0.5;
            letter-spacing: 1px;
        }}
        </style>
        <div class="story-wrap">
            <div class="story-top">
                <div class="story-brand">@{brand}</div>
                <div class="story-hook">{hook}</div>
            </div>
            <div class="story-mid">{body}</div>
            <div class="story-bottom">
                {'<div class="story-cta">' + cta + '</div>' if cta else ''}
                <div class="story-swipe">↑ deslizá para más</div>
            </div>
        </div>
        """

    def _base_css_story(self, mc: dict) -> str:
        """Like _base_css but sized for 1080×1920 story canvas."""
        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        secondary = mc.get("image_secondary_color", mc.get("secondary_color", "#ffffff"))
        accent = mc.get("accent_color", primary)
        font_family = mc.get("image_fonts", mc.get("fonts", "'Space Grotesk', sans-serif"))

        return f"""
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 400;
            src: url('file:///app/fonts/SpaceGrotesk-Regular.ttf') format('truetype');
        }}
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 700;
            src: url('file:///app/fonts/SpaceGrotesk-Bold.ttf') format('truetype');
        }}
        @font-face {{
            font-family: 'Space Grotesk';
            font-weight: 600;
            src: url('file:///app/fonts/SpaceGrotesk-SemiBold.ttf') format('truetype');
        }}
        *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
        :root {{
            --bg: {bg};
            --primary: {primary};
            --secondary: {secondary};
            --accent: {accent};
            --font: {font_family};
        }}
        html, body {{
            width: 1080px;
            height: 1920px;
            background: var(--bg);
            color: var(--secondary);
            font-family: var(--font);
            -webkit-font-smoothing: antialiased;
            overflow: hidden;
        }}
        .slide {{
            width: 1080px;
            height: 1920px;
            display: flex;
            flex-direction: column;
            position: relative;
            overflow: hidden;
            background: var(--bg);
        }}
        """

    def _build_story_html(self, slide_data: dict, mc: dict) -> str:
        """Assemble complete HTML for a story post (1080×1920)."""
        base_css = self._base_css_story(mc)
        inner = self._story_layout(slide_data, mc)
        is_rtl = mc.get("rtl", False)
        html_dir = ' dir="rtl"' if is_rtl else ""
        rtl_css = "\n        body { direction: rtl; text-align: right; }" if is_rtl else ""
        return f"""<!DOCTYPE html>
<html lang="es"{html_dir}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<style>
{base_css}{rtl_css}
</style>
</head>
<body>
<div class="slide">
{inner}
</div>
</body>
</html>"""

    async def _html_to_png_story(self, html: str) -> bytes:
        """Render HTML to a 1080×1920 PNG using Playwright (story format)."""
        import tempfile
        import os
        from playwright.async_api import async_playwright

        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.html',
            delete=False,
            encoding='utf-8',
        ) as f:
            f.write(html)
            tmp_path = f.name

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                )
                page = await browser.new_page(viewport={"width": 1080, "height": 1920})
                await page.goto(f"file://{tmp_path}", wait_until="domcontentloaded")
                await page.wait_for_timeout(800)
                png_bytes = await page.screenshot(
                    type="png",
                    clip={"x": 0, "y": 0, "width": 1080, "height": 1920},
                )
                await browser.close()
                return png_bytes
        finally:
            os.unlink(tmp_path)

    async def render_story(self, slide_data: dict, media_config: dict) -> str:
        """Render a story post to a 1080×1920 PNG and upload to S3.

        slide_data keys: hook_text, body_text, cta_text
        """
        from app.services.storage.s3 import S3Service

        html_content = self._build_story_html(slide_data, media_config)
        try:
            png_bytes = await self._html_to_png_story(html_content)
        except Exception as exc:
            logger.error("Playwright render failed for story: %s", exc)
            raise

        s3 = S3Service()
        url = await s3.upload_bytes(png_bytes, folder="generated/stories")
        logger.info("HTMLSlideRenderer uploaded story: %s", url)
        return url

    async def _build_html_with_claude(self, slide_data: dict, mc: dict) -> str:
        """Generate complete slide HTML using Claude API.

        Builds a detailed prompt from slide_data and media_config, calls Claude,
        and returns the raw HTML string. Raises on any error so the caller can
        fall back to the fixed template.
        """
        from anthropic import Anthropic
        from app.core.config import settings

        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        secondary = mc.get("image_secondary_color", mc.get("secondary_color", "#ffffff"))
        brand_handle = mc.get("brand_handle", mc.get("brand_name", ""))
        slide_num = slide_data.get("slide_number", 1)
        total = slide_data.get("total_slides", 1)
        headline = slide_data.get("headline", "")
        subtext = slide_data.get("subtext", "")

        prompt = f"""You are an expert social media slide designer.
Generate a complete, self-contained HTML file that renders a 1080x1080px slide.

BRAND:
- Background color: {bg}
- Primary/accent color: {primary}
- Secondary/text color: {secondary}
- Font family: Space Grotesk (available at file:///app/fonts/)
- Brand handle: @{brand_handle}

SLIDE CONTENT:
- Position: slide {slide_num} of {total}
- Headline: {headline}
- Body text: {subtext}

TECHNICAL REQUIREMENTS:
- Exactly 1080x1080px canvas, no scrolling (overflow: hidden)
- @font-face pointing to file:///app/fonts/SpaceGrotesk-Bold.ttf (weight 700), SpaceGrotesk-Regular.ttf (weight 400), SpaceGrotesk-SemiBold.ttf (weight 600)
- No external resources (no CDN fonts, no external images)
- Pure HTML + CSS only (inline <style> tag)
- <meta charset="UTF-8"> must be first tag in <head>

DESIGN FREEDOM:
- Be creative with the layout — use the primary color for accents, dividers, highlights, overlays
- Slide 1: bold hook layout, large headline, grab attention
- Middle slides: clear hierarchy, readable body text
- Last slide: CTA focused, brand prominent
- Spanish text must render correctly (é, ñ, ú, ó, á, ¿, ¡)

Return ONLY the HTML. No explanations, no markdown, no code blocks."""

        logger.info("Generating slide HTML with Claude (slide %s/%s)", slide_num, total)

        client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()

        # Strip accidental markdown code fences if present
        if raw.startswith("```"):
            raw = re.sub(r"^```[a-zA-Z]*\n?", "", raw)
            raw = re.sub(r"\n?```$", "", raw)
            raw = raw.strip()

        return raw

    async def _build_html_async(self, slide_data: dict, mc: dict) -> str:
        """Assemble the complete HTML document for a slide.

        Tries Claude-generated HTML first; falls back to fixed templates on any error.
        """
        try:
            return await self._build_html_with_claude(slide_data, mc)
        except Exception as exc:
            logger.warning(
                "Claude HTML generation failed, using fallback template: %s", exc
            )
            return self._build_html(slide_data, mc)

    def _build_html(self, slide_data: dict, mc: dict) -> str:
        """Assemble the complete HTML document for a slide using fixed templates (fallback)."""
        slide_num = slide_data.get("slide_number", 1)
        total = slide_data.get("total_slides", 1)

        logger.debug(
            "_build_html slide=%s/%s media_config keys=%s",
            slide_num, total, list(mc.keys()),
        )

        # Pick layout by position
        if slide_num == 1:
            inner = self._hook_layout(slide_data, mc)
        elif slide_num == total:
            inner = self._cta_layout(slide_data, mc)
        else:
            inner = self._content_layout(slide_data, mc)

        base_css = self._base_css(mc)

        # RTL support
        is_rtl = mc.get("rtl", False)
        html_dir = ' dir="rtl"' if is_rtl else ""
        rtl_css = "\n        body { direction: rtl; text-align: right; }" if is_rtl else ""

        return f"""<!DOCTYPE html>
<html lang="es"{html_dir}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1080">
<style>
{base_css}{rtl_css}
</style>
</head>
<body>
<div class="slide">
{inner}
</div>
</body>
</html>"""

    async def _html_to_png(self, html: str) -> bytes:
        """Render HTML to a 1080x1080 PNG using Playwright headless Chromium.

        Writes the HTML to a temp file and loads it via file:// URL so that:
        - UTF-8 / Spanish characters (é, ñ, ú, ó) are preserved correctly
        - Local @font-face file:// references are resolved by Chromium
        """
        import tempfile
        import os
        from playwright.async_api import async_playwright

        with tempfile.NamedTemporaryFile(
            mode='w',
            suffix='.html',
            delete=False,
            encoding='utf-8',
        ) as f:
            f.write(html)
            tmp_path = f.name

        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(
                    args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
                )
                page = await browser.new_page(viewport={"width": 1080, "height": 1080})
                await page.goto(f"file://{tmp_path}", wait_until="domcontentloaded")
                await page.wait_for_timeout(800)
                png_bytes = await page.screenshot(
                    type="png",
                    clip={"x": 0, "y": 0, "width": 1080, "height": 1080},
                )
                await browser.close()
                return png_bytes
        finally:
            os.unlink(tmp_path)

    async def render_slide(self, slide_data: dict, media_config: dict) -> str:
        """Render a single slide to a 1080x1080 PNG and upload to S3.

        Args:
            slide_data: dict with keys: headline, subtext, slide_number, total_slides
            media_config: project media_config dict — all colors/fonts come from here

        Returns:
            Public S3 URL for the rendered PNG.

        Raises:
            Exception: re-raised so the caller can fall back to a placeholder.
        """
        from app.services.storage.s3 import S3Service

        html_content = await self._build_html_async(slide_data, media_config)

        try:
            png_bytes = await self._html_to_png(html_content)
        except Exception as exc:
            logger.error("Playwright render failed for slide %s: %s", slide_data.get("slide_number"), exc)
            raise

        s3 = S3Service()
        url = await s3.upload_bytes(png_bytes, folder="generated/slides")
        logger.info(
            "HTMLSlideRenderer uploaded slide %s/%s: %s",
            slide_data.get("slide_number"),
            slide_data.get("total_slides"),
            url,
        )
        return url

    # ------------------------------------------------------------------ #
    # BaseImageProvider interface
    # ------------------------------------------------------------------ #

    async def generate_image(
        self,
        prompt: str,
        media_config: dict = {},
        style: str = "typographic",
        aspect_ratio: str = "1:1",
        color_palette: str = "dark",
    ) -> str:
        """Generate a single typographic slide from a free-text prompt.

        Called when a single_image type is requested or from the factory interface.
        Builds a simple full-bleed typographic slide with the prompt as headline.
        """
        slide_data = {
            "headline": prompt[:80],
            "subtext": "",
            "slide_number": 1,
            "total_slides": 1,
        }
        return await self.render_slide(slide_data, media_config)
