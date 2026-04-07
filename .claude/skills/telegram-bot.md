---
name: telegram-bot
description: "ALWAYS use this skill for ANY Telegram interaction. Load it whenever: sending messages to the approval bot, debugging the approval flow, working with inline keyboards, or configuring Telegram nodes in n8n. Contains the bot token location, chat ID, and the n8n credential ID."
---

# Telegram Bot Skill

## Credentials
- Bot: @Dwbarbot
- Chat ID: 1284119239
- Token: in backend/.env as TELEGRAM_BOT_TOKEN
- n8n credential ID: DBXApHxp80E6clFc (Telegram Bot Quantoria)

## Send simple message
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -H "Content-Type: application/json" -d '{"chat_id": "1284119239", "text": "Your message", "parse_mode": "HTML"}'

## Send message with inline buttons
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" -H "Content-Type: application/json" -d '{"chat_id": "1284119239", "text": "Approve this post?", "reply_markup": {"inline_keyboard": [[{"text": "Aprobar", "callback_data": "approve"}, {"text": "Rechazar", "callback_data": "reject"}]]}}'

## Approval flow in n8n
1. Telegram node sends message with inline keyboard
2. Wait node pauses workflow execution
3. User clicks button → callback received
4. IF node checks callback_query.data value
5. Branch true (approve) or false (reject)
