"""Abstract base classes for media generation providers."""
from abc import ABC, abstractmethod


class BaseImageProvider(ABC):
    @abstractmethod
    async def generate_image(
        self,
        prompt: str,
        media_config: dict = {},
        # Legacy params kept for backward compatibility — prefer media_config
        style: str = "typographic",
        aspect_ratio: str = "1:1",
        color_palette: str = "dark",
    ) -> str:
        """Generate an image from a prompt and return a public S3 URL."""
        pass


class BaseVideoProvider(ABC):
    @abstractmethod
    async def generate_video(
        self,
        prompt: str,
        image_url: str = None,
        duration: int = 5,
        aspect_ratio: str = "9:16",
    ) -> str:
        """Generate a video from a prompt and return a public S3 URL."""
        pass
