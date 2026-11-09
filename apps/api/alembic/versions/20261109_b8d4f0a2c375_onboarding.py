"""onboarding: user_settings.onboarding (tour and first-time tips)

Revision ID: b8d4f0a2c375
Revises: a7c3e9f1b264
Create Date: 2026-11-09 12:00:00.000000

Block 3.16: the last tour version done, whether to ask before the tour and the tips already seen,
saved per user so they don't repeat on another PC. Accounts that exist before this migration get
{"tour_invite": true}: they are asked once ("Quer fazer um tour rápido pelo Aureum?") instead of
having the tour start by itself, which is only for accounts created from now on. Users without a
settings row get one (every other column has a default). Older apps ignore the new key.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'b8d4f0a2c375'
down_revision: str | None = 'a7c3e9f1b264'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Also run by tests/test_tour.py.
BACKFILL = """
    INSERT INTO user_settings (user_id, onboarding)
    SELECT id, '{"tour_invite": true}'::jsonb FROM users
    ON CONFLICT (user_id) DO UPDATE SET onboarding = EXCLUDED.onboarding
"""


def upgrade() -> None:
    op.add_column(
        'user_settings',
        sa.Column('onboarding', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    )
    op.execute(BACKFILL)


def downgrade() -> None:
    op.drop_column('user_settings', 'onboarding')
