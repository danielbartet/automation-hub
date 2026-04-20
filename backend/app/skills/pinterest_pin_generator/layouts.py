"""Pinterest pin image overlay layouts using Pillow.

Adapted from ChargeTechLab/scripts/generate_pin.py.
"""
import io
import logging
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

logger = logging.getLogger(__name__)

# Default pin dimensions
_PIN_W = 1000
_PIN_H = 1500


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    """Convert a hex color string to an (R, G, B) tuple."""
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i: i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def _get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Return a font at the requested size, falling back to the built-in default."""
    candidates: list[str]
    if bold:
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/Library/Fonts/Arial Bold.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        ]
    else:
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    logger.warning("No system font found, using built-in default")
    return ImageFont.load_default()


def _wrap(text: str, font, max_w: int, draw: ImageDraw.ImageDraw) -> list[str]:
    """Wrap text to fit within max_w pixels."""
    words, lines, cur = text.split(), [], ""
    for word in words:
        test = f"{cur} {word}".strip()
        if draw.textbbox((0, 0), test, font=font)[2] > max_w and cur:
            lines.append(cur)
            cur = word
        else:
            cur = test
    if cur:
        lines.append(cur)
    return lines


def _make_gradient_fast(
    width: int,
    height: int,
    color_rgb: tuple[int, int, int],
    alpha_top: int,
    alpha_bottom: int,
) -> Image.Image:
    """Build a vertical gradient using the fast resize method."""
    col = Image.new("RGBA", (1, height))
    r, g, b = color_rgb
    pixels = []
    for y in range(height):
        t = y / height
        alpha = int(alpha_top + (alpha_bottom - alpha_top) * t)
        pixels.append((r, g, b, alpha))
    col.putdata(pixels)
    return col.resize((width, height), Image.NEAREST)


# ─── Layout implementations ──────────────────────────────────────────────────


def _layout_bottom(
    img: Image.Image,
    title: str,
    description: str,
    brand_colors: dict,
    width: int,
    height: int,
) -> Image.Image:
    """Gradient bar at bottom 30%, white title + description."""
    base = img.convert("RGBA")
    pad = 52

    title_font = _get_font(72, bold=True)
    desc_font = _get_font(40)
    draw_tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    title_lines = _wrap(title, title_font, width - pad * 2, draw_tmp)
    desc_lines = _wrap(description, desc_font, width - pad * 2, draw_tmp) if description else []

    line_h_t = 82
    line_h_s = 50
    accent_h = 4
    gap = 24

    block_h = (
        len(title_lines) * line_h_t
        + (gap + accent_h + gap + len(desc_lines) * line_h_s if desc_lines else 0)
        + gap * 2
        + pad * 2
    )

    grad_start = height - block_h - 80
    grad = _make_gradient_fast(width, height - grad_start, (10, 15, 30), 0, 230)
    base.paste(grad, (0, grad_start), grad)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    y = height - block_h + pad

    # Title
    for line in title_lines:
        draw.text((pad, y), line, font=title_font, fill=(255, 255, 255, 255))
        y += line_h_t

    # Accent line + description
    if desc_lines:
        y += gap
        primary_rgb = _hex_to_rgb(brand_colors.get("primary", "#7c3aed"))
        draw.rectangle([(pad, y), (pad + 60, y + accent_h)], fill=(*primary_rgb, 255))
        y += accent_h + gap
        for line in desc_lines:
            draw.text((pad, y), line, font=desc_font, fill=(220, 220, 220, 255))
            y += line_h_s

    return Image.alpha_composite(base, overlay).convert("RGB")


def _layout_split(
    img: Image.Image,
    title: str,
    description: str,
    brand_colors: dict,
    width: int,
    height: int,
) -> Image.Image:
    """Left half image / right half solid brand color with text."""
    base = img.convert("RGBA")
    pad = 52

    title_font = _get_font(78, bold=True)
    desc_font = _get_font(36)
    draw_tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))

    right_w = width // 2
    title_lines = _wrap(title, title_font, right_w - pad * 2, draw_tmp)
    desc_lines = _wrap(description, desc_font, right_w - pad * 2, draw_tmp) if description else []

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Right half solid brand color panel
    bg_rgb = _hex_to_rgb(brand_colors.get("bg", "#050505"))
    draw.rectangle([(width // 2, 0), (width, height)], fill=(*bg_rgb, 230))

    # Title on right panel, vertically centered
    total_text_h = len(title_lines) * 90 + (len(desc_lines) * 44 + 24 if desc_lines else 0)
    y = (height - total_text_h) // 2
    x = width // 2 + pad

    for line in title_lines:
        draw.text((x, y), line, font=title_font, fill=(255, 255, 255, 255))
        y += 90

    if desc_lines:
        y += 24
        primary_rgb = _hex_to_rgb(brand_colors.get("primary", "#7c3aed"))
        for line in desc_lines:
            draw.text((x, y), line, font=desc_font, fill=(*primary_rgb, 255))
            y += 44

    return Image.alpha_composite(base, overlay).convert("RGB")


def _layout_center(
    img: Image.Image,
    title: str,
    description: str,
    brand_colors: dict,
    width: int,
    height: int,
) -> Image.Image:
    """Translucent rounded rectangle centered with text."""
    base = img.convert("RGBA")

    # Subtle blur in the central zone for legibility
    blurred = base.filter(ImageFilter.GaussianBlur(radius=3))
    mask = Image.new("L", base.size, 0)
    md = ImageDraw.Draw(mask)
    x_margin = int(width * 0.06)
    y_top = int(height * 0.32)
    y_bot = int(height * 0.68)
    md.rounded_rectangle([(x_margin, y_top), (width - x_margin, y_bot)], radius=16, fill=200)
    base = Image.composite(blurred, base, mask)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    title_font = _get_font(68, bold=True)
    desc_font = _get_font(38)
    draw_tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    max_w = width - x_margin * 2 - 48 * 2
    title_lines = _wrap(title, title_font, max_w, draw_tmp)
    desc_lines = _wrap(description, desc_font, max_w, draw_tmp) if description else []

    box_pad = 48
    content_h = len(title_lines) * 78 + (len(desc_lines) * 50 + 32 if desc_lines else 0)
    box_top = (height - content_h) // 2 - box_pad
    box_bot = box_top + content_h + box_pad * 2

    draw.rounded_rectangle(
        [(x_margin, box_top), (width - x_margin, box_bot)],
        radius=16,
        fill=(10, 15, 30, 195),
    )

    y = box_top + box_pad
    for line in title_lines:
        w = draw.textbbox((0, 0), line, font=title_font)[2]
        draw.text(((width - w) // 2, y), line, font=title_font, fill=(255, 255, 255, 255))
        y += 78

    if desc_lines:
        y += 16
        primary_rgb = _hex_to_rgb(brand_colors.get("primary", "#7c3aed"))
        for line in desc_lines:
            w = draw.textbbox((0, 0), line, font=desc_font)[2]
            draw.text(((width - w) // 2, y), line, font=desc_font, fill=(*primary_rgb, 255))
            y += 50

    return Image.alpha_composite(base, overlay).convert("RGB")


def _layout_badge_bottom(
    img: Image.Image,
    title: str,
    description: str,
    brand_colors: dict,
    width: int,
    height: int,
) -> Image.Image:
    """Pill badge at bottom with title only (description used as badge label if provided)."""
    base = img.convert("RGBA")
    pad = 52

    badge_font = _get_font(30)
    title_font = _get_font(72, bold=True)
    draw_tmp = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    title_lines = _wrap(title, title_font, width - pad * 2, draw_tmp)

    line_h_t = 82
    block_h = len(title_lines) * line_h_t + pad * 2 + 36 + 24
    grad_start = height - block_h - 80
    grad = _make_gradient_fast(width, height - grad_start, (10, 15, 30), 0, 230)
    base.paste(grad, (0, grad_start), grad)

    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Badge pill at top using description as label
    if description:
        primary_rgb = _hex_to_rgb(brand_colors.get("primary", "#7c3aed"))
        bw = draw.textbbox((0, 0), description, font=badge_font)[2]
        bx, by = pad, 48
        draw.rounded_rectangle(
            [(bx - 14, by - 8), (bx + bw + 14, by + 38)],
            radius=20,
            fill=(*primary_rgb, 235),
        )
        draw.text((bx, by), description, font=badge_font, fill=(255, 255, 255, 255))

    # Title at bottom
    y = height - block_h + pad
    for line in title_lines:
        draw.text((pad, y), line, font=title_font, fill=(255, 255, 255, 255))
        y += line_h_t

    return Image.alpha_composite(base, overlay).convert("RGB")


# ─── Public API ──────────────────────────────────────────────────────────────

_LAYOUT_MAP = {
    "bottom": _layout_bottom,
    "split": _layout_split,
    "center": _layout_center,
    "badge_bottom": _layout_badge_bottom,
}


def apply_overlay(
    base_image: bytes,
    title: str,
    description: str,
    layout: str,
    brand_colors: dict,
) -> bytes:
    """Compose text overlay onto base_image and return PNG bytes.

    Args:
        base_image: Raw image bytes (PNG or JPEG) to use as the base.
        title: Main title text to render on the image.
        description: Secondary description or badge label text.
        layout: One of ``"bottom"``, ``"split"``, ``"center"``, ``"badge_bottom"``.
        brand_colors: Dict with optional keys ``"primary"`` (hex) and ``"bg"`` (hex).
            Defaults to ``{"primary": "#7c3aed", "bg": "#050505"}``.

    Returns:
        PNG bytes of the composited image.
    """
    if layout not in _LAYOUT_MAP:
        logger.warning("Unknown layout %r — falling back to 'bottom'", layout)
        layout = "bottom"

    brand_colors = brand_colors or {}
    brand_colors.setdefault("primary", "#7c3aed")
    brand_colors.setdefault("bg", "#050505")

    img = Image.open(io.BytesIO(base_image))
    width, height = img.size

    composed = _LAYOUT_MAP[layout](img, title, description, brand_colors, width, height)

    buf = io.BytesIO()
    composed.save(buf, format="PNG", optimize=True)
    buf.seek(0)
    return buf.read()
