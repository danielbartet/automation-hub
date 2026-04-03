"""V1 API router — aggregates all endpoint modules."""
from fastapi import APIRouter
from app.api.v1 import projects, content, ads, dashboard, audiences
from app.api.v1.upload import router as upload_router
from app.api.v1 import auth, notifications, users
from app.api.v1 import health

api_router = APIRouter()

api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(projects.router, prefix="/projects", tags=["projects"])
api_router.include_router(health.router, prefix="/projects", tags=["health"])
api_router.include_router(content.router, prefix="/content", tags=["content"])
api_router.include_router(ads.router, prefix="/ads", tags=["ads"])
api_router.include_router(audiences.router, prefix="/audiences", tags=["audiences"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(users.router, prefix="/users", tags=["users"])
api_router.include_router(upload_router)
