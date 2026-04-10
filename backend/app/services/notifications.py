"""Notification service — creates and manages in-app notifications."""
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from app.models.notification import Notification
from app.models.user import User
from app.models.user_project import UserProject


class NotificationService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create(
        self,
        type: str,
        title: str,
        message: str,
        project_id: int | None = None,
        user_id: str | None = None,
        action_url: str | None = None,
        action_label: str | None = None,
        action_data: dict | None = None,
    ) -> list[Notification]:
        """Create notification(s).

        If user_id is set → one notification for that user.
        If user_id is None → one per admin + one per operator assigned to project_id.
        """
        target_user_ids: list[str] = []

        if user_id:
            target_user_ids = [user_id]
        else:
            # All super_admins and admins
            admin_result = await self.db.execute(
                select(User.id).where(User.role.in_(["admin", "super_admin"]), User.is_active == True)
            )
            target_user_ids.extend(row[0] for row in admin_result.fetchall())

            # Operators assigned to this project
            if project_id:
                op_result = await self.db.execute(
                    select(UserProject.user_id).where(UserProject.project_id == project_id)
                )
                op_user_ids = {row[0] for row in op_result.fetchall()}
                # Add operators (not already in target)
                if op_user_ids:
                    op_users_result = await self.db.execute(
                        select(User.id).where(
                            User.id.in_(op_user_ids),
                            User.role == "operator",
                            User.is_active == True,
                        )
                    )
                    for row in op_users_result.fetchall():
                        if row[0] not in target_user_ids:
                            target_user_ids.append(row[0])

        if not target_user_ids:
            # Fallback: create unaddressed notification (user_id=None)
            target_user_ids = [None]  # type: ignore

        created = []
        for uid in target_user_ids:
            notif = Notification(
                id=str(uuid4()),
                user_id=uid,
                project_id=project_id,
                type=type,
                title=title,
                message=message,
                action_url=action_url,
                action_label=action_label,
                action_data=action_data,
            )
            self.db.add(notif)
            created.append(notif)

        await self.db.commit()
        return created

    async def mark_read(self, notification_id: str, user_id: str) -> bool:
        result = await self.db.execute(
            select(Notification).where(
                Notification.id == notification_id,
                Notification.user_id == user_id,
            )
        )
        notif = result.scalar_one_or_none()
        if notif:
            notif.is_read = True
            await self.db.commit()
            return True
        return False

    async def mark_all_read(self, user_id: str) -> int:
        result = await self.db.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.is_read == False,
            )
        )
        notifs = result.scalars().all()
        for n in notifs:
            n.is_read = True
        await self.db.commit()
        return len(notifs)

    async def get_unread_count(self, user_id: str) -> int:
        result = await self.db.execute(
            select(sqlfunc.count(Notification.id)).where(
                Notification.user_id == user_id,
                Notification.is_read == False,
            )
        )
        return result.scalar() or 0

    async def get_for_user(
        self,
        user_id: str,
        page: int = 1,
        per_page: int = 20,
        unread_only: bool = False,
    ) -> list[Notification]:
        query = select(Notification).where(Notification.user_id == user_id)
        if unread_only:
            query = query.where(Notification.is_read == False)
        query = query.order_by(Notification.created_at.desc()).offset((page - 1) * per_page).limit(per_page)
        result = await self.db.execute(query)
        return result.scalars().all()
