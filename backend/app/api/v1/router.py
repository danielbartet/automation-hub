"""V1 API router — aggregates all endpoint modules."""
from fastapi import APIRouter
from app.api.v1 import projects, content, ads, ads_audit, dashboard, audiences
from app.api.v1.upload import router as upload_router
from app.api.v1 import auth, notifications, users
from app.api.v1 import health
from app.api.v1 import meta_oauth
from app.api.v1 import token_usage as token_usage_module
from app.api.v1 import pinterest as pinterest_module
from app.api.v1 import competitor_intelligence as competitor_intelligence_module

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(health.router, prefix="/projects", tags=["health"])
api_router.include_router(content.router, prefix="/content", tags=["content"])
api_router.include_router(ads.router, prefix="/ads", tags=["ads"])
api_router.include_router(ads_audit.router, prefix="/ads/audit", tags=["ads-audit"])
api_router.include_router(audiences.router, prefix="/audiences", tags=["audiences"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(upload_router)
api_router.include_router(meta_oauth.router, prefix="/auth/meta", tags=["meta-oauth"])
api_router.include_router(token_usage_module.router, prefix="/token-usage", tags=["token-usage"])
api_router.include_router(pinterest_module.router)  # prefix="/pinterest" defined on the router itself
api_router.include_router(pinterest_module.oauth_router, prefix="/auth/pinterest", tags=["pinterest-oauth"])
api_router.include_router(
    competitor_intelligence_module.router,
    prefix="/competitor-intelligence",
    tags=["competitor-intelligence"],
)
