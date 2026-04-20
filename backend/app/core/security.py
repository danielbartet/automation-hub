"""Security utilities: Fernet encryption for sensitive fields."""
import logging
from cryptography.fernet import Fernet
from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_fernet() -> Fernet | None:
    """Return Fernet instance if key is configured and valid."""
    if settings.FERNET_KEY:
        try:
            return Fernet(settings.FERNET_KEY.encode())
        except Exception:
            return None
    return None


def encrypt_token(plaintext: str) -> str:
    """Encrypt a sensitive string. Returns plaintext if no key configured."""
    fernet = _get_fernet()
    if fernet and plaintext:
        return fernet.encrypt(plaintext.encode()).decode()
    return plaintext


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted string. Returns ciphertext if no key configured."""
    fernet = _get_fernet()
    if fernet and ciphertext:
        try:
            return fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            return ciphertext
    return ciphertext


async def get_project_token(project, db=None) -> str | None:
    """Return the Meta access token for a project using three-tier resolution.

    Tier 1: project.meta_access_token (Fernet-encrypted) — decrypt and return.
    Tier 2: UserMetaToken for project.owner_id — only when USER_META_TOKEN_ENABLED=True
             and project.owner_id is set. Skipped if token is expired.
    Tier 3: settings.META_ACCESS_TOKEN global fallback.

    Returns None if all tiers yield nothing (caller handles the error).
    """
    # Tier 1: project-level token
    if project.meta_access_token:
        logger.debug("get_project_token: Tier 1 resolved for project %s", getattr(project, "id", "?"))
        return decrypt_token(project.meta_access_token)

    # Tier 2: per-user token (feature-flagged)
    if settings.USER_META_TOKEN_ENABLED and db is not None and project.owner_id:
        from app.models.user_meta_token import UserMetaToken
        from sqlalchemy import select
        from datetime import datetime, timezone

        result = await db.execute(
            select(UserMetaToken).where(UserMetaToken.user_id == project.owner_id)
        )
        user_token = result.scalar_one_or_none()
        if user_token:
            # Check expiry — None means non-expiring
            expires_at = user_token.expires_at
            if expires_at is not None and expires_at.tzinfo is not None:
                expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
            if expires_at is not None and expires_at <= datetime.now(timezone.utc).replace(tzinfo=None):
                logger.warning(
                    "get_project_token: Tier 2 token for user %s is expired (expires_at=%s) — skipping",
                    project.owner_id,
                    user_token.expires_at,
                )
            else:
                logger.debug(
                    "get_project_token: Tier 2 resolved for project %s via owner %s",
                    getattr(project, "id", "?"),
                    project.owner_id,
                )
                return decrypt_token(user_token.encrypted_token)

    # Tier 3: global settings fallback
    if settings.META_ACCESS_TOKEN:
        logger.debug("get_project_token: Tier 3 (global) resolved for project %s", getattr(project, "id", "?"))
        return settings.META_ACCESS_TOKEN

    return None
