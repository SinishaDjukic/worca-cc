"""
worca.events.webhook — HTTP webhook delivery.

Public API:
  deliver_webhook(event, webhook_cfg)       — async daemon-thread delivery
  deliver_webhook_sync(event, webhook_cfg)  — synchronous, returns response dict

Internal helpers (exported for tests):
  _matches_filter(event_type, patterns)
  _sign_payload(body_bytes, secret)

Design:
  - urllib.request only (stdlib, no extra deps)
  - HMAC-SHA256 signing when secret is configured
  - Exponential backoff retries: 1s, 2s, 4s
  - Per-event-type rate limiting (per-webhook, keyed by URL+event_type)
  - All failures logged to stderr, never raised
"""

import hashlib
import hmac
import json
import sys
import threading
import time
from fnmatch import fnmatch
from typing import Optional
from urllib import request
from urllib.error import URLError

# ---------------------------------------------------------------------------
# Rate limit state: { (webhook_url, event_type) -> last_delivery_time }
# Protected by _rate_lock for thread safety.
# ---------------------------------------------------------------------------
_rate_state: dict[tuple[str, str], float] = {}
_rate_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _matches_filter(event_type: str, patterns: Optional[list]) -> bool:
    """Return True if event_type matches any of the fnmatch patterns.

    None or empty list means no filter configured — all events match.
    """
    if not patterns:
        return True
    return any(fnmatch(event_type, p) for p in patterns)


def _sign_payload(body: bytes, secret: str) -> str:
    """Return HMAC-SHA256 hex digest of body using secret."""
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _build_request(event: dict, webhook_cfg: dict, body: bytes) -> request.Request:
    """Build the urllib Request with all required headers."""
    url = webhook_cfg["url"]
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "worca-pipeline/1.0",
        "X-Worca-Event": event.get("event_type", ""),
        "X-Worca-Delivery": event.get("event_id", ""),
    }
    secret = webhook_cfg.get("secret")
    if secret:
        sig = _sign_payload(body, secret)
        headers["X-Worca-Signature"] = f"sha256={sig}"

    return request.Request(url, data=body, headers=headers, method="POST")


def _is_rate_limited(event_type: str, webhook_url: str, rate_limit_ms: int) -> bool:
    """Return True if this event type is within the rate limit window."""
    if not rate_limit_ms:
        return False
    key = (webhook_url, event_type)
    now = time.monotonic()
    with _rate_lock:
        last = _rate_state.get(key, 0.0)
        if now - last < rate_limit_ms / 1000.0:
            return True
        _rate_state[key] = now
        return False


def _do_post(event: dict, webhook_cfg: dict) -> Optional[dict]:
    """Perform the HTTP POST with retries. Returns response dict or None.

    - 2xx: success, return parsed JSON body (or {} if non-JSON).
    - 5xx / URLError: retry with exponential backoff.
    - 4xx: no retry, return None.
    - All failures logged; never raised.
    """
    try:
        body = json.dumps(event, ensure_ascii=False).encode()
    except Exception as exc:
        print(f"[worca.webhook] Serialization error: {exc}", file=sys.stderr)
        return None

    req = _build_request(event, webhook_cfg, body)
    timeout = webhook_cfg.get("timeout_ms", 5000) / 1000.0
    max_retries = webhook_cfg.get("max_retries", 3)
    event_type = event.get("event_type", "unknown")
    url = webhook_cfg.get("url", "")

    attempt = 0
    while True:
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                raw = resp.read()
                if 200 <= status < 300:
                    try:
                        return json.loads(raw)
                    except Exception:
                        return {}
                elif 500 <= status < 600:
                    raise _RetryableError(f"HTTP {status}")
                else:
                    # 4xx: client error, don't retry
                    print(
                        f"[worca.webhook] Non-retryable HTTP {status} for "
                        f"{event_type} → {url}",
                        file=sys.stderr,
                    )
                    return None
        except _RetryableError as exc:
            if attempt >= max_retries:
                print(
                    f"[worca.webhook] Giving up after {attempt} retries for "
                    f"{event_type} → {url}: {exc}",
                    file=sys.stderr,
                )
                return None
            delay = 2 ** attempt  # 1, 2, 4, 8, …
            attempt += 1
            time.sleep(delay)
            # Rebuild request (body bytes are the same)
            req = _build_request(event, webhook_cfg, body)
        except URLError as exc:
            if attempt >= max_retries:
                print(
                    f"[worca.webhook] Network error after {attempt} retries for "
                    f"{event_type} → {url}: {exc}",
                    file=sys.stderr,
                )
                return None
            delay = 2 ** attempt
            attempt += 1
            time.sleep(delay)
            req = _build_request(event, webhook_cfg, body)
        except Exception as exc:
            print(
                f"[worca.webhook] Unexpected error delivering {event_type} → {url}: {exc}",
                file=sys.stderr,
            )
            return None


class _RetryableError(Exception):
    pass


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def deliver_webhook(event: dict, webhook_cfg: dict) -> None:
    """Deliver event to webhook in a background daemon thread.

    Returns immediately. Delivery failures are logged, never raised.
    """
    if not webhook_cfg.get("enabled", True):
        return

    event_type = event.get("event_type", "")
    patterns = webhook_cfg.get("events")  # None = all
    if not _matches_filter(event_type, patterns):
        return

    rate_limit_ms = webhook_cfg.get("rate_limit_ms", 0)
    if _is_rate_limited(event_type, webhook_cfg.get("url", ""), rate_limit_ms):
        return

    t = threading.Thread(
        target=_do_post,
        args=(event, webhook_cfg),
        daemon=True,
    )
    t.start()


def deliver_webhook_sync(event: dict, webhook_cfg: dict) -> Optional[dict]:
    """Deliver event synchronously and return the parsed JSON response.

    Used for control webhooks. Blocks until the response is received.
    Returns the parsed response dict, {} for non-JSON 200, or None on failure.
    Never raises.
    """
    if not webhook_cfg.get("enabled", True):
        return None

    event_type = event.get("event_type", "")
    patterns = webhook_cfg.get("events")
    if not _matches_filter(event_type, patterns):
        return None

    try:
        return _do_post(event, webhook_cfg)
    except Exception as exc:
        print(
            f"[worca.webhook] Unexpected sync error for {event_type}: {exc}",
            file=sys.stderr,
        )
        return None
