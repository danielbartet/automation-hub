"""User management endpoints — admin and super_admin."""
from datetime import datetime
from uuid import uuid4
import bcrypt
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.api.deps import get_session, require_role, get_current_user
from app.models.user import User
from app.models.user_project import UserProject
from app.models.project import Project

router = APIRouter()


def user_to_dict(u: User, project_ids: list[int] | None = None) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "is_active": u.is_active,
        "telegram_chat_id": u.telegram_chat_id,
        "created_at": str(u.created_at),
        "project_ids": project_ids or [],
    }


@router.get("")
async def list_users(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> list[dict]:
    if current_user.role == "super_admin":
        # super_admin sees all users
        result = await db.execute(select(User).order_by(User.created_at))
        users = result.scalars().all()
    else:
        # admin sees only users assigned to their projects
        owned_projects_result = await db.execute(
            select(Project.id).where(Project.owner_id == current_user.id)
        )
        owned_project_ids = [row[0] for row in owned_projects_result.fetchall()]
        if not owned_project_ids:
            return []
        assigned_user_ids_result = await db.execute(
            select(UserProject.user_id).where(UserProject.project_id.in_(owned_project_ids)).distinct()
        )
        assigned_user_ids = [row[0] for row in assigned_user_ids_result.fetchall()]
        if not assigned_user_ids:
            return []
        result = await db.execute(
            select(User).where(User.id.in_(assigned_user_ids)).order_by(User.created_at)
        )
        users = result.scalars().all()

    out = []
    for u in users:
        up_result = await db.execute(
            select(UserProject.project_id).where(UserProject.user_id == u.id)
        )
        project_ids = [row[0] for row in up_result.fetchall()]
        out.append(user_to_dict(u, project_ids))
    return out


class CreateUserRequest(BaseModel):
    email: str
    name: str
    password: str
    role: str = "operator"  # operator | client
    project_ids: list[int] = []
    can_approve: bool = True


@router.post("")
async def create_user(
    body: CreateUserRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> dict:
    # Check duplicate email
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Email already in use")

    # Role creation rules:
    # - admin can create operator and client only
    # - super_admin can create any role including admin
    if current_user.role == "admin" and body.role in ("admin", "super_admin"):
        raise HTTPException(400, "Admins can only create operator or client users")
    if current_user.role == "super_admin" and body.role == "super_admin":
        raise HTTPException(400, "Cannot create super_admin users via API")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    user = User(
        id=str(uuid4()),
        email=body.email,
        name=body.name,
        password_hash=pw_hash,
        role=body.role,
    )
    db.add(user)
    await db.flush()

    for pid in body.project_ids:
        db.add(UserProject(
            id=str(uuid4()),
            user_id=user.id,
            project_id=pid,
            can_approve=body.can_approve,
        ))

    await db.commit()
    return user_to_dict(user, body.project_ids)


class MetaTokenStatusResponse(BaseModel):
    connected: bool
    expires_at: datetime | None


@router.get("/me/meta-token", response_model=MetaTokenStatusResponse)
async def get_my_meta_token_status(
    db: AsyncSession = Depends(get_session),
    current_user=Depends(get_current_user),
) -> MetaTokenStatusResponse:
    """Return whether the current user has a personal Meta token stored."""
    from app.models.user_meta_token import UserMetaToken
    result = await db.execute(
        select(UserMetaToken).where(UserMetaToken.user_id == current_user.id)
    )
    umt = result.scalar_one_or_none()
    return MetaTokenStatusResponse(
        connected=umt is not None,
        expires_at=umt.expires_at if umt else None,
    )


class UpdateUserRequest(BaseModel):
    role: str | None = None
    is_active: bool | None = None
    project_ids: list[int] | None = None
    can_approve: bool | None = None


@router.put("/{user_id}")
async def update_user(
    user_id: str,
    body: UpdateUserRequest,
    db: AsyncSession = Depends(get_session),
    current_user=Depends(require_role("admin", "super_admin")),
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    if body.role is not None:
        # admin cannot elevate to admin/super_admin; super_admin cannot set super_admin
        if current_user.role == "admin" and body.role in ("admin", "super_admin"):
            raise HTTPException(400, "Admins cannot assign admin or super_admin roles")
        if current_user.role == "super_admin" and body.role == "super_admin":
            raise HTTPException(400, "Cannot set super_admin role via API")
        user.role = body.role
    if body.is_active is not None:
        user.is_active = body.is_active

    if body.project_ids is not None:
        # Replace all project assignments
        await db.execute(delete(UserProject).where(UserProject.user_id == user_id))
        can_approve = body.can_approve if body.can_approve is not None else True
        for pid in body.project_ids:
            db.add(UserProject(id=str(uuid4()), user_id=user_id, project_id=pid, can_approve=can_approve))

    await db.commit()

    up_result = await db.execute(
        select(UserProject.project_id).where(UserProject.user_id == user_id)
    )
    project_ids = [row[0] for row in up_result.fetchall()]
    return user_to_dict(user, project_ids)
