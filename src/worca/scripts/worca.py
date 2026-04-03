"""worca CLI — lifecycle commands for pipeline runs.

Commands:
  pause        [run_id]  Write control.json with action:pause
  stop         [run_id]  Write control.json with action:stop + SIGTERM to PID
  resume       [run_id]  Spawn run_pipeline.py --resume
  status       [run_id]  Print pipeline state/stage/iteration
  multi-status           Print status of all parallel pipelines

When run_id is omitted, the active run is read from .worca/active_run.
"""

import argparse
import os
import signal
import subprocess
import sys
from pathlib import Path

# Allow running as a script or importing from tests
_SCRIPTS_DIR = Path(__file__).parent
_CLAUDE_DIR = _SCRIPTS_DIR.parent
sys.path.insert(0, str(_CLAUDE_DIR))

from worca.orchestrator.control import write_control  # noqa: E402
from worca.orchestrator.registry import get_pipeline, list_pipelines, reconcile_stale  # noqa: E402
from worca.state.status import load_status  # noqa: E402


_DEFAULT_BASE = ".worca"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def resolve_run_id(run_id: str | None, base: str = _DEFAULT_BASE) -> str:
    """Return run_id, reading .worca/active_run when run_id is None.

    Raises SystemExit(1) if run_id is None and active_run is missing.
    """
    if run_id:
        return run_id
    active_run_file = Path(base) / "active_run"
    if not active_run_file.exists():
        print(
            f"error: no run_id given and {active_run_file} does not exist",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return active_run_file.read_text().strip()


def _status_path(run_id: str, base: str) -> str:
    return str(Path(base) / "runs" / run_id / "status.json")


def _pid_path(run_id: str, base: str) -> str:
    return str(Path(base) / "runs" / run_id / "pid")


def _resolve_worktree_base(run_id: str | None, base: str) -> tuple[str, dict | None]:
    """Check if run_id belongs to a registered parallel pipeline.

    If the run_id is found in the pipeline registry, returns the worktree's
    .worca/ path as the effective base and the pipeline entry dict.
    Otherwise returns the original base and None.

    When run_id is None (active-run mode), no registry lookup is performed.

    Returns:
        (effective_base, pipeline_entry_or_None)
    """
    if not run_id:
        return base, None
    entry = get_pipeline(run_id, base=base)
    if entry is None:
        return base, None
    worktree_path = entry.get("worktree_path", "")
    return os.path.join(worktree_path, ".worca"), entry


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_pause(run_id: str | None, base: str = _DEFAULT_BASE) -> str:
    """Write a pause control file for the given run.

    When run_id matches a registered parallel pipeline, the control file
    is written to the pipeline's worktree .worca/ directory.

    Returns:
        The resolved run_id.
    """
    effective_base, _entry = _resolve_worktree_base(run_id, base)
    run_id = resolve_run_id(run_id, base=effective_base)
    write_control(run_id, "pause", source="cli", base=effective_base)
    print(f"Pause requested for run: {run_id}")
    return run_id


def cmd_stop(run_id: str | None, base: str = _DEFAULT_BASE) -> str:
    """Write a stop control file and send SIGTERM to the pipeline process.

    When run_id matches a registered parallel pipeline, the control file
    is written to the worktree's .worca/ directory and the PID from the
    registry entry is used for SIGTERM (in addition to any pid file).

    Returns:
        The resolved run_id.
    """
    effective_base, entry = _resolve_worktree_base(run_id, base)
    run_id = resolve_run_id(run_id, base=effective_base)
    write_control(run_id, "stop", source="cli", base=effective_base)

    # Determine PID: prefer registry entry, fall back to pid file
    pid = None
    if entry and entry.get("pid"):
        pid = entry["pid"]
    else:
        pid_file = Path(_pid_path(run_id, effective_base))
        if pid_file.exists():
            pid = int(pid_file.read_text().strip())

    if pid is not None:
        try:
            os.kill(pid, signal.SIGTERM)
            print(f"Sent SIGTERM to PID {pid}")
        except ProcessLookupError:
            pass  # process already gone — that's fine

    print(f"Stop requested for run: {run_id}")
    return run_id


def cmd_resume(run_id: str | None, base: str = _DEFAULT_BASE) -> subprocess.Popen:
    """Spawn run_pipeline.py --resume for the given run.

    Passes --status-dir pointing to the run's directory so the pipeline
    reloads status.json from the correct location.

    When run_id matches a registered parallel pipeline, spawns
    run_pipeline.py with cwd set to the worktree path and adds the
    --worktree flag.

    Returns:
        The Popen process object.
    """
    effective_base, entry = _resolve_worktree_base(run_id, base)
    run_id = resolve_run_id(run_id, base=effective_base)
    run_dir = str(Path(effective_base) / "runs" / run_id)
    script = str(_SCRIPTS_DIR / "run_pipeline.py")

    cmd = [sys.executable, script, "--resume", "--status-dir", run_dir]
    popen_kwargs: dict = {}

    if entry:
        cmd.append("--worktree")
        popen_kwargs["cwd"] = entry["worktree_path"]

    proc = subprocess.Popen(cmd, **popen_kwargs)
    print(f"Resuming run: {run_id} (PID {proc.pid})")
    return proc


def cmd_status(run_id: str | None, base: str = _DEFAULT_BASE) -> dict:
    """Read and print the pipeline status for the given run.

    When run_id matches a registered parallel pipeline, reads
    status.json from the worktree's .worca/ directory.

    Returns:
        The status dict.

    Raises:
        SystemExit(1): If status.json does not exist.
    """
    effective_base, _entry = _resolve_worktree_base(run_id, base)
    run_id = resolve_run_id(run_id, base=effective_base)
    path = _status_path(run_id, effective_base)

    if not Path(path).exists():
        print(f"error: status file not found: {path}", file=sys.stderr)
        raise SystemExit(1)

    status = load_status(path)

    pipeline_status = status.get("pipeline_status", status.get("status", "unknown"))
    stage = status.get("stage", "unknown")
    stages = status.get("stages", {})
    current_stage_data = stages.get(stage, {})
    iteration = current_stage_data.get("iteration", "—")

    print(f"Run:    {run_id}")
    print(f"Status: {pipeline_status}")
    print(f"Stage:  {stage} (iteration {iteration})")

    return status


def cmd_multi_status(base: str = _DEFAULT_BASE) -> list[dict]:
    """Print status of all registered parallel pipelines.

    Reads from the pipeline registry and enriches with status.json data
    from each worktree.
    """
    reconcile_stale(base)
    pipelines = list_pipelines(base)

    if not pipelines:
        print("No parallel pipelines registered.")
        return []

    # Enrich each pipeline with stage from its status.json
    for entry in pipelines:
        run_id = entry.get("run_id", "")
        worktree_path = entry.get("worktree_path", "")
        status_path = os.path.join(
            worktree_path, ".worca", "runs", run_id, "status.json"
        )
        try:
            status = load_status(status_path)
            entry["stage"] = status.get("stage", "—")
        except Exception:
            entry.setdefault("stage", "—")

    # Print table
    header = f"{'RUN_ID':<24} {'STATUS':<12} {'STAGE':<14} {'TITLE':<30} {'WORKTREE'}"
    print(header)
    print("-" * len(header))
    for entry in pipelines:
        run_id = entry.get("run_id", "—")
        status = entry.get("status", "—")
        stage = entry.get("stage", "—")
        title = entry.get("title", "—")
        worktree = entry.get("worktree_path", "—")
        print(f"{run_id:<24} {status:<12} {stage:<14} {title:<30} {worktree}")

    return pipelines


# ---------------------------------------------------------------------------
# Argument parser
# ---------------------------------------------------------------------------


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="worca",
        description="worca pipeline lifecycle commands",
    )
    parser.add_argument(
        "--base",
        default=None,
        help="Base worca directory (default: .worca)",
    )

    sub = parser.add_subparsers(dest="command")

    for name in ("pause", "stop", "resume", "status"):
        sp = sub.add_parser(name, help=f"{name} a pipeline run")
        sp.add_argument("run_id", nargs="?", default=None, help="Run ID (default: active run)")
        sp.add_argument(
            "--base",
            default=None,
            help="Base worca directory (default: .worca)",
        )

    sub.add_parser("multi-status", help="Show status of all parallel pipelines")

    return parser


def main(argv=None):
    parser = create_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help(sys.stderr)
        raise SystemExit(1)

    # Commands that take a run_id argument
    run_id_dispatch = {
        "pause": cmd_pause,
        "stop": cmd_stop,
        "resume": cmd_resume,
        "status": cmd_status,
    }

    # Commands that take no positional arguments
    no_arg_dispatch = {
        "multi-status": cmd_multi_status,
    }

    # Sub-command --base overrides parent --base; fall back to default
    base = getattr(args, "base", None) or _DEFAULT_BASE

    if args.command in run_id_dispatch:
        run_id_dispatch[args.command](args.run_id, base=base)
    elif args.command in no_arg_dispatch:
        no_arg_dispatch[args.command](base=base)
    else:
        print(f"error: unknown command {args.command!r}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
