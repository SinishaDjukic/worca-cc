"""Auto-register project in ~/.worca/projects.d/ for global worca-ui discovery."""

import json
import logging
import os
import re
import tempfile

from worca.utils.paths import worca_home

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"^[a-z0-9_-]{1,64}$", re.IGNORECASE)


def _get_pkg_version() -> str:
    """Return the worca version key (lazy import avoids circular imports)."""
    from worca.utils.pkg_store import version_key  # noqa: PLC0415
    return version_key()


def slugify(name: str) -> str:
    """Slugify a project name: lowercase, replace non-alphanumeric with hyphens."""
    slug = re.sub(r"[^a-z0-9_-]", "-", name.lower())
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:64]


def auto_register_project(project_root: str, prefs_dir: str | None = None) -> None:
    """Register the current project in ~/.worca/projects.d/ if not already registered.

    ``prefs_dir`` defaults to ``$WORCA_HOME`` (falling back to ``~/.worca``)
    via the lazy resolver in ``worca.utils.paths``.  Honoring the env var
    keeps subprocess-spawned pipelines from writing into the developer's
    real home directory during test runs (issue #162).

    Non-fatal — catches and logs all errors.
    """
    try:
        if prefs_dir is None:
            prefs_dir = worca_home()
        else:
            prefs_dir = os.path.expanduser(prefs_dir)
        projects_dir = os.path.join(prefs_dir, "projects.d")
        os.makedirs(projects_dir, exist_ok=True)

        project_root = os.path.abspath(project_root)
        name = slugify(os.path.basename(project_root))
        if not name or not _SLUG_RE.match(name):
            return

        # Check if any existing entry already points to this path
        for fname in os.listdir(projects_dir):
            if not fname.endswith(".json"):
                continue
            try:
                with open(os.path.join(projects_dir, fname), encoding="utf-8") as f:
                    existing = json.load(f)
                if existing.get("path") == project_root:
                    return
            except Exception:
                continue

        entry_path = os.path.join(projects_dir, f"{name}.json")
        if os.path.exists(entry_path):
            return

        worca_config_path = os.path.join(prefs_dir, "projects", name, "config.json")
        entry = {
            "name": name,
            "path": project_root,
            "worcaDir": os.path.join(project_root, ".worca"),
            "settingsPath": os.path.join(project_root, ".claude", "settings.json"),
            "worcaConfigPath": worca_config_path,
            "worcaPkgVersion": _get_pkg_version(),
        }

        # Atomic write: write to temp file, then rename
        fd, tmp_path = tempfile.mkstemp(dir=projects_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(entry, f, indent=2)
                f.write("\n")
            os.replace(tmp_path, entry_path)
        except Exception:
            # Clean up temp file on failure
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

        logger.info("Auto-registered project '%s' at %s", name, project_root)
    except Exception as e:
        logger.debug("Failed to auto-register project: %s", e)


def update_registry_entry(project_root: str, prefs_dir: str | None = None) -> None:
    """Update an existing registry entry with current worcaConfigPath and worcaPkgVersion.

    Non-fatal — catches and logs all errors. No-op when no entry exists.
    """
    try:
        if prefs_dir is None:
            prefs_dir = worca_home()
        else:
            prefs_dir = os.path.expanduser(prefs_dir)
        projects_dir = os.path.join(prefs_dir, "projects.d")

        project_root = os.path.abspath(project_root)
        name = slugify(os.path.basename(project_root))
        if not name or not _SLUG_RE.match(name):
            return

        entry_path = os.path.join(projects_dir, f"{name}.json")
        if not os.path.exists(entry_path):
            # Not registered yet — delegate to auto_register_project
            auto_register_project(project_root, prefs_dir=prefs_dir)
            return

        with open(entry_path, encoding="utf-8") as f:
            entry = json.load(f)

        worca_config_path = os.path.join(prefs_dir, "projects", name, "config.json")
        entry["worcaConfigPath"] = worca_config_path
        entry["worcaPkgVersion"] = _get_pkg_version()

        fd, tmp_path = tempfile.mkstemp(dir=projects_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(entry, f, indent=2)
                f.write("\n")
            os.replace(tmp_path, entry_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

        logger.info("Updated registry entry for '%s'", name)
    except Exception as e:
        logger.debug("Failed to update registry entry: %s", e)
