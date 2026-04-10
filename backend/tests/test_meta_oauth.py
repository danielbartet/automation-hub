"""Smoke tests for meta_oauth.py service: generate_state / validate_state."""
import time
import pytest
from unittest.mock import patch


# ---------------------------------------------------------------------------
# T22 — generate_state / validate_state dual-mode
# ---------------------------------------------------------------------------

def test_generate_and_validate_state_project_mode():
    """generate_state(mode='project', slug='test') → validate_state returns correct payload."""
    from app.services.meta_oauth import generate_state, validate_state

    state = generate_state(mode="project", slug="test")
    payload = validate_state(state)

    assert payload["mode"] == "project"
    assert payload["slug"] == "test"


def test_generate_and_validate_state_user_mode():
    """generate_state(mode='user', user_id='123') → validate_state returns correct payload."""
    from app.services.meta_oauth import generate_state, validate_state

    state = generate_state(mode="user", user_id="123")
    payload = validate_state(state)

    assert payload["mode"] == "user"
    assert payload["user_id"] == "123"


def test_validate_state_backward_compat_no_mode_key():
    """Old state without 'mode' key → validate_state injects mode='project'."""
    import base64
    import hashlib
    import hmac
    import json
    from app.core.config import settings
    from app.services.meta_oauth import validate_state

    # Build an old-format payload without 'mode'
    payload = {"slug": "legacy-project", "ts": int(time.time())}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(
        settings.META_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()
    state = f"{encoded}.{sig}"

    result = validate_state(state)

    assert result["mode"] == "project"
    assert result["slug"] == "legacy-project"


def test_validate_state_tampered_raises_value_error():
    """Tampered state (modified signature) raises ValueError."""
    from app.services.meta_oauth import generate_state, validate_state

    state = generate_state(mode="project", slug="real-project")
    # Flip the last character of the signature
    tampered = state[:-1] + ("x" if state[-1] != "x" else "y")

    with pytest.raises(ValueError, match="HMAC signature is invalid"):
        validate_state(tampered)


def test_validate_state_expired_raises_value_error():
    """Expired state (ts too old) raises ValueError."""
    import base64
    import hashlib
    import hmac
    import json
    from app.core.config import settings
    from app.services.meta_oauth import validate_state, _STATE_TTL

    # Craft a state with a timestamp 1 second past the TTL
    old_ts = int(time.time()) - _STATE_TTL - 1
    payload = {"mode": "project", "slug": "old-project", "ts": old_ts}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(
        settings.META_OAUTH_STATE_SECRET.encode(),
        encoded.encode(),
        hashlib.sha256,
    ).hexdigest()
    state = f"{encoded}.{sig}"

    with pytest.raises(ValueError, match="expired"):
        validate_state(state)
