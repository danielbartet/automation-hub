# Automation Hub

Multi-project content automation and Meta Ads management platform.

## Stack

- **Backend**: FastAPI + SQLAlchemy (async) + SQLite + Alembic
- **Frontend**: Next.js 14 (App Router) + Tailwind CSS + NextAuth v5
- **Infra**: Docker Compose

## Quick Start

```bash
make build   # Build Docker images
make dev     # Start in foreground
make dev-d   # Start in background
make stop    # Stop all services
```

## Services

| Service  | URL                        |
|----------|----------------------------|
| Backend  | http://localhost:8000      |
| API Docs | http://localhost:8000/docs |
| Frontend | http://localhost:3000      |

## Default credentials

Username: `admin` / Password: `admin`
