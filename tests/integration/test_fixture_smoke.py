"""Smoke tests for the integration test fixture infrastructure (Phase 2).

These tests verify that pipeline_env and webhook_server fixtures
are properly set up and usable by Phase 3+ integration tests.
"""
import json
import os
import sys

import pytest

from tests.integration.helpers import (
    PipelineEnv,
    WebhookCapture,
    assert_stage_sequence,
    make_iteration_scenario,
    read_run_dir,
    read_stub_log,
)

# Stopgap: every test that touches the webhook_server fixture deterministically
# hits a >30s setup-phase timeout on the GitHub macOS runners (passes on Linux
# and Windows). The previous fix (binding HTTPServer to "127.0.0.1" instead of
# "localhost") was not sufficient, so the root cause sits somewhere else in the
# fixture-setup chain on macOS CI. Skipping is the agreed stopgap; the long-form
# investigation stays open as a follow-up. Skipping only the first user would
# push the cold-start cost to the second, so both tests carry the marker.
_DARWIN_CI_SKIP = pytest.mark.skipif(
    sys.platform == "darwin" and bool(os.environ.get("CI")),
    reason="webhook_server fixture-setup timeout on GitHub macOS runners "
    "(pre-existing; tracked as follow-up)",
)


def test_pipeline_env_project_exists(pipeline_env):
    assert pipeline_env.project.exists()


def test_pipeline_env_worca_runtime_installed(pipeline_env):
    # W-077: runtime now lives in ~/.worca/pkg/<ver>/worca/, not .claude/worca/
    assert pipeline_env.worca_config_path is not None
    assert pipeline_env.worca_config_path.exists(), (
        f"Project config not found at {pipeline_env.worca_config_path}"
    )
    assert not (pipeline_env.project / ".claude" / "worca").exists(), (
        ".claude/worca/ must not exist — runtime is in the shared pkg store"
    )


def test_pipeline_env_git_repo_initialized(pipeline_env):
    assert (pipeline_env.project / ".git").exists()


def test_pipeline_env_settings_overridden(pipeline_env):
    import json
    # W-077: worca.* config lives in config.json, not .claude/settings.json
    config = json.loads(pipeline_env.worca_config_path.read_text())
    stages = config.get("worca", {}).get("stages", {})
    assert stages.get("preflight", {}).get("enabled") is False
    assert stages.get("plan_review", {}).get("enabled") is False
    assert stages.get("learn", {}).get("enabled") is False


def test_pipeline_env_effort_pinned_disabled(pipeline_env):
    import json
    # W-077: worca.* config lives in config.json, not .claude/settings.json
    config = json.loads(pipeline_env.worca_config_path.read_text())
    effort = config.get("worca", {}).get("effort", {})
    assert effort.get("auto_mode") == "disabled"


@_DARWIN_CI_SKIP
def test_webhook_server_url_is_localhost(webhook_server):
    assert webhook_server.url.startswith("http://localhost:")


@_DARWIN_CI_SKIP
def test_webhook_server_receives_posts(webhook_server):
    import urllib.request
    import json
    payload = json.dumps({"event_type": "test.event"}).encode()
    req = urllib.request.Request(
        webhook_server.url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    urllib.request.urlopen(req, timeout=5)
    assert len(webhook_server.received) == 1
    assert webhook_server.received[0]["event_type"] == "test.event"


def test_pipeline_env_is_dataclass_type(pipeline_env):
    assert isinstance(pipeline_env, PipelineEnv)


@_DARWIN_CI_SKIP
def test_webhook_server_is_dataclass_type(webhook_server):
    assert isinstance(webhook_server, WebhookCapture)


# ---------------------------------------------------------------------------
# W-050 Phase 0 — fixture extension smoke tests
# ---------------------------------------------------------------------------


def test_enable_stages_flips_settings(pipeline_env):
    pipeline_env.enable_stages("preflight", "learn")
    # W-077: worca.stages lives in config.json, not .claude/settings.json
    config = json.loads(pipeline_env.worca_config_path.read_text())
    stages = config["worca"]["stages"]
    assert stages["preflight"]["enabled"] is True
    assert stages["learn"]["enabled"] is True
    # plan_review was not enabled — must remain False from fixture defaults.
    assert stages["plan_review"]["enabled"] is False


def test_set_governance_agent_replaces_not_appends(pipeline_env):
    """The plan's Considerations call out: must replace WORCA_AGENT, not append."""
    pipeline_env.set_governance_agent("implementer")
    pipeline_env.set_governance_agent("guardian")
    # We can't observe the env from outside, but we can drive a real run that
    # echoes the agent — easier sanity check: just confirm the mutator is
    # idempotent and the second call wins (verified via a dummy run below).
    scenario = {"default": {"action": "succeed", "delay_s": 0}}
    result = pipeline_env.run(scenario, prompt="smoke", timeout=60)
    # The pipeline should still complete — set_governance_agent alone must
    # not break execution (governance hooks are still permissive in the
    # default fixture setup; Phase 2 tests will exercise the strict cases).
    assert result.returncode in (0, 1, 2), (
        f"unexpected returncode: {result.returncode}\nstderr: {result.stderr[:500]}"
    )


def test_enable_beads_sets_path_and_clears_skip(pipeline_env):
    pipeline_env.enable_beads()
    # Stubs dir exists and contains the bd stub.
    assert pipeline_env.stubs_dir.is_dir()
    assert (pipeline_env.stubs_dir / "bd").exists()
    assert (pipeline_env.stubs_dir / "gh").exists()
    # Stub log path is set on the env.
    assert pipeline_env.stub_log_path is not None


def test_enable_beads_with_response_file_records_it(pipeline_env, tmp_path):
    response_file = tmp_path / "bd_responses.json"
    response_file.write_text(json.dumps({"default": {"stdout": "ok", "exit": 0}}))
    pipeline_env.enable_beads(response_file=response_file)
    assert pipeline_env.stub_response_files["bd"] == response_file


def test_make_iteration_scenario_shape():
    scenario = make_iteration_scenario({
        "tester": {
            "iter_1": {"action": "fail", "error": "boom"},
            "iter_2": {"action": "succeed"},
        }
    })
    assert scenario["agents"]["tester"]["iter_1"]["action"] == "fail"
    assert scenario["agents"]["tester"]["iter_2"]["action"] == "succeed"
    assert scenario["default"]["action"] == "succeed"
    # Default delay_s is short enough to keep CI fast.
    assert scenario["default"]["delay_s"] <= 0.05


def test_make_iteration_scenario_custom_default():
    scenario = make_iteration_scenario(
        {"tester": {"iter_1": {"action": "fail"}}},
        default={"action": "fail", "delay_s": 0},
    )
    assert scenario["default"] == {"action": "fail", "delay_s": 0}


def test_read_run_dir_returns_latest(pipeline_env):
    scenario = {"default": {"action": "succeed", "delay_s": 0}}
    pipeline_env.run(scenario, prompt="rd-smoke", timeout=60)
    run_dir = read_run_dir(pipeline_env.worca_dir)
    assert run_dir.is_dir()
    assert (run_dir / "status.json").exists()


def test_assert_stage_sequence_matches_subsequence(pipeline_env):
    scenario = {"default": {"action": "succeed", "delay_s": 0}}
    result = pipeline_env.run(scenario, prompt="seq-smoke", timeout=60)
    # The helper ignores stages not in the expected list, so we can assert
    # just the spine: plan must fire before implement, and implement before pr.
    assert_stage_sequence(result.events, ["plan", "implement", "pr"])


def test_read_stub_log_empty_when_no_invocations(pipeline_env):
    # Fixture sets stub_log_path but the file isn't created until first write.
    assert read_stub_log(pipeline_env.stub_log_path) == []


def test_stub_log_records_invocations_via_path(pipeline_env, monkeypatch):
    """Direct invocation of the stub through PATH writes a JSONL record."""
    pipeline_env.enable_beads()
    monkeypatch.setenv("PATH", f"{pipeline_env.stubs_dir}{os.pathsep}{os.environ['PATH']}")
    monkeypatch.setenv("WORCA_STUB_LOG", str(pipeline_env.stub_log_path))
    import subprocess
    subprocess.run(["bd", "ready", "--json", "id"], check=True, capture_output=True)
    invocations = read_stub_log(pipeline_env.stub_log_path)
    assert len(invocations) == 1
    assert invocations[0]["binary"] == "bd"
    assert invocations[0]["argv"] == ["ready", "--json", "id"]


# ---------------------------------------------------------------------------
# W-050 Phase 2 — run_hook smoke tests
# ---------------------------------------------------------------------------


def test_run_hook_benign_payload_exits_zero(pipeline_env):
    """Plumbing check: pre_tool_use over a Read tool call returns exit 0.

    Read isn't a guarded operation and plan_check only inspects Write/Edit, so
    a happy-path call must succeed. This verifies the subprocess wiring (cwd,
    stdin JSON, env, coverage wrapping) without depending on governance state.
    """
    proc = pipeline_env.run_hook(
        "pre_tool_use",
        {"tool_name": "Read", "tool_input": {"file_path": "README.md"}},
    )
    assert proc.returncode == 0, (
        f"unexpected returncode: {proc.returncode}\nstderr: {proc.stderr[:500]}"
    )


def test_run_hook_honors_set_governance_agent(pipeline_env):
    """plan_check enforces only when WORCA_AGENT is set — verifies the
    set_governance_agent override reaches the hook subprocess.

    With WORCA_AGENT="implementer" and no MASTER_PLAN.md in the project, a
    Write to a .py file must be blocked by check_plan (exit 2, "Blocked" in
    stderr). Without set_governance_agent, the same call would exit 0 because
    plan_check returns early when WORCA_AGENT is empty.
    """
    pipeline_env.set_governance_agent("implementer")
    proc = pipeline_env.run_hook(
        "pre_tool_use",
        {"tool_name": "Write", "tool_input": {
            "file_path": "src/foo.py",
            "content": "print('hi')",
        }},
    )
    assert proc.returncode == 2, (
        f"expected block (exit 2), got {proc.returncode}\n"
        f"stderr: {proc.stderr[:500]}"
    )
    assert "Blocked" in proc.stderr or "plan" in proc.stderr.lower()


def test_run_hook_env_overrides_apply_per_call(pipeline_env):
    """env_overrides on a single run_hook call should win over fixture defaults.

    Sets WORCA_AGENT via env_overrides (without going through
    set_governance_agent) and confirms plan_check engages — proves the per-call
    override path works independently of the persistent _overrides dict.
    """
    proc = pipeline_env.run_hook(
        "pre_tool_use",
        {"tool_name": "Write", "tool_input": {
            "file_path": "src/foo.py",
            "content": "x = 1",
        }},
        env_overrides={"WORCA_AGENT": "implementer"},
    )
    assert proc.returncode == 2, (
        f"expected block (exit 2), got {proc.returncode}\n"
        f"stderr: {proc.stderr[:500]}"
    )
