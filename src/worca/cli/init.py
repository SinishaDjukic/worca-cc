"""worca init — scaffold or upgrade .claude/worca/ in a project.

worca init [--upgrade] [--force] [--check] [--source PATH]

Source resolution order:
  1. --source flag (explicit, highest priority)
  2. worca.source_repo in .claude/settings.local.json
  3. Installed pip package (default)
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _find_git_root() -> Path:
    """Walk up from cwd to find the git root directory."""
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".git").exists():
            return parent
    print("error: not inside a git repository", file=sys.stderr)
    raise SystemExit(1)


def _get_worca_source(source_flag: str | None, git_root: Path) -> Path:
    """Resolve the worca source directory using the resolution chain."""
    # 1. Explicit --source flag
    if source_flag:
        src = Path(source_flag).expanduser() / "src" / "worca"
        if not src.is_dir():
            print(f"error: source not found: {src}", file=sys.stderr)
            raise SystemExit(1)
        return src

    # 2. settings.local.json source_repo
    local_settings = git_root / ".claude" / "settings.local.json"
    if local_settings.exists():
        try:
            with open(local_settings) as f:
                settings = json.load(f)
            source_repo = settings.get("worca", {}).get("source_repo")
            if source_repo:
                src = Path(source_repo).expanduser() / "src" / "worca"
                if src.is_dir():
                    return src
        except (json.JSONDecodeError, OSError):
            pass

    # 3. Installed pip package
    try:
        import worca as _worca_pkg
        return Path(_worca_pkg.__file__).parent
    except ImportError:
        print(
            "error: worca-cc package not installed and no --source provided",
            file=sys.stderr,
        )
        raise SystemExit(1)


def _deep_merge(base: dict, overlay: dict) -> dict:
    """Deep-merge overlay into base. Overlay values win for scalars; dicts merge recursively."""
    result = base.copy()
    for key, value in overlay.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            # Only add missing keys, don't overwrite existing
            if key not in result:
                result[key] = value
    return result


def _deep_merge_overwrite(base: dict, overlay: dict) -> dict:
    """Deep-merge overlay into base. Overlay values always win."""
    result = base.copy()
    for key, value in overlay.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge_overwrite(result[key], value)
        else:
            result[key] = value
    return result


# Legacy files to remove during upgrade from pre-packaging installs
_LEGACY_HOOK_FILES = [
    "__init__.py", "post_tool_use.py", "pre_compact.py", "pre_tool_use.py",
    "session_end.py", "session_start.py", "stop.py",
    "subagent_start.py", "subagent_stop.py", "user_prompt_submit.py",
]

_LEGACY_SCRIPT_FILES = [
    "__init__.py", "preflight_checks.py", "run_batch.py", "run_learn.py",
    "run_multi.py", "run_parallel.py", "run_pipeline.py",
    "worca.py",  # renamed to worca_lifecycle.py in new structure
]

_LEGACY_AGENT_FILES = [
    "coordinator.md", "guardian.md", "implementer.md", "learner.md",
    "plan_reviewer.md", "planner.md", "tester.md",
]

# Path migrations for --upgrade from pre-packaging installs
_PATH_MIGRATIONS = [
    # (settings key path, old substring, new substring)
    (".claude/hooks/pre_tool_use.py", ".claude/hooks/pre_tool_use.py",
     ".claude/worca/claude_hooks/pre_tool_use.py"),
    (".claude/hooks/post_tool_use.py", ".claude/hooks/post_tool_use.py",
     ".claude/worca/claude_hooks/post_tool_use.py"),
    (".claude/hooks/user_prompt_submit.py", ".claude/hooks/user_prompt_submit.py",
     ".claude/worca/claude_hooks/user_prompt_submit.py"),
    (".claude/scripts/preflight_checks.py", ".claude/scripts/preflight_checks.py",
     ".claude/worca/scripts/preflight_checks.py"),
]


def _migrate_settings_paths(settings: dict) -> tuple[dict, list[str]]:
    """Apply path migrations to settings dict. Returns (migrated_settings, list_of_changes)."""
    changes = []
    raw = json.dumps(settings)

    for _desc, old, new in _PATH_MIGRATIONS:
        if old in raw:
            raw = raw.replace(old, new)
            changes.append(f"  {old} -> {new}")

    # Migrate agent_overrides_dir
    migrated = json.loads(raw)
    worca_cfg = migrated.get("worca", {})
    if worca_cfg.get("agent_overrides_dir") == ".claude/agents/overrides":
        worca_cfg["agent_overrides_dir"] = ".claude/agents"
        changes.append("  agent_overrides_dir: .claude/agents/overrides -> .claude/agents")
        migrated["worca"] = worca_cfg

    return migrated, changes


def _migrate_agent_overrides(git_root: Path) -> list[str]:
    """Move .claude/agents/overrides/*.md to .claude/agents/*.md."""
    changes = []
    old_dir = git_root / ".claude" / "agents" / "overrides"
    new_dir = git_root / ".claude" / "agents"

    if not old_dir.is_dir():
        return changes

    for md_file in old_dir.glob("*.md"):
        target = new_dir / md_file.name
        if target.exists():
            changes.append(f"  WARNING: {target} already exists, skipping {md_file.name}")
        else:
            shutil.move(str(md_file), str(target))
            changes.append(f"  Moved {md_file.name} to .claude/agents/")

    # Remove empty overrides directory
    try:
        # Remove .DS_Store if present
        ds_store = old_dir / ".DS_Store"
        if ds_store.exists():
            ds_store.unlink()
        old_dir.rmdir()
        changes.append("  Removed empty .claude/agents/overrides/")
    except OSError:
        pass  # Directory not empty, leave it

    return changes


def _remove_files_from_dir(directory: Path, filenames: list[str], changes: list[str]) -> None:
    """Remove specific files from a directory, then clean up __pycache__/.DS_Store and empty dir."""
    if not directory.is_dir():
        return

    for name in filenames:
        f = directory / name
        if f.exists():
            f.unlink()
            changes.append(f"  Removed {f.relative_to(directory.parent.parent)}")

    # Remove __pycache__/ if present
    pycache = directory / "__pycache__"
    if pycache.is_dir():
        shutil.rmtree(pycache)
        changes.append(f"  Removed {pycache.relative_to(directory.parent.parent)}")

    # Remove .DS_Store if present
    ds_store = directory / ".DS_Store"
    if ds_store.exists():
        ds_store.unlink()

    # Remove directory if now empty
    try:
        directory.rmdir()
        changes.append(f"  Removed empty {directory.relative_to(directory.parent.parent)}/")
    except OSError:
        pass  # Directory not empty (user files remain)


def _cleanup_legacy_files(git_root: Path) -> list[str]:
    """Remove known worca-owned files from pre-packaging install locations.

    Only runs if .claude/worca/ has no version (pre-packaging install).
    Returns list of change descriptions.
    """
    changes: list[str] = []
    claude_dir = git_root / ".claude"
    worca_dir = claude_dir / "worca"

    # If worca dir already has a version, this is a packaged install — skip cleanup
    if read_version(worca_dir) is not None:
        return changes

    # Remove known files from .claude/hooks/
    _remove_files_from_dir(claude_dir / "hooks", _LEGACY_HOOK_FILES, changes)

    # Remove known files from .claude/scripts/
    _remove_files_from_dir(claude_dir / "scripts", _LEGACY_SCRIPT_FILES, changes)

    # Remove .claude/agents/core/ (agent templates)
    _remove_files_from_dir(claude_dir / "agents" / "core", _LEGACY_AGENT_FILES, changes)

    # Remove .claude/agents/domain/ if only contains .gitkeep and/or .DS_Store
    domain_dir = claude_dir / "agents" / "domain"
    if domain_dir.is_dir():
        contents = set(f.name for f in domain_dir.iterdir())
        if contents <= {".gitkeep", ".DS_Store"}:
            shutil.rmtree(domain_dir)
            changes.append("  Removed .claude/agents/domain/")

    # Remove .claude/worca-ui/ (fully worca-owned embedded UI)
    worca_ui_dir = claude_dir / "worca-ui"
    if worca_ui_dir.is_dir():
        shutil.rmtree(worca_ui_dir)
        changes.append("  Removed .claude/worca-ui/")

    return changes


def _copy_worca_source(source: Path, target: Path) -> None:
    """Copy worca source to target, excluding cli/ and __pycache__/."""
    if target.exists():
        shutil.rmtree(target)

    def ignore_patterns(directory, contents):
        ignored = set()
        rel = os.path.relpath(directory, source)
        # Skip cli/ at the top level
        if rel == ".":
            if "cli" in contents:
                ignored.add("cli")
        # Skip __pycache__ everywhere
        if "__pycache__" in contents:
            ignored.add("__pycache__")
        # Skip .DS_Store
        if ".DS_Store" in contents:
            ignored.add(".DS_Store")
        return ignored

    shutil.copytree(str(source), str(target), ignore=ignore_patterns)


def _ensure_gitignore(git_root: Path) -> list[str]:
    """Add recommended .gitignore entries if missing."""
    gitignore = git_root / ".gitignore"
    entries_needed = [".worca/", "logs/", ".claude/settings.local.json"]
    changes = []

    existing = ""
    if gitignore.exists():
        existing = gitignore.read_text()

    lines_to_add = []
    for entry in entries_needed:
        if entry not in existing:
            lines_to_add.append(entry)
            changes.append(f"  Added {entry} to .gitignore")

    if lines_to_add:
        with open(gitignore, "a") as f:
            if existing and not existing.endswith("\n"):
                f.write("\n")
            f.write("\n# worca runtime\n")
            for line in lines_to_add:
                f.write(f"{line}\n")

    return changes


def _init_beads(git_root: Path) -> bool:
    """Run bd init if .beads/ doesn't exist. Returns True if initialized."""
    if (git_root / ".beads").is_dir():
        return False
    try:
        subprocess.run(
            ["bd", "init"],
            cwd=str(git_root),
            capture_output=True,
            timeout=30,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _upgrade_beads(git_root: Path) -> bool:
    """Update beads repo fingerprint if .beads/ exists. Idempotent."""
    if not (git_root / ".beads").is_dir():
        return False
    try:
        subprocess.run(
            ["bd", "migrate", "--update-repo-id"],
            cwd=str(git_root),
            input=b"y\n",
            capture_output=True,
            timeout=30,
        )
        return True
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _show_check(source: Path, git_root: Path) -> None:
    """Show what would change without making changes."""
    target = git_root / ".claude" / "worca"
    settings_path = git_root / ".claude" / "settings.json"

    # Version comparison
    source_version = read_version(source)
    project_version = read_version(target) if target.exists() else None

    print(f"Source version:  {source_version or 'unknown'}")
    print(f"Project version: {project_version or 'not installed'}")

    if source_version and project_version and source_version != project_version:
        print(f"  -> Would upgrade {project_version} -> {source_version}")
    elif source_version == project_version:
        print("  -> Versions match")

    # Settings diff
    if settings_path.exists():
        with open(settings_path) as f:
            current = json.load(f)

        source_settings_path = source / "settings.json"
        if source_settings_path.exists():
            with open(source_settings_path) as f:
                template = json.load(f)

            # Check what keys would be added
            merged = _deep_merge(current, template)
            new_raw = json.dumps(merged, indent=2, sort_keys=True)
            old_raw = json.dumps(current, indent=2, sort_keys=True)
            if new_raw != old_raw:
                print("\nSettings changes (new keys that would be added):")
                # Simple diff: show keys present in merged but not in current
                _show_key_diff(current, merged, prefix="  ")
            else:
                print("\nSettings: no changes needed")

        # Check path migrations
        _, migration_changes = _migrate_settings_paths(current)
        if migration_changes:
            print("\nPath migrations that would be applied:")
            for change in migration_changes:
                print(change)

    # Legacy file cleanup check
    claude_dir = git_root / ".claude"
    worca_dir = claude_dir / "worca"
    if read_version(worca_dir) is None:
        legacy_files = []
        for name in _LEGACY_HOOK_FILES:
            f = claude_dir / "hooks" / name
            if f.exists():
                legacy_files.append(f"  .claude/hooks/{name}")
        for name in _LEGACY_SCRIPT_FILES:
            f = claude_dir / "scripts" / name
            if f.exists():
                legacy_files.append(f"  .claude/scripts/{name}")
        for name in _LEGACY_AGENT_FILES:
            f = claude_dir / "agents" / "core" / name
            if f.exists():
                legacy_files.append(f"  .claude/agents/core/{name}")
        domain_dir = claude_dir / "agents" / "domain"
        if domain_dir.is_dir():
            contents = set(f.name for f in domain_dir.iterdir())
            if contents <= {".gitkeep", ".DS_Store"}:
                legacy_files.append("  .claude/agents/domain/")
        worca_ui_dir = claude_dir / "worca-ui"
        if worca_ui_dir.is_dir():
            legacy_files.append("  .claude/worca-ui/")
        if legacy_files:
            print("\nLegacy files that would be removed:")
            for lf in legacy_files:
                print(lf)

    # Agent override migration
    old_overrides = git_root / ".claude" / "agents" / "overrides"
    if old_overrides.is_dir() and list(old_overrides.glob("*.md")):
        print("\nAgent overrides that would be moved:")
        for md in old_overrides.glob("*.md"):
            print(f"  {md.name} -> .claude/agents/{md.name}")


def _show_key_diff(current: dict, merged: dict, prefix: str = "") -> None:
    """Show keys that exist in merged but not in current."""
    for key in sorted(merged.keys()):
        if key not in current:
            print(f"{prefix}+ {key}")
        elif isinstance(merged[key], dict) and isinstance(current.get(key), dict):
            _show_key_diff(current[key], merged[key], prefix=f"{prefix}  {key}.")


def read_version(worca_dir: Path) -> str | None:
    """Read __version__ from a worca __init__.py."""
    init_file = worca_dir / "__init__.py"
    if not init_file.exists():
        return None
    content = init_file.read_text()
    for line in content.splitlines():
        if line.startswith("__version__"):
            # Extract version string
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def run_init(
    upgrade: bool = False,
    force: bool = False,
    check: bool = False,
    source: str | None = None,
) -> None:
    """Main init logic."""
    git_root = _find_git_root()
    worca_source = _get_worca_source(source, git_root)

    print(f"Source: {worca_source}")
    print(f"Target: {git_root / '.claude' / 'worca'}")

    # --check: dry-run mode
    if check:
        _show_check(worca_source, git_root)
        return

    target = git_root / ".claude" / "worca"
    settings_path = git_root / ".claude" / "settings.json"
    source_settings = worca_source / "settings.json"

    # Ensure .claude/ exists
    (git_root / ".claude").mkdir(exist_ok=True)

    if not upgrade and not force and target.exists():
        print(
            ".claude/worca/ already exists. Use --upgrade to update or --force to overwrite.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    # --- Path migrations (before merge, only on --upgrade) ---
    migration_changes = []
    if upgrade and settings_path.exists():
        with open(settings_path) as f:
            current_settings = json.load(f)
        migrated, migration_changes = _migrate_settings_paths(current_settings)
        if migration_changes:
            with open(settings_path, "w") as f:
                json.dump(migrated, f, indent=2)
                f.write("\n")
            print("Path migrations applied:")
            for change in migration_changes:
                print(change)

    # --- Legacy file cleanup (only on --upgrade, before source copy) ---
    if upgrade:
        legacy_changes = _cleanup_legacy_files(git_root)
        if legacy_changes:
            print("Legacy file cleanup:")
            for change in legacy_changes:
                print(change)

    # --- Agent override migration (only on --upgrade) ---
    if upgrade:
        override_changes = _migrate_agent_overrides(git_root)
        if override_changes:
            print("Agent override migration:")
            for change in override_changes:
                print(change)

    # --- Copy worca source ---
    _copy_worca_source(worca_source, target)
    print("Copied worca to .claude/worca/")

    # --- Create .claude/templates/ for project templates ---
    project_templates_dir = git_root / ".claude" / "templates"
    if not project_templates_dir.exists():
        project_templates_dir.mkdir(parents=True, exist_ok=True)
        print("Created .claude/templates/ (project templates go here)")

    # --- Settings merge ---
    if force:
        # Full overwrite from template
        if source_settings.exists():
            shutil.copy2(str(source_settings), str(settings_path))
            print("Settings: replaced with template (--force)")
    elif settings_path.exists():
        # Deep-merge: template values overwrite base, user customizations live in .local.json
        with open(settings_path) as f:
            current = json.load(f)
        if source_settings.exists():
            with open(source_settings) as f:
                template = json.load(f)
            merged = _deep_merge_overwrite(current, template)
            with open(settings_path, "w") as f:
                json.dump(merged, f, indent=2)
                f.write("\n")
            print("Settings: updated to latest defaults")
    else:
        # Create from template
        if source_settings.exists():
            shutil.copy2(str(source_settings), str(settings_path))
            print("Settings: created from template")

    # --- .gitignore ---
    gitignore_changes = _ensure_gitignore(git_root)
    if gitignore_changes:
        print(".gitignore updates:")
        for change in gitignore_changes:
            print(change)

    # --- Beads init / upgrade ---
    if _init_beads(git_root):
        print("Initialized beads (.beads/)")
    elif upgrade and _upgrade_beads(git_root):
        print("Beads: updated repo fingerprint")

    version = read_version(target)
    print(f"\nworca {version or 'unknown'} initialized successfully.")
