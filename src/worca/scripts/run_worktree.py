# /// script
# requires-python = ">=3.8"
# ///
"""Launch a single work request in an isolated git worktree pipeline.

Creates a git worktree, copies the worca runtime into it, registers in the
multi-pipeline registry, and spawns run_pipeline.py --worktree as a detached
subprocess. Exits immediately (fire-and-forget).

Usage:
    python .claude/worca/scripts/run_worktree.py \
        --prompt "Add user auth" \
        --branch feature/auth \
        --plan path/to/plan.md \
        --fleet-id f_20260426_abc
"""
import argparse
import os
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from worca.orchestrator.registry import register_pipeline, update_pipeline
from worca.orchestrator.work_request import normalize

from worca.utils.branch_naming import slugify as _slugify
from worca.utils.git import (
    branch_exists,
    checkout_pr_worktree,
    create_pipeline_worktree,
    detect_default_branch,
    find_worktree_for_branch,
    init_worktree_beads,
)
from worca.utils.runtime import copy_claude_config, validate_runtime
from worca.utils.settings import load_settings


def _worktree_pipeline_is_live(worktree_path: str) -> bool:
    """True if a registered pipeline at `worktree_path` is still running.

    Reuse of an existing PR-head worktree is only safe when no pipeline is
    actively writing to it. Scans the multi-pipeline registry for a RUNNING
    entry pointing at this worktree whose PID is still alive.
    """
    from worca.orchestrator.registry import list_pipelines
    from worca.state.status import PipelineStatus
    from worca.utils.proc import pid_is_alive

    target = os.path.abspath(worktree_path)
    for entry in list_pipelines():
        if entry.get("status") != PipelineStatus.RUNNING:
            continue
        path = entry.get("worktree_path")
        if not path or os.path.abspath(path) != target:
            continue
        pid = entry.get("pid")
        if pid is None:
            continue
        try:
            if pid_is_alive(pid):
                return True
        except PermissionError:
            # Process exists but owned by another user — treat as live.
            return True
    return False


def _resolve_base_branch(args, settings: dict) -> str:
    """Pick the base branch for the new worktree.

    Priority:
    1. `--branch` on the CLI (caller knows best; passed straight to git).
    2. `worca.parallel.default_base_branch` from settings, but only if the
       ref actually resolves in this repo. A misconfigured value (e.g. the
       shipped default of "main" in a "master" repo) emits a warning and
       falls through to detection.
    3. `detect_default_branch()` — `origin/HEAD` then current branch then
       the literal `HEAD`.
    """
    if args.branch:
        return args.branch
    configured = (
        settings.get("worca", {}).get("parallel", {}).get("default_base_branch")
    )
    if configured:
        if branch_exists(configured):
            return configured
        print(
            f"warning: configured worca.parallel.default_base_branch "
            f"'{configured}' does not exist in this repo; auto-detecting",
            file=sys.stderr,
        )
    return detect_default_branch()


def _spawn_log_tail(path: str, max_lines: int = 20) -> str:
    """Return the last `max_lines` of the spawn log, for the error message."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            lines = fh.read().splitlines()
        return "\n".join(lines[-max_lines:])
    except OSError:
        return ""


# How long to watch a freshly-spawned run_pipeline.py for a startup crash.
# A healthy pipeline writes its status.json well within this window.
_STARTUP_WAIT_SECONDS = 3.0


def _await_pipeline_startup(proc, run_id: str, status_json: str) -> bool:
    """Watch a freshly-spawned run_pipeline.py for a startup crash.

    Returns True if the pipeline looks healthy (it wrote its status.json,
    or it's still running after the grace window — a slow-but-alive
    start). Returns False if the process exited *before* creating
    status.json — i.e. it crashed on startup (unknown args, import
    error, missing runtime).

    Extracted as a seam so unit tests can stub it without spinning the
    real wait loop.
    """
    deadline = time.monotonic() + _STARTUP_WAIT_SECONDS
    while time.monotonic() < deadline:
        if os.path.exists(status_json):
            return True  # pipeline started cleanly
        if proc.poll() is not None:
            return False  # exited before writing status.json — startup crash
        time.sleep(0.2)
    # Still running after the grace window with no status.json yet — treat
    # as a slow-but-alive start rather than a failure.
    return True


def _generate_run_id() -> str:
    """Generate a unique run ID in YYYYMMDD-HHMMSS-mmm-xxxxxxxx format.

    The random suffix is 4 bytes (8 hex chars). A 2-byte suffix only has
    16 bits of entropy, so back-to-back calls within the same millisecond
    collided at a ~0.07% rate over 10 IDs — enough to flake CI. 4 bytes
    matches the fleet_id generator and makes a same-ms collision
    negligible. RUN_ID_RE is length-agnostic, so widening the suffix is
    safe for every downstream consumer.
    """
    now = datetime.now(timezone.utc)
    millis = now.microsecond // 1000
    suffix = secrets.token_hex(4)
    return f"{now.strftime('%Y%m%d-%H%M%S')}-{millis:03d}-{suffix}"


def _resolve_pipeline_script() -> str:
    """Return the absolute path to run_pipeline.py from the shared pkg store.

    Falls back to the legacy project-local path if pkg_dir() is unavailable.
    Separated from _build_pipeline_cmd so callers that have already resolved
    validate_runtime can pass the path directly without re-computing.
    """
    try:
        from worca.utils.paths import pkg_dir as _pkg_dir  # noqa: PLC0415
        return os.path.join(_pkg_dir(), "worca", "scripts", "run_pipeline.py")
    except Exception:
        return os.path.join(".claude", "worca", "scripts", "run_pipeline.py")


def _build_pipeline_cmd(args: argparse.Namespace, run_id: str = "",
                        pipeline_script: str | None = None) -> list:
    """Build the run_pipeline.py argv to spawn inside the worktree.

    Pure function over parsed args — no filesystem or env side effects — so
    tests can assert the exact argv shape without mocking Popen.

    When run_id is given (called from main()), it is forwarded as --run-id
    so the runner uses the same key as the multi-pipeline registry entry
    written by register_pipeline(). When empty, --run-id is omitted and the
    runner falls back to generating one (legacy in-place callers).

    ``pipeline_script`` is the path to run_pipeline.py; when None, resolved
    via ``_resolve_pipeline_script()`` (shared pkg store, with fallback).
    """
    script = pipeline_script or _resolve_pipeline_script()
    cmd = [
        sys.executable,
        script,
        "--worktree",
        "--registry-base",
        os.path.abspath(".worca"),
    ]
    if run_id:
        cmd.extend(["--run-id", run_id])

    if args.source:
        cmd.extend(["--source", args.source])
    elif args.spec:
        cmd.extend(["--spec", args.spec])

    if args.prompt:
        cmd.extend(["--prompt", args.prompt])

    if args.plan:
        cmd.extend(["--plan", args.plan])

    if args.guide:
        for guide_path in args.guide:
            cmd.extend(["--guide", os.path.abspath(guide_path)])

    if args.branch:
        cmd.extend(["--branch", args.branch])

    if args.msize != 1:
        cmd.extend(["--msize", str(args.msize)])

    if args.mloops != 1:
        cmd.extend(["--mloops", str(args.mloops)])

    if args.template:
        cmd.extend(["--template", args.template])

    if args.param:
        for p in args.param:
            cmd.extend(["--param", p])

    if args.skip_preflight:
        cmd.append("--skip-preflight")

    if args.max_beads is not None:
        cmd.extend(["--max-beads", str(args.max_beads)])

    if args.claude_md_mode is not None:
        cmd.extend(["--claude-md-mode", args.claude_md_mode])

    return cmd


def create_parser() -> argparse.ArgumentParser:
    """Build the argument parser for run_worktree."""
    parser = argparse.ArgumentParser(
        description="Launch a single worca-cc pipeline in an isolated git worktree"
    )
    parser.add_argument("--prompt", help="Text prompt for work request")
    parser.add_argument("--source", help="Source reference (gh:issue:42, bd:bd-abc)")
    parser.add_argument("--spec", help="Path to spec file")

    parser.add_argument(
        "--branch",
        help="Base branch to fork the worktree from (default: HEAD); stored as target_branch",
    )
    parser.add_argument("--plan", help="Path to pre-made plan file (skips PLAN stage)")
    parser.add_argument(
        "--guide",
        action="append",
        metavar="PATH",
        help="Path to a reference guide (repeatable); resolved to absolute path",
    )
    parser.add_argument("--fleet-id", help="Fleet group ID (from run_fleet.py)")
    parser.add_argument("--workspace-id", help="Workspace group ID (from run_workspace.py)")
    parser.add_argument(
        "--msize",
        type=int,
        default=1,
        choices=range(1, 11),
        metavar="[1-10]",
        help="Task size multiplier for max_turns (default: 1)",
    )
    parser.add_argument(
        "--mloops",
        type=int,
        default=1,
        choices=range(1, 11),
        metavar="[1-10]",
        help="Loop multiplier for max iterations (default: 1)",
    )
    parser.add_argument("--template", help="Template ID to apply before running")
    parser.add_argument(
        "--param",
        action="append",
        metavar="KEY=VALUE",
        help="Template parameter override (repeatable)",
    )
    parser.add_argument(
        "--skip-preflight",
        action="store_true",
        help="Skip the PREFLIGHT stage",
    )
    parser.add_argument(
        "--max-beads",
        type=int,
        default=None,
        help="Cap on the number of beads the coordinator may create (0 = auto, None = use config)",
    )
    parser.add_argument(
        "--claude-md-mode",
        default=None,
        choices=["none", "project", "project+local", "all"],
        help="CLAUDE.md load mode override (none/project/project+local/all)",
    )
    parser.add_argument(
        "--settings",
        default=".claude/settings.json",
        help="Path to settings.json",
    )
    return parser


def main(argv=None) -> int:
    """Entry point. Returns exit code (0 = launched, 1 = worktree failed, 2 = bad args)."""
    parser = create_parser()
    args = parser.parse_args(argv)

    if not any([args.prompt, args.source, args.spec]):
        print("error: one of --prompt, --source, or --spec is required", file=sys.stderr)
        return 2

    if args.source and args.spec:
        print("error: --source and --spec are mutually exclusive", file=sys.stderr)
        return 2

    if args.plan and not os.path.isfile(args.plan):
        print(f"error: plan file not found: {args.plan}", file=sys.stderr)
        return 2

    # Normalize work request to get a title for the slug and registry entry
    try:
        if args.source:
            plan_template = load_settings(args.settings).get("worca", {}).get(
                "plan_path_template"
            )
            wr = normalize("source", args.source, plan_path_template=plan_template)
        elif args.spec:
            wr = normalize("spec", args.spec)
        else:
            wr = normalize("prompt", args.prompt)
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # Reject --branch for github_pr source: the head branch is fixed by the PR
    # (L2 — drift creates duplicate PRs). Precedent: fleet rejects --branch too.
    if wr.source_type == "github_pr" and args.branch:
        print(
            "error: --branch is not allowed when sourcing from a GitHub PR; "
            "the target branch is taken from the PR's base branch",
            file=sys.stderr,
        )
        return 2

    # Validate the worca runtime exists before any side effects (worktree create,
    # registry write, Popen). Without it the spawned run_pipeline.py crashes
    # under stdout=DEVNULL — UI shows "started" then nothing.
    validate_runtime()

    # Steps 1-2: generate run_id and derive slug
    run_id = _generate_run_id()
    slug = _slugify(wr.title)

    # Step 3: create git worktree at the configured base dir
    _settings = load_settings(args.settings)
    _parallel = _settings.get("worca", {}).get("parallel", {})
    _wt_base = _parallel.get("worktree_base_dir", ".worktrees")

    if wr.source_type == "github_pr":
        # A git branch can only be checked out in one worktree at a time. The
        # worca run that originally opened the PR leaves the PR head branch
        # checked out in its (frequently still-on-disk) worktree, so a fresh
        # `gh pr checkout` of the same branch fails with "already used by
        # worktree at …". When such a worktree already exists, reuse it —
        # unless a pipeline is still live there (reusing would corrupt it).
        existing = find_worktree_for_branch(wr.pr_head_branch)
        if existing:
            if _worktree_pipeline_is_live(existing):
                print(
                    f"error: PR head branch '{wr.pr_head_branch}' is checked out "
                    f"in a worktree with a running pipeline ({existing}); "
                    "stop that run before launching a revision.",
                    file=sys.stderr,
                )
                return 1
            print(
                f"reusing existing worktree for PR #{wr.pr_number} head branch "
                f"'{wr.pr_head_branch}': {existing}",
                file=sys.stderr,
            )
            worktree_path = existing
        else:
            # No existing checkout — create a fresh worktree and check out the
            # PR head via 'gh pr checkout' (handles cross-repo/fork PRs).
            worktree_path = checkout_pr_worktree(
                run_id,
                wr.pr_number,
                wr.pr_head_branch,
                pr_is_cross_repo=wr.pr_is_cross_repo,
                base_dir=_wt_base,
            )
        worktree_branch = wr.pr_head_branch  # L2: preserve head branch name verbatim
        target_branch = wr.pr_base_branch
    else:
        base_branch = _resolve_base_branch(args, _settings)
        worktree_path = create_pipeline_worktree(run_id, slug, base_branch, _wt_base)
        worktree_branch = f"worca/{slug}-{run_id}"
        target_branch = args.branch

    if not worktree_path:
        print(f"error: failed to create worktree for run {run_id}", file=sys.stderr)
        return 1

    # Step 4: copy .claude/ into the worktree (settings.json, agents/, hooks/,
    # scripts/, skills/, templates/, worca/, etc.). Most projects gitignore
    # .claude/, so the worktree starts empty; without this copy preflight
    # fails on missing settings.json. Files git already placed in the
    # worktree are preserved.
    copy_claude_config(".claude", os.path.join(worktree_path, ".claude"))

    # Step 5: init beads in worktree
    init_worktree_beads(worktree_path)

    # Step 6: register in pipelines.d/. The branch is the worktree's own
    # branch; storing it lets the Worktrees view show it without reaching into
    # the worktree's status.json.
    register_pipeline(
        run_id=run_id,
        worktree_path=worktree_path,
        title=wr.title,
        pid=os.getpid(),
        branch=worktree_branch,
        fleet_id=args.fleet_id,
        workspace_id=args.workspace_id,
        group_type="fleet" if args.fleet_id else "workspace" if args.workspace_id else None,
        target_branch=target_branch,
        revises_pr=wr.pr_number if wr.source_type == "github_pr" else None,
    )

    # Step 7: build and spawn run_pipeline.py --worktree (detached, fire-and-forget)
    # Resolve the pipeline script path here (after validate_runtime has confirmed the
    # runtime exists) so _build_pipeline_cmd stays a pure function over parsed args.
    pipeline_script = _resolve_pipeline_script()
    cmd = _build_pipeline_cmd(args, run_id=run_id, pipeline_script=pipeline_script)

    env = os.environ.copy()
    env.pop("CLAUDECODE", None)

    # Capture the child's stdout+stderr to a spawn log inside the worktree.
    # A run_pipeline.py that crashes on startup (unknown args, import error,
    # missing runtime) used to vanish under DEVNULL — leaving a stale
    # "running" registry entry the UI later mislabels "interrupted (stale_pid)".
    worca_dir = os.path.join(worktree_path, ".worca")
    os.makedirs(worca_dir, exist_ok=True)
    spawn_log = os.path.join(worca_dir, "spawn.log")
    with open(spawn_log, "wb") as _log_fh:
        proc = subprocess.Popen(
            cmd,
            cwd=worktree_path,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=_log_fh,
            stderr=subprocess.STDOUT,
            # Windows: silently ignored — detach not guaranteed (use WSL2).
            start_new_session=True,
        )

    # Brief liveness check: if run_pipeline.py exits before writing its own
    # status.json it crashed on startup — mark the registry entry
    # setup_failed (a terminal failure state the fleet + UI understand) so
    # it surfaces as a real failure with spawn.log as the diagnostic,
    # instead of a stale "running" entry the reconciler ghost-interrupts.
    status_json = os.path.join(worca_dir, "runs", run_id, "status.json")
    if not _await_pipeline_startup(proc, run_id, status_json):
        update_pipeline(run_id, status="setup_failed")
        tail = _spawn_log_tail(spawn_log)
        print(
            f"error: run_pipeline.py exited before startup "
            f"(run {run_id}) — see {spawn_log}",
            file=sys.stderr,
        )
        if tail:
            print(tail, file=sys.stderr)
        return 1

    # Step 8: print run_id + path and exit immediately
    print(run_id)
    print(worktree_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
