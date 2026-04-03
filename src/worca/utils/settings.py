"""Shared settings loader with .local.json deep-merge support.

All pipeline code should use load_settings() instead of reading settings.json
directly. This merges the base settings.json with a sibling settings.local.json
(if it exists), letting developers keep machine-specific config (webhooks, etc.)
out of version control.
"""

import json
import os
import sys


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


def _local_path_for(settings_path: str) -> str:
    """Derive the .local.json sibling path from a base settings path."""
    root, ext = os.path.splitext(settings_path)
    return root + ".local" + ext


def load_settings(settings_path: str) -> dict:
    """Load base settings and deep-merge any sibling .local.json over them.

    - If settings_path does not exist, returns {}.
    - If the .local.json sibling does not exist, returns the base as-is.
    - If .local.json has invalid JSON, logs a warning and returns the base.
    """
    try:
        with open(settings_path) as f:
            base = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

    local_path = _local_path_for(settings_path)
    if not os.path.exists(local_path):
        return base

    try:
        with open(local_path) as f:
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
