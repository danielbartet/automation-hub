"""remove_n8n_webhook_base_url_from_projects

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = [r[1] for r in conn.execute(sa.text("PRAGMA table_info(projects)")).fetchall()]
    if 'n8n_webhook_base_url' in cols:
        op.drop_column('projects', 'n8n_webhook_base_url')


def downgrade() -> None:
    op.add_column('projects', sa.Column('n8n_webhook_base_url', sa.String(255), nullable=True))
