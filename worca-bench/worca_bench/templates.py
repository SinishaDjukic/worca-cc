"""tier:name template resolution (requirement 2).

worca's ``--template`` takes a *bare* id and resolves project > user > builtin.
It does not parse a ``tier:name`` prefix. worca-bench owns that syntax: it parses
``builtin:`` / ``project:`` / ``user:``, seeds project/user template definitions into
the right tier dir, and hands worca the bare id.

Template definitions for non-builtin tiers come from ``profile.templates[name]`` — a
``template.json``-shaped dict ({id, name, config, ...}).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

VALID_TIERS = {"builtin", "project", "user"}


class TemplateRefError(ValueError):
    pass


def parse_ref(ref: str) -> tuple[str | None, str]:
    """Split ``tier:name`` → (tier, name). A bare ``name`` returns (None, name)."""
    if ":" in ref:
        tier, name = ref.split(":", 1)
        if tier not in VALID_TIERS:
            raise TemplateRefError(
                f"unknown template tier {tier!r} in {ref!r}; expected {sorted(VALID_TIERS)}"
            )
        return tier, name
    return None, ref


def _seed_template(dir_: Path, defn: dict[str, Any] | None, name: str) -> None:
    if defn is None:
        raise TemplateRefError(
            f"profile.templates is missing a definition for non-builtin template {name!r}"
        )
    dir_.mkdir(parents=True, exist_ok=True)
    payload = dict(defn)
    payload.setdefault("id", name)
    payload.setdefault("name", name)
    payload.setdefault("builtin", False)
    payload.setdefault("config", {})
    (dir_ / "template.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def resolve_for_launch(
    ref: str,
    *,
    tree: Path,
    templates: dict[str, dict[str, Any]],
    user_templates_dir: Path | None = None,
) -> str:
    """Return the bare id to pass to ``--template``, seeding project/user tiers.

    ``builtin:`` and bare refs pass through (a fresh clone has no shadow, so a bare
    id resolves to the builtin). ``project:`` seeds ``<tree>/.claude/templates/<name>``.
    ``user:`` seeds ``~/.worca/templates/<name>`` (host-global; isolate per CI user).
    """
    tier, name = parse_ref(ref)
    if tier in (None, "builtin"):
        return name
    if tier == "project":
        _seed_template(tree / ".claude" / "templates" / name, templates.get(name), name)
        return name
    if tier == "user":
        base = user_templates_dir or (Path.home() / ".worca" / "templates")
        _seed_template(base / name, templates.get(name), name)
        return name
    raise TemplateRefError(f"unhandled tier in {ref!r}")  # pragma: no cover
