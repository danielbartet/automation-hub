---
name: n8n-api
description: "ALWAYS use this skill for ANY n8n task. Load it immediately whenever: creating or modifying workflows, fixing webhook issues, checking workflow status, managing n8n credentials, or debugging executions. Contains critical IDs (workflow IDs, credential IDs) that must not be typed from memory."
---

# n8n API Skill

## Connection
- URL: https://n8n.quantorialabs.com
- API Key: in server ~/.env as N8N_API_KEY
- Auth header: X-N8N-API-KEY

## Key IDs
- Telegram credential: DBXApHxp80E6clFc (Telegram Bot Quantoria)
- Meta credential: 0fXQK7f6mONUSQhg (Meta - n8n-automation)
- Publish workflow: QHcY6NWupxgAsy3m (Publish Meta — IG & FB)

## Common API calls
source ~/.env

List workflows:
curl -s https://n8n.quantorialabs.com/api/v1/workflows -H "X-N8N-API-KEY: $N8N_API_KEY"

Get specific workflow:
curl -s https://n8n.quantorialabs.com/api/v1/workflows/WORKFLOW_ID -H "X-N8N-API-KEY: $N8N_API_KEY" > /tmp/workflow.json

Update workflow:
curl -s -X PUT https://n8n.quantorialabs.com/api/v1/workflows/WORKFLOW_ID -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" -d @/tmp/workflow.json

Activate workflow:
curl -s -X POST https://n8n.quantorialabs.com/api/v1/workflows/WORKFLOW_ID/activate -H "X-N8N-API-KEY: $N8N_API_KEY"

Deactivate workflow:
curl -s -X POST https://n8n.quantorialabs.com/api/v1/workflows/WORKFLOW_ID/deactivate -H "X-N8N-API-KEY: $N8N_API_KEY"

List credentials:
curl -s https://n8n.quantorialabs.com/api/v1/credentials -H "X-N8N-API-KEY: $N8N_API_KEY"

## Direct DB access (when API fails)
Find SQLite DB:
docker exec $(docker ps | grep n8n | awk '{print $1}') find / -name "database.sqlite" 2>/dev/null

Query DB:
docker exec $(docker ps | grep n8n | awk '{print $1}') sqlite3 /home/node/.n8n/database.sqlite "SELECT id, name FROM workflow_entity;"

Edit workflow JSON directly:
docker exec $(docker ps | grep n8n | awk '{print $1}') sqlite3 /home/node/.n8n/database.sqlite "UPDATE workflow_entity SET nodes = REPLACE(nodes, 'old_value', 'new_value') WHERE id='WORKFLOW_ID';"

## Webhook testing
Production (workflow must be active):
curl -s -X POST https://n8n.quantorialabs.com/webhook/PATH -H "Content-Type: application/json" -d '{"key": "value"}'

Test mode (workflow must be open in UI):
curl -s -X POST https://n8n.quantorialabs.com/webhook-test/PATH -H "Content-Type: application/json" -d '{"key": "value"}'

## Known issue
The n8n API PUT endpoint is strict with schema validation. If PUT fails with "must NOT have additional properties", use direct DB access instead.
