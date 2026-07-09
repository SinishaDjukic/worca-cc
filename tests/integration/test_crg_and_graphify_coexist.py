"""W-057 — CRG and graphify coexistence.

Both engines enabled → both build under one per-commit snapshot; agents get
both surfaces (GRAPHIFY_OUT for graphify queries, MCP config for CRG tools).
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


def _setup_global_both(pipeline_env) -> Path:
    """WORCA_HOME with both graphify and CRG enabled globally."""
    worca_home = pipeline_env.tmp_path / "worca_home"
    worca_home.mkdir(exist_ok=True)
    global_settings = {
        "worca": {
            "graphify": {"enabled": True},
            "code_review_graph": {"enabled": True},
        },
    }
    (worca_home / "settings.json").write_text(json.dumps(global_settings))
    return worca_home


def _enable_both_settings(pipeline_env) -> None:
    """Enable both graphify and CRG in project settings."""
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["graphify"] = {
        "enabled": True,
        "mode": "structural",
        "update_on": {"preflight": True},
        "freshness": "base_sha",
    }
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


def _run_pipeline_with_both(pipeline_env, scenario: dict, prompt: str,
                             graphify_log: Path, crg_log: Path) -> subprocess.CompletedProcess:
    scenario_path = pipeline_env.tmp_path / "scenario_coexist.json"
    scenario_path.write_text(json.dumps(scenario))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", prompt]

    worca_home = _setup_global_both(pipeline_env)
    mock_path = (
        f"{MOCK_CRG_DIR}{os.pathsep}"
        f"{MOCK_GRAPHIFY_DIR}{os.pathsep}"
        f"{os.environ.get('PATH', '')}"
    )
    env = {
        **os.environ,
        "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
        "WORCA_AGENT": "",
        "WORCA_SKIP_BEADS": "1",
        "MOCK_CLAUDE_SCENARIO": str(scenario_path),
        "PATH": mock_path,
        "MOCK_GRAPHIFY_LOG": str(graphify_log),
        "MOCK_CRG_LOG": str(crg_log),
        "WORCA_HOME": str(worca_home),
        "PYTHONPATH": str(REPO_ROOT / "src"),
        # W-077: pin config path so pipeline reads from the same file that
        # _enable_both_settings wrote to.
        "WORCA_CONFIG_PATH": str(pipeline_env.worca_config_path),
    }
    for key in ("WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR"):
        env.pop(key, None)

    return subprocess.run(
        cmd, cwd=str(pipeline_env.project), env=env,
        capture_output=True, text=True, timeout=120,
    )


# ===========================================================================
# 1. Both engines ready — pipeline completes with both statuses
# ===========================================================================

def test_both_engines_ready(pipeline_env):
    """When both graphify and CRG are enabled, both build successfully and
    the pipeline completes with both statuses recorded."""
    pipeline_env.enable_stages("preflight")
    _enable_both_settings(pipeline_env)
    graphify_log = pipeline_env.tmp_path / "mock_graphify_coexist.jsonl"
    crg_log = pipeline_env.tmp_path / "mock_crg_coexist.jsonl"

    result = _run_pipeline_with_both(
        pipeline_env, _happy_scenario(), "coexistence test",
        graphify_log, crg_log,
    )

    assert result.returncode == 0, (
        f"Pipeline failed (rc={result.returncode}).\nstderr: {result.stderr[-2000:]}"
    )

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("graphify_status") == "ready", (
        f"graphify_status={status.get('graphify_status')!r}"
    )
    assert status.get("crg_status") == "ready", (
        f"crg_status={status.get('crg_status')!r}"
    )
    assert status.get("graphify_enabled") is True
    assert status.get("crg_enabled") is True


# ===========================================================================
# 2. Both mock CLIs actually invoked
# ===========================================================================

def test_both_mocks_invoked(pipeline_env):
    """Both mock graphify and mock CRG should be invoked during preflight."""
    pipeline_env.enable_stages("preflight")
    _enable_both_settings(pipeline_env)
    graphify_log = pipeline_env.tmp_path / "mock_graphify_both.jsonl"
    crg_log = pipeline_env.tmp_path / "mock_crg_both.jsonl"

    result = _run_pipeline_with_both(
        pipeline_env, _happy_scenario(), "both invoked test",
        graphify_log, crg_log,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    assert graphify_log.exists(), "Mock graphify was never invoked"
    graphify_invocations = [
        json.loads(line) for line in graphify_log.read_text().splitlines() if line.strip()
    ]
    graphify_updates = [i for i in graphify_invocations if "update" in i["argv"]]
    assert graphify_updates, f"No graphify `update` found: {graphify_invocations}"

    assert crg_log.exists(), "Mock CRG was never invoked"
    crg_invocations = [
        json.loads(line) for line in crg_log.read_text().splitlines() if line.strip()
    ]
    crg_builds = [i for i in crg_invocations if "build" in i["argv"]]
    assert crg_builds, f"No CRG `build` found: {crg_invocations}"


# ===========================================================================
# 3. Both snapshots share the same per-commit cache root
# ===========================================================================

def test_shared_snapshot_root(pipeline_env):
    """Both engines build under the same per-commit cache directory."""
    pipeline_env.enable_stages("preflight")
    _enable_both_settings(pipeline_env)
    graphify_log = pipeline_env.tmp_path / "mock_graphify_snap.jsonl"
    crg_log = pipeline_env.tmp_path / "mock_crg_snap.jsonl"

    result = _run_pipeline_with_both(
        pipeline_env, _happy_scenario(), "snapshot root test",
        graphify_log, crg_log,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    worca_dir = pipeline_env.project / ".worca"
    _find_latest_status(worca_dir)

    cache_root = pipeline_env.tmp_path / "worca_home" / "cache" / "ast"
    graphify_reports = list(cache_root.glob("*/*/graphify/GRAPH_REPORT.md"))
    assert graphify_reports, f"No graphify report under {cache_root}"

    crg_dbs = list(cache_root.glob("*/*/code-review-graph/graph.db"))
    assert crg_dbs, f"No CRG graph.db under {cache_root}"

    graphify_sha_dir = graphify_reports[0].parent.parent
    crg_sha_dir = crg_dbs[0].parent.parent
    assert graphify_sha_dir == crg_sha_dir, (
        f"Both engines should share the same <repo-id>/<sha> snapshot.\n"
        f"graphify: {graphify_sha_dir}\n"
        f"CRG: {crg_sha_dir}"
    )


# ===========================================================================
# 4. Plan prompt carries both availability notes
# ===========================================================================

def test_plan_prompt_has_both_notes(pipeline_env):
    """Plan stage prompt carries both graphify and CRG availability notes."""
    pipeline_env.enable_stages("preflight")
    _enable_both_settings(pipeline_env)
    graphify_log = pipeline_env.tmp_path / "mock_graphify_notes.jsonl"
    crg_log = pipeline_env.tmp_path / "mock_crg_notes.jsonl"

    result = _run_pipeline_with_both(
        pipeline_env, _happy_scenario(), "both notes test",
        graphify_log, crg_log,
    )

    assert result.returncode == 0, f"stderr: {result.stderr[-2000:]}"

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    plan_stage = status.get("stages", {}).get("plan", {})
    plan_prompt = plan_stage.get("prompt", "")

    assert "graphify query" in plan_prompt, (
        "Plan prompt should carry the graphify availability note"
    )
    assert "code-review-graph" in plan_prompt.lower() or "crg" in plan_prompt.lower(), (
        "Plan prompt should carry the CRG availability note"
    )
