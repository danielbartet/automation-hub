"""Meta API audit logging helper — call after every Meta Graph API write operation."""
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.meta_api_audit_log import MetaAPIAuditLog

logger = logging.getLogger(__name__)

_SENSITIVE_KEY_FRAGMENTS = ("token", "secret", "key", "password", "auth", "credential")


def _sanitize_payload(payload: dict | None) -> dict | None:
    """Remove sensitive fields from a payload dict before persisting.

    Strips any key whose name contains 'token', 'secret', or 'key' (case-insensitive).
    """
    if payload is None:
        return None
    return {
        k: v
        for k, v in payload.items()
        if not any(frag in k.lower() for frag in _SENSITIVE_KEY_FRAGMENTS)
    }


async def log_meta_operation(
    db: AsyncSession,
    project_id: int,
    operation: str,
    entity_type: str,
    success: bool,
    entity_id: Optional[str] = None,
    payload: Optional[dict] = None,
    response_status: Optional[int] = None,
    error_message: Optional[str] = None,
    user_id: Optional[int] = None,
) -> None:
    """Persist a Meta API operation record to meta_api_audit_log.

    Call this after every Meta Graph API write operation (success or failure).
    Tokens and secrets are automatically stripped from payload before saving.

    Args:
        db: active async session — caller is responsible for committing.
        project_id: DB project ID.
        operation: one of publish_post | create_campaign | update_budget |
                   pause_campaign | activate_campaign | upload_image.
        entity_type: one of post | campaign | ad | budget.
        success: True if the Meta API call succeeded.
        entity_id: Meta's external ID for the created/updated entity (optional).
        payload: dict of parameters sent to Meta (tokens will be stripped).
        response_status: HTTP status code returned by Meta Graph API.
        error_message: error detail string on failure.
        user_id: DB user ID of the user who triggered the action (optional).
    """
    try:
        log_entry = MetaAPIAuditLog(
            project_id=project_id,
            user_id=user_id,
            operation=operation,
            entity_type=entity_type,
            entity_id=entity_id,
            payload=_sanitize_payload(payload),
            response_status=response_status,
            success=success,
            error_message=error_message[:1024] if error_message else None,
        )
        db.add(log_entry)
        # Flush so the record is visible in the current transaction; caller commits.
        await db.flush()
        logger.debug(
            "[MetaAudit] %s %s project=%s entity=%s success=%s",
            operation, entity_type, project_id, entity_id, success,
        )
    except Exception as exc:
        # Audit logging must never break the main flow.
        logger.warning("[MetaAudit] Failed to log operation %s: %s", operation, exc)
