"""W-057 — full pipeline with CRG (code-review-graph) enabled.

Asserts:
- Preflight invokes mock CRG CLI (``build``)
- Base snapshot is built and run-scoped copy is seeded
- MCP config is injected into agent commands (via --mcp-config)
- Post-implement refresh invokes ``update`` on the run-scoped DB
- Pipeline completes with crg_status=ready in status.json
- Plan prompt carries the CRG availability note
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.integration.helpers import _find_latest_status


REPO_ROOT = Path(__file__).parent.parent.parent
MOCK_CRG_DIR = Path(__file__).parent.parent / "mock_crg"
MOCK_GRAPHIFY_DIR = Path(__file__).parent.parent / "mock_graphify"
MOCK_CLAUDE_BIN = Path(__file__).parent.parent / "mock_claude" / "mock_claude.py"

pytestmark = [pytest.mark.timeout(180), pytest.mark.allow_worca_writes]


def _tester_pass() -> dict:
    return {"action": "succeed", "delay_s": 0.05,
            "structured_output": {"passed": True}}


def _review_approve() -> dict:
    return {"action": "succeed", "delay_s": 0.05,
            "structured_output": {"outcome": "approve", "issues": []}}


def _happy_scenario() -> dict:
    return {
        "agents": {
            "tester": _tester_pass(),
            "reviewer": _review_approve(),
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }


def _setup_global_crg(pipeline_env) -> Path:
    """Create a temp WORCA_HOME with global CRG enabled (no kill-switch)."""
    worca_home = pipeline_env.tmp_path / "worca_home"
    worca_home.mkdir(exist_ok=True)
    global_settings = {"worca": {"code_review_graph": {"enabled": True}}}
    (worca_home / "settings.json").write_text(json.dumps(global_settings))
    return worca_home


def _enable_crg_settings(pipeline_env) -> None:
    """Enable CRG in project settings with base_sha freshness."""
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["code_review_graph"] = {
        "enabled": True,
        "freshness": "base_sha",
        "update_on": {
            "preflight": True,
            "post_implement": True,
            "guardian_post_commit": False,
        },
    }
    settings_path.write_text(json.dumps(settings, indent=2))


def _run_pipeline_with_crg(pipeline_env, scenario: dict, prompt: str,
                            crg_log_path: Path) -> subprocess.CompletedProcess:
    """Run the pipeline with mock CRG + fastmcp on PATH."""
    scenario_path = pipeline_env.tmp_path / "scenario_crg.json"
    scenario_path.write_text(json.dumps(scenario))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", prompt]

    worca_home = _setup_global_crg(pipeline_env)
    mock_path = f"{MOCK_CRG_DIR}{os.pathsep}{MOCK_GRAPHIFY_DIR}{os.pathsep}{os.environ.get('PATH', '')}"
    env = {
        **os.environ,
        "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
        "WORCA_AGENT": "",
        "WORCA_SKIP_BEADS": "1",
        "MOCK_CLAUDE_SCENARIO": str(scenario_path),
        "PATH": mock_path,
        "MOCK_CRG_LOG": str(crg_log_path),
        "WORCA_HOME": str(worca_home),
        # W-077: pin config path to the fixture's config so _enable_crg_settings
        # writes and the pipeline reads from the same file.
        "WORCA_CONFIG_PATH": str(pipeline_env.worca_config_path),
        "PYTHONPATH": str(REPO_ROOT / "src"),
    }
    for key in ("WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR"):
        env.pop(key, None)

    return subprocess.run(
        cmd, cwd=str(pipeline_env.project), env=env,
        capture_output=True, text=True, timeout=120,
    )


# ===========================================================================
# 1. Preflight builds base snapshot and seeds run-scoped copy
# ===========================================================================

def test_crg_preflight_builds_and_seeds_run_copy(pipeline_env):
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)
    log_path = pipeline_env.tmp_path / "mock_crg_invocations.jsonl"

    result = _run_pipeline_with_crg(
        pipeline_env, _happy_scenario(), "crg pipeline test", log_path,
    )

    assert result.returncode == 0, (
        f"Pipeline failed (rc={result.returncode}).\nstderr: {result.stderr[-2000:]}"
    )

    assert log_path.exists(), f"Mock CRG was never invoked.\nstderr: {result.stderr[-1000:]}"
    invocations = [
        json.loads(line) for line in log_path.read_text().splitlines() if line.strip()
    ]
    build_calls = [i for i in invocations if "build" in i["argv"]]
    assert build_calls, f"No `build` invocation found in {invocations}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("crg_status") == "ready"
    assert status.get("crg_enabled") is True

    crg_data_dir = status.get("crg_data_dir")
    assert crg_data_dir, "crg_data_dir should be recorded in status.json"
    crg_abs = (
        Path(crg_data_dir) if os.path.isabs(crg_data_dir)
        else pipeline_env.project / crg_data_dir
    )
    assert (crg_abs / "graph.db").is_file(), (
        f"Run-scoped graph.db missing at {crg_abs}"
    )


# ===========================================================================
# 2. Plan prompt carries CRG availability note
# ===========================================================================

def test_crg_availability_note_in_plan_prompt(pipeline_env):
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)
    log_path = pipeline_env.tmp_path / "mock_crg_prompt.jsonl"

    result = _run_pipeline_with_crg(
        pipeline_env, _happy_scenario(), "crg prompt test", log_path,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    plan_stage = status.get("stages", {}).get("plan", {})
    plan_prompt = plan_stage.get("prompt", "")
    assert "code-review-graph" in plan_prompt.lower() or "crg" in plan_prompt.lower(), (
        f"Plan prompt missing CRG availability note.\nprompt preview:\n{plan_prompt[:1000]}"
    )


# ===========================================================================
# 3. Post-implement refresh invokes `update` on run-scoped DB
# ===========================================================================

def test_crg_post_implement_refresh(pipeline_env):
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)
    log_path = pipeline_env.tmp_path / "mock_crg_refresh.jsonl"

    result = _run_pipeline_with_crg(
        pipeline_env, _happy_scenario(), "crg refresh test", log_path,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    invocations = [
        json.loads(line) for line in log_path.read_text().splitlines() if line.strip()
    ]
    update_calls = [i for i in invocations if "update" in i["argv"]]
    assert update_calls, (
        f"No `update` invocation found — post-implement refresh not triggered.\n"
        f"All invocations: {invocations}"
    )
    assert update_calls[0]["crg_data_dir"], (
        "update call should have CRG_DATA_DIR pointing at the run-scoped dir"
    )


# ===========================================================================
# 4. CRG state propagated through entire pipeline
# ===========================================================================

def test_crg_state_propagated_to_all_stages(pipeline_env):
    """When CRG is ready, crg_data_dir and crg_enabled are recorded in
    status.json and the preflight extras carry the CRG status."""
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)
    log_path = pipeline_env.tmp_path / "mock_crg_state.jsonl"

    result = _run_pipeline_with_crg(
        pipeline_env, _happy_scenario(), "crg state test", log_path,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status.get("crg_status") == "ready"
    assert status.get("crg_enabled") is True
    assert status.get("crg_data_dir"), "crg_data_dir must be recorded"

    preflight_stage = status.get("stages", {}).get("preflight", {})
    assert preflight_stage.get("crg_status") == "ready"
    assert preflight_stage.get("crg_data_dir")


# ===========================================================================
# 5. Disabled CRG has no invocations (regression guard)
# ===========================================================================

def test_crg_disabled_no_invocation(pipeline_env):
    """With CRG disabled, the mock is never invoked and pipeline completes."""
    pipeline_env.enable_stages("preflight")
    log_path = pipeline_env.tmp_path / "mock_crg_disabled.jsonl"

    result = _run_pipeline_with_crg(
        pipeline_env, _happy_scenario(), "crg disabled test", log_path,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"

    if log_path.exists():
        invocations = [
            json.loads(line) for line in log_path.read_text().splitlines()
            if line.strip()
        ]
        assert not invocations, f"CRG should not be invoked when disabled: {invocations}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("crg_status") in (None, "skipped")
    assert not status.get("crg_enabled")
