"""Seed script — create initial projects in the database."""
import sys
import os
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from app.core.database import AsyncSessionLocal
from app.models.project import Project
from sqlalchemy import select


async def seed() -> None:
    async with AsyncSessionLocal() as db:
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
                "brand_primary_color": "#7c3aed",
                "brand_secondary_color": "#00FF41",
                "brand_bg_color": "#0a0a0a",
                "visual_style": "typographic",
                "image_mood": "oscuro, premium, tecnológico, sin caras, tipografía bold gigante, estilo hacker/matrix pero elegante, contraste extremo, minimalismo oscuro",
                "brand_fonts": "Space Grotesk Bold, Inter Bold",
                "competitors": "@midudev, @hola.devs, @developerhabits, @programmingwisdom",
                "business_objective": "generate_leads",
                "target_platforms": ["instagram", "facebook"],
                "posting_frequency": "3-4x_week",
            },
            media_config={
                "image_provider": "ideogram",
                "image_style": "typographic",
                "image_aspect_ratio": "1:1",
                "image_color_palette": "dark_purple",
                "image_mood": "oscuro, premium, tecnológico, sin caras, tipografía bold gigante, estilo hacker/matrix pero elegante, contraste extremo, minimalismo oscuro",
                "image_primary_color": "#7c3aed",
                "image_secondary_color": "#00FF41",
                "image_bg_color": "#0a0a0a",
                "image_fonts": "Space Grotesk Bold, Inter Bold",
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
