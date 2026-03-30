"""Telegram Bot service — stub."""
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

TELEGRAM_NOTIFICATIONS_ENABLED = settings.TELEGRAM_NOTIFICATIONS_ENABLED


class TelegramBot:
    """Sends messages and approval requests via Telegram Bot API."""

    def __init__(self, bot_token: str) -> None:
        self.bot_token = bot_token

    async def send_message(self, chat_id: str, text: str) -> dict:
        """Send a text message. Stub returns mock response."""
        if not TELEGRAM_NOTIFICATIONS_ENABLED:
            logger.info("Telegram notifications disabled — skipping send_message")
            return {"ok": True, "skipped": True}
        return {"ok": True, "stub": True, "chat_id": chat_id}

    async def send_approval_request(self, chat_id: str, content_preview: str, content_post_id: int) -> dict:
        """Send a content approval request with approve/reject buttons."""
        if not TELEGRAM_NOTIFICATIONS_ENABLED:
            logger.info("Telegram notifications disabled — skipping send_approval_request")
            return {"ok": True, "skipped": True}
        return {"ok": True, "stub": True, "content_post_id": content_post_id}

    async def send_optimizer_approval_request(self, chat_id: str, message: str, campaign_id: int) -> dict:
        """Send an optimizer approval request to Telegram."""
        if not TELEGRAM_NOTIFICATIONS_ENABLED:
            logger.info("Telegram notifications disabled — skipping send_optimizer_approval_request")
            return {"ok": True, "skipped": True}
        return {"ok": True, "stub": True, "campaign_id": campaign_id}

    async def send_optimizer_result(self, chat_id: str, message: str) -> dict:
        """Send an optimizer result notification to Telegram."""
        if not TELEGRAM_NOTIFICATIONS_ENABLED:
            logger.info("Telegram notifications disabled — skipping send_optimizer_result")
            return {"ok": True, "skipped": True}
        return {"ok": True, "stub": True}
