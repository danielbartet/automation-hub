"""Smoke tests for get_project_token three-tier resolution (security.py)."""
import pytest
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_project(meta_access_token=None, owner_id=None):
    project = MagicMock()
    project.id = 1
    project.meta_access_token = meta_access_token
    project.owner_id = owner_id
    return project


def _make_user_meta_token(encrypted_token="enc_user_tok", expires_at=None):
    umt = MagicMock()
    umt.encrypted_token = encrypted_token
    umt.expires_at = expires_at
    return umt


async def _make_db_with_token(user_meta_token):
    """Return an AsyncMock db whose execute() scalar_one_or_none returns the given token."""
    db = AsyncMock()
    result = MagicMock()
    result.scalar_one_or_none.return_value = user_meta_token
    db.execute.return_value = result
    return db


# ---------------------------------------------------------------------------
# T20 — Flag DISABLED (Tier 1 + Tier 3, Tier 2 never touched)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tier1_wins_when_project_token_set_flag_disabled():
    """Tier 1: project.meta_access_token wins; flag disabled; no DB query."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token="encrypted_tok", owner_id="user-1")
    db = AsyncMock()

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", False), \
         patch("app.core.security.decrypt_token", return_value="plaintext_tok"):
        result = await get_project_token(project, db)

    assert result == "plaintext_tok"
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_tier3_returns_env_var_when_project_token_none_flag_disabled():
    """Tier 3: global fallback used when project token absent and flag disabled."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-1")
    db = AsyncMock()

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", False), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", "global_tok"):
        result = await get_project_token(project, db)

    assert result == "global_tok"
    db.execute.assert_not_called()


@pytest.mark.asyncio
async def test_all_none_returns_none_flag_disabled():
    """When all tiers yield nothing and flag disabled, return None."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-1")
    db = AsyncMock()

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", False), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", ""):
        result = await get_project_token(project, db)

    assert result is None


# ---------------------------------------------------------------------------
# T21 — Flag ENABLED (all 3 tiers)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_tier2_returns_user_token_when_tier1_absent():
    """Tier 2: user token returned when project token absent and token not expired."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-42")
    umt = _make_user_meta_token(encrypted_token="enc_user", expires_at=None)
    db = await _make_db_with_token(umt)

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", True), \
         patch("app.core.security.decrypt_token", return_value="decrypted_user_tok"):
        result = await get_project_token(project, db)

    assert result == "decrypted_user_tok"


@pytest.mark.asyncio
async def test_tier2_skipped_when_token_expired():
    """Tier 2: expired token is skipped (WARNING logged); falls through to Tier 3."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-42")
    expired = _make_user_meta_token(
        encrypted_token="enc_expired",
        expires_at=datetime.utcnow() - timedelta(days=1),
    )
    db = await _make_db_with_token(expired)

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", True), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", "global_fallback"):
        result = await get_project_token(project, db)

    # Should fall through to Tier 3
    assert result == "global_fallback"


@pytest.mark.asyncio
async def test_tier2_skipped_when_owner_id_none():
    """Tier 2: skipped entirely when project.owner_id is None."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id=None)
    db = AsyncMock()

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", True), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", "global_tok"):
        result = await get_project_token(project, db)

    # DB should not be queried — no owner_id
    db.execute.assert_not_called()
    assert result == "global_tok"


@pytest.mark.asyncio
async def test_all_none_returns_none_flag_enabled():
    """All tiers yield nothing when flag enabled — return None."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-1")
    db = await _make_db_with_token(None)

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", True), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", ""):
        result = await get_project_token(project, db)

    assert result is None


@pytest.mark.asyncio
async def test_flag_false_skips_tier2_entirely():
    """Feature flag=False must skip Tier 2 without any DB query."""
    from app.core.security import get_project_token

    project = _make_project(meta_access_token=None, owner_id="user-99")
    db = AsyncMock()

    with patch("app.core.config.settings.USER_META_TOKEN_ENABLED", False), \
         patch("app.core.config.settings.META_ACCESS_TOKEN", "global_tok"):
        result = await get_project_token(project, db)

    db.execute.assert_not_called()
    assert result == "global_tok"
