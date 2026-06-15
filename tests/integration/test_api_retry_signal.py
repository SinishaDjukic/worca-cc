"""Integration test: API-throttling/retry signal end-to-end (W-074).

A mock-claude run whose agents print a synthetic "overloaded, retrying" line to
stderr. Asserts the full spine captures it:
  - the per-iteration log persists the stderr line tagged ``err``;
  - status.json token_usage carries ``api_retries >= 1`` and
    ``api_retry_wait_ms >= 0``;
  - a ``pipeline.agent.api_retry`` event lands in events.jsonl.
"""
import pytest

from tests.integration.helpers import read_run_dir

pytestmark = pytest.mark.timeout(120)


def _retry_scenario() -> dict:
    """Every agent succeeds but first prints a 429/529 backoff line to stderr."""
    retry = {
        "action": "succeed",
        "delay_s": 0.05,
        "stderr_lines": ["API Error 529: overloaded, retrying in 4s"],
    }
    return {
        "agents": {
            "tester": {**retry, "structured_output": {"passed": True}},
            "reviewer": {**retry, "structured_output": {"outcome": "approve", "issues": []}},
        },
        "default": retry,
    }


def test_api_retry_signal_captured_end_to_end(pipeline_env):
    result = pipeline_env.run(_retry_scenario(), prompt="retry signal test",
                              timeout=90)
    assert result.returncode == 0, f"pipeline failed: {result.stderr[-500:]}"
    assert result.status["pipeline_status"] == "completed"

    # 1. The stderr line is persisted into a per-iteration log tagged "err".
    run_dir = read_run_dir(pipeline_env.worca_dir)
    logs_dir = run_dir / "logs"
    err_logs = [
        p for p in logs_dir.rglob("iter-*.log")
        if any("\terr\t" in ln for ln in p.read_text(encoding="utf-8").splitlines())
    ]
    assert err_logs, "no iter log carried an \\terr\\t-tagged stderr line"
    sample = err_logs[0].read_text(encoding="utf-8")
    assert "overloaded" in sample

    # 2. status.json token_usage carries api_retries >= 1 and api_retry_wait_ms >= 0.
    retry_iters = []
    for stage in result.status.get("stages", {}).values():
        for it in stage.get("iterations", []):
            tu = it.get("token_usage") or {}
            if tu.get("api_retries", 0) >= 1:
                retry_iters.append((it, tu))
    assert retry_iters, "no iteration token_usage recorded api_retries >= 1"
    it, tu = retry_iters[0]
    assert tu["api_retries"] >= 1
    assert tu["api_retry_wait_ms"] >= 0
    # The HTTP status parsed from "API Error 529: ..." flows through token_usage.
    assert tu["api_error_status"] == 529
    # Surfaced onto the iteration top-level too (the UI view-model reads it there).
    assert it.get("api_retries", 0) >= 1
    assert it.get("api_error_status") == 529

    # 3. A pipeline.agent.api_retry event is emitted.
    retry_events = [
        e for e in result.events
        if e.get("event_type") == "pipeline.agent.api_retry"
    ]
    assert retry_events, "no pipeline.agent.api_retry event in events.jsonl"
    payload = retry_events[0].get("payload", {})
    assert payload.get("attempt", 0) >= 1
    assert "detail" in payload
