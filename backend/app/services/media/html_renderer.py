"""HTML-based slide renderer — generates 1080x1080 PNG slides via Playwright/Chromium.

Each slide is rendered from an HTML template built entirely from media_config values.
Zero hardcoded colors — all visual tokens come from the project's media_config.
"""
import html
import logging
import asyncio
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
        """Return global CSS variables and resets derived from media_config."""
        bg = mc.get("image_bg_color", mc.get("bg_color", "#0a0a0a"))
        primary = mc.get("image_primary_color", mc.get("primary_color", "#00FF41"))
        secondary = mc.get("image_secondary_color", mc.get("secondary_color", "#ffffff"))
        accent = mc.get("accent_color", primary)
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

    def _build_html(self, slide_data: dict, mc: dict) -> str:
        """Assemble the complete HTML document for a slide."""
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

        return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1080">
<style>
{base_css}
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

        html_content = self._build_html(slide_data, media_config)

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
