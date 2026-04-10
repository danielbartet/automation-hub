"""andromeda_v2_narrative_angle_and_competitor_cache

Revision ID: a2b3c4d5e6f7
Revises: f6a7b8c9d0e1
Create Date: 2026-04-10 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a2b3c4d5e6f7'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()

    # 1. Add narrative_angle column to content_posts (idempotent)
    columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(content_posts)")).fetchall()]
    if 'narrative_angle' not in columns:
        op.add_column(
            'content_posts',
            sa.Column('narrative_angle', sa.String(), nullable=True)
        )

    # 2. Create competitor_research_cache table (idempotent)
    tables = [row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]
    if 'competitor_research_cache' not in tables:
        op.create_table(
            'competitor_research_cache',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False),
            sa.Column('research_json', sa.JSON(), nullable=False),
            sa.Column('fetched_at', sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('project_id'),
        )
        op.create_index(
            'ix_competitor_research_cache_project_id',
            'competitor_research_cache',
            ['project_id']
        )


def downgrade() -> None:
    op.drop_index('ix_competitor_research_cache_project_id', table_name='competitor_research_cache')
    op.drop_table('competitor_research_cache')
    op.drop_column('content_posts', 'narrative_angle')
