# Models package — import all models here to ensure they are registered with SQLAlchemy.
from app.models.user_meta_token import UserMetaToken  # noqa: F401

__all__ = ["UserMetaToken"]
