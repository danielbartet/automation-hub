"""Seed script — create initial super_admin user and projects in the database."""
import sys
import os
import asyncio
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import AsyncSessionLocal
from app.models.project import Project
from app.models.user import User
from sqlalchemy import select
import bcrypt


async def seed() -> None:
    async with AsyncSessionLocal() as db:
        # Seed or upgrade the super_admin user
        admin_result = await db.execute(select(User).where(User.email == "admin@automation-hub.com"))
        existing_admin = admin_result.scalar_one_or_none()
        if existing_admin:
            if existing_admin.role == "admin":
                existing_admin.role = "super_admin"
                await db.commit()
                print("Upgraded admin@automation-hub.com to super_admin.")
            else:
                print(f"User admin@automation-hub.com already exists with role={existing_admin.role}, skipping.")
        else:
            pw_hash = bcrypt.hashpw(b"admin", bcrypt.gensalt()).decode()
            super_admin = User(
                id=str(uuid4()),
                email="admin@automation-hub.com",
                name="Admin",
                password_hash=pw_hash,
                role="super_admin",
                is_active=True,
            )
            db.add(super_admin)
            await db.commit()
            print("Created super_admin user: admin@automation-hub.com / admin")

        result = await db.execute(select(Project).where(Project.slug == "quantoria-labs"))
        existing = result.scalar_one_or_none()
        if existing:
            print("Project quantoria-labs already exists, skipping.")
            return

        project = Project(
            name="Quantoria Labs",
            slug="quantoria-labs",
            description="Tech education for LATAM developers",
            facebook_page_id="1010286398835015",
            instagram_account_id="17841449394293930",
            ad_account_id="act_1337773745049119",
            telegram_chat_id="1284119239",
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
                "brand_primary_color": "#00FF41",
                "brand_secondary_color": "#ffffff",
                "brand_bg_color": "#0a0a0a",
                "visual_style": "typographic",
                "image_mood": "oscuro, hacker, terminal verde, sin caras, tipografía bold gigante, estilo matrix elegante, contraste extremo, minimalismo dark",
                "brand_fonts": "Space Grotesk Bold, Inter Bold",
                "competitors": "@midudev, @hola.devs, @developerhabits, @programmingwisdom",
                "business_objective": "generate_leads",
                "target_platforms": ["instagram", "facebook"],
                "posting_frequency": "3-4x_week",
            },
            media_config={
                "image_provider": "html",
                "brand_handle": "quantorialabs",
                "image_cta_url": "quantorialabs.com",
                "image_style": "typographic",
                "image_aspect_ratio": "1:1",
                "image_color_palette": "dark_green",
                "image_mood": "oscuro, hacker, terminal verde, sin caras, tipografía bold gigante, estilo matrix elegante, contraste extremo, minimalismo dark",
                "image_primary_color": "#00FF41",
                "image_secondary_color": "#ffffff",
                "image_bg_color": "#0a0a0a",
                "image_fonts": "Space Grotesk Bold, Inter Bold",
                "google_fonts_url": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=Inter:wght@400;600;700;800;900&display=swap",
                "video_provider": "kling",
                "video_duration": 5,
                "video_aspect_ratio": "9:16",
                "video_quality": "standard",
            },
            credits_balance=1000,
            credits_used_this_month=0,
        )
        db.add(project)
        await db.commit()
        print(f"Seeded project: quantoria-labs (id={project.id})")


if __name__ == "__main__":
    asyncio.run(seed())
