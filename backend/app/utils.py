"""Shared utility helpers for the Automation Hub backend."""


def _safe_float(v, default: float = 0.0) -> float:
    """Safely convert a value to float, returning default on None, empty string, or error."""
    try:
        return float(v) if v not in (None, "") else default
    except (TypeError, ValueError):
        return default
