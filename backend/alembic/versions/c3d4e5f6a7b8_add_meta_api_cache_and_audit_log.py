"""add_meta_api_cache_and_audit_log

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-04-02 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'meta_api_cache',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=False),
        sa.Column('cache_key', sa.String(length=100), nullable=False),
        sa.Column('data', sa.JSON(), nullable=True),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
        sa.Column('ttl_seconds', sa.Integer(), nullable=False, server_default='900'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_meta_api_cache_project_id'), 'meta_api_cache', ['project_id'], unique=False)

    op.create_table(
        'audit_log',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('project_id', sa.Integer(), nullable=True),
        sa.Column('action', sa.String(length=200), nullable=False),
        sa.Column('endpoint', sa.String(length=500), nullable=False),
        sa.Column('response_status', sa.Integer(), nullable=True),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('timestamp', sa.DateTime(), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_audit_log_project_id'), 'audit_log', ['project_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_audit_log_project_id'), table_name='audit_log')
    op.drop_table('audit_log')
    op.drop_index(op.f('ix_meta_api_cache_project_id'), table_name='meta_api_cache')
    op.drop_table('meta_api_cache')
