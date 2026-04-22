"""add_operation_limit_tables

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-04-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "i9j0k1l2m3n4"
down_revision: Union[str, None] = "h8i9j0k1l2m3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # user_operation_limits
    op.create_table(
        "user_operation_limits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("plan", sa.String(length=20), nullable=False, server_default="basic"),
        # Post limits
        sa.Column("max_posts_per_min", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_posts_per_hour", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("max_posts_per_day", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("min_post_interval_min", sa.Integer(), nullable=False, server_default="2"),
        # Campaign limits
        sa.Column("max_campaigns_per_min", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("max_campaigns_per_hour", sa.Integer(), nullable=False, server_default="2"),
        sa.Column("max_campaigns_per_day", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("min_campaign_interval_min", sa.Integer(), nullable=False, server_default="5"),
        # Meta API cap
        sa.Column("meta_usage_cap_pct", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("(CURRENT_TIMESTAMP)"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_operation_limits_user_id", "user_operation_limits", ["user_id"])

    # user_operation_logs
    op.create_table(
        "user_operation_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("operation_type", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_operation_logs_user_id", "user_operation_logs", ["user_id"])
    op.create_index("ix_user_operation_logs_created_at", "user_operation_logs", ["created_at"])
    op.create_index(
        "ix_user_op_logs_user_type_created",
        "user_operation_logs",
        ["user_id", "operation_type", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_op_logs_user_type_created", table_name="user_operation_logs")
    op.drop_index("ix_user_operation_logs_created_at", table_name="user_operation_logs")
    op.drop_index("ix_user_operation_logs_user_id", table_name="user_operation_logs")
    op.drop_table("user_operation_logs")
    op.drop_index("ix_user_operation_limits_user_id", table_name="user_operation_limits")
    op.drop_table("user_operation_limits")
