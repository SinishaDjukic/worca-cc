"""
T18: Tests for webhook configuration validation in EventContext.__post_init__.

TDD: These tests are written BEFORE implementation and should fail until
emitter.py is updated with validation logic.

Covers:
- URL must start with https:// or http://localhost
- timeout_ms must be in range 1000-30000 (if present)
- max_retries must be in range 0-10 (if present)
- events patterns must match [a-zA-Z0-9.*] (if present)
- Control webhooks require non-empty secret
- Invalid configs log warnings to stderr
- Separation of ctx._webhooks (observer) and ctx._control_webhooks (control)
"""

import json
import sys


sys.path.insert(0, ".claude")

from worca.events.emitter import EventContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ctx(tmp_path, webhooks=None, settings_webhooks=None):
    """Build an EventContext with webhook config from settings file."""
    events_file = tmp_path / "events.jsonl"
    if settings_webhooks is not None:
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps({"worca": {"webhooks": settings_webhooks}}))
        settings_path = str(settings_file)
    else:
        settings_path = ""

    if webhooks is not None:
        return EventContext(
            run_id="20260320-075700",
            branch="test",
            work_request={"title": "Test"},
            events_path=str(events_file),
            settings_path=settings_path,
            enabled=True,
            _webhooks=webhooks,
        )
    else:
        return EventContext(
            run_id="20260320-075700",
            branch="test",
            work_request={"title": "Test"},
            events_path=str(events_file),
            settings_path=settings_path,
            enabled=True,
        )


def _valid_observer(url="https://example.com/hook"):
    """A valid observer webhook config."""
    return {"url": url, "enabled": True, "control": False}


def _valid_control(url="https://example.com/ctrl", secret="s3cr3t"):
    """A valid control webhook config."""
    return {"url": url, "enabled": True, "control": True, "secret": secret}


# ---------------------------------------------------------------------------
# Separation: _webhooks (observer) vs _control_webhooks
# ---------------------------------------------------------------------------


class TestWebhookSeparation:
    def test_control_webhooks_attr_exists(self, tmp_path):
        """EventContext must have a _control_webhooks attribute after init."""
        ctx = _make_ctx(tmp_path)
        assert hasattr(ctx, "_control_webhooks")

    def test_observer_webhook_goes_to_webhooks_list(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._webhooks) == 1
        assert ctx._webhooks[0]["url"] == "https://example.com/hook"

    def test_observer_webhook_not_in_control_list(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._control_webhooks) == 0

    def test_control_webhook_goes_to_control_list(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_control()])
        assert len(ctx._control_webhooks) == 1
        assert ctx._control_webhooks[0]["url"] == "https://example.com/ctrl"

    def test_control_webhook_not_in_observer_list(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_control()])
        assert len(ctx._webhooks) == 0

    def test_mixed_webhooks_separated_correctly(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[
            _valid_observer("https://obs.example.com/hook"),
            _valid_control("https://ctrl.example.com/hook"),
        ])
        assert len(ctx._webhooks) == 1
        assert len(ctx._control_webhooks) == 1
        assert ctx._webhooks[0]["url"] == "https://obs.example.com/hook"
        assert ctx._control_webhooks[0]["url"] == "https://ctrl.example.com/hook"

    def test_empty_webhooks_gives_empty_lists(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[])
        assert ctx._webhooks == []
        assert ctx._control_webhooks == []

    def test_no_webhooks_gives_empty_lists(self, tmp_path):
        ctx = _make_ctx(tmp_path)
        assert ctx._webhooks == []
        assert ctx._control_webhooks == []

    def test_settings_webhooks_separated(self, tmp_path):
        """Webhooks loaded from settings are also separated."""
        ctx = _make_ctx(tmp_path, settings_webhooks=[
            _valid_observer("https://obs.example.com/hook"),
            _valid_control("https://ctrl.example.com/hook"),
        ])
        assert len(ctx._webhooks) == 1
        assert len(ctx._control_webhooks) == 1


# ---------------------------------------------------------------------------
# URL validation
# ---------------------------------------------------------------------------


class TestUrlValidation:
    def test_https_url_accepted(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer("https://example.com/hook")])
        assert len(ctx._webhooks) == 1

    def test_http_localhost_url_accepted(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer("http://localhost:9000/hook")])
        assert len(ctx._webhooks) == 1

    def test_http_localhost_no_port_accepted(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer("http://localhost/hook")])
        assert len(ctx._webhooks) == 1

    def test_plain_http_url_rejected(self, tmp_path):
        """http:// URLs (non-localhost) must be rejected."""
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer("http://example.com/hook")])
        assert len(ctx._webhooks) == 0

    def test_ftp_url_rejected(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer("ftp://example.com/hook")])
        assert len(ctx._webhooks) == 0

    def test_empty_url_rejected(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[{"url": "", "enabled": True}])
        assert len(ctx._webhooks) == 0

    def test_missing_url_rejected(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[{"enabled": True}])
        assert len(ctx._webhooks) == 0

    def test_warning_logged_for_invalid_url(self, tmp_path, capsys):
        _make_ctx(tmp_path, webhooks=[_valid_observer("http://example.com/hook")])
        captured = capsys.readouterr()
        assert "http://example.com/hook" in captured.err or "invalid" in captured.err.lower() or "warning" in captured.err.lower()

    def test_invalid_url_does_not_stop_other_webhooks(self, tmp_path):
        """Invalid webhooks are skipped; valid ones are still processed."""
        ctx = _make_ctx(tmp_path, webhooks=[
            _valid_observer("http://bad.example.com/hook"),   # invalid
            _valid_observer("https://good.example.com/hook"), # valid
        ])
        assert len(ctx._webhooks) == 1
        assert ctx._webhooks[0]["url"] == "https://good.example.com/hook"


# ---------------------------------------------------------------------------
# timeout_ms validation
# ---------------------------------------------------------------------------


class TestTimeoutMsValidation:
    def test_timeout_ms_in_range_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["timeout_ms"] = 5000
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_timeout_ms_at_lower_bound_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["timeout_ms"] = 1000
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_timeout_ms_at_upper_bound_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["timeout_ms"] = 30000
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_timeout_ms_below_range_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["timeout_ms"] = 500
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_timeout_ms_above_range_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["timeout_ms"] = 60000
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_timeout_ms_absent_accepted(self, tmp_path):
        """timeout_ms is optional; absent is valid."""
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._webhooks) == 1

    def test_timeout_ms_warning_on_rejection(self, tmp_path, capsys):
        wh = _valid_observer()
        wh["timeout_ms"] = 500
        _make_ctx(tmp_path, webhooks=[wh])
        captured = capsys.readouterr()
        assert captured.err.strip() != ""


# ---------------------------------------------------------------------------
# max_retries validation
# ---------------------------------------------------------------------------


class TestMaxRetriesValidation:
    def test_max_retries_zero_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["max_retries"] = 0
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_max_retries_ten_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["max_retries"] = 10
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_max_retries_negative_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["max_retries"] = -1
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_max_retries_above_limit_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["max_retries"] = 11
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_max_retries_absent_accepted(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._webhooks) == 1


# ---------------------------------------------------------------------------
# events patterns validation
# ---------------------------------------------------------------------------


class TestEventsPatternsValidation:
    def test_valid_dotstar_pattern_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["pipeline.*"]
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_exact_event_pattern_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["pipeline.run.started"]
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_wildcard_only_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["*"]
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_multiple_valid_patterns_accepted(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["pipeline.*", "control.*"]
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1

    def test_pattern_with_space_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["pipeline run"]  # space is invalid
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_pattern_with_special_char_rejected(self, tmp_path):
        wh = _valid_observer()
        wh["events"] = ["pipeline@stage"]  # @ is invalid
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 0

    def test_events_absent_accepted(self, tmp_path):
        """events filter is optional; absent means receive all."""
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._webhooks) == 1

    def test_empty_events_list_accepted(self, tmp_path):
        """Empty events list is valid (no filter)."""
        wh = _valid_observer()
        wh["events"] = []
        ctx = _make_ctx(tmp_path, webhooks=[wh])
        assert len(ctx._webhooks) == 1


# ---------------------------------------------------------------------------
# Control webhook secret validation
# ---------------------------------------------------------------------------


class TestControlWebhookSecretValidation:
    def test_control_with_secret_accepted(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_control(secret="s3cr3t")])
        assert len(ctx._control_webhooks) == 1

    def test_control_without_secret_rejected(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[
            {"url": "https://ctrl.example.com", "enabled": True, "control": True}
        ])
        assert len(ctx._control_webhooks) == 0

    def test_control_with_empty_secret_rejected(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[
            {"url": "https://ctrl.example.com", "enabled": True, "control": True, "secret": ""}
        ])
        assert len(ctx._control_webhooks) == 0

    def test_control_without_secret_logs_warning(self, tmp_path, capsys):
        _make_ctx(tmp_path, webhooks=[
            {"url": "https://ctrl.example.com", "enabled": True, "control": True}
        ])
        captured = capsys.readouterr()
        assert captured.err.strip() != ""

    def test_control_without_secret_not_in_observer_list(self, tmp_path):
        """A rejected control webhook must not appear in _webhooks either."""
        ctx = _make_ctx(tmp_path, webhooks=[
            {"url": "https://ctrl.example.com", "enabled": True, "control": True}
        ])
        assert len(ctx._webhooks) == 0
        assert len(ctx._control_webhooks) == 0

    def test_observer_does_not_need_secret(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert len(ctx._webhooks) == 1


# ---------------------------------------------------------------------------
# control_webhooks property backward compat
# ---------------------------------------------------------------------------


class TestControlWebhooksProperty:
    def test_control_webhooks_property_returns_control_list(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[
            _valid_observer("https://obs.example.com/hook"),
            _valid_control("https://ctrl.example.com/hook"),
        ])
        assert ctx.control_webhooks == ctx._control_webhooks

    def test_control_webhooks_property_empty_when_no_control(self, tmp_path):
        ctx = _make_ctx(tmp_path, webhooks=[_valid_observer()])
        assert ctx.control_webhooks == []
