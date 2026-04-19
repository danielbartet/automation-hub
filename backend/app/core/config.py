"""Application configuration via pydantic-settings."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-key"
    FERNET_KEY: str = ""
    DATABASE_URL: str = "sqlite+aiosqlite:////app/data/automation_hub.db"
    ANTHROPIC_API_KEY: str = ""
    AWS_PROFILE: str = ""
    AWS_BUCKET: str = "quantoria-static"
    AWS_REGION: str = "us-east-1"
    META_APP_ID: str = ""
    META_APP_SECRET: str = ""
    META_ACCESS_TOKEN: str = ""
    N8N_WEBHOOK_SECRET: str = ""
    TELEGRAM_BOT_TOKEN: str = ""
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"
    JWT_SECRET: str = "change-this-in-production-use-long-random-string"  # validated at startup
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    IDEOGRAM_API_KEY: str = ""
    KLING_API_KEY: str = ""
    TELEGRAM_NOTIFICATIONS_ENABLED: bool = False
    META_OAUTH_REDIRECT_URI: str = ""
    META_OAUTH_STATE_SECRET: str = "change-this-in-production"  # validated at startup
    FRONTEND_URL: str = "https://hub.quantorialabs.com"
    USER_META_TOKEN_ENABLED: bool = False
    APIFY_API_KEY: str = ""


settings = Settings()
