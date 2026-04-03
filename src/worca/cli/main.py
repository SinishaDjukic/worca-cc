"""worca CLI — global entry point for worca commands.

Subcommands:
  init       [--upgrade] [--force] [--check] [--source PATH]
  run        --prompt "..." [--plan ...] [--msize N] [--mloops N] [--resume]
  pause      [run_id]
  stop       [run_id]
  resume     [run_id]
  status     [run_id]
  multi-status
  --version

The `worca run` command is a thin launcher: it finds the git root,
verifies .claude/worca/ exists, injects the project's .claude/ into
sys.path, and delegates to the project copy's run_pipeline.main().
"""

import argparse
import subprocess
import sys
from pathlib import Path

import worca


def _find_git_root() -> Path:
    """Walk up from cwd to find the git root directory."""
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".git").exists():
            return parent
    print("error: not inside a git repository", file=sys.stderr)
    raise SystemExit(1)


def _require_project_worca(git_root: Path) -> Path:
    """Verify .claude/worca/ exists in the project. Returns the path."""
    worca_dir = git_root / ".claude" / "worca"
    if not worca_dir.is_dir():
        print(
            "error: .claude/worca/ not found. Run 'worca init' first.",
            file=sys.stderr,
        )
        raise SystemExit(1)
    return worca_dir


def _inject_project_path(git_root: Path) -> None:
    """Insert the project's .claude/ into sys.path so imports resolve to the project copy."""
    claude_dir = str(git_root / ".claude")
    if claude_dir not in sys.path:
        sys.path.insert(0, claude_dir)


def cmd_version(_args: argparse.Namespace) -> None:
    """Print the installed worca-cc version."""
    print(f"worca-cc {worca.__version__}")


def cmd_init(args: argparse.Namespace) -> None:
    """Run worca init to scaffold or upgrade a project."""
    from worca.cli.init import run_init
    run_init(
        upgrade=args.upgrade,
        force=args.force,
        check=args.check,
        source=args.source,
    )


def cmd_run(args: argparse.Namespace) -> None:
    """Thin launcher that delegates to the project copy's run_pipeline."""
    git_root = _find_git_root()
    _require_project_worca(git_root)
    _inject_project_path(git_root)

    # Build the command to run the project's run_pipeline.py
    script = str(git_root / ".claude" / "worca" / "scripts" / "run_pipeline.py")
    cmd = [sys.executable, script]

    if args.prompt:
        cmd.extend(["--prompt", args.prompt])
    if args.plan:
        cmd.extend(["--plan", args.plan])
    if args.spec:
        cmd.extend(["--spec", args.spec])
    if args.msize:
        cmd.extend(["--msize", str(args.msize)])
    if args.mloops:
        cmd.extend(["--mloops", str(args.mloops)])
    if args.resume:
        cmd.append("--resume")
    if args.source_arg:
        cmd.extend(["--source", args.source_arg])

    result = subprocess.run(cmd, cwd=str(git_root))
    raise SystemExit(result.returncode)


def cmd_lifecycle(args: argparse.Namespace) -> None:
    """Delegate pause/stop/resume/status/multi-status to the project copy's worca_lifecycle."""
    git_root = _find_git_root()
    _require_project_worca(git_root)
    _inject_project_path(git_root)

    # Import from the project copy
    from worca.scripts.worca_lifecycle import main as worca_main
    # Re-invoke with the subcommand and its args
    argv = [args.lifecycle_command]
    if hasattr(args, "run_id") and args.run_id:
        argv.append(args.run_id)
    if hasattr(args, "base") and args.base:
        argv.extend(["--base", args.base])
    worca_main(argv)


def create_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="worca",
        description="worca-cc: autonomous software development pipeline",
    )
    parser.add_argument(
        "--version", action="store_true", help="Print version and exit"
    )

    sub = parser.add_subparsers(dest="command")

    # init
    init_parser = sub.add_parser("init", help="Initialize or upgrade worca in a project")
    init_parser.add_argument("--upgrade", action="store_true", help="Upgrade existing installation")
    init_parser.add_argument("--force", action="store_true", help="Force overwrite everything")
    init_parser.add_argument("--check", action="store_true", help="Show what would change")
    init_parser.add_argument("--source", default=None, help="Path to local worca-cc repo")

    # run
    run_parser = sub.add_parser("run", help="Run the pipeline")
    run_parser.add_argument("--prompt", default=None, help="Pipeline prompt")
    run_parser.add_argument("--plan", default=None, help="Path to plan file")
    run_parser.add_argument("--spec", default=None, help="Path to spec file")
    run_parser.add_argument("--msize", type=int, default=None, help="Turn multiplier (1-10)")
    run_parser.add_argument("--mloops", type=int, default=None, help="Loop multiplier (1-10)")
    run_parser.add_argument("--resume", action="store_true", help="Resume from last checkpoint")
    run_parser.add_argument("--source", dest="source_arg", default=None, help="Work source")

    # lifecycle commands: pause, stop, resume, status
    for name in ("pause", "stop", "resume", "status"):
        sp = sub.add_parser(name, help=f"{name.title()} a pipeline run")
        sp.add_argument("run_id", nargs="?", default=None, help="Run ID (default: active run)")
        sp.add_argument("--base", default=None, help="Base .worca directory")

    # multi-status
    sub.add_parser("multi-status", help="Show status of all parallel pipelines")

    return parser


def main(argv=None):
    parser = create_parser()
    args = parser.parse_args(argv)

    if args.version:
        cmd_version(args)
        return

    if not args.command:
        parser.print_help(sys.stderr)
        raise SystemExit(1)

    if args.command == "init":
        cmd_init(args)
    elif args.command == "run":
        cmd_run(args)
    elif args.command in ("pause", "stop", "resume", "status"):
        args.lifecycle_command = args.command
        cmd_lifecycle(args)
    elif args.command == "multi-status":
        args.lifecycle_command = "multi-status"
        cmd_lifecycle(args)
    else:
        print(f"error: unknown command {args.command!r}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
