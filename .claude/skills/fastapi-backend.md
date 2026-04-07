---
name: fastapi-backend
description: "ALWAYS use this skill when working on the backend. Load it whenever: creating endpoints, adding models, writing services, running migrations, or working in the backend/ directory. Use it even for small changes — it contains project conventions that must be followed consistently."
---

# FastAPI Backend Skill

## Project structure
backend/app/main.py              - FastAPI app entry point
backend/app/api/v1/              - API endpoints
backend/app/core/config.py       - Settings via pydantic-settings
backend/app/core/database.py     - SQLAlchemy engine + session
backend/app/models/              - SQLAlchemy models
backend/app/services/            - External API integrations
backend/app/skills/              - Automation skills (BaseSkill pattern)
backend/alembic/                 - DB migrations
backend/pyproject.toml           - uv project config

## Run locally via Docker
make dev           - Start all services with hot reload
make logs-backend  - View backend logs
make shell-backend - Shell into backend container
make migrate       - Run pending migrations
make migrate-create name="describe_change" - Create new migration
make test          - Run pytest

## Adding a new endpoint
1. Create route in app/api/v1/your_module.py
2. Register in app/api/v1/router.py
3. Add service in app/services/ if needed

## Adding a new model
1. Create in app/models/your_model.py
2. Import in app/models/__init__.py
3. Run: make migrate-create name="add_your_model"
4. Run: make migrate

## BaseSkill pattern
class BaseSkill(ABC):
    def __init__(self, project: Project):
        self.project = project
    async def execute(self, payload: dict) -> dict: pass
    @property
    def name(self) -> str: pass
    @property
    def description(self) -> str: pass

## Environment variables
All in backend/.env — never hardcode secrets.
Access via: from app.core.config import settings
