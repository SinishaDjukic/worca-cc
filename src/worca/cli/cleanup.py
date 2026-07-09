"""worca cleanup — remove completed pipeline worktrees.

Usage:
  worca cleanup                    # Interactive: list worktrees, prompt
  worca cleanup --all              # Remove all completed/failed worktrees
  worca cleanup --run-id <id>      # Remove a specific worktree by run ID
  worca cleanup --dry-run          # List what would be removed
  worca cleanup --older-than 7d    # Remove worktrees started more than 7 days ago

Running worktrees are never eligible for cleanup.

Extensibility: CLEANUP_SOURCES is a list of source objects. Each source
implements list_eligible(filters) and remove(entry). W-040 (FleetSource) and
W-047 (WorkspaceSource) are stubs — add them to CLEANUP_SOURCES when ready.
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timedelta, timezone

from worca.cli.main import _find_git_root
from worca.orchestrator.registry import deregister_pipeline, get_pipeline, list_pipelines
from worca.state.status import PipelineStatus, PIPELINE_ACTIVE
from worca.utils.git import remove_pipeline_worktree


_TERMINAL_STATUSES = frozenset({PipelineStatus.COMPLETED, PipelineStatus.FAILED})


def _parse_duration(value: str) -> timedelta:
    """Parse a duration string (7d, 24h, 30m) into a timedelta."""
    import re

    m = re.match(r"^(\d+)([dhm])$", value)
    if not m:
        raise argparse.ArgumentTypeError(
            f"Invalid duration {value!r}. Use format: 7d, 24h, 30m"
        )
    amount, unit = int(m.group(1)), m.group(2)
    if unit == "d":
        return timedelta(days=amount)
    if unit == "h":
        return timedelta(hours=amount)
    return timedelta(minutes=amount)


def _format_bytes(n: int) -> str:
    """Return a human-readable byte count string."""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _dir_size(path: str) -> int:
    """Return total size of all files under path in bytes.

    Tries `du -sb` first (matches worca-ui/server/worktrees-routes.js so both
    surfaces report the same number for the same worktree); falls back to a
    Python walk on Windows or when du is unavailable.
    """
    try:
        import subprocess
        out = subprocess.check_output(
            ["du", "-sb", path],
            stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return int(out.split(b"\t", 1)[0])
    except (OSError, ValueError, subprocess.SubprocessError):
        pass

    total = 0
    for dirpath, _, filenames in os.walk(path):
        for fname in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fname))
            except OSError:
                pass
    return total


def _read_worktree_status(worktree_path: str) -> str | None:
    """Read pipeline_status from the worktree's status.json files.

    Scans <worktree>/.worca/runs/*/status.json (W-048 layout) and falls back
    to the legacy flat <worktree>/.worca/status.json. Returns None if unreadable.
    """
    runs_dir = os.path.join(worktree_path, ".worca", "runs")
    if os.path.isdir(runs_dir):
        for entry in os.listdir(runs_dir):
            status_path = os.path.join(runs_dir, entry, "status.json")
            if os.path.isfile(status_path):
                try:
                    with open(status_path, encoding="utf-8") as f:
                        data = json.load(f)
                    status = data.get("pipeline_status")
                    if status:
                        return status
                except (json.JSONDecodeError, OSError):
                    pass

    flat = os.path.join(worktree_path, ".worca", "status.json")
    if os.path.isfile(flat):
        try:
            with open(flat, encoding="utf-8") as f:
                data = json.load(f)
            return data.get("pipeline_status")
        except (json.JSONDecodeError, OSError):
            pass

    return None


class WorktreeSource:
    """Cleanup source for pipelines registered in pipelines.d/ with a worktree_path."""

    def __init__(self, base: str = ".worca"):
        self.base = base

    def list_eligible(self, filters: dict) -> list[dict]:
        """Return registry entries eligible for cleanup under the given filters.

        Filters keys (all optional):
          run_id      — only include this specific run
          fleet_id    — when set without run_id, returns [] — fleet child
                        worktrees are owned by FleetSource.remove and must
                        not be enumerated here, otherwise `cleanup --fleet-id`
                        from inside an unrelated project root would offer to
                        delete every completed worktree in that project's
                        registry. Symmetric to FleetSource's guard against
                        the inverse (run_id without fleet_id).
          older_than  — timedelta; only include entries started before now - delta
        """
        if ("fleet_id" in filters or "workspace_id" in filters) and "run_id" not in filters:
            return []

        eligible = []
        for reg in list_pipelines(base=self.base):
            worktree_path = reg.get("worktree_path")
            if not worktree_path:
                continue

            run_id = reg.get("run_id", "")

            if "run_id" in filters and filters["run_id"] != run_id:
                continue

            if not os.path.isdir(worktree_path):
                continue

            # Cross-reference actual pipeline_status from the worktree's status.json.
            # The outer registry entry stays "running" permanently (run_id mismatch),
            # so we read status.json for the ground truth. Fall back to registry status
            # when no status.json exists yet (pipeline hasn't started).
            pipeline_status = _read_worktree_status(worktree_path)
            if pipeline_status is None:
                pipeline_status = reg.get("status")

            if pipeline_status not in _TERMINAL_STATUSES:
                continue

            if "older_than" in filters and filters["older_than"] is not None:
                started_at = reg.get("started_at")
                if started_at:
                    started = datetime.fromisoformat(started_at)
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    cutoff = datetime.now(timezone.utc) - filters["older_than"]
                    if started >= cutoff:
                        continue

            eligible.append(
                {
                    "run_id": run_id,
                    "worktree_path": worktree_path,
                    "title": reg.get("title", ""),
                    "pipeline_status": pipeline_status,
                    "started_at": reg.get("started_at"),
                }
            )

        return eligible

    def remove(self, entry: dict) -> bool:
        """Remove the worktree from disk and deregister from the registry.

        Returns True on success. Returns False if git worktree removal fails,
        in which case the registry entry is left intact.
        """
        run_id = entry["run_id"]
        worktree_path = entry["worktree_path"]

        if os.path.isdir(worktree_path):
            if not remove_pipeline_worktree(worktree_path):
                return False

        deregister_pipeline(run_id, base=self.base)
        return True


_FLEET_RUNNING_STATUSES = PIPELINE_ACTIVE


class FleetSource:
    """Cleanup source for fleet manifests and their child worktrees (W-040)."""

    def __init__(self, fleet_runs_dir: str = None):
        if fleet_runs_dir is None:
            from worca.orchestrator.fleet_manifest import _FLEET_RUNS_DIR
            from worca.utils.paths import fleet_runs_dir as resolve_fleet_runs_dir
            fleet_runs_dir = resolve_fleet_runs_dir(_FLEET_RUNS_DIR)
        self.fleet_runs_dir = fleet_runs_dir

    def list_eligible(self, filters: dict) -> list[dict]:
        """Return fleet manifest entries eligible for cleanup.

        Enumerates fleet_runs_dir/*.json and returns one entry per manifest.
        Skips running/paused/resuming fleets.

        Filter keys (all optional):
          fleet_id   — only include this specific fleet
          older_than — timedelta; only include fleets started before now - delta

        When run_id is present in filters but fleet_id is not, returns [] so that
        --run-id targeted worktree cleanup does not inadvertently trigger fleet removal.
        """
        if "run_id" in filters and "fleet_id" not in filters:
            return []

        if not os.path.isdir(self.fleet_runs_dir):
            return []

        eligible = []
        for fname in sorted(os.listdir(self.fleet_runs_dir)):
            if not fname.endswith(".json"):
                continue
            fleet_id = fname[:-5]

            if "fleet_id" in filters and filters["fleet_id"] != fleet_id:
                continue

            manifest_path = os.path.join(self.fleet_runs_dir, fname)
            try:
                with open(manifest_path, encoding="utf-8") as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            if manifest.get("status") in _FLEET_RUNNING_STATUSES:
                continue

            if "older_than" in filters and filters["older_than"] is not None:
                # Fleet manifests carry `created_at` (set at manifest write).
                # `started_at` is read first for forward-compatibility if the
                # field is later added; without the fallback the age guard
                # would be a no-op and --older-than would delete every fleet.
                started_at = (
                    manifest.get("started_at")
                    or manifest.get("created_at")
                )
                if started_at:
                    started = datetime.fromisoformat(started_at)
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    cutoff = datetime.now(timezone.utc) - filters["older_than"]
                    if started >= cutoff:
                        continue

            fleet_dir = os.path.join(self.fleet_runs_dir, fleet_id)
            eligible.append({
                "fleet_id": fleet_id,
                "run_id": fleet_id,
                "title": manifest.get("title", fleet_id),
                "worktree_path": fleet_dir,
                "manifest_path": manifest_path,
                "children": manifest.get("children", []),
            })

        return eligible

    def remove(self, entry: dict) -> bool:
        """Remove fleet: child worktrees, pipelines.d/ entries, fleet-runs dir + manifest.

        Returns True if all steps succeeded. Returns False if any child worktree
        removal fails (manifest and guides dir are still removed on partial failure).
        """
        fleet_id = entry["fleet_id"]
        children = entry.get("children", [])
        all_ok = True

        for child in children:
            project_path = child.get("project_path")
            run_id = child.get("run_id")
            if not project_path or not run_id:
                continue

            child_base = os.path.join(project_path, ".worca")
            reg = get_pipeline(run_id, base=child_base)
            if reg:
                child_source = WorktreeSource(base=child_base)
                child_entry = {
                    "run_id": run_id,
                    "worktree_path": reg.get("worktree_path", ""),
                }
                if not child_source.remove(child_entry):
                    all_ok = False
            else:
                deregister_pipeline(run_id, base=child_base)

        fleet_dir = os.path.join(self.fleet_runs_dir, fleet_id)
        if os.path.isdir(fleet_dir):
            try:
                shutil.rmtree(fleet_dir)
            except OSError:
                all_ok = False

        manifest_path = entry.get("manifest_path") or os.path.join(
            self.fleet_runs_dir, f"{fleet_id}.json"
        )
        if os.path.isfile(manifest_path):
            try:
                os.unlink(manifest_path)
            except OSError:
                all_ok = False

        return all_ok


_WORKSPACE_RUNNING_STATUSES = frozenset({
    "planning", "running", "paused", "halted", "resuming",
    "integration_testing", "blocked",
})


class WorkspaceSource:
    """Cleanup source for workspace runs and their child worktrees (W-047)."""

    def __init__(self, pointer_dir: str = None):
        if pointer_dir is None:
            pointer_dir = os.path.expanduser("~/.worca/workspace-runs")
        self.pointer_dir = pointer_dir

    def list_eligible(self, filters: dict) -> list[dict]:
        """Return workspace entries eligible for cleanup.

        Enumerates pointer files at pointer_dir/*.json and follows them to
        the workspace manifest. Skips active workspaces.

        Filter keys (all optional):
          workspace_id — only include this specific workspace
          older_than   — timedelta; only include workspaces created before now - delta

        Guard: when run_id or fleet_id is present without workspace_id,
        returns [] to prevent cross-source interference.
        """
        if ("run_id" in filters or "fleet_id" in filters) and "workspace_id" not in filters:
            return []

        if not os.path.isdir(self.pointer_dir):
            return []

        eligible = []
        for fname in sorted(os.listdir(self.pointer_dir)):
            if not fname.endswith(".json"):
                continue

            workspace_id = fname[:-5]
            if "workspace_id" in filters and filters["workspace_id"] != workspace_id:
                continue

            pointer_path = os.path.join(self.pointer_dir, fname)
            try:
                with open(pointer_path, encoding="utf-8") as f:
                    pointer = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            workspace_root = pointer.get("workspace_root")
            if not workspace_root:
                continue

            manifest_path = os.path.join(
                workspace_root, ".worca", "workspace-runs", workspace_id,
                "workspace-manifest.json",
            )
            try:
                with open(manifest_path, encoding="utf-8") as f:
                    manifest = json.load(f)
            except (json.JSONDecodeError, OSError):
                continue

            status = manifest.get("status", "")
            if status in _WORKSPACE_RUNNING_STATUSES:
                continue

            if "older_than" in filters and filters["older_than"] is not None:
                created_at = (
                    manifest.get("started_at") or manifest.get("created_at")
                )
                if created_at:
                    started = datetime.fromisoformat(created_at)
                    if started.tzinfo is None:
                        started = started.replace(tzinfo=timezone.utc)
                    cutoff = datetime.now(timezone.utc) - filters["older_than"]
                    if started >= cutoff:
                        continue

            run_dir = os.path.join(
                workspace_root, ".worca", "workspace-runs", workspace_id,
            )

            eligible.append({
                "workspace_id": workspace_id,
                "run_id": workspace_id,
                "title": manifest.get("workspace_name", workspace_id),
                "workspace_root": workspace_root,
                "worktree_path": run_dir,
                "run_dir": run_dir,
                "pointer_path": pointer_path,
                "children": manifest.get("children", []),
            })

        return eligible

    def remove(self, entry: dict) -> bool:
        """Remove workspace: child worktrees, pipelines.d/ entries, integration-env,
        workspace run directory, and pointer file.

        Returns True if all steps succeeded. Returns False if any child worktree
        removal fails (remaining artifacts are still cleaned up).
        """
        workspace_root = entry["workspace_root"]
        children = entry.get("children", [])
        all_ok = True

        for child in children:
            project_path = child.get("project_path")
            run_id = child.get("run_id")
            if not project_path or not run_id:
                continue

            child_base = os.path.join(project_path, ".worca")
            reg = get_pipeline(run_id, base=child_base)
            if reg:
                child_source = WorktreeSource(base=child_base)
                child_entry = {
                    "run_id": run_id,
                    "worktree_path": reg.get("worktree_path", ""),
                }
                if not child_source.remove(child_entry):
                    all_ok = False
            else:
                deregister_pipeline(run_id, base=child_base)

        integration_env_dir = os.path.join(workspace_root, ".worca", "integration-env")
        if os.path.isdir(integration_env_dir):
            try:
                shutil.rmtree(integration_env_dir)
            except OSError:
                all_ok = False

        run_dir = entry.get("run_dir")
        if run_dir and os.path.isdir(run_dir):
            try:
                shutil.rmtree(run_dir)
            except OSError:
                all_ok = False

        pointer_path = entry.get("pointer_path")
        if pointer_path and os.path.isfile(pointer_path):
            try:
                os.unlink(pointer_path)
            except OSError:
                all_ok = False

        return all_ok


def _build_sources(base: str) -> list:
    return [WorktreeSource(base=base), FleetSource(), WorkspaceSource()]


def cmd_cleanup(args: argparse.Namespace) -> None:
    """Handle the `worca cleanup` subcommand."""
    if getattr(args, "gc", False):
        cmd_gc(args)
        return

    git_root = _find_git_root()
    base = str(git_root / ".worca")

    filters: dict = {}
    if getattr(args, "run_id", None):
        filters["run_id"] = args.run_id
    if getattr(args, "fleet_id", None):
        filters["fleet_id"] = args.fleet_id
    if getattr(args, "workspace_id", None):
        filters["workspace_id"] = args.workspace_id
    if getattr(args, "older_than", None) is not None:
        filters["older_than"] = args.older_than

    sources = _build_sources(base)

    eligible: list[tuple] = []
    for source in sources:
        for entry in source.list_eligible(filters):
            eligible.append((source, entry))

    if not eligible:
        print("No eligible worktrees to clean up.")
        return

    if args.dry_run:
        print(f"Would remove {len(eligible)} worktree(s):")
        for _, entry in eligible:
            size = _dir_size(entry["worktree_path"]) if os.path.isdir(entry["worktree_path"]) else 0
            print(f"  {entry['run_id']}  {entry['title']}  ({_format_bytes(size)})")
        return

    proceed = args.all or bool(getattr(args, "run_id", None)) or bool(getattr(args, "fleet_id", None)) or bool(getattr(args, "workspace_id", None))
    if not proceed:
        print(f"Found {len(eligible)} eligible worktree(s):")
        for _, entry in eligible:
            size = _dir_size(entry["worktree_path"]) if os.path.isdir(entry["worktree_path"]) else 0
            print(f"  {entry['run_id']}  {entry['title']}  ({_format_bytes(size)})")
        answer = input("Remove all? [y/N] ").strip().lower()
        if answer not in ("y", "yes"):
            print("Aborted.")
            return

    removed = 0
    errors = 0
    total_freed = 0
    for source, entry in eligible:
        worktree_path = entry["worktree_path"]
        size = _dir_size(worktree_path) if os.path.isdir(worktree_path) else 0
        if source.remove(entry):
            total_freed += size
            removed += 1
        else:
            print(
                f"  warning: failed to remove {entry['run_id']} ({worktree_path})",
                file=sys.stderr,
            )
            errors += 1

    print(f"Removed {removed} worktree(s), freed {_format_bytes(total_freed)}.")
    if errors:
        print(f"  {errors} removal error(s) — see warnings above.", file=sys.stderr)


def cmd_gc(args: argparse.Namespace) -> None:
    """Handle the `worca cleanup --gc` subcommand."""
    from worca.utils.pkg_store import gc_pkg_store  # noqa: PLC0415

    dry_run = getattr(args, "dry_run", False)
    keep_latest = getattr(args, "keep_latest", 0) or 0

    result = gc_pkg_store(dry_run=dry_run, keep_latest=keep_latest)

    if dry_run:
        orphans = result["would_remove"]
        if not orphans:
            print("No orphan pkg versions found.")
        else:
            print(f"Would remove {len(orphans)} orphan pkg version(s):")
            for ver in orphans:
                print(f"  {ver}")
        skipped = result["skipped_live"]
        if skipped:
            print(f"Would skip {len(skipped)} version(s) referenced by running pipelines:")
            for ver in skipped:
                print(f"  {ver} (live)")
    else:
        removed = result["removed"]
        skipped = result["skipped_live"]
        if removed:
            print(f"Removed {len(removed)} orphan pkg version(s):")
            for ver in removed:
                print(f"  {ver}")
        else:
            print("No orphan pkg versions to remove.")
        if skipped:
            print(f"Skipped {len(skipped)} version(s) referenced by running pipelines:")
            for ver in skipped:
                print(f"  {ver} (live)")


def register_subcommand(sub) -> None:
    """Register the `cleanup` subparser on the provided subparsers action."""
    p = sub.add_parser("cleanup", help="Remove completed pipeline worktrees")
    p.add_argument(
        "--all",
        action="store_true",
        help="Remove all completed/failed worktrees without prompting",
    )
    p.add_argument(
        "--run-id",
        default=None,
        metavar="ID",
        help="Remove a specific worktree by run ID",
    )
    p.add_argument(
        "--fleet-id",
        default=None,
        metavar="ID",
        help="Remove a specific fleet and all its child worktrees by fleet ID",
    )
    p.add_argument(
        "--workspace-id",
        default=None,
        metavar="ID",
        help="Remove a specific workspace and all its child worktrees by workspace ID",
    )
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="List what would be removed without removing anything",
    )
    p.add_argument(
        "--older-than",
        type=_parse_duration,
        default=None,
        metavar="DURATION",
        help="Only remove worktrees started more than this long ago (e.g. 7d, 24h, 30m)",
    )
    p.add_argument(
        "--gc",
        action="store_true",
        help="Run mark-and-sweep GC on orphan pkg versions in ~/.worca/pkg/",
    )
    p.add_argument(
        "--keep-latest",
        type=int,
        default=0,
        metavar="N",
        help="With --gc: preserve the N most recent pkg versions regardless of references",
    )
