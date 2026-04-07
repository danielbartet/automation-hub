---
name: ssh-server
description: "ALWAYS use this skill for ANY task involving the EC2 server (44.194.116.2). Load it immediately whenever: connecting to the server, running remote commands, editing server files, checking service status, restarting n8n or any container, viewing logs, or deploying changes. Do not attempt server tasks from memory — always load this skill first."
---

# SSH Server Skill

## Connection
ssh -i ~/.ssh/quantoria-key.pem ubuntu@44.194.116.2

## Key paths on server
- n8n docker: /home/ubuntu/.openclaw/workspace/traefik-n8n/
- OpenClaw skills: /home/ubuntu/workspace/skills/
- Environment vars: /home/ubuntu/.env
- automation-hub: /home/ubuntu/automation-hub/
- Logs: /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

## Common commands
Check n8n status:
cd /home/ubuntu/.openclaw/workspace/traefik-n8n && docker compose ps

Restart n8n:
docker compose restart n8n

Check env vars:
source ~/.env && grep -c VARIABLE_NAME ~/.env

View logs:
docker compose logs --tail=50 n8n

## Rules
- Always verify before destructive actions
- Never force push git
- Never share secret values in output
- Always run docker compose ps after restart to confirm service is up
