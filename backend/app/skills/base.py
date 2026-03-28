"""Abstract base class for all automation skills."""
from abc import ABC, abstractmethod
from app.models.project import Project


class BaseSkill(ABC):
    """Base class that all skills must extend."""

    def __init__(self, project: Project) -> None:
        self.project = project

    @abstractmethod
    async def execute(self, payload: dict) -> dict:
        """Execute the skill with the given payload. Returns a result dict."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable skill name."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Short description of what this skill does."""
        pass
