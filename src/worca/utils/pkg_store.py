"""Versioned package store utilities for ~/.worca/pkg/<version>/.

Version key format: <semver>-<git-short-hash> (e.g. '0.59.0-a1b2c3d').
For pip/released installs where no git context is available, the hash
suffix is omitted and the key is just the semver string.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Optional


def _get_semver() -> str:
    """Return the installed worca semver string."""
    import worca  # noqa: PLC0415
    return worca.__version__


def _get_git_short_hash() -> Optional[str]:
    """Return the 7-char git short hash of HEAD, or None if unavailable."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            h = result.stdout.strip()
            if len(h) == 7:
                return h
    except Exception:
        pass
    return None


def version_key() -> str:
    """Compute the version key for the current worca install.

    Returns '<semver>-<short-hash>' when inside a git repo, else '<semver>'.
    """
    semver = _get_semver()
    git_hash = _get_git_short_hash()
    if git_hash:
        return f"{semver}-{git_hash}"
    return semver


def _collect_referenced_versions(prefs_dir: str) -> set[str]:
    """Scan projects.d/*.json and return all worcaPkgVersion values."""
    referenced: set[str] = set()
    projects_d = os.path.join(prefs_dir, "projects.d")
    if not os.path.isdir(projects_d):
        return referenced
    for fname in os.listdir(projects_d):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(projects_d, fname), encoding="utf-8") as f:
                entry = json.load(f)
            ver = entry.get("worcaPkgVersion")
            if ver:
                referenced.add(ver)
        except (json.JSONDecodeError, OSError):
            pass
    return referenced


def _collect_running_pipeline_versions(prefs_dir: str) -> set[str]:
    """Scan pipelines.d/ across all registered projects for running pipeline versions.

    A pipeline is considered live if its status is in PIPELINE_ACTIVE set
    (running/resuming/paused). Any worcaPkgVersion found in a live pipeline
    entry is treated as referenced regardless of registry state.
    """
    from worca.state.status import PIPELINE_ACTIVE  # noqa: PLC0415

    live_versions: set[str] = set()
    projects_d = os.path.join(prefs_dir, "projects.d")
    if not os.path.isdir(projects_d):
        return live_versions

    project_paths: list[str] = []
    for fname in os.listdir(projects_d):
        if not fname.endswith(".json"):
            continue
        try:
            with open(os.path.join(projects_d, fname), encoding="utf-8") as f:
                entry = json.load(f)
            p = entry.get("path") or entry.get("worcaDir")
            if p:
                project_paths.append(p)
        except (json.JSONDecodeError, OSError):
            pass

    active_statuses = {s.value for s in PIPELINE_ACTIVE}

    for proj_path in project_paths:
        # worcaDir may be <path>/.worca; path gives us the project root
        # Normalise: if proj_path ends with /.worca strip it
        base = proj_path
        if base.endswith("/.worca") or base.endswith("\\.worca"):
            base = os.path.dirname(base)
        pipelines_d = os.path.join(base, ".worca", "multi", "pipelines.d")
        if not os.path.isdir(pipelines_d):
            continue
        for fname in os.listdir(pipelines_d):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(pipelines_d, fname), encoding="utf-8") as f:
                    pipeline = json.load(f)
                status = str(pipeline.get("status", ""))
                if status in active_statuses:
                    ver = pipeline.get("worcaPkgVersion")
                    if ver:
                        live_versions.add(ver)
            except (json.JSONDecodeError, OSError):
                pass

    return live_versions


def gc_pkg_store(
    dry_run: bool = False,
    keep_latest: int = 0,
    prefs_dir: str | None = None,
) -> dict:
    """Mark-and-sweep GC for ~/.worca/pkg/ orphan versions.

    Steps:
    1. Collect referenced versions from projects.d/*.json (mark)
    2. Collect versions referenced by any running pipeline (safety)
    3. List all dirs in ~/.worca/pkg/
    4. Apply keep_latest: preserve the N most recent dirs (sorted)
    5. Delete orphan dirs (unless dry_run)

    Returns dict with keys:
      - removed: list of version keys actually deleted
      - would_remove: list of orphan version keys (populated in dry_run)
      - skipped_live: list of version keys skipped due to running pipelines
    """
    from worca.utils.paths import worca_home  # noqa: PLC0415

    if prefs_dir is None:
        prefs_dir = worca_home()

    pkg_root = os.path.join(prefs_dir, "pkg")
    if not os.path.isdir(pkg_root):
        return {"removed": [], "would_remove": [], "skipped_live": []}

    all_versions = sorted(
        d for d in os.listdir(pkg_root)
        if os.path.isdir(os.path.join(pkg_root, d))
    )

    referenced = _collect_referenced_versions(prefs_dir)
    live_versions = _collect_running_pipeline_versions(prefs_dir)

    # keep_latest: preserve the N most-recent dirs regardless of reference status
    keep_set: set[str] = set()
    if keep_latest > 0:
        keep_set = set(all_versions[-keep_latest:])

    removed: list[str] = []
    would_remove: list[str] = []
    skipped_live: list[str] = []

    for ver in all_versions:
        if ver in referenced or ver in keep_set:
            continue
        if ver in live_versions:
            skipped_live.append(ver)
            continue
        if dry_run:
            would_remove.append(ver)
        else:
            try:
                shutil.rmtree(os.path.join(pkg_root, ver))
                removed.append(ver)
            except OSError:
                pass

    return {"removed": removed, "would_remove": would_remove, "skipped_live": skipped_live}
