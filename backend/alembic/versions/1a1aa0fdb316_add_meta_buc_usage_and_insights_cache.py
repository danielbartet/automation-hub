"""add_meta_buc_usage_and_insights_cache

Revision ID: 1a1aa0fdb316
Revises: i9j0k1l2m3n4
Create Date: 2026-04-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "1a1aa0fdb316"
down_revision: Union[str, None] = "i9j0k1l2m3n4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # meta_buc_usage — per-BUC-type rate-limit snapshots (independent buckets)
    op.create_table(
        "meta_buc_usage",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("ad_account_id", sa.String(length=64), nullable=False),
        sa.Column("buc_type", sa.String(length=64), nullable=False),
        sa.Column("call_count_pct", sa.Float(), nullable=True),
        sa.Column("total_cputime_pct", sa.Float(), nullable=True),
        sa.Column("total_time_pct", sa.Float(), nullable=True),
        sa.Column("max_pct", sa.Float(), nullable=True),
        sa.Column("estimated_reset_minutes", sa.Integer(), nullable=True),
        sa.Column(
            "recorded_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_meta_buc_usage_ad_account_id", "meta_buc_usage", ["ad_account_id"])
    op.create_index("ix_meta_buc_usage_buc_type", "meta_buc_usage", ["buc_type"])
    op.create_index("ix_meta_buc_usage_recorded_at", "meta_buc_usage", ["recorded_at"])

    # campaign_insights_cache — 1-hour TTL cache for Meta campaign insights
    op.create_table(
        "campaign_insights_cache",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("campaign_id", sa.String(length=64), nullable=False),
        sa.Column("date_preset", sa.String(length=32), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column(
            "cached_at",
            sa.DateTime(),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("campaign_id", "date_preset", name="uq_campaign_insights_preset"),
    )
    op.create_index("ix_campaign_insights_cache_campaign_id", "campaign_insights_cache", ["campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_campaign_insights_cache_campaign_id", table_name="campaign_insights_cache")
    op.drop_table("campaign_insights_cache")
    op.drop_index("ix_meta_buc_usage_recorded_at", table_name="meta_buc_usage")
    op.drop_index("ix_meta_buc_usage_buc_type", table_name="meta_buc_usage")
    op.drop_index("ix_meta_buc_usage_ad_account_id", table_name="meta_buc_usage")
    op.drop_table("meta_buc_usage")
