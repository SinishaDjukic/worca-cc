"""W-053 Phase 2 — graphify enabled but CLI missing degrades gracefully.

Asserts:
- enabled=true but graphify not on PATH → one warning logged
- Pipeline completes identically to a disabled run (no graph section in prompt)
- graphify_status=degraded in status.json
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from tests.integration.helpers import _find_latest_status


REPO_ROOT = Path(__file__).parent.parent.parent
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


def _setup_global_graphify(pipeline_env) -> Path:
    """Create a temp WORCA_HOME with global graphify enabled."""
    worca_home = pipeline_env.tmp_path / "worca_home"
    worca_home.mkdir(exist_ok=True)
    global_settings = {"worca": {"graphify": {"enabled": True}}}
    (worca_home / "settings.json").write_text(json.dumps(global_settings))
    return worca_home


def _run_pipeline(pipeline_env, scenario: dict, prompt: str,
                   path_override: str | None = None) -> subprocess.CompletedProcess:
    """Run the pipeline subprocess, optionally with a custom PATH."""
    scenario_path = pipeline_env.tmp_path / "scenario_degrade.json"
    scenario_path.write_text(json.dumps(scenario))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", prompt]

    worca_home = _setup_global_graphify(pipeline_env)
    env = {
        **os.environ,
        "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
        "WORCA_AGENT": "",
        "WORCA_SKIP_BEADS": "1",
        "MOCK_CLAUDE_SCENARIO": str(scenario_path),
        "WORCA_HOME": str(worca_home),
        # W-077: pin config path so pipeline reads from the same file that
        # _enable_graphify_settings wrote to.
        "WORCA_CONFIG_PATH": str(pipeline_env.worca_config_path),
        "PYTHONPATH": str(REPO_ROOT / "src"),
    }
    if path_override is not None:
        env["PATH"] = path_override
    for key in ("WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR"):
        env.pop(key, None)

    return subprocess.run(
        cmd, cwd=str(pipeline_env.project), env=env,
        capture_output=True, text=True, timeout=120,
    )


def _enable_graphify_settings(pipeline_env) -> None:
    """Enable graphify in project settings."""
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["graphify"] = {
        "enabled": True,
        "mode": "structural",
        "update_on": {"preflight": True},
        "version_range": ">=0.8.16,<1",
    }
    settings_path.write_text(json.dumps(settings, indent=2))


def _strip_graphify_from_path(sandbox_root) -> str:
    """Return a PATH where ``graphify`` is unfindable but sibling tools survive.

    Name-based filtering isn't enough (a real install lives in a generic dir
    like ~/.local/bin), and dropping the whole dir is too blunt — that dir also
    holds tools the preflight checks for (e.g. ``claude``). So for any PATH dir
    containing a ``graphify`` executable we substitute a sandbox dir that
    symlinks every entry EXCEPT graphify; the mock_graphify dir is dropped
    outright. The result has all the usual tools but no graphify.
    """
    original = os.environ.get("PATH", "")
    out = []
    for idx, p in enumerate(original.split(os.pathsep)):
        if not p or "mock_graphify" in p:
            continue
        if os.path.exists(os.path.join(p, "graphify")):
            shadow = os.path.join(sandbox_root, f"pathshadow-{idx}")
            os.makedirs(shadow, exist_ok=True)
            for name in os.listdir(p):
                if name == "graphify":
                    continue
                link = os.path.join(shadow, name)
                if not os.path.lexists(link):
                    try:
                        os.symlink(os.path.join(p, name), link)
                    except OSError:
                        pass
            out.append(shadow)
        else:
            out.append(p)
    return os.pathsep.join(out)


# ===========================================================================
# 1. Enabled but graphify missing → pipeline completes with degraded status
# ===========================================================================

def test_graphify_missing_degrades_to_completed(pipeline_env):
    """Pipeline completes successfully even when graphify is enabled but the
    CLI is not on PATH. status.json records graphify_status=degraded."""
    pipeline_env.enable_stages("preflight")
    _enable_graphify_settings(pipeline_env)

    clean_path = _strip_graphify_from_path(pipeline_env.tmp_path / 'pathshadow')
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "graphify missing test",
        path_override=clean_path,
    )

    assert result.returncode == 0, (
        f"Pipeline should complete even without graphify.\n"
        f"stderr: {result.stderr[-1000:]}"
    )

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("graphify_status") == "degraded", (
        f"Expected graphify_status='degraded', got {status.get('graphify_status')!r}"
    )


# ===========================================================================
# 2. Degraded run has no graph section in planner prompt
# ===========================================================================

def test_graphify_missing_no_graph_in_prompt(pipeline_env):
    """When graphify is enabled but missing, the planner prompt carries no
    graphify availability note — identical to a disabled run."""
    pipeline_env.enable_stages("preflight")
    _enable_graphify_settings(pipeline_env)

    clean_path = _strip_graphify_from_path(pipeline_env.tmp_path / 'pathshadow')
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "graphify missing prompt test",
        path_override=clean_path,
    )

    assert result.returncode == 0

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)

    # Plan stage prompt should not contain the graphify availability note
    plan_stage = status.get("stages", {}).get("plan", {})
    plan_prompt = plan_stage.get("prompt", "")
    assert "graphify query" not in plan_prompt, (
        "Graphify availability note should not appear when graphify is degraded"
    )
    assert "code knowledge graph is preloaded" not in plan_prompt

    # No graphify_report_path should be recorded
    assert not status.get("graphify_report_path"), (
        f"graphify_report_path should not be set when degraded, "
        f"got {status.get('graphify_report_path')!r}"
    )


# ===========================================================================
# 3. Warning is logged for degraded graphify
# ===========================================================================

def test_graphify_missing_logs_warning(pipeline_env):
    """When graphify is enabled but missing, the pipeline logs a warning
    about the missing/incompatible CLI in the preflight iteration output."""
    pipeline_env.enable_stages("preflight")
    _enable_graphify_settings(pipeline_env)

    clean_path = _strip_graphify_from_path(pipeline_env.tmp_path / 'pathshadow')
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "graphify warning test",
        path_override=clean_path,
    )

    assert result.returncode == 0

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status.get("graphify_status") == "degraded"

    # The degradation reason is recorded in the preflight iteration output
    # (iter_extras["output"] = result from run_preflight, which includes
    # graphify_reason from run_graphify_preflight).
    preflight_stage = status.get("stages", {}).get("preflight", {})
    iterations = preflight_stage.get("iterations", [])
    assert iterations, "No preflight iterations found"
    output = iterations[0].get("output", {})
    reason = output.get("graphify_reason", "")
    assert reason, (
        f"Expected graphify_reason in preflight output.\n"
        f"output keys: {list(output.keys())}"
    )
