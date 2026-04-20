"""add_pinterest_pin_generator

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-04-19 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7b8c9d0e1f2'
down_revision: Union[str, None] = 'f6a7b8c9d0e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add Pinterest OAuth columns to projects (idempotent — skip if already exist)
    conn = op.get_bind()
    columns = [row[1] for row in conn.execute(sa.text("PRAGMA table_info(projects)")).fetchall()]
    if 'pinterest_access_token' not in columns:
        op.add_column('projects', sa.Column('pinterest_access_token', sa.Text(), nullable=True))
    if 'pinterest_refresh_token' not in columns:
        op.add_column('projects', sa.Column('pinterest_refresh_token', sa.Text(), nullable=True))
    if 'pinterest_oauth_verifier' not in columns:
        op.add_column('projects', sa.Column('pinterest_oauth_verifier', sa.Text(), nullable=True))

    # Create pinterest_pins table
    tables = [row[0] for row in conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()]
    if 'pinterest_pins' not in tables:
        op.create_table(
            'pinterest_pins',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('project_id', sa.Integer(), sa.ForeignKey('projects.id'), nullable=False),
            sa.Column('title', sa.String(100), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('image_url', sa.Text(), nullable=True),
            sa.Column('layout', sa.String(50), nullable=False, server_default='bottom'),
            sa.Column('topic', sa.String(255), nullable=True),
            sa.Column('board_id', sa.String(100), nullable=True),
            sa.Column('pinterest_pin_id', sa.String(100), nullable=True),
            sa.Column('status', sa.String(50), nullable=False, server_default='pending_approval'),
            sa.Column('published_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column('updated_at', sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_pinterest_pins_id', 'pinterest_pins', ['id'])
        op.create_index('ix_pinterest_pins_project_id', 'pinterest_pins', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_pinterest_pins_project_id', table_name='pinterest_pins')
    op.drop_index('ix_pinterest_pins_id', table_name='pinterest_pins')
    op.drop_table('pinterest_pins')
    op.drop_column('projects', 'pinterest_oauth_verifier')
    op.drop_column('projects', 'pinterest_refresh_token')
    op.drop_column('projects', 'pinterest_access_token')
