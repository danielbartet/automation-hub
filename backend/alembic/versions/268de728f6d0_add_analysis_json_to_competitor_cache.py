"""add_analysis_json_to_competitor_cache

Revision ID: 268de728f6d0
Revises: 380095466778
Create Date: 2026-04-17 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '268de728f6d0'
down_revision: Union[str, None] = '380095466778'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(competitor_research_cache)")).fetchall()]
    if 'analysis_json' not in columns:
        op.add_column(
            'competitor_research_cache',
            sa.Column('analysis_json', sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    op.drop_column("competitor_research_cache", "analysis_json")
