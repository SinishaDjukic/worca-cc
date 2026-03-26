"""worca CLI — lifecycle commands for pipeline runs.

Commands:
  pause  [run_id]  Write control.json with action:pause
  stop   [run_id]  Write control.json with action:stop + SIGTERM to PID
  resume [run_id]  Spawn run_pipeline.py --resume
  status [run_id]  Print pipeline state/stage/iteration

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


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def cmd_pause(run_id: str | None, base: str = _DEFAULT_BASE) -> str:
    """Write a pause control file for the given run.

    Returns:
        The resolved run_id.
    """
    run_id = resolve_run_id(run_id, base=base)
    write_control(run_id, "pause", source="cli", base=base)
    print(f"Pause requested for run: {run_id}")
    return run_id


def cmd_stop(run_id: str | None, base: str = _DEFAULT_BASE) -> str:
    """Write a stop control file and send SIGTERM to the pipeline process.

    If a pid file exists at .worca/runs/{run_id}/pid, sends SIGTERM to that
    process. Silently ignores ProcessLookupError (process already gone).

    Returns:
        The resolved run_id.
    """
    run_id = resolve_run_id(run_id, base=base)
    write_control(run_id, "stop", source="cli", base=base)

    pid_file = Path(_pid_path(run_id, base))
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
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

    Returns:
        The Popen process object.
    """
    run_id = resolve_run_id(run_id, base=base)
    run_dir = str(Path(base) / "runs" / run_id)
    script = str(_SCRIPTS_DIR / "run_pipeline.py")

    cmd = [sys.executable, script, "--resume", "--status-dir", run_dir]
    proc = subprocess.Popen(cmd)
    print(f"Resuming run: {run_id} (PID {proc.pid})")
    return proc


def cmd_status(run_id: str | None, base: str = _DEFAULT_BASE) -> dict:
    """Read and print the pipeline status for the given run.

    Returns:
        The status dict.

    Raises:
        SystemExit(1): If status.json does not exist.
    """
    run_id = resolve_run_id(run_id, base=base)
    path = _status_path(run_id, base)

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
        default=_DEFAULT_BASE,
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

    return parser


def main(argv=None):
    parser = create_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help(sys.stderr)
        raise SystemExit(1)

    dispatch = {
        "pause": cmd_pause,
        "stop": cmd_stop,
        "resume": cmd_resume,
        "status": cmd_status,
    }

    fn = dispatch.get(args.command)
    if fn is None:
        print(f"error: unknown command {args.command!r}", file=sys.stderr)
        raise SystemExit(1)

    # Sub-command --base overrides parent --base; fall back to default
    base = getattr(args, "base", None) or _DEFAULT_BASE
    fn(args.run_id, base=base)


if __name__ == "__main__":
    main()
