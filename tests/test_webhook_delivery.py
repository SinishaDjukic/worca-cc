"""
Tests for worca.events.webhook — deliver_webhook() and deliver_webhook_sync().

TDD: these tests are written first and should FAIL until webhook.py is implemented.
"""

import hashlib
import hmac
import json
import sys
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, ".claude")

from worca.events.webhook import (
    _matches_filter,
    _sign_payload,
    deliver_webhook,
    deliver_webhook_sync,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_EVENT = {
    "schema_version": "1",
    "event_id": "550e8400-e29b-41d4-a716-446655440000",
    "event_type": "pipeline.run.started",
    "timestamp": "2026-03-20T07:57:00.000Z",
    "run_id": "20260320-075700",
    "pipeline": {
        "branch": "worca/w-003",
        "work_request": {"title": "Test", "source_ref": "test", "priority": "P2"},
    },
    "payload": {"resume": False},
}


def _wh(url="http://localhost:9999", secret=None, events=None, enabled=True,
         timeout_ms=5000, max_retries=3, rate_limit_ms=0, control=False):
    """Build a minimal webhook config dict."""
    cfg = {
        "url": url,
        "enabled": enabled,
        "timeout_ms": timeout_ms,
        "max_retries": max_retries,
        "rate_limit_ms": rate_limit_ms,
        "control": control,
    }
    if secret is not None:
        cfg["secret"] = secret
    if events is not None:
        cfg["events"] = events
    return cfg


# ---------------------------------------------------------------------------
# _matches_filter
# ---------------------------------------------------------------------------

class TestMatchesFilter:
    def test_wildcard_matches_everything(self):
        assert _matches_filter("pipeline.run.started", ["*"]) is True

    def test_exact_match(self):
        assert _matches_filter("pipeline.run.started", ["pipeline.run.started"]) is True

    def test_no_match(self):
        assert _matches_filter("pipeline.run.started", ["pipeline.stage.completed"]) is False

    def test_prefix_glob(self):
        assert _matches_filter("pipeline.run.started", ["pipeline.run.*"]) is True
        assert _matches_filter("pipeline.stage.completed", ["pipeline.run.*"]) is False

    def test_multiple_patterns_first_matches(self):
        assert _matches_filter("pipeline.bead.created", ["pipeline.run.*", "pipeline.bead.*"]) is True

    def test_empty_filter_list_matches_everything(self):
        """Empty list means no filter configured — deliver all events."""
        assert _matches_filter("pipeline.run.started", []) is True

    def test_none_filter_matches_everything(self):
        """None means no filter configured — deliver all events."""
        assert _matches_filter("pipeline.run.started", None) is True


# ---------------------------------------------------------------------------
# _sign_payload
# ---------------------------------------------------------------------------

class TestSignPayload:
    def test_returns_sha256_hex(self):
        body = b'{"test": 1}'
        sig = _sign_payload(body, "my-secret")
        expected = hmac.new(b"my-secret", body, hashlib.sha256).hexdigest()
        assert sig == expected

    def test_different_secrets_give_different_sigs(self):
        body = b'{"test": 1}'
        sig1 = _sign_payload(body, "secret-a")
        sig2 = _sign_payload(body, "secret-b")
        assert sig1 != sig2

    def test_different_bodies_give_different_sigs(self):
        sig1 = _sign_payload(b'{"a": 1}', "secret")
        sig2 = _sign_payload(b'{"b": 2}', "secret")
        assert sig1 != sig2


# ---------------------------------------------------------------------------
# deliver_webhook (async, daemon thread)
# ---------------------------------------------------------------------------

class TestDeliverWebhook:
    def test_disabled_webhook_not_delivered(self):
        """Disabled webhooks must be skipped entirely."""
        wh = _wh(enabled=False)
        with patch("urllib.request.urlopen") as mock_open:
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.1)
            mock_open.assert_not_called()

    def test_event_filtered_out_not_delivered(self):
        """Events not matching the filter pattern are skipped."""
        wh = _wh(events=["pipeline.stage.*"])
        with patch("urllib.request.urlopen") as mock_open:
            deliver_webhook(SAMPLE_EVENT, wh)  # event_type=pipeline.run.started
            time.sleep(0.1)
            mock_open.assert_not_called()

    def test_returns_immediately(self):
        """deliver_webhook must return immediately (non-blocking)."""
        wh = _wh(events=["*"])

        slow_response = MagicMock()
        slow_response.__enter__ = lambda s: s
        slow_response.__exit__ = MagicMock(return_value=False)
        slow_response.status = 200

        with patch("urllib.request.urlopen", return_value=slow_response):
            start = time.monotonic()
            deliver_webhook(SAMPLE_EVENT, wh)
            elapsed = time.monotonic() - start
            assert elapsed < 0.1, f"deliver_webhook blocked for {elapsed:.3f}s"

    def test_posts_json_body(self):
        """Verify the request body is a JSON-serialised event envelope."""
        received_bodies = []

        def fake_urlopen(req, timeout):
            received_bodies.append(req.data)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        assert len(received_bodies) == 1
        parsed = json.loads(received_bodies[0])
        assert parsed["event_type"] == "pipeline.run.started"

    def test_required_headers_sent(self):
        """X-Worca-Event, X-Worca-Delivery, Content-Type, User-Agent must be present."""
        received_headers = []

        def fake_urlopen(req, timeout):
            received_headers.append(dict(req.headers))
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        assert len(received_headers) == 1
        hdrs = received_headers[0]
        # Header names are capitalised by urllib
        header_keys_lower = {k.lower() for k in hdrs}
        assert "x-worca-event" in header_keys_lower
        assert "x-worca-delivery" in header_keys_lower
        assert "content-type" in header_keys_lower
        assert "user-agent" in header_keys_lower

    def test_hmac_signature_header_when_secret_configured(self):
        """X-Worca-Signature: sha256=<hex> must be present when secret is set."""
        received_requests = []

        def fake_urlopen(req, timeout):
            received_requests.append(req)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        secret = "test-secret-key"
        wh = _wh(events=["*"], secret=secret)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        assert len(received_requests) == 1
        req = received_requests[0]
        sig_header = req.get_header("X-worca-signature")
        assert sig_header is not None, "X-Worca-Signature header missing"
        assert sig_header.startswith("sha256=")
        # Verify correctness
        body = req.data
        expected_sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert sig_header == f"sha256={expected_sig}"

    def test_no_signature_header_without_secret(self):
        """No X-Worca-Signature when no secret configured."""
        received_requests = []

        def fake_urlopen(req, timeout):
            received_requests.append(req)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"])  # no secret
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        req = received_requests[0]
        sig_header = req.get_header("X-worca-signature")
        assert sig_header is None

    def test_retries_on_5xx(self):
        """5xx responses trigger retries up to max_retries."""
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 500
            resp.read.return_value = b"error"
            return resp

        wh = _wh(events=["*"], max_retries=2)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            with patch("time.sleep"):  # speed up test
                deliver_webhook(SAMPLE_EVENT, wh)
                time.sleep(0.3)

        # Initial attempt + 2 retries = 3 total
        assert call_count[0] == 3

    def test_no_retry_on_4xx(self):
        """4xx responses are not retried (client errors)."""
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 404
            resp.read.return_value = b"not found"
            return resp

        wh = _wh(events=["*"], max_retries=3)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        assert call_count[0] == 1

    def test_retries_on_network_error(self):
        """Network errors (OSError) also trigger retries."""
        from urllib.error import URLError
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            raise URLError("connection refused")

        wh = _wh(events=["*"], max_retries=2)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            with patch("time.sleep"):
                deliver_webhook(SAMPLE_EVENT, wh)
                time.sleep(0.3)

        assert call_count[0] == 3

    def test_exponential_backoff_delays(self):
        """Retries use 1s, 2s, 4s exponential backoff."""
        from urllib.error import URLError
        sleep_calls = []

        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            raise URLError("connection refused")

        def fake_sleep(x):
            sleep_calls.append(x)

        wh = _wh(events=["*"], max_retries=3)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            with patch("worca.events.webhook.time.sleep", side_effect=fake_sleep):
                deliver_webhook(SAMPLE_EVENT, wh)
                # Wait for all attempts (initial + 3 retries = 4 urlopen calls)
                deadline = time.monotonic() + 5
                while call_count[0] < 4 and time.monotonic() < deadline:
                    time.sleep(0.01)

        # Should see delays 1, 2, 4 for 3 retries
        assert sleep_calls == [1, 2, 4]

    def test_failure_does_not_raise(self):
        """Delivery failures must never propagate exceptions."""
        from urllib.error import URLError

        wh = _wh(events=["*"], max_retries=1)
        with patch("urllib.request.urlopen", side_effect=URLError("oops")):
            with patch("time.sleep"):
                # Must not raise
                deliver_webhook(SAMPLE_EVENT, wh)
                time.sleep(0.2)

    def test_failure_logged_to_stderr(self, capsys):
        """Delivery failures are logged to stderr."""
        from urllib.error import URLError

        wh = _wh(events=["*"], max_retries=0)  # no retries
        with patch("urllib.request.urlopen", side_effect=URLError("oops")):
            deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.2)

        captured = capsys.readouterr()
        assert "worca" in captured.err.lower() or "webhook" in captured.err.lower() or "pipeline.run.started" in captured.err

    def test_runs_in_daemon_thread(self):
        """deliver_webhook must use a daemon thread."""
        threads_created = []
        original_thread = threading.Thread

        class TrackingThread(original_thread):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                threads_created.append(self)

        resp = MagicMock()
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        resp.status = 200
        resp.read.return_value = b"{}"

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", return_value=resp):
            with patch("threading.Thread", TrackingThread):
                deliver_webhook(SAMPLE_EVENT, wh)
                time.sleep(0.1)

        assert len(threads_created) >= 1
        assert all(t.daemon for t in threads_created)


# ---------------------------------------------------------------------------
# Rate limiting
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def reset_rate_state():
    """Reset module-level rate limit state between tests."""
    import worca.events.webhook as wh_mod
    wh_mod._rate_state.clear()
    yield
    wh_mod._rate_state.clear()


class TestRateLimit:
    def test_rate_limit_zero_disables_throttling(self):
        """rate_limit_ms=0 means no throttling — all events delivered."""
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"], rate_limit_ms=0)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            for _ in range(3):
                deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.4)

        assert call_count[0] == 3

    def test_rate_limit_throttles_high_frequency_events(self):
        """With rate_limit_ms=200, rapid events of same type are throttled."""
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"], rate_limit_ms=200)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            # Fire 5 events quickly — only 1 should go through immediately
            for _ in range(5):
                deliver_webhook(SAMPLE_EVENT, wh)
            time.sleep(0.1)  # very short wait — window not expired

        # With rate limiting, not all 5 should have fired
        assert call_count[0] <= 2  # at most 1-2 got through

    def test_rate_limit_is_per_event_type(self):
        """Different event types have independent rate limit buckets."""
        call_count = [0]

        def fake_urlopen(req, timeout):
            call_count[0] += 1
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"], rate_limit_ms=500)
        event_a = {**SAMPLE_EVENT, "event_type": "pipeline.run.started"}
        event_b = {**SAMPLE_EVENT, "event_type": "pipeline.stage.completed"}

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook(event_a, wh)
            deliver_webhook(event_b, wh)  # different type, different bucket
            time.sleep(0.2)

        # Both should fire — different event types
        assert call_count[0] == 2


# ---------------------------------------------------------------------------
# deliver_webhook_sync
# ---------------------------------------------------------------------------

class TestDeliverWebhookSync:
    def test_returns_parsed_json_response(self):
        """deliver_webhook_sync returns the parsed JSON body."""
        control_response = {"control": {"action": "approve", "reason": "ok"}}

        resp = MagicMock()
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        resp.status = 200
        resp.read.return_value = json.dumps(control_response).encode()

        wh = _wh(events=["*"], secret="required-secret")
        with patch("urllib.request.urlopen", return_value=resp):
            result = deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert result == control_response

    def test_blocks_until_complete(self):
        """deliver_webhook_sync must block (not return before request completes)."""
        completed = [False]

        def fake_urlopen(req, timeout):
            time.sleep(0.05)
            completed[0] = True
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert completed[0] is True

    def test_returns_none_on_network_error(self):
        """Network failures return None (not raised)."""
        from urllib.error import URLError

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", side_effect=URLError("timeout")), \
             patch("worca.events.webhook.time.sleep"):
            result = deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert result is None

    def test_returns_none_on_non_2xx(self):
        """Non-2xx responses return None."""
        resp = MagicMock()
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        resp.status = 503
        resp.read.return_value = b"Service Unavailable"

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", return_value=resp), \
             patch("worca.events.webhook.time.sleep"):
            result = deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert result is None

    def test_returns_empty_dict_on_non_json_200(self):
        """200 with non-JSON body returns empty dict (treated as continue)."""
        resp = MagicMock()
        resp.__enter__ = lambda s: s
        resp.__exit__ = MagicMock(return_value=False)
        resp.status = 200
        resp.read.return_value = b"OK"

        wh = _wh(events=["*"])
        with patch("urllib.request.urlopen", return_value=resp):
            result = deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert result == {}

    def test_returns_none_if_filtered_out(self):
        """Event filtered out returns None immediately."""
        wh = _wh(events=["pipeline.stage.*"])
        with patch("urllib.request.urlopen") as mock_open:
            result = deliver_webhook_sync(SAMPLE_EVENT, wh)  # run.started, filtered

        mock_open.assert_not_called()
        assert result is None

    def test_sends_hmac_signature(self):
        """deliver_webhook_sync includes HMAC signature when secret configured."""
        received_requests = []

        def fake_urlopen(req, timeout):
            received_requests.append(req)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        secret = "control-secret"
        wh = _wh(events=["*"], secret=secret)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook_sync(SAMPLE_EVENT, wh)

        req = received_requests[0]
        sig = req.get_header("X-worca-signature")
        assert sig is not None
        expected = hmac.new(secret.encode(), req.data, hashlib.sha256).hexdigest()
        assert sig == f"sha256={expected}"

    def test_uses_configured_timeout(self):
        """deliver_webhook_sync passes timeout_ms to urlopen."""
        timeouts_used = []

        def fake_urlopen(req, timeout):
            timeouts_used.append(timeout)
            resp = MagicMock()
            resp.__enter__ = lambda s: s
            resp.__exit__ = MagicMock(return_value=False)
            resp.status = 200
            resp.read.return_value = b"{}"
            return resp

        wh = _wh(events=["*"], timeout_ms=8000)
        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            deliver_webhook_sync(SAMPLE_EVENT, wh)

        assert timeouts_used == [8.0]  # timeout_ms / 1000
