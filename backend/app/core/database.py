"""Async SQLAlchemy database engine and session factory."""
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.APP_ENV == "development",
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base for all SQLAlchemy models."""
    pass


async def get_db() -> AsyncSession:
    """Dependency that yields an async database session."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    """Create all tables (used in dev; in prod use Alembic migrations)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def seed_db() -> None:
    """Seed initial data."""
    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from app.models.project import Project
        result = await session.execute(select(Project).where(Project.slug == "quantoria-labs"))
        if not result.scalar_one_or_none():
            project = Project(
                name="Quantoria Labs",
                slug="quantoria-labs",
                description="Tech education for LATAM developers",
                facebook_page_id="1010286398835015",
                instagram_account_id="17841449394293930",
                ad_account_id="act_1337773745049119",
                telegram_chat_id="1284119239",
                n8n_webhook_base_url="https://n8n.quantorialabs.com/webhook/QHcY6NWupxgAsy3m/webhook",
                is_active=True,
                content_config={
                    "language": "es",
                    "brand_name": "Quantoria Labs",
                    "tone": "Technical, direct, elegant. Confrontational but intelligent. No excessive emojis. No empty motivational phrases. No influencer style.",
                    "core_message": "AI no reemplaza developers. Reemplaza developers promedio.",
                    "target_audience": "Developers 22-32 años, 0-5 años experiencia, que sienten que el AI los puede dejar atrás",
                    "content_categories": [
                        "Confrontación estratégica — desafiar suposiciones cómodas",
                        "Errores comunes de juniors — errores técnicos y profesionales específicos",
                        "Frameworks mentales — formas estructuradas de pensar la carrera",
                        "Micro-checklists accionables — pasos concretos que pueden tomar ya",
                    ],
                    "output_format": "carousel_6_slides",
                    "slide_count": 6,
                    "additional_rules": [
                        "El slide 1 debe hacer que alguien pare de scrollear",
                        "Cada slide debe tener UNA sola idea clara",
                        "Los hashtags deben ser relevantes, no spam",
                        "El caption debe reforzar el posicionamiento de marca",
                    ],
                },
            )
            session.add(project)
            await session.commit()
