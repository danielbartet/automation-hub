"""Telegram Bot service — stub."""


class TelegramBot:
    """Sends messages and approval requests via Telegram Bot API."""

    def __init__(self, bot_token: str) -> None:
        self.bot_token = bot_token

    async def send_message(self, chat_id: str, text: str) -> dict:
        """Send a text message. Stub returns mock response."""
        return {"ok": True, "stub": True, "chat_id": chat_id}

    async def send_approval_request(self, chat_id: str, content_preview: str, content_post_id: int) -> dict:
        """Send a content approval request with approve/reject buttons."""
        return {"ok": True, "stub": True, "content_post_id": content_post_id}
