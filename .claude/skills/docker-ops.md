---
name: docker-ops
description: "ALWAYS use this skill before running any docker or docker compose command on the EC2 server. Load it whenever: restarting containers, checking logs, deploying code changes, rebuilding images, or debugging container issues. Contains exact paths and service names for this project."
---

# Docker Operations Skill

## n8n container
cd /home/ubuntu/.openclaw/workspace/traefik-n8n

Status: docker compose ps
Restart n8n only: docker compose restart n8n
View logs: docker compose logs --tail=50 n8n
Filter errors: docker compose logs --tail=100 n8n 2>&1 | grep -i error
Full restart: docker compose down && docker compose up -d

## automation-hub containers
cd /home/ubuntu/automation-hub

Status: docker compose ps
Restart backend: docker compose restart backend
Restart frontend: docker compose restart frontend
View backend logs: docker compose logs --tail=50 backend
View frontend logs: docker compose logs --tail=50 frontend
Rebuild after code changes: docker compose build backend && docker compose up -d backend

## General docker commands
List running containers: docker ps
Shell into container: docker exec -it CONTAINER_NAME bash
Check container env vars: docker exec CONTAINER_NAME env | grep VARIABLE
Copy file from container: docker cp CONTAINER_NAME:/path/to/file /local/path

## Rules
- Always run docker compose ps after restart to confirm service is up
- If container keeps restarting, check logs before retrying
- Never docker rm -f on production containers without user confirmation
