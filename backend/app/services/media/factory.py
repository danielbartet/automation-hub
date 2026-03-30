"""Factory functions that return the correct media provider based on project config."""
import logging

from fastapi import HTTPException

from app.core.config import settings
from app.services.media.base import BaseImageProvider, BaseVideoProvider

logger = logging.getLogger(__name__)


def get_image_provider(provider_name: str = "html") -> BaseImageProvider:
    """Return the requested image provider, falling back to HTMLSlideRenderer if unconfigured."""
    from app.services.media.html_renderer import HTMLSlideRenderer
    from app.services.media.ideogram import IdeogramProvider
    from app.services.media.placeholder import PlaceholderProvider

    if provider_name == "ideogram" and settings.IDEOGRAM_API_KEY:
        return IdeogramProvider()

    if provider_name == "ideogram" and not settings.IDEOGRAM_API_KEY:
        logger.warning(
            "Image provider 'ideogram' requested but IDEOGRAM_API_KEY is not set — "
            "falling back to HTMLSlideRenderer"
        )
        return HTMLSlideRenderer()

    if provider_name == "placeholder":
        return PlaceholderProvider()

    # Default: HTMLSlideRenderer for all text carousels
    if provider_name not in ("html", "ideogram", "placeholder"):
        logger.warning(
            "Image provider '%s' not configured or unsupported — falling back to HTMLSlideRenderer",
            provider_name,
        )
    return HTMLSlideRenderer()


def get_video_provider(provider_name: str) -> BaseVideoProvider:
    """Return the requested video provider. Raises 400 if provider is unknown or unconfigured."""
    from app.services.media.kling import KlingProvider

    providers = {
        "kling": KlingProvider,
    }

    cls = providers.get(provider_name)
    if not cls:
        raise HTTPException(
            status_code=400,
            detail=f"Video provider '{provider_name}' not supported",
        )

    # Check that the required API key exists
    if provider_name == "kling" and not settings.KLING_API_KEY:
        raise HTTPException(
            status_code=400,
            detail="Kling API key not configured",
        )

    return cls()
