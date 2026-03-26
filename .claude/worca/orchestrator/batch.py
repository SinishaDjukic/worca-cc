"""Batch processing with rate limiting and circuit breakers.

Processes multiple work requests sequentially, tracking failures and
applying circuit breaker logic.
"""

import hashlib
import json
import os
import time

from worca.orchestrator.runner import run_pipeline
from worca.orchestrator.work_request import WorkRequest


class CircuitBreakerError(Exception):
    """Raised when too many consecutive failures occur."""
    pass


class RateLimitError(Exception):
    """Raised when API rate limit is hit."""
    pass


def _request_id(request: WorkRequest) -> str:
    """Generate a short hash ID for a work request.

    Uses source_ref if available, otherwise falls back to title.
    """
    key = request.source_ref or request.title
    return hashlib.md5(key.encode()).hexdigest()[:12]


def should_skip(request: WorkRequest, results_dir: str = ".worca/results") -> bool:
    """Check if a result already exists for this request.

    Returns True if a completed result file exists for the request ID.
    """
    rid = _request_id(request)
    result_path = os.path.join(results_dir, f"{rid}.json")
    if not os.path.exists(result_path):
        return False
    with open(result_path) as f:
        result = json.load(f)
    return result.get("completed", False)


def run_batch(
    requests: list,
    settings_path: str = ".claude/settings.json",
    max_failures: int = 3,
    results_dir: str = ".worca/results",
) -> list:
    """Process a batch of work requests sequentially.

    Runs each request through run_pipeline(). Tracks consecutive failures
    and raises CircuitBreakerError after max_failures consecutive failures.
    Catches RateLimitError and retries with exponential backoff.
    Skips requests that already have completed results.

    Returns list of results (status dicts, skip markers, or error dicts).
    """
    results = []
    consecutive_failures = 0

    for request in requests:
        if should_skip(request, results_dir):
            results.append({"skipped": True, "title": request.title})
            continue

        try:
            result = run_pipeline(request, settings_path=settings_path)
            results.append(result)
            consecutive_failures = 0

            # Save result
            os.makedirs(results_dir, exist_ok=True)
            rid = _request_id(request)
            with open(os.path.join(results_dir, f"{rid}.json"), "w") as f:
                json.dump({"completed": True, **result}, f)

        except RateLimitError:
            backoff = 2 ** consecutive_failures
            time.sleep(backoff)
            consecutive_failures += 1
            results.append({"error": "rate_limit", "title": request.title})

        except Exception as e:
            consecutive_failures += 1
            results.append({"error": str(e), "title": request.title})

            if consecutive_failures >= max_failures:
                raise CircuitBreakerError(
                    f"Circuit breaker: {consecutive_failures} consecutive failures"
                )

    return results
