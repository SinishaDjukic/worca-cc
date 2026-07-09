"""Shared settings loader with .local.json deep-merge support.

All pipeline code should use load_settings() instead of reading settings.json
directly. This merges the base settings.json with a sibling settings.local.json
(if it exists), letting developers keep machine-specific config (webhooks, etc.)
out of version control.
"""

import importlib.resources
import json
import os
import sys

_schema = json.loads(
    importlib.resources.files("worca.schemas").joinpath("keys.json").read_text(encoding="utf-8")
)
GLOBAL_ONLY_KEYS = [tuple(k) for k in _schema["global_only_keys"]]
NORMALIZE_SKIP_KEYS = [tuple(k) for k in _schema["normalize_skip_keys"]]
GLOBAL_DEFAULTS = _schema["defaults"]["global"]
PROJECT_DEFAULTS = _schema["defaults"]["project"]


def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge override into base, returning a new dict.

    - Dicts are merged recursively.
    - Lists and scalars in override replace base values entirely.
    - Neither input dict is mutated.
    """
    result = dict(base)
    for key, val in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(val, dict):
            result[key] = deep_merge(result[key], val)
        else:
            result[key] = val
    return result


# Cross-tier merge atomic paths. Each tuple addresses a dict whose direct
# children should be replaced wholesale (not deep-merged) when an upper tier
# (project) overrides a lower tier (user-global). Within a single tier the
# normal deep_merge still applies (so settings.json `{id}` + settings.local.json
# `{env}` still compose into one entry per tier).
_ATOMIC_LEAF_PATHS = (
    ("worca", "models"),
    ("worca", "pricing", "models"),
)


def _replace_atomic_subkeys(merged: dict, override: dict, path: tuple) -> None:
    """Mutate `merged` so each key at `path` defined in `override` replaces
    the merged entry wholesale (instead of the recursive deep-merge result).

    Walks `path` in both `merged` and `override`; for each alias key the
    override defines at that path, sets `merged[...][alias] = override[...][alias]`
    verbatim. Silently no-ops if either input doesn't reach the full path.
    """
    node_merged = merged
    node_override = override
    for segment in path:
        if not isinstance(node_merged, dict) or segment not in node_merged:
            return
        if not isinstance(node_override, dict) or segment not in node_override:
            return
        node_merged = node_merged[segment]
        node_override = node_override[segment]
    if not isinstance(node_merged, dict) or not isinstance(node_override, dict):
        return
    for key, value in node_override.items():
        node_merged[key] = value


def _local_path_for(settings_path: str) -> str:
    """Derive the .local.json sibling path from a base settings path."""
    root, ext = os.path.splitext(settings_path)
    return root + ".local" + ext


def _load_worca_config() -> dict:
    """Load base worca config from WORCA_CONFIG_PATH if set.

    Returns {} if the env var is unset or the file is absent.
    On JSON error, emits a stderr warning and returns {} — pipeline-side
    callers tolerate degraded config rather than hard-failing the way
    hook-side callers do (see tracking.py::_load_worca_config_base).
    """
    config_path = os.environ.get("WORCA_CONFIG_PATH")
    if not config_path:
        return {}
    try:
        with open(config_path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        print(
            f"worca: warning: WORCA_CONFIG_PATH={config_path}: file not found",
            file=sys.stderr,
        )
        return {}
    except json.JSONDecodeError as e:
        import sys  # noqa: PLC0415
        print(
            f"worca: warning: WORCA_CONFIG_PATH={config_path}: invalid JSON ({e}); "
            "worca config ignored",
            file=sys.stderr,
        )
        return {}


def load_settings(settings_path: str) -> dict:
    """Load base settings and deep-merge any sibling .local.json over them.

    Config loading precedence (lowest to highest):
    1. WORCA_CONFIG_PATH → ~/.worca/projects/<slug>/config.json (base worca config)
    2. settings_path (the project .claude/settings.json or template-merged overlay)
    3. .local.json sibling of settings_path (secrets merge)

    - If settings_path does not exist, returns {}.
    - If the .local.json sibling does not exist, returns the base as-is.
    - If .local.json has invalid JSON, logs a warning and returns the base.
    """
    worca_config_base = _load_worca_config()

    try:
        with open(settings_path, encoding="utf-8") as f:
            base = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return worca_config_base

    if worca_config_base:
        base = deep_merge(worca_config_base, base)

    local_path = _local_path_for(settings_path)
    if not os.path.exists(local_path):
        return base

    try:
        with open(local_path, encoding="utf-8") as f:
            local = json.load(f)
    except json.JSONDecodeError:
        print(
            f"[settings] Warning: {local_path} contains invalid JSON, ignoring local overrides",
            file=sys.stderr,
        )
        return base
    except Exception:
        return base

    return deep_merge(base, local)


_DEFAULT_MODEL_MAP = {
    "opus": "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5-20251001",
}


def normalize_model_entry(value, *, alias=None):
    """Canonicalize a worca.models entry to {id, env} form.

    - String value -> {"id": value, "env": {}}
    - Dict value -> must contain "id" (str); "env" defaults to {}; extra keys ignored.
    - Anything else -> raise ValueError.
    - alias (optional): the alias key being normalized; rejected if it contains ':'.
    """
    if alias is not None and ":" in alias:
        raise ValueError(
            f"alias name cannot contain colon: '{alias}'. "
            "Use 'tier:alias' only in agent model references, not as a models key."
        )
    if isinstance(value, str):
        return {"id": value, "env": {}}
    if isinstance(value, dict) and isinstance(value.get("id"), str):
        env = value.get("env") or {}
        if not isinstance(env, dict):
            raise ValueError(f"model env must be a dict, got {type(env).__name__}")
        return {"id": value["id"], "env": dict(env)}
    raise ValueError("model entry must be a string ID or {id, env} object")


def resolve_model(name, models_cfg):
    """Look up a model shorthand in a worca.models config dict.

    Returns (resolved_id, env_dict).  When the name is not in models_cfg,
    falls back to _DEFAULT_MODEL_MAP, then treats it as an opaque
    pass-through ID.
    """
    if name is None:
        return None, {}
    raw = models_cfg.get(name, _DEFAULT_MODEL_MAP.get(name))
    if raw is None:
        return name, {}
    entry = normalize_model_entry(raw)
    return entry["id"], entry["env"]


def _default_global_path() -> str:
    from worca.utils.paths import worca_home
    return os.path.join(worca_home(), "settings.json")


def load_global_settings(*, global_path: str | None = None) -> dict:
    """Load global settings from ~/.worca/settings.json (with .local.json merge).

    Returns {} if the file doesn't exist or contains invalid JSON.
    """
    if global_path is None:
        global_path = _default_global_path()
    return load_settings(global_path)


def load_settings_with_global_fallback(
    settings_path: str,
    *,
    global_path: str | None = None,
) -> dict:
    """Load project settings deep-merged over global (~/.worca/settings.json).

    Global values form the base; project values win on overlap.
    Missing or malformed global file is silently tolerated (warning on bad JSON).

    After merging, attaches ``merged['_worca_tier_views']`` — a stash of per-tier
    raw model maps (user, project, builtin) used by resolve_tier_pinned().
    The stash is internal; the public API is resolve_tier_pinned().
    """
    if global_path is None:
        global_path = _default_global_path()

    # Probe the committed global file first so a malformed-JSON warning is still
    # emitted for it; then read through load_global_settings so the sibling
    # ~/.worca/settings.local.json is deep-merged in. The .local merge mirrors
    # how the project tier (load_settings) and the public load_global_settings
    # API already treat .local. Without it, user-tier model `env` blocks were
    # unreachable: `worca templates import --scope user` of an alt-endpoint alias
    # writes the env (secrets) to ~/.worca/settings.local.json, but a raw
    # json.load of ~/.worca/settings.json never saw it — so both the merged
    # config below and the `user` tier-view stash silently dropped the env.
    try:
        with open(global_path, encoding="utf-8") as f:
            json.load(f)
    except FileNotFoundError:
        global_blob = {}
    except json.JSONDecodeError:
        print(
            f"[settings] Warning: {global_path} contains invalid JSON, ignoring global preferences",
            file=sys.stderr,
        )
        global_blob = {}
    else:
        global_blob = load_global_settings(global_path=global_path)

    project = load_settings(settings_path)
    if not global_blob:
        project.pop("_worca_tier_views", None)
        project["_worca_tier_views"] = {
            "user": {},
            "project": project.get("worca", {}).get("models") or {},
            "builtin": dict(_DEFAULT_MODEL_MAP),
        }
        return project

    merged = deep_merge(global_blob, project)
    # Whole-entry replace for model aliases and per-model pricing: a project-tier
    # entry shadows the user-global entry in entirety (rather than per-field
    # deep-merging). Matches the Models page UX where each alias resolves from
    # exactly one tier; mirrors how Pipeline Templates shadow across tiers.
    for path in _ATOMIC_LEAF_PATHS:
        _replace_atomic_subkeys(merged, project, path)

    # Drop any pre-existing stash (regression guard for JSON round-tripping) and rebuild.
    merged.pop("_worca_tier_views", None)
    merged["_worca_tier_views"] = {
        "user": global_blob.get("worca", {}).get("models") or {},
        "project": project.get("worca", {}).get("models") or {},
        "builtin": dict(_DEFAULT_MODEL_MAP),
    }
    return merged


_VALID_TIERS = frozenset({"user", "project", "builtin"})


def _parse_model_ref(ref: str) -> tuple:
    """Parse a model reference into (tier_or_None, alias).

    Bare alias (no colon) -> (None, alias).
    Qualified 'tier:alias' -> (tier, alias).
    Malformed (unknown tier, empty alias, multiple colons) -> raises ValueError.
    """
    if ":" not in ref:
        return (None, ref)
    parts = ref.split(":")
    if len(parts) != 2:
        raise ValueError(f"malformed model ref '{ref}': expected 'tier:alias' or bare alias")
    tier, alias = parts
    if tier not in _VALID_TIERS:
        raise ValueError(
            f"malformed model ref '{ref}': unknown tier '{tier}', must be one of {sorted(_VALID_TIERS)}"
        )
    if not alias:
        raise ValueError(f"malformed model ref '{ref}': alias must not be empty")
    return (tier, alias)


def resolve_tier_pinned(ref, settings: dict) -> tuple:
    """Resolve a (possibly tier-qualified) model ref from settings.

    Returns (model_id, env_dict, error_msg).
    - ref is None => (None, {}, None).
    - Malformed ref => (None, {}, 'malformed model ref ...').
    - Bare ref => delegates to resolve_model on settings['worca']['models'].
    - Tier-qualified ref without _worca_tier_views stash => falls back to bare merged map.
    - Tier-qualified with stash, alias absent => (None, {}, error message).
    - Tier-qualified and present => (id, env) from that tier's entry verbatim.

    The _worca_tier_views stash is internal; this function is the public API.
    """
    if ref is None:
        return (None, {}, None)

    try:
        tier, alias = _parse_model_ref(ref)
    except ValueError as exc:
        return (None, {}, str(exc))

    if tier is None:
        models_cfg = settings.get("worca", {}).get("models") or {}
        model_id, env = resolve_model(alias, models_cfg)
        return (model_id, env, None)

    # Tier-qualified path.
    stash = settings.get("_worca_tier_views")
    if stash is None:
        if tier == "builtin":
            # No stash but builtin tier pinned — resolve from _DEFAULT_MODEL_MAP,
            # bypassing any user/project override in the merged models.
            model_id, env = resolve_model(alias, _DEFAULT_MODEL_MAP)
            return (model_id, env, None)
        # Other tiers without stash — fall back to merged map for graceful degradation.
        models_cfg = settings.get("worca", {}).get("models") or {}
        model_id, env = resolve_model(alias, models_cfg)
        return (model_id, env, None)

    tier_map = stash.get(tier, {})
    if alias not in tier_map:
        return (None, {}, f"tier-pinned ref '{ref}': alias '{alias}' not defined in {tier} tier")

    entry = normalize_model_entry(tier_map[alias])
    return (entry["id"], entry["env"], None)
