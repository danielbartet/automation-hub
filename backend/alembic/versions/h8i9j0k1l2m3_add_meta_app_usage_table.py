"""add_meta_app_usage_table

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-04-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'h8i9j0k1l2m3'
down_revision: Union[str, None] = 'g7h8i9j0k1l2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "meta_app_usage",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column(
            "recorded_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("call_count_pct", sa.Float(), nullable=True),
        sa.Column("total_time_pct", sa.Float(), nullable=True),
        sa.Column("total_cputime_pct", sa.Float(), nullable=True),
        sa.Column("max_pct", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meta_app_usage_id", "meta_app_usage", ["id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_meta_app_usage_id", table_name="meta_app_usage")
    op.drop_table("meta_app_usage")
