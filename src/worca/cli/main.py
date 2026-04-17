"""worca CLI — global entry point for worca commands.

Subcommands:
  init              [--upgrade] [--force] [--check] [--source PATH]
  run               --prompt "..." [--plan ...] [--msize N] [--mloops N] [--resume]
  pause             [run_id]
  stop              [run_id]
  resume            [run_id]
  status            [run_id]
  multi-status
  integrations status
  --version

The `worca run` command is a thin launcher: it finds the git root,
verifies .claude/worca/ exists, injects the project's .claude/ into
sys.path, and delegates to the project copy's run_pipeline.main().
"""

import argparse
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


def _parse_version_tuple(version_str: str) -> tuple[int, ...]:
    """Extract numeric parts from a version string, ignoring pre-release suffixes.

    '0.6.0rc3' -> (0, 6, 0), '1.2.3' -> (1, 2, 3)
    """
    import re

    parts = []
    for segment in version_str.split("."):
        m = re.match(r"(\d+)", segment)
        if m:
            parts.append(int(m.group(1)))
    return tuple(parts)


def _warn_version_mismatch(project_worca_dir: Path) -> None:
    """Print a warning if the project's worca copy is older than the installed CLI."""
    try:
        from worca.cli.init import read_version

        project_version = read_version(project_worca_dir)
        if not project_version:
            return  # can't read — skip silently
        installed = worca.__version__
        if project_version == installed:
            return
        proj_tuple = _parse_version_tuple(project_version)
        inst_tuple = _parse_version_tuple(installed)
        if proj_tuple < inst_tuple:
            print(
                f"warning: project worca ({project_version}) is older than "
                f"installed ({installed}) — run 'worca init --upgrade'",
                file=sys.stderr,
            )
    except Exception:
        pass  # any error — never block


def cmd_integrations_status(_args: argparse.Namespace) -> None:
    """Probe the UI server's /api/integrations/status and print a summary table."""
    import json
    import os
    import urllib.error
    import urllib.request

    base_url = os.environ.get("WORCA_UI_URL", "http://127.0.0.1:3400")
    url = f"{base_url.rstrip('/')}/api/integrations/status"

    try:
        with urllib.request.urlopen(url, timeout=5) as resp:
            data = json.loads(resp.read())
    except urllib.error.URLError as exc:
        print(f"error: could not reach UI server at {base_url} — {exc.reason}", file=sys.stderr)
        raise SystemExit(1)

    enabled = data.get("enabled", False)
    strict = data.get("strict_inbox_verification", False)
    secrets = data.get("secrets_configured", 0)
    adapters = data.get("adapters", [])
    chats = data.get("chats", [])

    print(f"Integrations enabled : {enabled}")
    print(f"Strict inbox verify  : {strict}")
    print(f"Secrets configured   : {secrets}")

    if adapters:
        print()
        print(f"{'Adapter':<12} {'Enabled':<8} {'Connected':<10} {'Dropped':<8} {'Bad Sig':<8} {'Last Event'}")
        print("-" * 66)
        for a in adapters:
            name = a.get("name", "?")
            ena = str(a.get("enabled", False))
            conn = str(a.get("connected", "—"))
            dropped = str(a.get("dropped_messages", "—"))
            bad_sig = str(a.get("invalid_signature_events", "—"))
            last = a.get("last_event_at") or "—"
            print(f"{name:<12} {ena:<8} {conn:<10} {dropped:<8} {bad_sig:<8} {last}")

    if chats:
        print()
        print(f"{'Platform':<10} {'Chat ID':<14} {'Active Project':<16} {'Muted Until':<14} {'Muted Msgs'}")
        print("-" * 68)
        for c in chats:
            platform = c.get("platform", "?")
            chat_id = c.get("chat_id", "?")
            project = c.get("active_project") or "—"
            muted = c.get("muted_until") or "—"
            muted_msgs = str(c.get("muted_messages", 0))
            print(f"{platform:<10} {chat_id:<14} {project:<16} {muted:<14} {muted_msgs}")


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
    run_parser.add_argument("--template", default=None, help="Template ID to apply before running")
    run_parser.add_argument("--param", action="append", metavar="KEY=VALUE", help="Template parameter override (repeatable)")

    # lifecycle commands: pause, stop, resume, status
    for name in ("pause", "stop", "resume", "status"):
        sp = sub.add_parser(name, help=f"{name.title()} a pipeline run")
        sp.add_argument("run_id", nargs="?", default=None, help="Run ID (default: active run)")
        sp.add_argument("--base", default=None, help="Base .worca directory")

    # multi-status
    sub.add_parser("multi-status", help="Show status of all parallel pipelines")

    # integrations
    integ_parser = sub.add_parser("integrations", help="Chat integration commands")
    integ_sub = integ_parser.add_subparsers(dest="integrations_command")
    integ_sub.add_parser("status", help="Show integrations health from the UI server")

    # templates
    from worca.cli.templates import register_subcommand as register_templates
    register_templates(sub)

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
        from worca.cli.run_pipeline import cmd_run
        cmd_run(args)
    elif args.command in ("pause", "stop", "resume", "status"):
        from worca.cli.control import cmd_lifecycle
        args.lifecycle_command = args.command
        cmd_lifecycle(args)
    elif args.command == "multi-status":
        from worca.cli.control import cmd_lifecycle
        args.lifecycle_command = "multi-status"
        cmd_lifecycle(args)
    elif args.command == "integrations":
        if args.integrations_command == "status":
            cmd_integrations_status(args)
        else:
            print("error: specify a subcommand, e.g. 'worca integrations status'", file=sys.stderr)
            raise SystemExit(1)
    elif args.command == "templates":
        from worca.cli.templates import cmd_templates
        cmd_templates(args)
    else:
        print(f"error: unknown command {args.command!r}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
