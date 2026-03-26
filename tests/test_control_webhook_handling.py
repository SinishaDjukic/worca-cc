"""
Tests for T14: control webhook response handling.

TDD: these tests are written first and should FAIL until implementation is complete.

Covers:
- EventContext.control_webhooks property
- _check_control_response() in emitter.py
- _handle_pause() in runner.py
- Startup validation (control webhooks require secret)
"""

import json
import sys
from unittest.mock import patch

import pytest

sys.path.insert(0, ".claude")

from worca.events.emitter import EventContext, _check_control_response
from worca.orchestrator.runner import PipelineInterrupted, _handle_pause


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_MILESTONE_EVENT = {
    "schema_version": "1",
    "event_id": "test-uuid-001",
    "event_type": "pipeline.milestone.set",
    "timestamp": "2026-03-20T07:57:00Z",
    "run_id": "20260320-075700",
    "pipeline": {"branch": "test", "work_request": {"title": "Test"}},
    "payload": {"milestone": "plan_approved", "value": True, "stage": "plan"},
}

SAMPLE_STAGE_COMPLETED_EVENT = {
    "schema_version": "1",
    "event_id": "test-uuid-002",
    "event_type": "pipeline.stage.completed",
    "timestamp": "2026-03-20T07:58:00Z",
    "run_id": "20260320-075700",
    "pipeline": {"branch": "test", "work_request": {"title": "Test"}},
    "payload": {"stage": "plan", "iteration": 1, "duration_ms": 1000, "cost_usd": 0.0,
                "turns": 5, "outcome": "success"},
}


def _make_ctx(tmp_path, webhooks=None):
    """Build an EventContext with given webhooks list."""
    events_file = tmp_path / "events.jsonl"
    return EventContext(
        run_id="20260320-075700",
        branch="test",
        work_request={"title": "Test"},
        events_path=str(events_file),
        settings_path="",
        enabled=True,
        _webhooks=webhooks or [],
    )


@pytest.fixture
def ctx_no_webhooks(tmp_path):
    return _make_ctx(tmp_path)


@pytest.fixture
def ctx_with_control(tmp_path):
    return _make_ctx(tmp_path, [
        {"url": "https://ctrl.example.com", "enabled": True, "secret": "s3cr3t", "control": True},
        {"url": "https://obs.example.com", "enabled": True, "secret": "obs-s", "control": False},
    ])


@pytest.fixture
def ctx_control_no_secret(tmp_path):
    return _make_ctx(tmp_path, [
        {"url": "https://ctrl.example.com", "enabled": True, "control": True},  # no secret
    ])


@pytest.fixture
def ctx_mixed_control(tmp_path):
    """Two control webhooks: one with secret, one without."""
    return _make_ctx(tmp_path, [
        {"url": "https://ctrl1.example.com", "enabled": True, "secret": "s1", "control": True},
        {"url": "https://ctrl2.example.com", "enabled": True, "control": True},  # no secret
    ])


# ---------------------------------------------------------------------------
# EventContext.control_webhooks property
# ---------------------------------------------------------------------------


class TestEventContextControlWebhooks:
    def test_no_webhooks_returns_empty(self, ctx_no_webhooks):
        assert ctx_no_webhooks.control_webhooks == []

    def test_filters_to_control_true_with_secret(self, ctx_with_control):
        ctrl = ctx_with_control.control_webhooks
        assert len(ctrl) == 1
        assert ctrl[0]["url"] == "https://ctrl.example.com"

    def test_observer_webhooks_excluded(self, ctx_with_control):
        """Observer webhooks (control=False) must not appear in control_webhooks."""
        urls = [wh["url"] for wh in ctx_with_control.control_webhooks]
        assert "https://obs.example.com" not in urls

    def test_control_without_secret_excluded(self, ctx_control_no_secret):
        """Control webhooks without a secret must be excluded for security."""
        assert ctx_control_no_secret.control_webhooks == []

    def test_mixed_control_returns_only_with_secret(self, ctx_mixed_control):
        ctrl = ctx_mixed_control.control_webhooks
        assert len(ctrl) == 1
        assert ctrl[0]["url"] == "https://ctrl1.example.com"

    def test_empty_secret_string_excluded(self, tmp_path):
        ctx = _make_ctx(tmp_path, [
            {"url": "https://ctrl.example.com", "enabled": True, "secret": "", "control": True},
        ])
        assert ctx.control_webhooks == []


# ---------------------------------------------------------------------------
# _check_control_response()
# ---------------------------------------------------------------------------


class TestCheckControlResponse:
    def test_no_control_webhooks_returns_none(self, ctx_no_webhooks):
        result = _check_control_response(ctx_no_webhooks, SAMPLE_MILESTONE_EVENT)
        assert result is None

    def test_calls_deliver_webhook_sync_for_control_webhook(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync", return_value=None) as mock:
            _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        mock.assert_called_once_with(
            SAMPLE_MILESTONE_EVENT, ctx_with_control.control_webhooks[0]
        )

    def test_returns_approve_action(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"control": {"action": "approve"}}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result == "approve"

    def test_returns_pause_action(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"control": {"action": "pause"}}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result == "pause"

    def test_returns_abort_action(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"control": {"action": "abort"}}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result == "abort"

    def test_ignores_continue_action_returns_none(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"control": {"action": "continue"}}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result is None

    def test_returns_none_when_response_is_none(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync", return_value=None):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result is None

    def test_returns_none_when_no_control_key_in_response(self, ctx_with_control):
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"status": "ok"}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result is None

    def test_returns_none_on_exception(self, ctx_with_control):
        """_check_control_response must never raise."""
        with patch("worca.events.webhook.deliver_webhook_sync",
                   side_effect=RuntimeError("connection failed")):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result is None

    def test_first_non_continue_action_wins(self, tmp_path):
        """When multiple control webhooks, first non-continue action is returned."""
        ctx = _make_ctx(tmp_path, [
            {"url": "https://ctrl1.example.com", "enabled": True, "secret": "s1", "control": True},
            {"url": "https://ctrl2.example.com", "enabled": True, "secret": "s2", "control": True},
        ])
        responses = [
            {"control": {"action": "approve"}},   # first webhook
            {"control": {"action": "reject"}},    # second webhook (should not be reached)
        ]
        with patch("worca.events.webhook.deliver_webhook_sync", side_effect=responses):
            result = _check_control_response(ctx, SAMPLE_MILESTONE_EVENT)
        assert result == "approve"

    def test_skips_to_next_webhook_on_continue(self, tmp_path):
        """If first webhook returns continue, check subsequent webhooks."""
        ctx = _make_ctx(tmp_path, [
            {"url": "https://ctrl1.example.com", "enabled": True, "secret": "s1", "control": True},
            {"url": "https://ctrl2.example.com", "enabled": True, "secret": "s2", "control": True},
        ])
        responses = [
            {"control": {"action": "continue"}},   # first webhook: continue
            {"control": {"action": "pause"}},       # second webhook: pause
        ]
        with patch("worca.events.webhook.deliver_webhook_sync", side_effect=responses):
            result = _check_control_response(ctx, SAMPLE_MILESTONE_EVENT)
        assert result == "pause"

    def test_default_action_when_action_missing(self, ctx_with_control):
        """Missing 'action' in control dict defaults to continue (returns None)."""
        with patch("worca.events.webhook.deliver_webhook_sync",
                   return_value={"control": {}}):
            result = _check_control_response(ctx_with_control, SAMPLE_MILESTONE_EVENT)
        assert result is None


# ---------------------------------------------------------------------------
# _handle_pause()
# ---------------------------------------------------------------------------


class TestHandlePause:
    def test_raises_pipeline_interrupted_on_abort(self, ctx_no_webhooks):
        """abort action from control webhook raises PipelineInterrupted."""
        with patch("worca.orchestrator.runner._check_control_response",
                   return_value="abort"):
            with patch("time.sleep"):
                with pytest.raises(PipelineInterrupted, match="Aborted"):
                    _handle_pause(ctx_no_webhooks, "test gate")

    def test_returns_normally_on_resume(self, ctx_no_webhooks):
        """resume action ends the pause loop normally."""
        with patch("worca.orchestrator.runner._check_control_response",
                   return_value="resume"):
            with patch("time.sleep"):
                _handle_pause(ctx_no_webhooks, "test gate")  # must return, not loop forever

    def test_emits_paused_event(self, tmp_path):
        """_handle_pause emits pipeline.run.paused event."""
        ctx = _make_ctx(tmp_path)
        events_file = tmp_path / "events.jsonl"

        with patch("worca.orchestrator.runner._check_control_response",
                   return_value="resume"):
            with patch("time.sleep"):
                _handle_pause(ctx, "test gate")

        ctx.close()
        lines = events_file.read_text().strip().split("\n")
        types = [json.loads(line)["event_type"] for line in lines if line]
        assert "pipeline.run.paused" in types

    def test_sleeps_between_polls(self, ctx_no_webhooks):
        """_handle_pause sleeps before polling the control webhooks."""
        sleep_calls = []

        def track_sleep(duration):
            sleep_calls.append(duration)

        with patch("worca.orchestrator.runner._check_control_response",
                   return_value="resume"):
            with patch("time.sleep", side_effect=track_sleep):
                _handle_pause(ctx_no_webhooks, "test gate")

        assert len(sleep_calls) >= 1

    def test_continues_polling_until_decision(self, ctx_no_webhooks):
        """_handle_pause keeps polling until resume/abort."""
        call_count = [0]

        def slow_control_response(ctx, event):
            call_count[0] += 1
            if call_count[0] < 3:
                return None  # no action yet
            return "resume"

        with patch("worca.orchestrator.runner._check_control_response",
                   side_effect=slow_control_response):
            with patch("time.sleep"):
                _handle_pause(ctx_no_webhooks, "test gate")

        assert call_count[0] == 3

    def test_emits_resumed_from_pause_event(self, tmp_path):
        """After resume, emits pipeline.run.resumed_from_pause event."""
        ctx = _make_ctx(tmp_path)
        events_file = tmp_path / "events.jsonl"

        with patch("worca.orchestrator.runner._check_control_response",
                   return_value="resume"):
            with patch("time.sleep"):
                _handle_pause(ctx, "test gate")

        ctx.close()
        lines = events_file.read_text().strip().split("\n")
        types = [json.loads(line)["event_type"] for line in lines if line]
        assert "pipeline.run.resumed_from_pause" in types


# ---------------------------------------------------------------------------
# Control webhook validation at startup (security: secret required)
# ---------------------------------------------------------------------------


class TestControlWebhookValidation:
    def test_control_webhook_without_secret_is_excluded(self, ctx_control_no_secret):
        """control_webhooks property excludes webhooks without secret."""
        assert len(ctx_control_no_secret.control_webhooks) == 0

    def test_control_webhook_with_secret_included(self, ctx_with_control):
        """control_webhooks property includes webhooks with secret."""
        assert len(ctx_with_control.control_webhooks) == 1


# ---------------------------------------------------------------------------
# RUN_PAUSED and RUN_RESUMED_FROM_PAUSE in types.py
# ---------------------------------------------------------------------------


class TestRunPausedEventType:
    def test_run_paused_constant_exists(self):
        from worca.events.types import RUN_PAUSED
        assert RUN_PAUSED == "pipeline.run.paused"

    def test_run_resumed_from_pause_constant_exists(self):
        from worca.events.types import RUN_RESUMED_FROM_PAUSE
        assert RUN_RESUMED_FROM_PAUSE == "pipeline.run.resumed_from_pause"

    def test_run_paused_payload_builder_exists(self):
        from worca.events.types import run_paused_payload
        p = run_paused_payload(reason="manual review")
        assert p["reason"] == "manual review"

    def test_run_resumed_from_pause_payload_builder_exists(self):
        from worca.events.types import run_resumed_from_pause_payload
        p = run_resumed_from_pause_payload(reason="control webhook")
        assert p["reason"] == "control webhook"
