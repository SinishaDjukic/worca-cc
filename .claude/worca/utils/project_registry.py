"""Auto-register project in ~/.worca/projects.d/ for global worca-ui discovery."""

import json
import logging
import os
import re
import tempfile

logger = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"^[a-z0-9_-]{1,64}$", re.IGNORECASE)


def slugify(name: str) -> str:
    """Slugify a project name: lowercase, replace non-alphanumeric with hyphens."""
    slug = re.sub(r"[^a-z0-9_-]", "-", name.lower())
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:64]


def auto_register_project(project_root: str, prefs_dir: str = "~/.worca") -> None:
    """Register the current project in ~/.worca/projects.d/ if not already registered.

    Non-fatal — catches and logs all errors.
    """
    try:
        prefs_dir = os.path.expanduser(prefs_dir)
        projects_dir = os.path.join(prefs_dir, "projects.d")
        os.makedirs(projects_dir, exist_ok=True)

        project_root = os.path.abspath(project_root)
        name = slugify(os.path.basename(project_root))
        if not name or not _SLUG_RE.match(name):
            return

        entry_path = os.path.join(projects_dir, f"{name}.json")
        if os.path.exists(entry_path):
            return

        entry = {
            "name": name,
            "path": project_root,
            "worcaDir": os.path.join(project_root, ".worca"),
            "settingsPath": os.path.join(project_root, ".claude", "settings.json"),
        }

        # Atomic write: write to temp file, then rename
        fd, tmp_path = tempfile.mkstemp(dir=projects_dir, suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
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
