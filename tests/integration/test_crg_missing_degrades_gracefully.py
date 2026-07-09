"""W-057 — CRG enabled but CLI absent degrades gracefully.

Asserts:
- enabled=true but code-review-graph not on PATH → pipeline completes
- crg_status=degraded in status.json
- Plan prompt has no CRG availability note (byte-identical to disabled)
- A degradation reason is logged
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


def _setup_global_crg(pipeline_env) -> Path:
    worca_home = pipeline_env.tmp_path / "worca_home"
    worca_home.mkdir(exist_ok=True)
    global_settings = {"worca": {"code_review_graph": {"enabled": True}}}
    (worca_home / "settings.json").write_text(json.dumps(global_settings))
    return worca_home


def _enable_crg_settings(pipeline_env) -> None:
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings["worca"]["code_review_graph"] = {
        "enabled": True,
        "freshness": "base_sha",
        "update_on": {"preflight": True},
        "version_range": ">=2,<3",
        "fastmcp_min": "3.2.4",
    }
    settings_path.write_text(json.dumps(settings, indent=2))


def _strip_crg_from_path(sandbox_root) -> str:
    """Return a PATH where code-review-graph and fastmcp are unfindable.

    Follows the same shadow-link pattern as the graphify degradation test:
    for any PATH dir containing a matching binary, substitute a sandbox dir
    that symlinks every entry except the target; the mock_crg dir is dropped
    outright.
    """
    original = os.environ.get("PATH", "")
    targets = {"code-review-graph", "fastmcp"}
    out = []
    for idx, p in enumerate(original.split(os.pathsep)):
        if not p or "mock_crg" in p:
            continue
        found = [name for name in targets if os.path.exists(os.path.join(p, name))]
        if found:
            shadow = os.path.join(str(sandbox_root), f"pathshadow-{idx}")
            os.makedirs(shadow, exist_ok=True)
            for name in os.listdir(p):
                if name in targets:
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


def _run_pipeline(pipeline_env, scenario: dict, prompt: str,
                   path_override: str | None = None) -> subprocess.CompletedProcess:
    scenario_path = pipeline_env.tmp_path / "scenario_crg_degrade.json"
    scenario_path.write_text(json.dumps(scenario))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", prompt]

    worca_home = _setup_global_crg(pipeline_env)
    env = {
        **os.environ,
        "WORCA_CLAUDE_BIN": f"{sys.executable} {MOCK_CLAUDE_BIN}",
        "WORCA_AGENT": "",
        "WORCA_SKIP_BEADS": "1",
        "MOCK_CLAUDE_SCENARIO": str(scenario_path),
        "WORCA_HOME": str(worca_home),
        "PYTHONPATH": str(REPO_ROOT / "src"),
        # W-077: pin config path so pipeline reads from the same file that
        # _enable_crg_settings wrote to.
        "WORCA_CONFIG_PATH": str(pipeline_env.worca_config_path),
    }
    if path_override is not None:
        env["PATH"] = path_override
    for key in ("WORCA_PLAN_FILE", "WORCA_PROJECT_ROOT", "WORCA_RUN_ID", "WORCA_RUN_DIR"):
        env.pop(key, None)

    return subprocess.run(
        cmd, cwd=str(pipeline_env.project), env=env,
        capture_output=True, text=True, timeout=120,
    )


# ===========================================================================
# 1. CRG enabled but missing → pipeline completes with degraded status
# ===========================================================================

def test_crg_missing_degrades_to_completed(pipeline_env):
    """Pipeline completes when CRG is enabled but the CLI is absent."""
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)

    clean_path = _strip_crg_from_path(pipeline_env.tmp_path / "pathshadow")
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "crg missing test",
        path_override=clean_path,
    )

    assert result.returncode == 0, (
        f"Pipeline should complete even without CRG.\n"
        f"stderr: {result.stderr[-1000:]}"
    )

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status["pipeline_status"] == "completed"
    assert status.get("crg_status") == "degraded", (
        f"Expected crg_status='degraded', got {status.get('crg_status')!r}"
    )


# ===========================================================================
# 2. Degraded run has no CRG note in planner prompt
# ===========================================================================

def test_crg_missing_no_note_in_prompt(pipeline_env):
    """When CRG is enabled but missing, the planner prompt carries no CRG
    availability note — identical to a disabled run."""
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)

    clean_path = _strip_crg_from_path(pipeline_env.tmp_path / "pathshadow")
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "crg missing prompt test",
        path_override=clean_path,
    )

    assert result.returncode == 0

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    plan_stage = status.get("stages", {}).get("plan", {})
    plan_prompt = plan_stage.get("prompt", "")
    assert "code-review-graph mcp" not in plan_prompt.lower(), (
        "CRG availability note should not appear when CRG is degraded"
    )

    assert not status.get("crg_data_dir"), (
        f"crg_data_dir should not be set when degraded, "
        f"got {status.get('crg_data_dir')!r}"
    )


# ===========================================================================
# 3. Degradation reason is recorded
# ===========================================================================

def test_crg_missing_logs_reason(pipeline_env):
    """When CRG is enabled but missing, a degradation reason is logged."""
    pipeline_env.enable_stages("preflight")
    _enable_crg_settings(pipeline_env)

    clean_path = _strip_crg_from_path(pipeline_env.tmp_path / "pathshadow")
    result = _run_pipeline(
        pipeline_env, _happy_scenario(), "crg reason test",
        path_override=clean_path,
    )

    assert result.returncode == 0

    worca_dir = pipeline_env.project / ".worca"
    status = _find_latest_status(worca_dir)
    assert status.get("crg_status") == "degraded"

    preflight_stage = status.get("stages", {}).get("preflight", {})
    iterations = preflight_stage.get("iterations", [])
    assert iterations, "No preflight iterations found"
    output = iterations[0].get("output", {})
    reason = output.get("crg_reason", "")
    assert reason, (
        f"Expected crg_reason in preflight output.\n"
        f"output keys: {list(output.keys())}"
    )
