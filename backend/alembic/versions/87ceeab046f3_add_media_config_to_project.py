"""add_media_config_to_project

Revision ID: 87ceeab046f3
Revises: 9fc244605bb6
Create Date: 2026-03-29 05:08:33.659519

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '87ceeab046f3'
down_revision: Union[str, None] = '9fc244605bb6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add media_config + credits fields to projects
    op.add_column('projects', sa.Column('media_config', sa.JSON(), nullable=True))
    op.add_column('projects', sa.Column('credits_balance', sa.Integer(), nullable=False, server_default='1000'))
    op.add_column('projects', sa.Column('credits_used_this_month', sa.Integer(), nullable=False, server_default='0'))

    # Add video_url to content_posts
    op.add_column('content_posts', sa.Column('video_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('content_posts', 'video_url')
    op.drop_column('projects', 'credits_used_this_month')
    op.drop_column('projects', 'credits_balance')
    op.drop_column('projects', 'media_config')
