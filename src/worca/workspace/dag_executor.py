"""Tier-based DAG executor for workspace pipelines (W-047 §3).

Dispatches child pipelines via run_worktree.py in topological tier order.
Projects within a tier run in parallel via ThreadPoolExecutor; tiers execute
sequentially. Each child receives --workspace-id (not --fleet-id) and
per-child env vars WORCA_WORKSPACE_ID, WORCA_WORKSPACE_NAME, WORCA_DEFER_PR=1.

Between tiers, context artifacts (git diff --stat + targeted file-level diffs)
are extracted from completed children, written to {run_dir}/context/{project}-diff.md,
and injected into the next tier's children via --guide (W-047 §4).

Emits workspace.tier.started/.completed/.failed and
workspace.circuit_breaker.tripped/halted events at the corresponding state
transitions. Emission failures never propagate — emit_workspace_event is
itself never-raises, and we guard imports in case of partial installs.
"""
from __future__ import annotations

import os
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from worca.orchestrator.fleet_manifest import GRAPH_STATUS_DISABLED
from worca.state.status import WorkspaceStatus


CONTEXT_CAP_BYTES = 8192


def detect_child_crg_status(project_dir: str) -> str:
    """Return per-child CRG readiness: ready|degraded|disabled.

    Mirrors the fleet-level detection in run_fleet.py. Returns
    GRAPH_STATUS_DISABLED on any error (never crashes).
    """
    try:
        from worca.utils.code_review_graph import (
            detect_code_review_graph,
            effective_crg_config,
        )
        from worca.utils.settings import load_global_settings, load_settings

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
        from worca.orchestrator.fleet_manifest import GRAPH_STATUS_DEGRADED
        return GRAPH_STATUS_DEGRADED

    from worca.orchestrator.fleet_manifest import GRAPH_STATUS_READY
    return GRAPH_STATUS_READY

_API_SURFACE_DIRS = frozenset({"types", "api", "schemas"})

_SCRUB_KEYS = frozenset({
    "WORCA_AGENT",
    "WORCA_STAGE",
    "WORCA_RUN_ID",
    "WORCA_PROJECT_ROOT",
    "CLAUDECODE",
})
_SCRUB_PREFIXES = ("WORCA_",)


def _derive_config_path(project_dir: str | None) -> str | None:
    """Return the absolute path to config.json for *project_dir*, or None if absent."""
    if not project_dir:
        return None
    try:
        from worca.utils.paths import project_config_dir  # noqa: PLC0415
        from worca.utils.project_registry import slugify  # noqa: PLC0415

        slug = slugify(os.path.basename(project_dir))
        config_path = os.path.join(project_config_dir(slug), "config.json")
        return config_path if os.path.exists(config_path) else None
    except Exception:
        return None


def _build_child_env(
    base_env: dict,
    *,
    workspace_id: str,
    workspace_name: str,
    project_dir: str | None = None,
) -> dict:
    # Strip-then-inject: first drop every WORCA_* var the parent inherited
    # (stage-scoped state from any outer pipeline must not leak into child
    # subprocesses), then add back the workspace-scoped vars that downstream
    # children legitimately need. If you add a new WORCA_* var that children
    # must see, add it after the scrub loop or it will be filtered out.
    result = {}
    for key, value in base_env.items():
        if key in _SCRUB_KEYS:
            continue
        if any(key.startswith(prefix) for prefix in _SCRUB_PREFIXES):
            continue
        result[key] = value

    result["WORCA_WORKSPACE_ID"] = workspace_id
    result["WORCA_WORKSPACE_NAME"] = workspace_name
    result["WORCA_DEFER_PR"] = "1"

    config_path = _derive_config_path(project_dir)
    if config_path:
        result["WORCA_CONFIG_PATH"] = config_path

    return result


def _build_child_cmd(
    *,
    workspace_id: str,
    prompt: str,
    guide_paths: list[str],
    plan_path: str | None,
    max_beads: int | None = None,
    claude_md_mode: str | None = None,
) -> list[str]:
    run_worktree = os.path.join(
        os.path.dirname(os.path.dirname(__file__)), "scripts", "run_worktree.py"
    )
    cmd = [sys.executable, run_worktree]
    cmd.extend(["--prompt", prompt])
    cmd.extend(["--workspace-id", workspace_id])

    for g in guide_paths:
        cmd.extend(["--guide", g])

    if plan_path:
        cmd.extend(["--plan", plan_path])

    if max_beads is not None:
        cmd.extend(["--max-beads", str(max_beads)])

    if claude_md_mode is not None:
        cmd.extend(["--claude-md-mode", claude_md_mode])

    return cmd


def _parse_run_id_from_stdout(stdout_str: str) -> str | None:
    if not stdout_str:
        return None
    first = stdout_str.strip().split("\n", 1)[0].strip()
    if not first or "/" in first or "\\" in first or " " in first:
        return None
    return first


def _parse_worktree_from_stdout(stdout_str: str) -> str | None:
    if not stdout_str:
        return None
    lines = stdout_str.strip().split("\n")
    if len(lines) < 2:
        return None
    return lines[1].strip()


def _run_git(args: list[str], cwd: str) -> str:
    proc = subprocess.run(
        ["git"] + args, cwd=cwd, capture_output=True, text=True,
    )
    return proc.stdout if proc.returncode == 0 else ""


def _parse_diff_into_files(diff_text: str) -> list[tuple[str, str]]:
    """Split unified diff into (filepath, section_text) pairs."""
    files: list[tuple[str, str]] = []
    current_path: str | None = None
    current_lines: list[str] = []

    for line in diff_text.split("\n"):
        if line.startswith("diff --git "):
            if current_path is not None:
                files.append((current_path, "\n".join(current_lines)))
            parts = line.split(" b/", 1)
            current_path = parts[1] if len(parts) > 1 else ""
            current_lines = [line]
        elif current_path is not None:
            current_lines.append(line)

    if current_path is not None:
        files.append((current_path, "\n".join(current_lines)))

    return files


def _is_api_surface(filepath: str) -> bool:
    parts = filepath.replace("\\", "/").split("/")
    if any(p in _API_SURFACE_DIRS for p in parts):
        return True
    basename = parts[-1] if parts else ""
    return basename.startswith("index.")


def _prioritize_files(
    files: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    api = [(p, s) for p, s in files if _is_api_surface(p)]
    rest = [(p, s) for p, s in files if not _is_api_surface(p)]
    return api + rest


def _assemble_context(stat: str, full_diff: str, cap_bytes: int) -> str:
    """Format stat + prioritized diff sections within cap_bytes budget."""
    header = f"### Changes summary\n```\n{stat.rstrip()}\n```\n\n"

    if not full_diff.strip():
        return header

    files = _parse_diff_into_files(full_diff)
    files = _prioritize_files(files)

    diff_prefix = "### Diff\n```diff\n"
    diff_suffix = "```\n"
    overhead = len(header.encode()) + len(diff_prefix.encode()) + len(diff_suffix.encode())
    budget = cap_bytes - overhead

    if budget <= 0:
        return header

    included: list[str] = []
    total_remaining_lines = 0
    budget_exhausted = False

    for _filepath, section in files:
        if budget_exhausted:
            total_remaining_lines += section.count("\n") + 1
            continue

        section_bytes = len(section.encode())
        if section_bytes <= budget:
            included.append(section)
            budget -= section_bytes + 1
        else:
            section_lines = section.split("\n")
            file_header = "\n".join(section_lines[:4])
            rest_count = len(section_lines) - 4
            marker = f"\n[truncated — {rest_count} lines remaining]"
            candidate = file_header + marker

            if len(candidate.encode()) <= budget:
                included.append(candidate)
            else:
                total_remaining_lines += len(section_lines)

            budget_exhausted = True

    body = "\n".join(included)
    if total_remaining_lines > 0 and not any("[truncated" in s for s in included):
        body += f"\n[truncated — {total_remaining_lines} lines remaining]"

    return header + diff_prefix + body + "\n" + diff_suffix


def _detect_base_ref(worktree_path: str) -> str:
    upstream = _run_git(["rev-parse", "--abbrev-ref", "@{upstream}"], worktree_path).strip()
    if upstream:
        return upstream
    for candidate in ("main", "master", "develop"):
        if _run_git(["rev-parse", "--verify", f"refs/heads/{candidate}"], worktree_path).strip():
            return candidate
        if _run_git(["rev-parse", "--verify", f"refs/remotes/origin/{candidate}"], worktree_path).strip():
            return f"origin/{candidate}"
    return "HEAD~1"


def _extract_project_context(
    worktree_path: str, cap_bytes: int = CONTEXT_CAP_BYTES,
) -> str:
    base = _detect_base_ref(worktree_path)
    stat = _run_git(["diff", f"{base}..HEAD", "--stat"], worktree_path)
    full_diff = _run_git(["diff", f"{base}..HEAD"], worktree_path)
    return _assemble_context(stat, full_diff, cap_bytes)


def _write_context_file(run_dir: str, project: str, content: str) -> str:
    context_dir = os.path.join(run_dir, "context")
    os.makedirs(context_dir, exist_ok=True)
    path = os.path.join(context_dir, f"{project}-diff.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"## Dependency Context: {project}\n\n{content}")
    return path


def _emit(event_type: str, payload: dict, *, workspace_id: str, settings_path: str | None) -> None:
    """Best-effort workspace event emission. Never raises.

    Module-level so DagExecutor instances and the halt helper share one
    failure-isolated emit path. Import is lazy so partial installs don't
    break dispatch.
    """
    try:
        from worca.events.workspace_emitter import emit_workspace_event
    except Exception:
        return
    try:
        kwargs = {}
        if settings_path is not None:
            kwargs["settings_path"] = settings_path
        emit_workspace_event(workspace_id, event_type, payload, **kwargs)
    except Exception:
        pass


class DagExecutor:
    """Dispatch workspace children in tier order via ThreadPoolExecutor."""

    def __init__(self, manifest: dict, run_dir: str, *, settings_path: str | None = None, max_beads: int | None = None, claude_md_mode: str | None = None):
        self._manifest = manifest
        self._run_dir = run_dir
        self._settings_path = settings_path
        self._workspace_id = manifest["workspace_id"]
        self._workspace_name = manifest["workspace_name"]
        self._workspace_root = manifest["workspace_root"]
        self._max_parallel = manifest.get("max_parallel", 5)
        self._prompt = manifest["work_request"]["description"]
        self._guide_paths = manifest.get("guide", {}).get("paths", [])
        self._project_plans = manifest.get("plan", {}).get("project_plans", {}) or {}
        self._projects_by_name = manifest.get("projects_by_name") or {}
        self._dependency_graph = manifest.get("dag", {}).get("dependency_graph") or {}
        self._context_paths: dict[str, str] = {}
        self._current_tier = -1
        self._failed_projects: set[str] = set()
        self._failure_threshold = manifest.get("failure_threshold")
        self._total_projects = sum(len(t["projects"]) for t in manifest["dag"]["tiers"])
        self._terminal_count = 0
        self._failed_count = 0
        self._max_beads = max_beads
        self._claude_md_mode = claude_md_mode

        self._completed_projects: dict[str, dict] = {}
        for child in manifest.get("children", []):
            if child.get("status") == "completed":
                self._completed_projects[child["project"]] = child

        self._crg_statuses: dict[str, str] = {}
        for project_name, project_path in self._projects_by_name.items():
            abs_path = self._project_abs_path(project_path)
            try:
                self._crg_statuses[project_name] = detect_child_crg_status(abs_path)
            except Exception:
                self._crg_statuses[project_name] = GRAPH_STATUS_DISABLED

    def _project_abs_path(self, project_path: str) -> str:
        return os.path.join(self._workspace_root, *project_path.replace("\\", "/").split("/"))

    def _emit_event(self, event_type: str, payload: dict) -> None:
        _emit(
            event_type,
            payload,
            workspace_id=self._workspace_id,
            settings_path=self._settings_path,
        )

    def execute(self) -> dict:
        tiers = self._manifest["dag"]["tiers"]
        from worca.events import types as event_types

        for i, tier_info in enumerate(tiers):
            tier_idx = tier_info["tier"]
            projects = tier_info["projects"]
            self._current_tier = tier_idx

            if tier_info["status"] == "completed":
                if self._dependency_graph and i < len(tiers) - 1:
                    self._regenerate_tier_context(projects)
                continue

            if self._check_circuit_breaker():
                self._emit_circuit_breaker_tripped()
                self._halt_remaining_tiers(tiers[i:])
                self._emit_halted("circuit_breaker")
                return {"status": "halted"}

            already_done = [p for p in projects if p in self._completed_projects]
            need_dispatch = [p for p in projects if p not in self._completed_projects]

            # In master/existing plan modes, skip projects absent from
            # `project_plans` — the planner intentionally omitted them.
            # An empty `project_plans` means "skip everything" in these
            # modes; do not fall through to a full dispatch.
            skipped: list[str] = []
            if self._manifest.get("plan_mode") in ("master", "existing"):
                skipped = [p for p in need_dispatch if p not in self._project_plans]
                for p in skipped:
                    project_path = self._projects_by_name.get(p, p)
                    entry = {
                        "project": p,
                        "run_id": None,
                        "worktree_path": None,
                        "project_path": self._project_abs_path(project_path),
                        "status": "completed",
                        "skipped": True,
                        "tier": tier_idx,
                        "crg_status": self._crg_statuses.get(p, GRAPH_STATUS_DISABLED),
                    }
                    self._manifest["children"].append(entry)
                    self._completed_projects[p] = entry
                    self._terminal_count += 1
                    self._emit_event(
                        event_types.WORKSPACE_PROJECT_SKIPPED,
                        event_types.workspace_project_skipped_payload(
                            workspace_name=self._workspace_name,
                            project=p,
                            tier=tier_idx,
                            reason="no_plan",
                        ),
                    )
                need_dispatch = [p for p in need_dispatch if p not in skipped]

            blocked, runnable = self._partition_projects(need_dispatch)

            tier_started_at = datetime.now(timezone.utc)
            self._emit_event(
                event_types.WORKSPACE_TIER_STARTED,
                event_types.workspace_tier_started_payload(
                    workspace_name=self._workspace_name,
                    tier=tier_idx,
                    projects=projects,
                ),
            )

            for project in blocked:
                project_path = self._projects_by_name.get(project, project)
                self._manifest["children"].append({
                    "project": project,
                    "run_id": None,
                    "worktree_path": None,
                    "project_path": self._project_abs_path(project_path),
                    "status": "blocked",
                    "tier": tier_idx,
                    "crg_status": self._crg_statuses.get(project, GRAPH_STATUS_DISABLED),
                })
                self._failed_projects.add(project)
                self._terminal_count += 1
                self._failed_count += 1

            results: dict = {}
            if runnable:
                tier_info["status"] = "running"

                # Pre-register runnable children as "running" so a SIGKILL /
                # SIGTERM that arrives while `_dispatch_tier` is blocked in
                # `subprocess.run` still leaves a manifest trace. Without
                # this, in-flight projects are invisible to `--resume` and
                # get re-dispatched fresh, potentially producing duplicate
                # pipelines for the same project in the same workspace.
                running_entries: dict[str, dict] = {}
                for project in runnable:
                    project_path = self._projects_by_name.get(project, project)
                    entry = {
                        "project": project,
                        "run_id": None,
                        "worktree_path": None,
                        "project_path": self._project_abs_path(project_path),
                        "status": "running",
                        "tier": tier_idx,
                        "crg_status": self._crg_statuses.get(project, GRAPH_STATUS_DISABLED),
                    }
                    self._manifest["children"].append(entry)
                    running_entries[project] = entry
                self._write_manifest()

                results = self._dispatch_tier(runnable)

                has_failed = any(r["status"] == "failed" for r in results.values())
                has_blocked = len(blocked) > 0
                if has_failed or has_blocked:
                    tier_info["status"] = "failed"
                else:
                    tier_info["status"] = "completed"

                for project, result in results.items():
                    entry = running_entries[project]
                    entry["run_id"] = result.get("run_id")
                    entry["worktree_path"] = result.get("worktree_path")
                    entry["status"] = result["status"]
                    self._terminal_count += 1
                    if result["status"] == "failed":
                        self._failed_projects.add(project)
                        self._failed_count += 1
                    elif result["status"] == "completed":
                        self._completed_projects[project] = result
            elif not already_done and not skipped:
                tier_info["status"] = "failed"
            else:
                tier_info["status"] = "completed"

            self._write_manifest()

            tier_duration_ms = int(
                (datetime.now(timezone.utc) - tier_started_at).total_seconds() * 1000
            )

            if tier_info["status"] == "failed":
                # Identify the projects in THIS tier that failed/blocked.
                tier_project_set = set(projects)
                failed_in_tier = [
                    c["project"] for c in self._manifest["children"]
                    if c["project"] in tier_project_set
                    and c.get("tier") == tier_idx
                    and c.get("status") in ("failed", "setup_failed")
                ]
                blocked_in_tier = [
                    c["project"] for c in self._manifest["children"]
                    if c["project"] in tier_project_set
                    and c.get("tier") == tier_idx
                    and c.get("status") == "blocked"
                ]
                self._emit_event(
                    event_types.WORKSPACE_TIER_FAILED,
                    event_types.workspace_tier_failed_payload(
                        workspace_name=self._workspace_name,
                        tier=tier_idx,
                        failed_projects=failed_in_tier,
                        blocked_projects=blocked_in_tier or None,
                        duration_ms=tier_duration_ms,
                    ),
                )
            elif tier_info["status"] == "completed":
                self._emit_event(
                    event_types.WORKSPACE_TIER_COMPLETED,
                    event_types.workspace_tier_completed_payload(
                        workspace_name=self._workspace_name,
                        tier=tier_idx,
                        projects=projects,
                        status="completed",
                        duration_ms=tier_duration_ms,
                    ),
                )

            if self._check_circuit_breaker() and i < len(tiers) - 1:
                self._emit_circuit_breaker_tripped()
                self._halt_remaining_tiers(tiers[i + 1:])
                self._emit_halted("circuit_breaker")
                return {"status": "halted"}

            if self._dependency_graph and i < len(tiers) - 1:
                completed_this_tier = {}
                if runnable:
                    completed_this_tier = {
                        project: r for project, r in results.items()
                        if r["status"] == "completed"
                    }
                for project in already_done:
                    child_info = self._completed_projects[project]
                    completed_this_tier[project] = {
                        "status": "completed",
                        "worktree_path": child_info.get("worktree_path"),
                    }
                if completed_this_tier:
                    self._extract_tier_context(completed_this_tier)

        has_failures = self._failed_projects or self._failed_count > 0
        if self._check_circuit_breaker():
            self._manifest["status"] = WorkspaceStatus.HALTED
            self._manifest["halt_reason"] = "circuit_breaker"
            self._write_manifest()
            self._emit_circuit_breaker_tripped()
            self._emit_halted("circuit_breaker")
            return {"status": "halted"}
        if has_failures:
            self._manifest["status"] = WorkspaceStatus.FAILED
            self._write_manifest()
            return {"status": "failed"}

        self._manifest["status"] = WorkspaceStatus.COMPLETED
        self._write_manifest()
        return {"status": "completed"}

    def _emit_circuit_breaker_tripped(self) -> None:
        from worca.events import types as event_types
        self._emit_event(
            event_types.WORKSPACE_CIRCUIT_BREAKER_TRIPPED,
            event_types.workspace_circuit_breaker_tripped_payload(
                workspace_name=self._workspace_name,
                failed_count=self._failed_count,
                terminal_count=self._terminal_count,
                total_count=self._total_projects,
                threshold=self._failure_threshold or 0.0,
            ),
        )

    def _emit_halted(self, reason: str) -> None:
        from worca.events import types as event_types
        tiers = self._manifest.get("dag", {}).get("tiers", [])
        completed_tiers = sum(1 for t in tiers if t.get("status") == "completed")
        pending_tiers = sum(
            1 for t in tiers if t.get("status") in ("pending", "halted")
        )
        self._emit_event(
            event_types.WORKSPACE_HALTED,
            event_types.workspace_halted_payload(
                workspace_name=self._workspace_name,
                halt_reason=reason,
                completed_tiers=completed_tiers,
                pending_tiers=pending_tiers,
            ),
        )

    def _partition_projects(self, projects: list[str]) -> tuple[list[str], list[str]]:
        blocked = []
        runnable = []
        for project in projects:
            deps = self._dependency_graph.get(project, [])
            if any(dep in self._failed_projects for dep in deps):
                blocked.append(project)
            else:
                runnable.append(project)
        return blocked, runnable

    def _check_circuit_breaker(self) -> bool:
        if self._failure_threshold is None:
            return False
        min_terminal = min(3, self._total_projects)
        if self._terminal_count < min_terminal:
            return False
        return self._failed_count / self._terminal_count >= self._failure_threshold

    def _halt_remaining_tiers(self, remaining_tiers: list[dict]) -> None:
        for tier_info in remaining_tiers:
            tier_info["status"] = "halted"
            for project in tier_info["projects"]:
                project_path = self._projects_by_name.get(project, project)
                self._manifest["children"].append({
                    "project": project,
                    "run_id": None,
                    "worktree_path": None,
                    "project_path": self._project_abs_path(project_path),
                    "status": "halted",
                    "tier": tier_info["tier"],
                    "crg_status": self._crg_statuses.get(project, GRAPH_STATUS_DISABLED),
                })
        self._manifest["status"] = WorkspaceStatus.HALTED
        self._manifest["halt_reason"] = "circuit_breaker"
        self._write_manifest()

    def _dispatch_tier(self, projects: list[str]) -> dict:
        results = {}

        with ThreadPoolExecutor(max_workers=self._max_parallel) as pool:
            futures = {
                pool.submit(self._run_child, project): project for project in projects
            }
            # Iterate in completion order so a stuck/slow project doesn't block
            # collection of already-finished results, and so an unhandled
            # exception from one child surfaces without silently dropping the
            # results of children that finished after it.
            for future in as_completed(futures):
                project = futures[future]
                try:
                    results[project] = future.result()
                except Exception as e:
                    results[project] = {
                        "status": "failed",
                        "run_id": None,
                        "worktree_path": None,
                        "error": f"{type(e).__name__}: {e}",
                    }

        return results

    def _regenerate_tier_context(self, projects: list[str]) -> None:
        """Re-extract context from already-completed projects in a skipped tier."""
        for project in projects:
            child = self._completed_projects.get(project)
            if not child:
                continue
            worktree_path = child.get("worktree_path")
            if not worktree_path:
                continue
            content = _extract_project_context(worktree_path)
            if not content.strip():
                continue
            path = _write_context_file(self._run_dir, project, content)
            self._context_paths[project] = path

    def _extract_tier_context(self, results: dict) -> None:
        for project, result in results.items():
            if result["status"] != "completed":
                continue
            worktree_path = result.get("worktree_path")
            if not worktree_path:
                continue
            content = _extract_project_context(worktree_path)
            if not content.strip():
                continue
            path = _write_context_file(self._run_dir, project, content)
            self._context_paths[project] = path

    def _run_child(self, project: str) -> dict:
        project_path = self._projects_by_name.get(project, project)
        cwd = self._project_abs_path(project_path)

        env = _build_child_env(
            os.environ.copy(),
            workspace_id=self._workspace_id,
            workspace_name=self._workspace_name,
            project_dir=cwd,
        )

        deps = self._dependency_graph.get(project, [])
        context_guides = [
            self._context_paths[dep] for dep in deps if dep in self._context_paths
        ]

        plan_path = self._project_plans.get(project)
        cmd = _build_child_cmd(
            workspace_id=self._workspace_id,
            prompt=self._prompt,
            guide_paths=self._guide_paths + context_guides,
            plan_path=plan_path,
            max_beads=self._max_beads,
            claude_md_mode=self._claude_md_mode,
        )

        proc = subprocess.run(
            cmd,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
        )

        if proc.returncode != 0:
            return {"status": "failed", "run_id": None, "worktree_path": None}

        run_id = _parse_run_id_from_stdout(proc.stdout)
        worktree_path = _parse_worktree_from_stdout(proc.stdout)
        return {
            "status": "completed",
            "run_id": run_id,
            "worktree_path": worktree_path,
        }

    def _write_manifest(self) -> None:
        from worca.scripts.run_workspace import write_workspace_manifest
        write_workspace_manifest(self._manifest, self._run_dir)
