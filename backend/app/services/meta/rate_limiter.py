"""In-memory per-project rate limiter for Meta API calls."""
import time
from collections import defaultdict
from fastapi import HTTPException


class MetaRateLimiter:
    """
    In-memory 3-window rate limiter per project_id.
    Resets on server restart — acceptable for now.
    """

    LIMITS = {
        "10min":  {"window_seconds": 600,   "max_calls": 10},
        "1hr":    {"window_seconds": 3600,  "max_calls": 30},
        "24hr":   {"window_seconds": 86400, "max_calls": 100},
    }

    def __init__(self) -> None:
        # project_id -> list of (timestamp, operation) tuples
        self._log: dict[int, list[tuple[float, str]]] = defaultdict(list)

    def _prune(self, project_id: int) -> None:
        now = time.time()
        max_window = max(w["window_seconds"] for w in self.LIMITS.values())
        self._log[project_id] = [
            (ts, op) for ts, op in self._log[project_id]
            if now - ts < max_window
        ]

    def check_and_record(self, project_id: int, operation: str = "api_call") -> None:
        """Check rate limits; raise HTTP 429 if exceeded; record the call."""
        self._prune(project_id)
        now = time.time()
        calls = self._log[project_id]

        for window_name, cfg in self.LIMITS.items():
            window_secs = cfg["window_seconds"]
            max_calls = cfg["max_calls"]
            recent = sum(1 for ts, _ in calls if now - ts < window_secs)
            if recent >= max_calls:
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded for project {project_id}: max {max_calls} {operation} per {window_name}",
                )

        self._log[project_id].append((now, operation))

    def get_usage(self, project_id: int) -> dict:
        """Return current usage across all windows for observability."""
        self._prune(project_id)
        now = time.time()
        calls = self._log[project_id]
        return {
            window_name: {
                "used": sum(1 for ts, _ in calls if now - ts < cfg["window_seconds"]),
                "limit": cfg["max_calls"],
            }
            for window_name, cfg in self.LIMITS.items()
        }


meta_rate_limiter = MetaRateLimiter()
