# /// script
# requires-python = ">=3.8"
# ///
"""Fan out a single work-request to N independent project repositories (W-040).

Accepts N target project paths, one prompt (or --source), an optional
repeatable --guide, an optional --plan, and a --head-template / --base pair,
then launches N isolated pipelines under a shared fleet_id.
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import time

from worca.orchestrator.fleet_manifest import (
    GRAPH_STATUS_DEGRADED,
    GRAPH_STATUS_DISABLED,
    GRAPH_STATUS_READY,
    read_fleet_manifest,
    register_fleet_child,
    update_fleet_status,
)
from worca.state.status import PipelineStatus, FleetStatus
from worca.utils.code_review_graph import detect_code_review_graph, effective_crg_config
from worca.utils.graphify import detect_graphify, effective_graphify_config
from worca.utils.paths import fleet_runs_dir as resolve_fleet_runs_dir
from worca.utils.settings import load_global_settings, load_settings

# Per W-040 §5: the fleet scrub list is fleet-specific. It is NOT the same as
# `worca.utils.env.RESERVED_ENV_KEYS` (which is the denylist for per-model env
# settings in settings.json and includes PATH so users can't silently override
# the shell PATH per stage). For subprocess dispatch we MUST keep PATH so that
# children can find `bd`, `claude`, `gh`, etc., on disk.
_FLEET_SCRUB_KEYS = frozenset({
    "WORCA_AGENT",
    "WORCA_STAGE",
    "WORCA_RUN_ID",
    "WORCA_PROJECT_ROOT",
    "CLAUDECODE",
})
_FLEET_SCRUB_PREFIXES = ("WORCA_",)

# Module-level override slot.  Resolves lazily via
# worca.utils.paths.fleet_runs_dir — None means "use $WORCA_HOME or ~/.worca"
# (issue #162).
_FLEET_RUNS_DEFAULT: str | None = None


_BRANCH_REJECTION_MSG = (
    "--branch is not a valid flag for run_fleet.py. You probably want one of:\n"
    "  --base <name>             PR base branch (= run_worktree.py --branch)\n"
    "  --head-template <tmpl>    Per-child head branch name template\n"
    "See W-040 §4 for the distinction."
)


def validate_base_branch(projects: list, base: str) -> list:
    """Return project paths where *base* branch is absent.

    Uses ``git -C <target> branch --list <base>`` per §4. Empty or
    whitespace-only output means the branch does not exist locally.
    """
    missing = []
    for project in projects:
        result = subprocess.run(
            ["git", "-C", project, "branch", "--list", base],
            capture_output=True,
            text=True,
        )
        if not result.stdout.strip():
            missing.append(project)
    return missing


def check_target_readiness(project_dir: str) -> tuple[bool, str | None]:
    """Verify *project_dir* is worca-ready for fleet dispatch (read-only).

    Replaces the prior ``provision_target`` step which silently ran
    ``worca init --upgrade`` in every target. The fleet runner no longer
    mutates target projects on launch — users must initialise / upgrade
    each project explicitly. This function only checks that:

      1. ``<project_dir>/.claude/worca/__init__.py`` exists
      2. Its ``__version__`` matches the fleet runner's installed
         ``worca`` package version

    Returns ``(True, None)`` when both hold, or ``(False, reason)`` with a
    human-readable explanation that points the user at the fix command.
    """
    # Late import: cli.init is heavy and only needed for pre-flight.
    from pathlib import Path
    from worca.cli.init import read_version

    target = Path(project_dir) / ".claude" / "worca"
    project_version = read_version(target) if target.exists() else None

    try:
        import worca as _worca_pkg
        installed_version = _worca_pkg.__version__
    except (ImportError, AttributeError):
        # No installed worca package — we can't compute the expected version,
        # so the only way to be definitive is to say the host is misconfigured.
        return False, "worca-cc not installed on the fleet host"

    if project_version is None:
        return False, (
            "no .claude/worca/ found — run `worca init` in this project "
            "before launching the fleet"
        )

    if project_version != installed_version:
        return False, (
            f".claude/worca/ is on {project_version}, fleet host has "
            f"{installed_version} — run `worca init --upgrade` in this "
            f"project before launching the fleet"
        )

    return True, None


def detect_child_graphify_status(project_dir: str) -> str:
    """Return per-child graphify readiness: ready|degraded|disabled."""
    try:
        settings_path = os.path.join(project_dir, ".claude", "settings.json")
        settings = load_settings(settings_path)
        global_settings = load_global_settings()
        cfg = effective_graphify_config(global_settings, settings)
    except Exception:
        return GRAPH_STATUS_DISABLED

    if not cfg.enabled:
        return GRAPH_STATUS_DISABLED

    detection = detect_graphify(cfg.version_range)
    if not detection.installed or not detection.compatible:
        return GRAPH_STATUS_DEGRADED

    return GRAPH_STATUS_READY


def detect_child_crg_status(project_dir: str) -> str:
    """Return per-child CRG readiness: ready|degraded|disabled."""
    try:
        settings_path = os.path.join(project_dir, ".claude", "settings.json")
        settings = load_settings(settings_path)
        global_settings = load_global_settings()
        cfg = effective_crg_config(global_settings, settings)
    except Exception:
        return GRAPH_STATUS_DISABLED

    if not cfg.enabled:
        return GRAPH_STATUS_DISABLED

    detection = detect_code_review_graph(
        version_range=cfg.version_range,
        fastmcp_min=cfg.fastmcp_min,
    )
    if not detection.installed or not detection.compatible or not detection.fastmcp_ok:
        return GRAPH_STATUS_DEGRADED

    return GRAPH_STATUS_READY


def build_child_env(base_env: dict, *, fleet_id: str | None = None) -> dict:
    """Return a copy of *base_env* with fleet-internal keys stripped.

    Scrubs the W-040 §5 list: ``WORCA_AGENT``, ``WORCA_STAGE``, ``WORCA_RUN_ID``,
    ``WORCA_PROJECT_ROOT``, ``CLAUDECODE``, plus anything else starting with
    ``WORCA_``. PATH is intentionally inherited so children can find on-disk
    binaries (``bd``, ``claude``, ``gh``, …). The per-model env-settings
    denylist in ``worca.utils.env`` is a different concern and is NOT reused
    here.

    When *fleet_id* is supplied, ``WORCA_FLEET_ID`` is re-injected AFTER the
    scrub so the Guardian agent in the child pipeline can detect fleet
    membership and apply the ``[fleet:<short>]`` PR-title prefix (W-040 §11).
    """
    result = {}
    for key, value in base_env.items():
        if key in _FLEET_SCRUB_KEYS:
            continue
        if any(key.startswith(prefix) for prefix in _FLEET_SCRUB_PREFIXES):
            continue
        result[key] = value

    if fleet_id:
        result["WORCA_FLEET_ID"] = fleet_id

    return result


def build_child_cmd(
    project_dir: str,
    fleet_id: str,
    prompt: str | None = None,
    source: str | None = None,
    spec: str | None = None,
    base: str | None = None,
    guide: list | None = None,
    plan: str | None = None,
    max_beads: int | None = None,
    claude_md_mode: str | None = None,
) -> list:
    """Build the run_worktree.py command for a single fleet child.

    Each child receives --fleet-id and, when --base was supplied, --branch
    (which is the W-048 base branch parameter).
    """
    run_worktree = os.path.join(os.path.dirname(__file__), "run_worktree.py")
    cmd = [sys.executable, run_worktree]

    if source:
        cmd.extend(["--source", source])
    elif spec:
        cmd.extend(["--spec", spec])

    if prompt:
        cmd.extend(["--prompt", prompt])

    cmd.extend(["--fleet-id", fleet_id])

    if base:
        cmd.extend(["--branch", base])

    for g in guide or []:
        cmd.extend(["--guide", g])

    if plan:
        cmd.extend(["--plan", plan])

    if max_beads is not None:
        cmd.extend(["--max-beads", str(max_beads)])

    if claude_md_mode is not None:
        cmd.extend(["--claude-md-mode", claude_md_mode])

    return cmd


def _wait_for_plan(
    worktree_path: str,
    timeout: int = 3600,
    poll_interval: float = 5.0,
) -> str | None:
    """Poll for MASTER_PLAN.md in worktree_path. Returns absolute path or None on timeout."""
    plan_path = os.path.join(worktree_path, "MASTER_PLAN.md")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if os.path.exists(plan_path):
            return plan_path
        time.sleep(poll_interval)
    return None


def run_plan_first(
    *,
    reference_project: str,
    fleet_id: str,
    prompt: str | None,
    source: str | None,
    base: str | None,
    guide: list,
    fleet_runs_base: str | None = None,
    max_beads: int | None = None,
    claude_md_mode: str | None = None,
    spec: str | None = None,
) -> str | None:
    """Run the reference child (blocking) and wait for its Planner to produce a plan.

    Dispatches run_worktree.py for the reference project, then polls for
    MASTER_PLAN.md to appear in the resulting worktree. On success, copies the
    plan to <fleet_runs_base>/<fleet_id>/shared-plan.md and returns that path.
    Returns None if the reference child fails to start or the plan never appears.

    The reference child runs its full pipeline independently; only the plan file
    is extracted early to unblock the remaining N-1 children (§6).
    """
    child_env = build_child_env(os.environ.copy(), fleet_id=fleet_id)
    cmd = build_child_cmd(
        project_dir=reference_project,
        fleet_id=fleet_id,
        prompt=prompt,
        source=source,
        spec=spec,
        base=base,
        guide=guide,
        plan=None,  # reference child generates the plan
        max_beads=max_beads,
        claude_md_mode=claude_md_mode,
    )

    proc = subprocess.run(
        cmd,
        cwd=reference_project,
        env=child_env,
        capture_output=True,
        text=True,
    )

    if proc.returncode != 0:
        print(
            f"plan-first: reference project {reference_project!r} failed "
            f"(exit {proc.returncode})",
            file=sys.stderr,
        )
        return None

    # run_worktree.py prints: <run_id>\n<worktree_path>
    lines = proc.stdout.strip().splitlines()
    if len(lines) < 2:
        print(
            f"plan-first: unexpected output from reference child ({len(lines)} lines)",
            file=sys.stderr,
        )
        return None

    run_id = lines[0].strip()
    worktree_path = lines[1]
    if run_id:
        try:
            register_fleet_child(fleet_id, reference_project, run_id)
        except Exception as exc:
            print(
                f"warning: failed to register plan-first reference child "
                f"{reference_project}/{run_id}: {exc}",
                file=sys.stderr,
            )

    plan_in_worktree = _wait_for_plan(worktree_path)
    if plan_in_worktree is None:
        print(
            f"plan-first: MASTER_PLAN.md not found in {worktree_path!r} "
            "(Planner may have failed or timed out)",
            file=sys.stderr,
        )
        return None

    if fleet_runs_base is None:
        fleet_runs_base = resolve_fleet_runs_dir(_FLEET_RUNS_DEFAULT)
    fleet_dir = os.path.join(fleet_runs_base, fleet_id)
    os.makedirs(fleet_dir, exist_ok=True)
    shared_plan = os.path.join(fleet_dir, "shared-plan.md")
    shutil.copy2(plan_in_worktree, shared_plan)

    return shared_plan


_DISPATCH_POLL_INTERVAL_SECONDS = 0.2


def _parse_run_id_from_stdout(stdout_str: str) -> str | None:
    """Extract the run_id printed by run_worktree.py on its first stdout line.

    run_worktree.py prints two lines on success: `<run_id>\\n<worktree_path>\\n`.
    Returns None if stdout is empty or the first line doesn't look like a
    run_id (defensive — keeps a malformed launcher from corrupting the
    manifest).
    """
    if not stdout_str:
        return None
    first = stdout_str.strip().split("\n", 1)[0].strip()
    # run_ids are timestamp-prefixed (`YYYYMMDD-HHMMSS-NNN-XXXX`). Reject empty
    # or path-looking strings without overspecifying the format.
    if not first or "/" in first or "\\" in first or " " in first:
        return None
    return first


def dispatch_fleet(
    targets: list,
    fleet_id: str,
    prompt: str | None,
    source: str | None,
    base: str | None,
    guide: list,
    plan: str | None,
    max_parallel: int,
    fleet_failure_threshold: float,
    max_beads: int | None = None,
    claude_md_mode: str | None = None,
    spec: str | None = None,
) -> dict:
    """Run fleet children in parallel with a semaphore-gated dispatch loop.

    Up to ``max_parallel`` children run concurrently. Each child is spawned as
    a ``subprocess.Popen`` (non-blocking) and the loop polls for completion
    every ``_DISPATCH_POLL_INTERVAL_SECONDS``. When the failure ratio crosses
    ``fleet_failure_threshold`` (and at least ``min(3, total)`` children have
    completed), the circuit breaker fires: no further children are spawned,
    but already-in-flight children are NEVER killed — they finish naturally
    so the fleet does not leave half-written repos behind (W-040 §7).

    Returns a dict mapping project_dir -> {"status": "completed"|"failed"|"halted"}.
    """
    results = {}
    total = len(targets)
    if total == 0:
        return results

    graph_status_by_project = {t["project_dir"]: t.get("graph_status") for t in targets}
    crg_status_by_project = {t["project_dir"]: t.get("crg_status") for t in targets}
    pending = [t["project_dir"] for t in targets]
    in_flight = {}  # project_dir -> Popen
    failed_count = 0
    halted = False

    def _check_breaker() -> bool:
        """Has the failure threshold been crossed?"""
        terminal_count = len(results)
        min_terminal = min(3, total)
        return (
            terminal_count >= min_terminal
            and failed_count / terminal_count >= fleet_failure_threshold
        )

    while pending or in_flight:
        # Spawn up to max_parallel children. Stops adding new ones once halted.
        while pending and len(in_flight) < max_parallel and not halted:
            project_dir = pending.pop(0)
            child_env = build_child_env(os.environ.copy(), fleet_id=fleet_id)
            cmd = build_child_cmd(
                project_dir=project_dir,
                fleet_id=fleet_id,
                prompt=prompt,
                source=source,
                spec=spec,
                base=base,
                guide=guide,
                plan=plan,
                max_beads=max_beads,
                claude_md_mode=claude_md_mode,
            )
            # Capture stdout so we can read the child's run_id (run_worktree.py
            # prints `<run_id>\n<worktree_path>\n` then exits). Knowing the
            # run_id lets us write a back-reference into the fleet manifest's
            # children array — otherwise the manifest never learns who its
            # dispatched children are.
            in_flight[project_dir] = subprocess.Popen(
                cmd,
                cwd=project_dir,
                env=child_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

        if not in_flight:
            break

        # Poll all in-flight children. Collect any that finished this tick.
        finished = []
        for project_dir, proc in in_flight.items():
            rc = proc.poll()
            if rc is not None:
                finished.append((project_dir, rc))

        if not finished:
            time.sleep(_DISPATCH_POLL_INTERVAL_SECONDS)
            continue

        for project_dir, rc in finished:
            proc = in_flight.pop(project_dir)
            stdout_str, _ = proc.communicate()
            if rc != 0:
                results[project_dir] = {"status": PipelineStatus.FAILED}
                failed_count += 1
                if not halted and _check_breaker():
                    halted = True
                    update_fleet_status(
                        fleet_id, FleetStatus.HALTED, halt_reason="circuit_breaker"
                    )
            else:
                results[project_dir] = {"status": PipelineStatus.COMPLETED}
                run_id = _parse_run_id_from_stdout(stdout_str)
                if run_id:
                    try:
                        register_fleet_child(
                            fleet_id, project_dir, run_id,
                            graph_status=graph_status_by_project.get(project_dir),
                            crg_status=crg_status_by_project.get(project_dir),
                        )
                    except Exception as exc:
                        print(
                            f"warning: failed to register fleet child "
                            f"{project_dir}/{run_id}: {exc}",
                            file=sys.stderr,
                        )

    # After the loop, any children still in `pending` were never launched.
    for project_dir in pending:
        results[project_dir] = {"status": FleetStatus.HALTED}

    return results


def resume_fleet(fleet_id: str) -> int:
    """Resume a halted/stopped/paused/failed fleet.

    Reads the fleet manifest, resolves each child's current status from its
    project's pipelines.d/ entry, and resumes it by one of two paths:

      - in place: ``paused`` and ``interrupted`` children still own a worktree
        with all of their progress, so they are continued via
        ``fleet_lifecycle.resume_child`` (run_pipeline.py --resume).
      - re-dispatch: ``failed``, ``pending`` and ``setup_failed`` children are
        re-launched fresh through ``dispatch_fleet`` (a new worktree).

    Children with status completed, running, resuming, or unrecoverable are
    left alone. When a failed child's worktree_path no longer exists on disk,
    the child is marked 'unrecoverable' in its pipelines.d/ entry and skipped.

    Returns 0 on success, 1 if the manifest is not found.
    """
    from worca.orchestrator.fleet_lifecycle import resume_child

    manifest = read_fleet_manifest(fleet_id)
    if manifest is None:
        print(f"error: fleet manifest not found: {fleet_id!r}", file=sys.stderr)
        return 1

    children = manifest.get("children", [])
    prompt = manifest.get("work_request", {}).get("description") or ""
    source = manifest.get("work_request", {}).get("source")
    spec = manifest.get("work_request", {}).get("spec")
    base = manifest.get("base_branch")
    guide = manifest.get("guide", {}).get("paths") or []
    plan = manifest.get("plan", {}).get("path")
    max_parallel = manifest.get("max_parallel", 5)
    threshold = manifest.get("fleet_failure_threshold", 0.30)
    claude_md_mode = manifest.get("claude_md_mode")

    _SKIP_STATUSES = frozenset({
        PipelineStatus.COMPLETED, PipelineStatus.RUNNING,
        PipelineStatus.RESUMING, PipelineStatus.UNRECOVERABLE,
    })
    _REDISPATCH = frozenset({
        PipelineStatus.FAILED, PipelineStatus.PENDING, PipelineStatus.SETUP_FAILED,
    })
    _IN_PLACE = frozenset({PipelineStatus.PAUSED, PipelineStatus.INTERRUPTED})

    targets = []  # re-dispatched fresh via dispatch_fleet
    inplace = []  # (project_path, run_id) continued via resume_child
    for child in children:
        project_path = child.get("project_path")
        run_id = child.get("run_id")

        if not project_path:
            continue

        child_base = os.path.join(project_path, ".worca")
        entry = None

        if run_id:
            entry_path = os.path.join(
                child_base, "multi", "pipelines.d", f"{run_id}.json"
            )
            try:
                with open(entry_path, encoding="utf-8") as f:
                    entry = json.load(f)
            except (OSError, json.JSONDecodeError):
                entry = None

        if entry is None:
            # No registry entry — treat as pending (never successfully dispatched)
            targets.append({"project_dir": project_path, "status": PipelineStatus.PENDING})
            continue

        status = entry.get("status", PipelineStatus.RUNNING)

        if status in _SKIP_STATUSES:
            continue

        # For failed status only: check whether the worktree still exists.
        # setup_failed never created a worktree, so no existence check there.
        # If a failed child's worktree was cleaned up, mark it unrecoverable.
        if status == PipelineStatus.FAILED:
            worktree_path = entry.get("worktree_path")
            if worktree_path and not os.path.exists(worktree_path):
                print(
                    f"skipping run {run_id} — worktree gone (cleaned up)",
                    file=sys.stderr,
                )
                from worca.orchestrator.registry import update_pipeline
                update_pipeline(run_id, status=PipelineStatus.UNRECOVERABLE, base=child_base)
                continue

        if status in _IN_PLACE:
            inplace.append((project_path, run_id))
        elif status in _REDISPATCH:
            targets.append({"project_dir": project_path, "status": status})

    if not targets and not inplace:
        # Nothing qualified to resume — leave the manifest at its prior
        # terminal status (halted/completed/failed). Writing `resuming` here
        # would strand the fleet, because reconcile_fleet_status is barred
        # from advancing `resuming` → terminal.
        return 0

    # We have work to do — flip the manifest to `resuming` now. Reconciliation
    # will advance it to `running` once a child registry entry reports running.
    update_fleet_status(fleet_id, FleetStatus.RESUMING)

    # Resume paused/interrupted children in their existing worktrees first —
    # cheap (one Popen each) and they keep all prior progress.
    for project_path, run_id in inplace:
        try:
            resume_child(project_path, run_id)
        except Exception as exc:
            print(
                f"warning: failed to resume child {project_path}/{run_id}: {exc}",
                file=sys.stderr,
            )

    if targets:
        dispatch_fleet(
            targets=targets,
            fleet_id=fleet_id,
            prompt=prompt,
            source=source,
            base=base,
            guide=guide,
            plan=plan,
            max_parallel=max_parallel,
            fleet_failure_threshold=threshold,
            claude_md_mode=claude_md_mode,
            spec=spec,
        )

    return 0


class _RejectBranch(argparse.Action):
    """Custom action that immediately errors when --branch is supplied."""

    def __call__(self, parser, namespace, values, option_string=None):
        parser.error(_BRANCH_REJECTION_MSG)


def create_parser() -> argparse.ArgumentParser:
    """Build the argument parser for run_fleet."""
    parser = argparse.ArgumentParser(
        description="Fan out a single work-request to N project repositories",
    )

    # --branch is explicitly rejected per §4 to avoid flag-meaning collision
    # with run_worktree.py where --branch means PR base branch.
    parser.add_argument(
        "--branch",
        action=_RejectBranch,
        nargs="?",
        default=argparse.SUPPRESS,
        help=argparse.SUPPRESS,
    )

    # Target project paths
    parser.add_argument(
        "--projects",
        nargs="+",
        metavar="PATH",
        help="Absolute paths to target project repositories (repeatable)",
    )
    parser.add_argument(
        "--projects-file",
        metavar="FILE",
        help="Path to a file listing project paths (one per line)",
    )

    # Work request source
    parser.add_argument("--prompt", help="Text prompt for work request")
    parser.add_argument(
        "--source", help="Source reference (gh:issue:42, bd:bd-abc)"
    )
    parser.add_argument("--spec", help="Path to spec file")

    # Branch naming (§4 — two separate concepts)
    parser.add_argument(
        "--head-template",
        metavar="TEMPLATE",
        help=(
            "Per-child head branch name template. "
            "Placeholders: {project}, {fleet_id}, {slug}, {yyyymmdd}, {yyyymmddhhmm}. "
            "If no placeholder present, '/{project}' is appended automatically."
        ),
    )
    parser.add_argument(
        "--base",
        metavar="BRANCH",
        help=(
            "PR base branch shared across the fleet "
            "(= run_worktree.py --branch / W-048 target_branch). "
            "Omit to use each repo's default branch."
        ),
    )

    # Guide
    parser.add_argument(
        "--guide",
        action="append",
        metavar="PATH",
        help="Path to a reference guide (repeatable); resolved to absolute paths before dispatch",
    )

    # Plan modes (§6)
    parser.add_argument(
        "--plan",
        metavar="PATH",
        help="Shared plan file; every child receives it and skips the PLAN stage",
    )
    parser.add_argument(
        "--plan-first",
        nargs="?",
        const=True,
        default=False,
        metavar="PROJECT",
        help=(
            "Run the Planner on a reference project, then share its plan with all "
            "remaining children. Optional value: path to the reference project "
            "(defaults to first entry in --projects)."
        ),
    )

    # Concurrency / circuit breaker (§7)
    parser.add_argument(
        "--max-parallel",
        type=int,
        default=5,
        metavar="N",
        help="Maximum number of children dispatched in parallel (default: 5)",
    )
    parser.add_argument(
        "--fleet-failure-threshold",
        type=float,
        default=0.30,
        metavar="RATIO",
        help=(
            "Fraction of failed children that trips the circuit breaker and "
            "halts unstarted children (default: 0.30)"
        ),
    )

    # Resumability (§12)
    parser.add_argument(
        "--resume",
        metavar="FLEET_ID",
        help="Resume a halted/stopped/paused/failed fleet: continue paused/interrupted "
        "children in place, re-dispatch failed/pending children",
    )

    # Fleet lifecycle actions — fan a control file out to every in-flight child
    parser.add_argument(
        "--pause",
        metavar="FLEET_ID",
        help="Pause a running fleet: write a pause control file to every in-flight child",
    )
    parser.add_argument(
        "--stop",
        metavar="FLEET_ID",
        help="Stop a running fleet: write a stop control file + SIGTERM every in-flight child",
    )

    # Pre-generated fleet id (used by the worca-ui POST /api/fleet-runs route
    # so the manifest path is known before dispatch). When provided, manifest
    # creation uses this id verbatim — no random generation.
    parser.add_argument(
        "--fleet-id",
        metavar="ID",
        help="Use this pre-generated fleet id instead of generating one (UI integration)",
    )
    parser.add_argument(
        "--max-beads",
        type=int,
        default=None,
        metavar="N",
        help="Override coordinator decomposition cap for every child (0 = auto)",
    )
    parser.add_argument(
        "--claude-md-mode",
        default=None,
        choices=["none", "project", "project+local", "all"],
        help="CLAUDE.md load mode override propagated to every child (none/project/project+local/all)",
    )

    return parser


def main(argv=None) -> int:
    """Entry point. Returns exit code."""
    parser = create_parser()
    args = parser.parse_args(argv)

    # --resume / --pause / --stop are lifecycle actions on an existing fleet
    # and are mutually exclusive with each other and with a launch.
    _lifecycle_actions = [
        a for a in (args.resume, args.pause, args.stop) if a
    ]
    if len(_lifecycle_actions) > 1:
        print(
            "error: --resume, --pause and --stop are mutually exclusive",
            file=sys.stderr,
        )
        return 2

    # Require a work request source unless acting on an existing fleet
    if not _lifecycle_actions and not any([args.prompt, args.source, args.spec]):
        print(
            "error: one of --prompt, --source, --spec, --resume, --pause or --stop is required",
            file=sys.stderr,
        )
        return 2

    if args.source and args.spec:
        print("error: --source and --spec are mutually exclusive", file=sys.stderr)
        return 2

    # --plan and --plan-first are mutually exclusive (§6)
    if args.plan and args.plan_first:
        print("error: --plan and --plan-first are mutually exclusive", file=sys.stderr)
        return 2

    # Handle --pause / --stop: fan a control file out to every in-flight child
    if args.pause:
        from worca.orchestrator.fleet_lifecycle import pause_fleet

        count = pause_fleet(args.pause)
        if count is None:
            print(f"error: fleet manifest not found: {args.pause!r}", file=sys.stderr)
            return 1
        print(f"paused {count} in-flight child{'' if count == 1 else 'ren'}")
        return 0

    if args.stop:
        from worca.orchestrator.fleet_lifecycle import stop_fleet

        count = stop_fleet(args.stop)
        if count is None:
            print(f"error: fleet manifest not found: {args.stop!r}", file=sys.stderr)
            return 1
        print(f"stopped {count} in-flight child{'' if count == 1 else 'ren'}")
        return 0

    # Handle --resume: continue/re-launch children of an existing fleet
    if args.resume:
        return resume_fleet(args.resume)

    # Resolve target projects from --projects and/or --projects-file.
    # Both flags compose; --projects-file lines starting with '#' are comments.
    projects = list(args.projects or [])
    if args.projects_file:
        try:
            with open(args.projects_file, encoding="utf-8") as f:
                file_projects = [
                    line.strip()
                    for line in f
                    if line.strip() and not line.strip().startswith("#")
                ]
        except OSError as exc:
            print(
                f"error: failed to read --projects-file {args.projects_file!r}: {exc}",
                file=sys.stderr,
            )
            return 1
        projects.extend(file_projects)
    projects = list(dict.fromkeys(projects))  # dedupe, preserve order

    if not projects:
        print(
            "error: no target projects — supply --projects PATH... or "
            "--projects-file FILE",
            file=sys.stderr,
        )
        return 2

    # Base branch pre-flight: verify branch exists in every target repo (§4)
    if args.base:
        missing = validate_base_branch(projects, args.base)
        if missing:
            missing_list = "\n".join(f"  {p}" for p in missing)
            print(
                f"error: base branch '{args.base}' not found in:\n{missing_list}",
                file=sys.stderr,
            )
            return 1

    # Per-target readiness check (§2, post-W-040): the fleet must NOT mutate
    # target projects. We verify every selected project has a `.claude/worca/`
    # that matches the fleet host's installed worca version, and abort the
    # whole fleet if any target is unready. Users run `worca init` /
    # `worca init --upgrade` manually before launching.
    if projects:
        unready: list[tuple[str, str]] = []
        for project in projects:
            ready, reason = check_target_readiness(project)
            if not ready:
                unready.append((project, reason))

        if unready:
            print(
                "error: fleet aborted — some targets are not worca-ready:",
                file=sys.stderr,
            )
            for project, reason in unready:
                print(f"  {project}: {reason}", file=sys.stderr)

            # If the UI pre-wrote a manifest (because it owns the fleet_id),
            # mark it halted so the dashboard surfaces a clear failure state
            # rather than a stuck-on-running record. CLI launches with no
            # prior manifest just exit non-zero.
            if args.fleet_id:
                update_fleet_status(
                    args.fleet_id,
                    FleetStatus.HALTED,
                    halt_reason="targets_not_ready",
                )
            return 1
    setup_failed: list[str] = []

    # Write initial fleet manifest (§10)
    if projects and not args.resume:
        from worca.orchestrator.fleet_manifest import generate_fleet_id, write_fleet_manifest
        from datetime import datetime, timezone

        if args.fleet_id:
            # UI-integration path: caller supplied the id so the manifest
            # filename is known before dispatch. Derive fleet_id_short from
            # the trailing hex segment (matches generate_fleet_id() format
            # f_<yyyymmddhhmm>_<rand>).
            fleet_id = args.fleet_id
            fleet_id_short = fleet_id.rsplit("_", 1)[-1]
        else:
            fleet_id, fleet_id_short = generate_fleet_id()
        guide_paths = [os.path.abspath(g) for g in (args.guide or [])]
        guide_bytes = sum(
            os.path.getsize(p) for p in guide_paths if os.path.isfile(p)
        )
        plan_mode = "none"
        if args.plan:
            plan_mode = "explicit"
        elif args.plan_first:
            plan_mode = "plan-first"

        manifest = {
            "fleet_id": fleet_id,
            "fleet_id_short": fleet_id_short,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "work_request": {
                "title": "",
                "description": args.prompt or "",
                "source": args.source,
                "spec": args.spec,
            },
            "guide": {
                "paths": guide_paths,
                "bytes": guide_bytes,
                "filenames": [os.path.basename(p) for p in guide_paths],
                "uploaded": False,
            },
            "plan": {
                "mode": plan_mode,
                "path": os.path.abspath(args.plan) if args.plan else None,
            },
            "head_template": args.head_template,
            "base_branch": args.base,
            "max_parallel": args.max_parallel,
            "fleet_failure_threshold": args.fleet_failure_threshold,
            "claude_md_mode": args.claude_md_mode,
            "status": FleetStatus.RUNNING,
            "halt_reason": None,
            "children": [],
        }
        write_fleet_manifest(manifest)

    # --plan-first: dispatch reference child (blocking), wait for plan, then fan-out
    # §6: reference child runs Planner first; plan copied to fleet dir; N-1 others
    # launch with that plan. Fleet halts before fan-out if reference Planner fails.
    _plan_first_ref = None
    shared_plan = None
    if projects and not args.resume and args.plan_first:
        provisioned_tmp = [p for p in projects if p not in setup_failed]
        _plan_first_ref = (
            args.plan_first
            if isinstance(args.plan_first, str)
            else (provisioned_tmp[0] if provisioned_tmp else None)
        )
        if _plan_first_ref is not None:
            guide_abs_ref = [os.path.abspath(g) for g in (args.guide or [])]
            shared_plan = run_plan_first(
                reference_project=_plan_first_ref,
                fleet_id=fleet_id,
                prompt=args.prompt,
                source=args.source,
                spec=args.spec,
                base=args.base,
                guide=guide_abs_ref,
                max_beads=args.max_beads,
                claude_md_mode=args.claude_md_mode,
            )
            if shared_plan is None:
                print(
                    "plan-first: reference Planner failed — halting fleet before fan-out",
                    file=sys.stderr,
                )
                update_fleet_status(fleet_id, FleetStatus.HALTED, halt_reason="plan_first_failed")
                return 1

    # Dispatch fleet children — skip setup_failed targets
    if projects and not args.resume:
        provisioned = [p for p in projects if p not in setup_failed]
        guide_abs = [os.path.abspath(g) for g in (args.guide or [])]

        graphify_statuses = {p: detect_child_graphify_status(p) for p in provisioned}
        crg_statuses = {p: detect_child_crg_status(p) for p in provisioned}

        if _plan_first_ref is not None:
            # Reference already ran — dispatch remaining N-1 children with shared plan
            remaining = [p for p in provisioned if p != _plan_first_ref]
            dispatch_targets = [
                {"project_dir": p, "status": PipelineStatus.PENDING, "graph_status": graphify_statuses.get(p), "crg_status": crg_statuses.get(p)}
                for p in remaining
            ]
            dispatch_plan = shared_plan
        else:
            dispatch_targets = [
                {"project_dir": p, "status": PipelineStatus.PENDING, "graph_status": graphify_statuses.get(p), "crg_status": crg_statuses.get(p)}
                for p in provisioned
            ]
            dispatch_plan = os.path.abspath(args.plan) if args.plan else None

        dispatch_fleet(
            targets=dispatch_targets,
            fleet_id=fleet_id,
            prompt=args.prompt,
            source=args.source,
            base=args.base,
            guide=guide_abs,
            plan=dispatch_plan,
            max_parallel=args.max_parallel,
            fleet_failure_threshold=args.fleet_failure_threshold,
            max_beads=args.max_beads,
            claude_md_mode=args.claude_md_mode,
            spec=args.spec,
        )

        # Fire fleet.launched once dispatch returns — children may still be
        # spinning up worktrees, but the manifest is populated and the fleet
        # is "in flight" from the subscriber's perspective. Best-effort
        # emission: never raises, never blocks the return.
        _emit_fleet_launched(
            fleet_id=fleet_id,
            projects=provisioned,
            plan_mode=plan_mode,
            plan_path=os.path.abspath(args.plan) if args.plan else None,
            guide_attached=bool(args.guide),
            head_template=args.head_template,
            base_branch=args.base,
            max_parallel=args.max_parallel,
            failure_threshold=args.fleet_failure_threshold,
        )

    return 0


def _emit_fleet_launched(
    *,
    fleet_id: str,
    projects: list,
    plan_mode: str,
    plan_path: str | None,
    guide_attached: bool,
    head_template: str | None,
    base_branch: str | None,
    max_parallel: int,
    failure_threshold: float,
) -> None:
    """Fire fleet.launched. Best-effort — never raises, never blocks."""
    try:
        from worca.events.fleet_emitter import emit_fleet_event
        from worca.events.types import FLEET_LAUNCHED, fleet_launched_payload

        # Settings come from the first project's root — every fleet child
        # shares its parent's hook/webhook config.
        settings_path = ".claude/settings.json"
        if projects:
            settings_path = os.path.join(
                projects[0], ".claude", "settings.json"
            )
        emit_fleet_event(
            fleet_id,
            FLEET_LAUNCHED,
            fleet_launched_payload(
                projects=list(projects),
                head_template=head_template,
                base_branch=base_branch,
                plan_mode=plan_mode,
                plan_path=plan_path,
                guide_attached=guide_attached,
                max_parallel=max_parallel,
                failure_threshold=failure_threshold,
                child_count=len(projects),
            ),
            settings_path=settings_path,
        )
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main())
