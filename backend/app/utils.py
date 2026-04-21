"""Shared utility helpers for the Automation Hub backend."""


def _safe_float(value, default: float = 0.0) -> float:
    """Safely converts Meta API numeric values to float, returning default on failure."""
    try:
        return float(value) if value not in (None, "", "N/A") else default
    except (TypeError, ValueError):
        return default
