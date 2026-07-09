"""W-053 — full pipeline with graphify enabled (mode=structural).

Asserts:
- Preflight invokes mock graphify CLI (`update <path>`)
- Planner prompt carries the per-run availability note (NOT the static report)
- The runner exports GRAPHIFY_OUT so an agent's `graphify query` reads the cache
- Pipeline completes successfully
- status.json records graphify_status=ready
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.integration.helpers import _find_latest_status


MOCK_GRAPHIFY_DIR = Path(__file__).parent.parent / "mock_graphify"
MOCK_CLAUDE_BIN = Path(__file__).parent.parent / "mock_claude" / "mock_claude.py"
# The pipeline subprocess must import worca from the worktree source tree, not
# a stale site-packages install — mirrors conftest._base_env. Without this,
# new agent .md files (copied from src by `worca init`) run against old
# orchestrator code (version skew that cannot occur in production, where both
# always come from the same installed package).
SRC_DIR = Path(__file__).resolve().parents[2] / "src"

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


def _setup_global_graphify(pipeline_env) -> Path:
    """Create a temp WORCA_HOME with global graphify enabled."""
    worca_home = pipeline_env.tmp_path / "worca_home"
    worca_home.mkdir(exist_ok=True)
    global_settings = {"worca": {"graphify": {"enabled": True}}}
    (worca_home / "settings.json").write_text(json.dumps(global_settings))
    return worca_home


def _run_pipeline_with_graphify(pipeline_env, scenario: dict, prompt: str,
                                 graphify_log_path: Path) -> subprocess.CompletedProcess:
    """Run the pipeline subprocess with mock graphify on PATH."""
    scenario_path = pipeline_env.tmp_path / "scenario_graphify.json"
    scenario_path.write_text(json.dumps(scenario))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", prompt]

    worca_home = _setup_global_graphify(pipeline_env)
    mock_path = f"{MOCK_GRAPHIFY_DIR}{os.pathsep}{os.environ.get('PATH', '')}"
    env = {
        **os.environ,
        "PYTHONPATH": str(SRC_DIR),
        "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
        "WORCA_AGENT": "",
        "WORCA_SKIP_BEADS": "1",
        "MOCK_CLAUDE_SCENARIO": str(scenario_path),
        "PATH": mock_path,
        "MOCK_GRAPHIFY_LOG": str(graphify_log_path),
        "WORCA_HOME": str(worca_home),
        # W-077: pin config path so pipeline reads from the same file that
        # _enable_graphify_settings wrote to.
        "WORCA_CONFIG_PATH": str(pipeline_env.worca_config_path),
    }
    for key in ("WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR"):
        env.pop(key, None)

    return subprocess.run(
        cmd, cwd=str(pipeline_env.project), env=env,
        capture_output=True, text=True, timeout=120,
    )


def _enable_graphify_settings(pipeline_env, mode: str = "structural") -> None:
    """Enable graphify in project settings.

    Uses freshness=base_sha so the per-commit snapshot is built deterministically
    regardless of the working-tree state during the run.
    """
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["graphify"] = {
        "enabled": True,
        "mode": mode,
        "update_on": {"preflight": True},
        "freshness": "base_sha",
    }
    settings_path.write_text(json.dumps(settings, indent=2))


# ===========================================================================
# 1. Mock graphify invoked by preflight + graph injected into planner prompt
# ===========================================================================

def test_graphify_preflight_invokes_mock_and_injects_graph(pipeline_env):
    pipeline_env.enable_stages("preflight")
    _enable_graphify_settings(pipeline_env, mode="structural")
    log_path = pipeline_env.tmp_path / "mock_graphify_invocations.jsonl"

    result = _run_pipeline_with_graphify(
        pipeline_env, _happy_scenario(), "graphify pipeline test", log_path,
    )

    assert result.returncode == 0, (
        f"Pipeline failed (rc={result.returncode}).\nstderr: {result.stderr[-2000:]}"
    )

    # 1. Mock graphify was invoked with `update .` (the real CLI's command;
    #    there is no `build` / `--no-llm`).
    assert log_path.exists(), f"Mock graphify was never invoked.\nstderr: {result.stderr[-1000:]}"
    invocations = [
        json.loads(line) for line in log_path.read_text().splitlines() if line.strip()
    ]
    assert len(invocations) >= 1
    update_calls = [i for i in invocations if "update" in i["argv"]]
    assert update_calls, f"No `update` invocation found in {invocations}"
    assert "build" not in update_calls[0]["argv"]
    assert "--no-llm" not in update_calls[0]["argv"]

    # 2. GRAPH_REPORT.md was created in the per-commit cache (not the repo tree)
    cache_root = pipeline_env.tmp_path / "worca_home" / "cache" / "ast"
    reports = list(cache_root.glob("*/*/graphify/GRAPH_REPORT.md"))
    assert reports, f"No cache snapshot report under {cache_root}"
    assert not (pipeline_env.project / "graphify-out").exists(), (
        "graphify-out/ must NOT be created in the repo tree (cache relocation)"
    )

    # 3. Verify status records graphify state
    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status.get("graphify_status") == "ready"
    assert status["pipeline_status"] == "completed"
    assert status.get("graphify_report_path")
    # Run-level enablement + per-iteration invocation count drive the UI badge.
    assert status.get("graphify_enabled") is True
    _plan_iters = status.get("stages", {}).get("plan", {}).get("iterations", [])
    assert _plan_iters and "graphify_invocations" in _plan_iters[0], (
        "agent-stage iterations must record graphify_invocations"
    )
    # Preflight has no agent and must NOT carry the badge field.
    _pf_iters = status.get("stages", {}).get("preflight", {}).get("iterations", [])
    assert _pf_iters and "graphify_invocations" not in _pf_iters[0], (
        "preflight iterations must not record graphify_invocations"
    )

    # 4. The plan stage's rendered prompt (from plan.block.md) carries the
    #    per-run availability NOTE — not the static report block. Agents query
    #    the graph on demand via GRAPHIFY_OUT; no report content is injected.
    #    The rendered prompt is stored in status.json under stages.plan.prompt.
    plan_stage = status.get("stages", {}).get("plan", {})
    plan_prompt = plan_stage.get("prompt", "")
    assert "graphify query" in plan_prompt, (
        f"Plan stage prompt missing graphify availability note.\n"
        f"graphify_report_path: {status.get('graphify_report_path')!r}\n"
        f"prompt preview:\n{plan_prompt[:1000]}"
    )
    assert "code knowledge graph is preloaded" in plan_prompt
    assert "## Codebase Structure" not in plan_prompt, (
        "Static graph-report block must not be injected (W-053 query pivot)"
    )
    assert "Graph Report (mock)" not in plan_prompt, (
        "Report content must not be injected into the prompt (W-053 query pivot)"
    )


# ===========================================================================
# 2. GRAPHIFY_OUT propagates to agents → `graphify query` reads the cache
# ===========================================================================

def _query_scenario() -> dict:
    """Happy scenario where the planner issues a read-only `graphify query`.

    The query runs in the planner's subprocess (which the runner spawned with
    GRAPHIFY_OUT set), so it inherits that env and reads the per-commit cache.
    """
    return {
        "agents": {
            "planner": {
                "action": "succeed", "delay_s": 0.05,
                "run_command": 'graphify query "where is the entrypoint"',
            },
            "tester": _tester_pass(),
            "reviewer": _review_approve(),
        },
        "default": {"action": "succeed", "delay_s": 0.05},
    }


def test_graphify_out_propagates_to_query_agent(pipeline_env):
    """The runner exports GRAPHIFY_OUT into agent subprocesses so a bare
    `graphify query` reads the per-commit cache snapshot, not ./graphify-out/."""
    pipeline_env.enable_stages("preflight")
    _enable_graphify_settings(pipeline_env, mode="structural")
    log_path = pipeline_env.tmp_path / "mock_graphify_query.jsonl"

    result = _run_pipeline_with_graphify(
        pipeline_env, _query_scenario(), "graphify query propagation", log_path,
    )
    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    invocations = [
        json.loads(line) for line in log_path.read_text().splitlines() if line.strip()
    ]
    query_calls = [i for i in invocations if "query" in i["argv"]]
    assert query_calls, f"No `query` invocation found in {invocations}"

    # The query inherited GRAPHIFY_OUT pointing at the per-commit cache snapshot
    # (the graphify/ dir = dirname of the report path the preflight resolved).
    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    expected_out = os.path.dirname(status["graphify_report_path"])
    assert query_calls[0]["graphify_out"] == expected_out, (
        f"query should read the cache via GRAPHIFY_OUT={expected_out!r}, "
        f"got {query_calls[0]['graphify_out']!r}"
    )


# ===========================================================================
# 3. Pipeline completes identically when graphify disabled (regression guard)
# ===========================================================================

def test_graphify_disabled_no_invocation(pipeline_env):
    """With graphify disabled, the mock is never invoked and pipeline completes."""
    pipeline_env.enable_stages("preflight")
    log_path = pipeline_env.tmp_path / "mock_graphify_disabled.jsonl"

    result = _run_pipeline_with_graphify(
        pipeline_env, _happy_scenario(), "graphify disabled test", log_path,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-500:]}"

    if log_path.exists():
        invocations = [
            json.loads(line) for line in log_path.read_text().splitlines()
            if line.strip()
        ]
        assert not invocations, f"Graphify should not be invoked when disabled: {invocations}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("graphify_status") in (None, "skipped")
    assert not status.get("graphify_enabled")
