"""worca run — thin launcher that delegates to the project copy's run_pipeline.

By default, dispatches to ``run_pipeline.py`` (in-place — modifies the current
branch's working tree). With ``--worktree``, dispatches to ``run_worktree.py``
instead so the run lands in an isolated git worktree (parallel-safe; mirrors
the UI's default behaviour). If ``run_worktree.py`` is missing in the project
runtime, the launcher falls back to ``run_pipeline.py`` with a warning — same
fallback the UI uses (worca-ui/server/process-manager.js:438-451).
"""

import subprocess
import sys
from argparse import Namespace
from pathlib import Path

from worca.cli.main import (
    _find_git_root,
    _inject_project_path,
    _require_project_worca,
    _warn_version_mismatch,
)


def _validate_worktree_args(args: Namespace) -> None:
    """Validate flag combinations before spawning anything.

    `--branch` is forwarded to run_worktree.py only and silently no-ops
    against run_pipeline.py — surface the misuse as a clear error rather than
    letting the in-place runner ignore it. `--guide` is supported on both
    paths, so it is not gated here. `--resume` must run inside the original
    tree, so combining it with `--worktree` is also nonsensical.

    On `--resume`, `--guide` is restored from the persisted work request and a
    freshly-passed `--guide` is ignored — warn rather than silently dropping it.
    """
    if args.worktree and args.resume:
        print("error: --worktree cannot be combined with --resume "
              "(resume must run in the original working tree)", file=sys.stderr)
        raise SystemExit(2)
    if not args.worktree:
        if args.branch:
            print("error: --branch requires --worktree", file=sys.stderr)
            raise SystemExit(2)
    if args.resume and args.guide:
        print("warning: --guide is ignored with --resume "
              "(the guide is restored from the original run)", file=sys.stderr)


def cmd_run(args: Namespace) -> None:
    """Thin launcher that delegates to the project copy's run_pipeline / run_worktree."""
    _validate_worktree_args(args)

    git_root = _find_git_root()
    project_worca_dir = _require_project_worca(git_root)
    _warn_version_mismatch(project_worca_dir)
    _inject_project_path(git_root)

    scripts_dir = project_worca_dir / "scripts"
    pipeline_script = scripts_dir / "run_pipeline.py"
    worktree_script = scripts_dir / "run_worktree.py"

    use_worktree = args.worktree
    if use_worktree and not worktree_script.exists():
        print(
            f"warning: {worktree_script} not found; falling back to in-place run_pipeline.py",
            file=sys.stderr,
        )
        use_worktree = False

    script: Path = worktree_script if use_worktree else pipeline_script
    cmd = [sys.executable, str(script)]

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
    if args.force_template_change:
        cmd.append("--force-template-change")
    for p in args.param or []:
        cmd.extend(["--param", p])

    for g in args.guide or []:
        cmd.extend(["--guide", g])
    if use_worktree:
        if args.branch:
            cmd.extend(["--branch", args.branch])

    result = subprocess.run(cmd, cwd=str(git_root))
    raise SystemExit(result.returncode)
