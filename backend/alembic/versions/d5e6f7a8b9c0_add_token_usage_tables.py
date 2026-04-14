"""add_token_usage_tables

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-04-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c4d5e6f7a8b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "token_usage_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(36), nullable=True),
        sa.Column("project_id", sa.Integer(), nullable=True),
        sa.Column("tokens_input", sa.Integer(), nullable=False),
        sa.Column("tokens_output", sa.Integer(), nullable=False),
        sa.Column("tokens_cached", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column("operation_type", sa.String(50), nullable=False),
        sa.Column("cost_usd", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_token_usage_log_id", "token_usage_log", ["id"], unique=False)
    op.create_index("ix_token_usage_log_user_id", "token_usage_log", ["user_id"], unique=False)
    op.create_index("ix_token_usage_log_project_id", "token_usage_log", ["project_id"], unique=False)
    op.create_index("ix_token_usage_log_created_at", "token_usage_log", ["created_at"], unique=False)
    op.create_index("ix_token_usage_log_user_created", "token_usage_log", ["user_id", "created_at"], unique=False)
    op.create_index("ix_token_usage_log_project_created", "token_usage_log", ["project_id", "created_at"], unique=False)

    op.create_table(
        "user_token_limits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(36), nullable=False),
        sa.Column("monthly_token_limit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_token_limits_id", "user_token_limits", ["id"], unique=False)
    op.create_index("ix_user_token_limits_user_id", "user_token_limits", ["user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_token_usage_log_project_created", table_name="token_usage_log")
    op.drop_index("ix_token_usage_log_user_created", table_name="token_usage_log")
    op.drop_index("ix_token_usage_log_created_at", table_name="token_usage_log")
    op.drop_index("ix_token_usage_log_project_id", table_name="token_usage_log")
    op.drop_index("ix_token_usage_log_user_id", table_name="token_usage_log")
    op.drop_index("ix_token_usage_log_id", table_name="token_usage_log")
    op.drop_table("token_usage_log")

    op.drop_index("ix_user_token_limits_user_id", table_name="user_token_limits")
    op.drop_index("ix_user_token_limits_id", table_name="user_token_limits")
    op.drop_table("user_token_limits")
