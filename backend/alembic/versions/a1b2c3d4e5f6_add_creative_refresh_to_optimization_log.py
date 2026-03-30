"""add_creative_refresh_to_optimization_log

Revision ID: a1b2c3d4e5f6
Revises: 87ceeab046f3
Create Date: 2026-03-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '87ceeab046f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = [r[0] for r in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]

    if 'campaign_optimization_logs' not in tables:
        op.create_table(
            'campaign_optimization_logs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('campaign_id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=False),
            sa.Column('checked_at', sa.DateTime(), server_default=sa.text('CURRENT_TIMESTAMP')),
            sa.Column('metrics_snapshot', sa.Text(), nullable=True),
            sa.Column('decision', sa.String(20), nullable=True),
            sa.Column('rationale', sa.Text(), nullable=True),
            sa.Column('action_taken', sa.String(20), nullable=True),
            sa.Column('old_budget', sa.Float(), nullable=True),
            sa.Column('new_budget', sa.Float(), nullable=True),
            sa.Column('creative_refreshed', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('new_creative_id', sa.String(100), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
    else:
        existing_cols = [r[1] for r in conn.execute(sa.text("PRAGMA table_info(campaign_optimization_logs)")).fetchall()]
        if 'creative_refreshed' not in existing_cols:
            op.add_column('campaign_optimization_logs', sa.Column('creative_refreshed', sa.Boolean(), nullable=False, server_default='0'))
        if 'new_creative_id' not in existing_cols:
            op.add_column('campaign_optimization_logs', sa.Column('new_creative_id', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('campaign_optimization_logs', 'new_creative_id')
    op.drop_column('campaign_optimization_logs', 'creative_refreshed')
