"""add_super_admin_role_and_owner_id

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-04-09 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f6a7b8c9d0e1'
down_revision: Union[str, None] = 'e5f6a7b8c9d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add owner_id FK column to projects (nullable for existing rows)
    # Idempotent: skip if column already exists (handles container restarts)
    conn = op.get_bind()
    columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(projects)")).fetchall()]
    if 'owner_id' not in columns:
        op.add_column(
            'projects',
            sa.Column('owner_id', sa.String(36), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True)
        )
    # role is stored as a plain VARCHAR — no DB-level enum change needed.
    # The new 'super_admin' value is valid as-is.


def downgrade() -> None:
    op.drop_column('projects', 'owner_id')
