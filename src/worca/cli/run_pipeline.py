"""worca run — thin launcher that delegates to the project copy's run_pipeline."""

import subprocess
import sys
from argparse import Namespace

from worca.cli.main import (
    _find_git_root,
    _inject_project_path,
    _require_project_worca,
    _warn_version_mismatch,
)


def cmd_run(args: Namespace) -> None:
    """Thin launcher that delegates to the project copy's run_pipeline."""
    git_root = _find_git_root()
    project_worca_dir = _require_project_worca(git_root)
    _warn_version_mismatch(project_worca_dir)
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
    if args.template:
        cmd.extend(["--template", args.template])
    for p in args.param or []:
        cmd.extend(["--param", p])

    result = subprocess.run(cmd, cwd=str(git_root))
    raise SystemExit(result.returncode)
