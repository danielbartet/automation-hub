"""tier3a_competitor_intelligence_and_audit_log

Revision ID: g7h8i9j0k1l2
Revises: a7b8c9d0e1f2
Create Date: 2026-04-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'g7h8i9j0k1l2'
down_revision: Union[str, None] = 'a7b8c9d0e1f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── competitor_intelligence_briefs ────────────────────────────────────────
    op.create_table(
        "competitor_intelligence_briefs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("analyzed_ads_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("brief", sa.JSON(), nullable=False, server_default="{}"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_competitor_intelligence_briefs_id",
        "competitor_intelligence_briefs",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_competitor_intelligence_briefs_project_id",
        "competitor_intelligence_briefs",
        ["project_id"],
        unique=False,
    )

    # ── meta_api_audit_log ────────────────────────────────────────────────────
    op.create_table(
        "meta_api_audit_log",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column(
            "timestamp",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("operation", sa.String(64), nullable=False),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(64), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=True),
        sa.Column("response_status", sa.Integer(), nullable=True),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("error_message", sa.String(1024), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_meta_api_audit_log_id",
        "meta_api_audit_log",
        ["id"],
        unique=False,
    )
    op.create_index(
        "ix_meta_api_audit_log_project_id",
        "meta_api_audit_log",
        ["project_id"],
        unique=False,
    )
    op.create_index(
        "ix_meta_api_audit_log_timestamp",
        "meta_api_audit_log",
        ["timestamp"],
        unique=False,
    )
    op.create_index(
        "ix_meta_api_audit_log_operation",
        "meta_api_audit_log",
        ["operation"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_meta_api_audit_log_operation", table_name="meta_api_audit_log")
    op.drop_index("ix_meta_api_audit_log_timestamp", table_name="meta_api_audit_log")
    op.drop_index("ix_meta_api_audit_log_project_id", table_name="meta_api_audit_log")
    op.drop_index("ix_meta_api_audit_log_id", table_name="meta_api_audit_log")
    op.drop_table("meta_api_audit_log")

    op.drop_index(
        "ix_competitor_intelligence_briefs_project_id",
        table_name="competitor_intelligence_briefs",
    )
    op.drop_index(
        "ix_competitor_intelligence_briefs_id",
        table_name="competitor_intelligence_briefs",
    )
    op.drop_table("competitor_intelligence_briefs")
