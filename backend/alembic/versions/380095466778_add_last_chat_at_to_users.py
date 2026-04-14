"""add_last_chat_at_to_users

Revision ID: 380095466778
Revises: d5e6f7a8b9c0
Create Date: 2026-04-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '380095466778'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: skip if column already exists
    conn = op.get_bind()
    columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(users)")).fetchall()]
    if 'last_chat_at' not in columns:
        op.add_column(
            'users',
            sa.Column('last_chat_at', sa.DateTime(), nullable=True)
        )


def downgrade() -> None:
    op.drop_column('users', 'last_chat_at')
