"""Integration test helpers: dataclasses, action functions, and polling utilities."""
import json
import os
import signal
import subprocess
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional


# ---------------------------------------------------------------------------
# Dataclasses
# ---------------------------------------------------------------------------

@dataclass
class PipelineResult:
    returncode: int
    status: dict
    events: list
    stdout: str
    stderr: str


@dataclass
class WorktreeResult:
    """Outcome of a ``run_worktree.py`` invocation (W-050 Phase 3).

    Worktree mode is fire-and-forget: ``run_worktree.py`` exits as soon as it
    has spawned the detached pipeline subprocess, so ``returncode`` reflects
    only the launch step. ``run_id`` and ``worktree_path`` are parsed from
    stdout (the script prints them on the last two lines). ``status`` and
    ``events`` are collected from ``<worktree>/.worca/runs/<run_id>/`` after
    the helper waits for the pipeline to reach a terminal state.
    """
    returncode: int
    run_id: str
    worktree_path: str
    status: dict
    events: list
    stdout: str
    stderr: str


@dataclass
class ParallelResult:
    """Outcome of a ``run_parallel.py`` invocation (W-050 Phase 3)."""
    returncode: int
    summary: list  # parsed parallel-results.json
    stdout: str
    stderr: str


@dataclass
class PipelineEnv:
    project: Path
    worca_dir: Path
    run: Callable
    run_background: Callable
    add_webhook: Callable
    # W-050 Phase 0 helpers — see conftest.py for the implementations.
    enable_stages: Callable = None  # type: ignore[assignment]
    set_governance_agent: Callable = None  # type: ignore[assignment]
    enable_beads: Callable = None  # type: ignore[assignment]
    # W-050 Phase 2 helper — drives a claude_hooks entry-point as a subprocess.
    run_hook: Callable = None  # type: ignore[assignment]
    # W-050 Phase 3 helpers — drive run_worktree.py / run_parallel.py.
    run_worktree: Callable = None  # type: ignore[assignment]
    run_parallel: Callable = None  # type: ignore[assignment]
    # W-050 coverage helper — drives a worca.cli.main subcommand as a subprocess.
    run_cli: Callable = None  # type: ignore[assignment]
    tmp_path: Optional[Path] = None
    stubs_dir: Optional[Path] = None
    stub_log_path: Optional[Path] = None
    stub_response_files: dict = field(default_factory=dict)
    # W-077: path to ~/.worca/projects/<slug>/config.json (worca config, not Claude settings)
    worca_config_path: Optional[Path] = None


@dataclass
class WebhookCapture:
    url: str
    received: list = field(default_factory=list)


# ---------------------------------------------------------------------------
# Result readers
# ---------------------------------------------------------------------------

def _find_latest_status(worca_dir: Path) -> dict:
    """Find the most recent run's status.json."""
    runs_dir = worca_dir / "runs"
    if not runs_dir.exists():
        return {}
    run_dirs = sorted(runs_dir.iterdir(), key=lambda p: p.name, reverse=True)
    for run_dir in run_dirs:
        status_path = run_dir / "status.json"
        if status_path.exists():
            return json.loads(status_path.read_text())
    return {}


def _read_events_jsonl(worca_dir: Path) -> list:
    """Read all events from the latest run's events.jsonl."""
    runs_dir = worca_dir / "runs"
    if not runs_dir.exists():
        return []
    run_dirs = sorted(runs_dir.iterdir(), key=lambda p: p.name, reverse=True)
    for run_dir in run_dirs:
        events_path = run_dir / "events.jsonl"
        if events_path.exists():
            lines = events_path.read_text().strip().split("\n")
            return [json.loads(line) for line in lines if line.strip()]
    return []


def _find_latest_run_id(worca_dir: Path) -> str:
    """Return the run_id of the most recently created run in runs/."""
    runs_dir = worca_dir / "runs"
    if not runs_dir.exists():
        raise RuntimeError(f"No runs/ directory found in {worca_dir}")
    run_dirs = sorted(runs_dir.iterdir(), key=lambda p: p.name, reverse=True)
    for run_dir in run_dirs:
        if (run_dir / "status.json").exists():
            return run_dir.name
    raise RuntimeError(f"No run found in {worca_dir}/runs/")


# ---------------------------------------------------------------------------
# Polling
# ---------------------------------------------------------------------------

def _wait_for_stage(worca_dir: Path, stage_name: str, timeout: float = 10) -> None:
    """Poll status.json until the named stage is in_progress."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = _find_latest_status(worca_dir)
        stage_data = status.get("stages", {}).get(stage_name, {})
        if stage_data.get("status") == "in_progress":
            return
        time.sleep(0.1)
    raise TimeoutError(f"Stage {stage_name!r} did not start within {timeout}s")


def _wait_for_stage_completed(worca_dir: Path, stage_name: str, timeout: float = 10) -> None:
    """Poll status.json until the named stage has status='completed'."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = _find_latest_status(worca_dir)
        stage_data = status.get("stages", {}).get(stage_name, {})
        if stage_data.get("status") == "completed":
            return
        time.sleep(0.1)
    raise TimeoutError(f"Stage {stage_name!r} did not complete within {timeout}s")


# ---------------------------------------------------------------------------
# run_and_act
# ---------------------------------------------------------------------------

def run_and_act(
    pipeline_env: PipelineEnv,
    scenario: dict,
    action_fn: Callable,
    act_after_stage: Optional[str] = None,
    act_after_stage_completed: Optional[str] = None,
    timeout: float = 15,
    extra_args: Optional[list] = None,
) -> PipelineResult:
    """Run pipeline in background, apply action at the right moment, collect results.

    act_after_stage: wait for the named stage to reach in_progress, then act.
    act_after_stage_completed: wait for the named stage to reach completed, then act.
    extra_args: additional CLI args passed to run_pipeline (e.g. ["--resume"]).
    """
    proc = pipeline_env.run_background(scenario, extra_args=extra_args)

    try:
        if act_after_stage:
            _wait_for_stage(pipeline_env.worca_dir, act_after_stage, timeout=30)
        elif act_after_stage_completed:
            _wait_for_stage_completed(pipeline_env.worca_dir, act_after_stage_completed, timeout=30)

        action_fn(proc, pipeline_env)
        stdout, stderr = proc.communicate(timeout=timeout)
    except (subprocess.TimeoutExpired, TimeoutError):
        proc.kill()
        stdout, stderr = proc.communicate()

    status = _find_latest_status(pipeline_env.worca_dir)
    events = _read_events_jsonl(pipeline_env.worca_dir)
    return PipelineResult(
        returncode=proc.returncode,
        status=status,
        events=events,
        stdout=stdout or "",
        stderr=stderr or "",
    )


# ---------------------------------------------------------------------------
# Action functions
# ---------------------------------------------------------------------------

def send_sigterm(proc, env: PipelineEnv) -> None:
    """Send SIGTERM to the pipeline process group.

    Targets the process group (not just the PID) because the pipeline spawns
    child processes (mock claude) that must also receive the signal. This is
    safe because run_background() uses start_new_session=True, isolating the
    pipeline into its own process group — no other processes are affected.
    """
    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)


def send_sigint(proc, env: PipelineEnv) -> None:
    """Send SIGINT to the pipeline process group.

    See send_sigterm() for rationale on targeting the process group.
    """
    os.killpg(os.getpgid(proc.pid), signal.SIGINT)


def send_sigkill(proc, env: PipelineEnv) -> None:
    """Send SIGKILL to the pipeline process group.

    See send_sigterm() for rationale on targeting the process group.
    SIGKILL cannot be caught — the process dies immediately with no cleanup.
    """
    os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


def write_control_stop(proc, env: PipelineEnv) -> None:
    """Write a stop control file using the current control.py protocol."""
    run_id = _find_latest_run_id(env.worca_dir)
    control = env.worca_dir / "runs" / run_id / "control.json"
    control.write_text(json.dumps({
        "action": "stop",
        "requested_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "test",
    }))


def write_control_pause(proc, env: PipelineEnv) -> None:
    """Write a pause control file using the current control.py protocol."""
    run_id = _find_latest_run_id(env.worca_dir)
    control = env.worca_dir / "runs" / run_id / "control.json"
    control.write_text(json.dumps({
        "action": "pause",
        "requested_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "source": "test",
    }))


# ---------------------------------------------------------------------------
# W-050 Phase 0 — scenario / run-dir / stub-log helpers
# ---------------------------------------------------------------------------

def make_iteration_scenario(
    per_agent_per_iter: dict,
    default: Optional[dict] = None,
) -> dict:
    """Build a scenario where agents return different directives per iteration.

    Args:
        per_agent_per_iter: ``{agent_name: {iter_N: directive, "default": directive}}``.
            Each inner dict maps iteration keys (``"iter_1"``, ``"iter_2"``, ...) and
            optionally ``"default"`` to directive dicts (the same shape mock_claude
            already accepts: ``{"action": "succeed", "result_text": "...", ...}``).
        default: Scenario-level fallback directive. Defaults to a short success.

    Example:
        ``make_iteration_scenario({
            "tester": {
                "iter_1": {"action": "fail", "error": "boom"},
                "iter_2": {"action": "succeed"},
            }
        })``
    """
    scenario = {
        "agents": dict(per_agent_per_iter),
        "default": default or {"action": "succeed", "delay_s": 0.05},
    }
    return scenario


def read_run_dir(worca_dir: Path) -> Path:
    """Return the path to the most recent run directory.

    Useful in Phase 1+ tests that need to inspect ``runs/<id>/iterations/`` or
    ``agents/resolved/`` artifacts created by the pipeline.
    """
    run_id = _find_latest_run_id(worca_dir)
    return worca_dir / "runs" / run_id


def assert_stage_sequence(events: list, expected_stages: list[str]) -> None:
    """Assert that ``pipeline.stage.started`` events fire in the given order.

    Reads stage names from the events.jsonl stream — only the first occurrence
    of each stage is checked, which tolerates in-stage retry loops emitting
    repeated ``pipeline.stage.started`` events. The check is a subsequence
    match: extra stages between the expected ones are allowed (existing event
    streams include preflight, coordinator, etc. that callers may not care about).
    """
    seen_order: list[str] = []
    seen_set: set[str] = set()
    for event in events:
        # Tolerate both the canonical "pipeline.stage.started" type and the
        # short "stage.started" form some test paths emit.
        if event.get("event_type") not in ("pipeline.stage.started", "stage.started"):
            continue
        stage = (
            event.get("stage")
            or event.get("payload", {}).get("stage")
            or event.get("data", {}).get("stage")
        )
        if not stage or stage in seen_set:
            continue
        seen_set.add(stage)
        seen_order.append(stage)

    relevant = [s for s in seen_order if s in expected_stages]
    assert relevant == expected_stages, (
        f"Stage sequence mismatch.\n  expected: {expected_stages}\n  got:      {relevant}\n"
        f"  all stages seen: {seen_order}"
    )


def read_stub_log(log_path: Path) -> list[dict]:
    """Read invocations recorded by the bd / gh stubs (see stubs/_stub_lib.py)."""
    if not log_path.exists():
        return []
    out: list[dict] = []
    for line in log_path.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out
