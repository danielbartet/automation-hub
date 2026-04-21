"""Carousel slide renderer — generates styled 1080x1080 PNG images using Pillow."""
import io
import logging
from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger(__name__)
logger.warning("renderer.py (Pillow) is deprecated. Use HTMLSlideRenderer instead.")


class CarouselRenderer:
    """Deprecated: Use HTMLSlideRenderer for all new projects."""

    WHITE = (255, 255, 255)
    GRAY = (180, 180, 195)
    DIM = (80, 80, 100)
    LINE_COLOR = (40, 40, 60)
    SIZE = (1080, 1080)

    def __init__(
        self,
        bg_color: tuple = (12, 12, 18),
        accent_color: tuple = (120, 120, 200),
        brand_label: str = "",
    ) -> None:
        self.BG = bg_color
        self.ACCENT = accent_color
        self._brand_label_text = brand_label

    def _make_base(self) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        img = Image.new("RGB", self.SIZE, self.BG)
        draw = ImageDraw.Draw(img)
        # Bottom line separator
        draw.line([(60, 980), (1020, 980)], fill=self.LINE_COLOR, width=1)
        return img, draw

    def _brand_label(self, draw: ImageDraw.ImageDraw) -> None:
        if not self._brand_label_text:
            return
        font = ImageFont.load_default(size=28)
        draw.text((1020, 1010), self._brand_label_text, fill=self.DIM, anchor="rm", font=font)

    def _slide_num(self, draw: ImageDraw.ImageDraw, num: int, total: int = 6) -> None:
        font = ImageFont.load_default(size=24)
        draw.text((60, 60), f"{num}/{total}", fill=self.DIM, font=font)

    def _wrap_text(self, text: str, max_chars: int = 35) -> list[str]:
        words = text.split()
        lines, line = [], []
        for word in words:
            if sum(len(w) for w in line) + len(line) + len(word) > max_chars:
                if line:
                    lines.append(" ".join(line))
                line = [word]
            else:
                line.append(word)
        if line:
            lines.append(" ".join(line))
        return lines

    def render_hook(self, slide: dict) -> bytes:
        """Render a hook slide (slide 1) — large headline + subtext."""
        img, draw = self._make_base()
        self._brand_label(draw)
        self._slide_num(draw, slide["slide_number"])

        headline_font = ImageFont.load_default(size=72)
        subtext_font = ImageFont.load_default(size=40)

        # Headline — centered at 38% from top
        hl_lines = self._wrap_text(slide.get("headline", ""), max_chars=22)
        y = int(self.SIZE[1] * 0.38) - (len(hl_lines) - 1) * 40
        for line in hl_lines:
            draw.text((540, y), line, fill=self.WHITE, anchor="mm", font=headline_font)
            y += 88

        # Subtext
        sub_lines = self._wrap_text(slide.get("subtext", ""), max_chars=38)
        y += 30
        for line in sub_lines:
            draw.text((540, y), line, fill=self.GRAY, anchor="mm", font=subtext_font)
            y += 52

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def render_content(self, slide: dict) -> bytes:
        """Render a content slide (slides 2-5) — headline + body text."""
        img, draw = self._make_base()
        self._brand_label(draw)
        self._slide_num(draw, slide["slide_number"])

        headline_font = ImageFont.load_default(size=64)
        body_font = ImageFont.load_default(size=36)

        hl_lines = self._wrap_text(slide.get("headline", ""), max_chars=24)
        y = int(self.SIZE[1] * 0.32) - (len(hl_lines) - 1) * 36
        for line in hl_lines:
            draw.text((540, y), line, fill=self.WHITE, anchor="mm", font=headline_font)
            y += 80

        body_lines = self._wrap_text(slide.get("body", ""), max_chars=42)
        y += 30
        for line in body_lines:
            draw.text((540, y), line, fill=self.GRAY, anchor="mm", font=body_font)
            y += 48

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def render_close(self, slide: dict) -> bytes:
        """Render a close slide (slide 6) — headline + CTA in accent color."""
        img, draw = self._make_base()
        self._brand_label(draw)
        self._slide_num(draw, slide["slide_number"])

        headline_font = ImageFont.load_default(size=64)
        cta_font = ImageFont.load_default(size=42)

        hl_lines = self._wrap_text(slide.get("headline", ""), max_chars=24)
        y = int(self.SIZE[1] * 0.38) - (len(hl_lines) - 1) * 36
        for line in hl_lines:
            draw.text((540, y), line, fill=self.WHITE, anchor="mm", font=headline_font)
            y += 80

        cta_lines = self._wrap_text(slide.get("cta", ""), max_chars=32)
        y += 40
        for line in cta_lines:
            draw.text((540, y), line, fill=self.ACCENT, anchor="mm", font=cta_font)
            y += 56

        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def render_slide(self, slide: dict) -> bytes:
        """Dispatch to the correct renderer based on slide type."""
        t = slide.get("type", "content")
        if t == "hook":
            return self.render_hook(slide)
        elif t == "close":
            return self.render_close(slide)
        else:
            return self.render_content(slide)

    def render_all(self, content: dict) -> list[bytes]:
        """Render all slides in a carousel content dict. Returns list of PNG bytes."""
        return [self.render_slide(slide) for slide in content.get("slides", [])]
