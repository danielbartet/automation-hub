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
    op.add_column(
        'campaign_optimization_logs',
        sa.Column('creative_refreshed', sa.Boolean(), nullable=False, server_default='0'),
    )
    op.add_column(
        'campaign_optimization_logs',
        sa.Column('new_creative_id', sa.String(100), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('campaign_optimization_logs', 'new_creative_id')
    op.drop_column('campaign_optimization_logs', 'creative_refreshed')
