"""W-050 Phase 7 — miscellaneous edge cases.

Six tests covering corners of the runner / CLI surface that aren't part of
any one phase's primary loop but each represent a distinct failure mode the
suite previously had no integration coverage for:

1. Circuit-breaker halt when ``max_consecutive_failures=1``
2. Malformed ``settings.json`` JSON tolerated gracefully (loaded as ``{}``)
3. Plan path pointing to a missing file fails fast
4. ``--param`` without an ``=`` rejected with rc=2
5. Explicit ``--run-id`` propagates to ``status.json`` and the run-dir name
6. ``--resume`` with multiple non-terminal runs rejects rather than picking one

Each test is a self-contained scenario; none rely on cross-test state.
"""
from __future__ import annotations

import json
import subprocess
import sys

import pytest


_HAPPY = {"default": {"action": "succeed", "delay_s": 0.05}}


# ---------------------------------------------------------------------------
# 1. Circuit breaker — halt threshold = 1
# ---------------------------------------------------------------------------


@pytest.mark.timeout(60)
def test_breaker_halts_after_single_failure_when_threshold_is_one(pipeline_env):
    """With ``circuit_breaker.max_consecutive_failures = 1``, a single stage
    failure must trip the breaker immediately. ``should_halt`` returns True
    once consecutive_failures >= threshold; the runner emits a halt and the
    final pipeline_status is ``failed``."""
    settings_path = pipeline_env.worca_config_path
    settings = json.loads(settings_path.read_text())
    settings.setdefault("worca", {})["circuit_breaker"] = {
        "max_consecutive_failures": 1,
    }
    settings_path.write_text(json.dumps(settings, indent=2))

    scenario = {
        "agents": {"planner": {"action": "fail", "error": "phase 7 planned failure"}},
        "default": {"action": "succeed", "delay_s": 0.05},
    }
    result = pipeline_env.run(scenario, timeout=30)

    assert result.returncode != 0, (
        f"breaker-tripped pipeline must exit non-zero; got {result.returncode}"
    )
    assert result.status.get("pipeline_status") == "failed", (
        f"pipeline_status should be 'failed' on breaker halt; "
        f"got {result.status.get('pipeline_status')}"
    )


# ---------------------------------------------------------------------------
# 2. Malformed settings.json tolerated (load_settings returns {})
# ---------------------------------------------------------------------------


@pytest.mark.timeout(60)
def test_malformed_settings_json_does_not_crash_pipeline(pipeline_env):
    """``load_settings`` catches ``json.JSONDecodeError`` and returns ``{}``
    so a typo in the file doesn't take the pipeline down. Without this
    guarantee, a stray trailing comma during local edits would brick every
    pipeline launch on the repo."""
    settings_path = pipeline_env.worca_config_path
    settings_path.write_text('{"worca": { invalid json }}')  # malformed

    result = pipeline_env.run(_HAPPY, timeout=30)

    # The pipeline either completes normally (defaults applied) or fails
    # cleanly — but it MUST NOT crash with a JSONDecodeError traceback.
    assert "JSONDecodeError" not in result.stderr, (
        f"malformed settings should not propagate JSONDecodeError; "
        f"stderr: {result.stderr[:500]}"
    )
    assert "Traceback" not in result.stderr, (
        f"malformed settings should not produce a Python traceback; "
        f"stderr: {result.stderr[:500]}"
    )


# ---------------------------------------------------------------------------
# 3. Plan path pointing to a missing file fails fast
# ---------------------------------------------------------------------------


@pytest.mark.timeout(30)
def test_plan_path_pointing_to_missing_file_fails(pipeline_env, tmp_path):
    """``--plan <missing.md>`` reaches ``normalize_plan_file`` which calls
    ``open(path, "r")`` directly. A missing path raises FileNotFoundError,
    which surfaces as a non-zero exit with the path in stderr — important
    for autonomous workflows where a wrong plan path should fail visibly."""
    bogus = tmp_path / "subdir" / "missing-plan.md"  # parent doesn't exist either

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--plan", str(bogus)]
    proc = subprocess.run(
        cmd, cwd=str(pipeline_env.project),
        capture_output=True, text=True, timeout=15,
    )
    assert proc.returncode != 0, (
        f"missing plan path must fail; got rc={proc.returncode}\n"
        f"stderr: {proc.stderr[:500]}"
    )


# ---------------------------------------------------------------------------
# 4. --param without "=" rejected
# ---------------------------------------------------------------------------


@pytest.mark.timeout(15)
def test_invalid_param_format_rejected_with_rc_two(pipeline_env):
    """``_parse_params`` requires KEY=VALUE; a bare token must be rejected
    with rc=2 and a clear error before any pipeline machinery runs."""
    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline",
           "--prompt", "p7 test",
           "--template", "anything",
           "--param", "foo_no_equals_sign"]
    proc = subprocess.run(
        cmd, cwd=str(pipeline_env.project),
        capture_output=True, text=True, timeout=10,
    )
    assert proc.returncode == 2, (
        f"--param without = should rc=2; got {proc.returncode}\n"
        f"stderr: {proc.stderr[:400]}"
    )
    assert "KEY=VALUE" in proc.stderr or "must be" in proc.stderr.lower()


# ---------------------------------------------------------------------------
# 5. Explicit --run-id propagates to status.json + run-dir name
# ---------------------------------------------------------------------------


@pytest.mark.timeout(60)
def test_explicit_run_id_propagates_to_status_and_run_dir(pipeline_env):
    """``--run-id <id>`` is the contract ``run_worktree.py`` relies on to
    keep the multi-pipeline registry and the runner agreed on the same key.
    The runner must use the supplied id verbatim — not generate its own —
    and the run-dir under ``.worca/runs/`` must match."""
    custom_id = "20260505-phase7-runid-test"
    result = pipeline_env.run(
        _HAPPY,
        extra_args=["--run-id", custom_id],
        timeout=45,
    )

    assert result.returncode == 0, (
        f"happy-path pipeline with custom run_id should complete; "
        f"rc={result.returncode}\nstderr: {result.stderr[:500]}"
    )
    assert result.status.get("run_id") == custom_id, (
        f"status.run_id must reflect --run-id flag; "
        f"got {result.status.get('run_id')!r}, expected {custom_id!r}"
    )
    expected_run_dir = pipeline_env.worca_dir / "runs" / custom_id
    assert expected_run_dir.is_dir(), (
        f"runner should create run-dir at {expected_run_dir}; not found"
    )


# ---------------------------------------------------------------------------
# 6. --resume with multiple active runs rejects
# ---------------------------------------------------------------------------


@pytest.mark.timeout(30)
def test_resume_with_multiple_active_runs_rejects_with_clear_error(
    pipeline_env,
):
    """``_find_active_runs`` returns every non-terminal run; if there's more
    than one, ``--resume`` cannot pick automatically and must error so the
    user can pass ``--status-dir`` or fix the registry."""
    runs_dir = pipeline_env.worca_dir / "runs"
    runs_dir.mkdir(parents=True, exist_ok=True)

    for run_id in ("phase7-active-a", "phase7-active-b"):
        run_dir = runs_dir / run_id
        run_dir.mkdir()
        status = {
            "schema_version": 1,
            "run_id": run_id,
            "work_request": {
                "source_type": "prompt",
                "title": f"P7 {run_id}",
                "description": "synthetic",
            },
            "pipeline_status": "running",  # non-terminal → counted as active
            "stage": "implement",
            "stages": {
                "preflight": {"status": "completed"},
                "plan": {"status": "completed"},
                "coordinate": {"status": "completed"},
                "implement": {"status": "in_progress"},
                "test": {"status": "pending"},
                "review": {"status": "pending"},
                "pr": {"status": "pending"},
            },
            "milestones": {},
        }
        (run_dir / "status.json").write_text(json.dumps(status))

    cmd = [sys.executable, "-m", "worca.scripts.run_pipeline", "--resume"]
    proc = subprocess.run(
        cmd, cwd=str(pipeline_env.project),
        capture_output=True, text=True, timeout=15,
    )

    assert proc.returncode == 2, (
        f"--resume with multiple active runs must rc=2; got {proc.returncode}\n"
        f"stderr: {proc.stderr[:500]}"
    )
    assert "multiple active runs" in proc.stderr.lower(), (
        f"expected 'multiple active runs' diagnostic; "
        f"stderr: {proc.stderr[:500]}"
    )
