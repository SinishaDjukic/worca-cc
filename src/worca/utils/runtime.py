"""Shared runtime helpers — copy and validate the worca runtime directory.

Used by run_worktree.py and run_parallel.py so both scripts handle the
gitignored-.claude/ case the same way.
"""
import json
import os
import shutil
import sys

# Allowlist of worca-namespace keys that are derived from the parent's
# runtime (host:port of the local UI, etc.) but must follow the run into
# the worktree. Everything else in settings.local.json stays parent-only.
PROPAGATED_LOCAL_WORCA_KEYS = ("webhooks", "events", "models")


def deep_merge(base: dict, override: dict) -> dict:
    """Dict-recursive merge — dicts merge, lists/scalars replace wholesale.

    Same semantics as worca.utils.settings.deep_merge.
    """
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def propagate_runtime_local_keys(src_dir: str, dst_dir: str) -> None:
    """Merge a narrow allowlist of worca-namespace keys from the parent's
    settings files into the worktree's settings.json.

    Reads from BOTH parent files for the allowlist keys, in order:
      1. parent's settings.json       (working-tree view, beats HEAD-derived worktree)
      2. parent's settings.local.json (env + secrets)
    Within the overlay, settings.local.json deep-merges over settings.json so a
    split-storage model entry (id in base, env in local) recomposes into a
    complete {id, env} pair before it hits the worktree.

    Why both files: with `.claude/settings.json` git-tracked, `git worktree add`
    materialises HEAD's version — which is stale relative to whatever the user
    just imported / edited in the working tree. Reading only settings.local.json
    leaks env without id when HEAD doesn't carry the new alias yet, producing a
    malformed `{env: ...}` entry that fails normalize_model_entry().

    No-op when:
    - Neither parent file exists.
    - Neither file has worca-namespace runtime keys.
    - The worktree has no settings.json to augment.
    """
    src_settings = os.path.join(src_dir, "settings.json")
    src_local = os.path.join(src_dir, "settings.local.json")
    dst_settings = os.path.join(dst_dir, "settings.json")
    if not os.path.exists(dst_settings):
        return

    def _load_worca(path: str) -> dict:
        if not os.path.exists(path):
            return {}
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}
        worca = data.get("worca") if isinstance(data, dict) else None
        return worca if isinstance(worca, dict) else {}

    parent_base_worca = _load_worca(src_settings)
    parent_local_worca = _load_worca(src_local)

    overlay: dict = {}
    for key in PROPAGATED_LOCAL_WORCA_KEYS:
        base_v = parent_base_worca.get(key)
        local_v = parent_local_worca.get(key)
        if base_v is None and local_v is None:
            continue
        if isinstance(base_v, dict) and isinstance(local_v, dict):
            overlay[key] = deep_merge(base_v, local_v)
        elif local_v is not None:
            overlay[key] = local_v
        else:
            overlay[key] = base_v
    if not overlay:
        return

    try:
        with open(dst_settings, encoding="utf-8") as f:
            base = json.load(f)
    except (OSError, json.JSONDecodeError):
        base = {}
    if not isinstance(base, dict):
        base = {}

    base_worca = base.get("worca")
    if not isinstance(base_worca, dict):
        base_worca = {}

    for key, value in overlay.items():
        if isinstance(value, dict) and isinstance(base_worca.get(key), dict):
            base_worca[key] = deep_merge(base_worca[key], value)
        else:
            base_worca[key] = value

    base["worca"] = base_worca

    with open(dst_settings, "w", encoding="utf-8") as f:
        json.dump(base, f, indent=2)
        f.write("\n")


def copy_claude_config(src_dir: str, dst_dir: str) -> None:
    """Copy .claude/ contents into a worktree.

    Most projects gitignore .claude/, so a fresh worktree starts with no
    .claude/ at all — preflight then fails on missing settings.json. Copy
    everything from the project's .claude/ into the worktree with these rules:

    - Skip settings.local.json (machine-specific; never propagate verbatim).
    - `tracked-files-win` for everything *except* the `.claude/worca/`
      runtime subtree: if `git worktree add` already placed a file there,
      keep it (projects may legitimately commit customised agents / hooks /
      skills / settings.json).
    - The `.claude/worca/` subtree is the opposite: it is `worca init`-
      managed runtime scaffolding and MUST match the running worca version.
      It is copied unconditionally, overwriting whatever `git worktree add`
      materialised from HEAD. Without this, a project that git-tracks
      `.claude/` with a stale committed `worca/` shadows the project's
      (working-tree) upgrade — the spawned run_pipeline.py is then a
      different version than the launcher and crashes on unknown flags.
    - Narrow exception to the local-skip rule: a small allowlist of
      worca-namespace runtime keys (webhooks, events, models) is merged from
      the parent's settings.local.json into the worktree's settings.json.
    """
    skip_top_level = {"settings.local.json"}
    if not os.path.isdir(src_dir):
        return
    for root, _dirs, files in os.walk(src_dir):
        rel = os.path.relpath(root, src_dir)
        if rel == ".":
            files = [f for f in files if f not in skip_top_level]
        # The `worca/` subtree is runtime scaffolding — always overwrite it
        # so the worktree's runtime matches the running worca version.
        in_runtime = rel == "worca" or rel.startswith("worca" + os.sep)
        for f in files:
            dst_file = os.path.join(dst_dir, rel, f)
            if os.path.exists(dst_file) and not in_runtime:
                continue  # tracked-files-win (everything but the worca/ runtime)
            os.makedirs(os.path.dirname(dst_file), exist_ok=True)
            shutil.copy2(os.path.join(root, f), dst_file)

    propagate_runtime_local_keys(src_dir, dst_dir)


def validate_runtime(runtime_dir: str | None = None) -> None:
    """Verify the worca runtime exists — either the shared pkg store or the legacy
    project-local directory.

    W-077: the canonical runtime location is now ``~/.worca/pkg/<ver>/worca/``
    (shared pkg store).  The ``runtime_dir`` parameter is kept for backward-compat
    but defaults to None, which triggers the pkg-store check.  If the pkg store
    directory is present the check passes.  Only when neither the pkg store nor the
    explicit ``runtime_dir`` exists does it raise SystemExit(1).

    Raises SystemExit(1) with a clear diagnostic when the runtime is absent.
    """
    try:
        from worca.utils.paths import pkg_dir as _pkg_dir  # noqa: PLC0415
        pkg_worca = os.path.join(_pkg_dir(), "worca")
        if os.path.isdir(pkg_worca):
            return
    except Exception:
        pass

    # Fall back to explicit runtime_dir or legacy default.
    legacy = runtime_dir if runtime_dir is not None else os.path.join(".claude", "worca")
    if not os.path.isdir(legacy):
        print(
            f"error: worca runtime not found at {legacy}/ — run `worca init .` first",
            file=sys.stderr,
        )
        raise SystemExit(1)
