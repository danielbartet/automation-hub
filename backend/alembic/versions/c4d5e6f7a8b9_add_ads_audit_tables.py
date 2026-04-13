"""add_ads_audit_tables

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-04-13 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4d5e6f7a8b9'
down_revision: Union[str, None] = 'b3c4d5e6f7a8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create ads_audits table first (no FK dependency on audit_check_results)
    op.create_table(
        "ads_audits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("project_id", sa.Integer(), nullable=False),
        sa.Column("ad_account_id", sa.String(50), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("health_score", sa.Float(), nullable=True),
        sa.Column("grade", sa.String(2), nullable=True),
        sa.Column("score_pixel", sa.Float(), nullable=True),
        sa.Column("score_creative", sa.Float(), nullable=True),
        sa.Column("score_structure", sa.Float(), nullable=True),
        sa.Column("score_audience", sa.Float(), nullable=True),
        sa.Column("checks_pass", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checks_warning", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checks_fail", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checks_manual", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checks_na", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("ios_disclaimer", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("triggered_by", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("raw_data", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ads_audits_id", "ads_audits", ["id"], unique=False)
    op.create_index("ix_ads_audits_project_id", "ads_audits", ["project_id"], unique=False)

    # Create audit_check_results table (depends on ads_audits)
    op.create_table(
        "audit_check_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("audit_id", sa.Integer(), nullable=False),
        sa.Column("check_id", sa.String(20), nullable=False),
        sa.Column("category", sa.String(20), nullable=False),
        sa.Column("severity", sa.String(20), nullable=False),
        sa.Column("result", sa.String(20), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("recommendation", sa.Text(), nullable=False, server_default=""),
        sa.Column("meta_value", sa.String(255), nullable=False, server_default=""),
        sa.Column("threshold_value", sa.String(255), nullable=False, server_default=""),
        sa.Column("meta_ui_link", sa.String(500), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["audit_id"], ["ads_audits.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_check_results_id", "audit_check_results", ["id"], unique=False)
    op.create_index("ix_audit_check_results_audit_id", "audit_check_results", ["audit_id"], unique=False)


def downgrade() -> None:
    # Drop in reverse FK dependency order
    op.drop_index("ix_audit_check_results_audit_id", table_name="audit_check_results")
    op.drop_index("ix_audit_check_results_id", table_name="audit_check_results")
    op.drop_table("audit_check_results")

    op.drop_index("ix_ads_audits_project_id", table_name="ads_audits")
    op.drop_index("ix_ads_audits_id", table_name="ads_audits")
    op.drop_table("ads_audits")
