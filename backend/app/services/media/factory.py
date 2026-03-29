"""Factory functions that return the correct media provider based on project config."""
import logging

from fastapi import HTTPException

from app.core.config import settings
from app.services.media.base import BaseImageProvider, BaseVideoProvider

logger = logging.getLogger(__name__)


def get_image_provider(provider_name: str) -> BaseImageProvider:
    """Return the requested image provider, falling back to PlaceholderProvider if unconfigured."""
    from app.services.media.ideogram import IdeogramProvider
    from app.services.media.placeholder import PlaceholderProvider

    if provider_name == "ideogram":
        if settings.IDEOGRAM_API_KEY:
            return IdeogramProvider()
        logger.warning(
            "Image provider 'ideogram' requested but IDEOGRAM_API_KEY is not set — "
            "falling back to PlaceholderProvider"
        )
        return PlaceholderProvider()

    if provider_name != "placeholder":
        logger.warning(
            "Image provider '%s' not configured or unsupported — falling back to PlaceholderProvider",
            provider_name,
        )
    return PlaceholderProvider()


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
