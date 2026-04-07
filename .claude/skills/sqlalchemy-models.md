---
name: sqlalchemy-models
description: "ALWAYS use this skill before creating or modifying any database model or migration. Load it whenever: adding a new model, writing a migration, querying the database, or working with SQLAlchemy in this project. Contains the base model pattern and migration workflow."
---

# SQLAlchemy Models Skill

## Base model pattern
from sqlalchemy import Column, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.core.database import Base
from uuid import uuid4

class YourModel(Base):
    __tablename__ = "your_table"
    id = Column(String, primary_key=True, default=lambda: str(uuid4()))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

## Project model key fields
id, name, slug, description
meta_access_token  (Fernet encrypted)
facebook_page_id, instagram_account_id, ad_account_id
telegram_chat_id, n8n_webhook_base_url
is_active, created_at, updated_at

## Migrations workflow
Create: make migrate-create name="describe_the_change"
Apply: make migrate
Check current: make shell-backend → uv run alembic current

## DB session in endpoints
from app.api.deps import get_db
from sqlalchemy.orm import Session

@router.get("/items")
async def get_items(db: Session = Depends(get_db)):
    return db.query(YourModel).all()
