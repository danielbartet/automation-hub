"""add_audiences_table

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-04-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c3d4e5f6a7b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = inspector.get_table_names()

    if 'audiences' not in existing_tables:
        op.create_table(
            'audiences',
            sa.Column('id', sa.String(length=36), nullable=False),
            sa.Column('project_id', sa.Integer(), nullable=False),
            sa.Column('meta_audience_id', sa.String(length=100), nullable=True),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('type', sa.String(length=50), nullable=True),
            sa.Column('subtype', sa.String(length=50), nullable=True),
            sa.Column('size', sa.Integer(), nullable=True),
            sa.Column('status', sa.String(length=50), nullable=False, server_default='processing'),
            sa.Column('source_audience_id', sa.String(length=36), nullable=True),
            sa.Column('lookalike_ratio', sa.Float(), nullable=True),
            sa.Column('lookalike_countries', sa.JSON(), nullable=True),
            sa.Column('retention_days', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
            sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_audiences_id'), 'audiences', ['id'], unique=False)
        op.create_index(op.f('ix_audiences_project_id'), 'audiences', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_audiences_project_id'), table_name='audiences')
    op.drop_index(op.f('ix_audiences_id'), table_name='audiences')
    op.drop_table('audiences')
