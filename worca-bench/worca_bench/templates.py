"""tier:name template resolution (requirement 2).

worca's ``--template`` takes a *bare* id and resolves project > user > builtin.
It does not parse a ``tier:name`` prefix. worca-bench owns that syntax: it parses
``builtin:`` / ``project:`` / ``user:``, seeds project/user template definitions into
the right tier dir, and hands worca the bare id.

Template definitions for non-builtin tiers may come from ``profile.templates[name]`` — a
``template.json``-shaped dict ({id, name, config, ...}) — which makes a profile
self-contained for isolated/CI hosts. When the profile carries no such definition but
the template already exists on disk in the right tier dir (e.g. a user template under
``~/.worca/templates/<name>``), the ref resolves seamlessly against it with no copy —
the same template worca's own resolution would pick. Only a ref with neither an embedded
definition nor an on-disk template is an error.
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


def _seed_template(dir_: Path, defn: dict[str, Any], name: str) -> None:
    """Materialize a ``template.json`` for ``name`` from an explicit profile definition.

    Only writes ``template.json`` — any sibling ``agents/`` override dir already on disk
    is preserved (``mkdir(exist_ok=True)`` never deletes).
    """
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
    """Return the bare id to pass to ``--template``, seeding project/user tiers as needed.

    ``builtin:`` and bare refs pass through untouched — worca's own
    project > user > builtin resolution handles them (a bare id finds an existing
    user/project template, or falls back to the builtin).

    For an explicit ``project:`` / ``user:`` ref, the tier dir is
    ``<tree>/.claude/templates/<name>`` (project) or ``~/.worca/templates/<name>``
    (user, host-global; isolate per CI user). Resolution there is:

    1. ``profile.templates[name]`` present → materialize it (self-contained / CI path;
       overrides any on-disk copy so the run host need not already have the template).
    2. no definition, but ``template.json`` already exists on disk → use it as-is,
       **no copy/overwrite** (the seamless host path — what worca would resolve anyway).
    3. neither → hard error.
    """
    tier, name = parse_ref(ref)
    if tier in (None, "builtin"):
        return name
    if tier == "project":
        dir_ = tree / ".claude" / "templates" / name
    elif tier == "user":
        base = user_templates_dir or (Path.home() / ".worca" / "templates")
        dir_ = base / name
    else:  # pragma: no cover - parse_ref already rejects unknown tiers
        raise TemplateRefError(f"unhandled tier in {ref!r}")

    defn = templates.get(name)
    if defn is not None:
        _seed_template(dir_, defn, name)
    elif not (dir_ / "template.json").exists():
        raise TemplateRefError(
            f"template {name!r} ({tier} tier) has no definition in profile.templates "
            f"and no existing template at {dir_}"
        )
    # else: template already present on disk — resolve seamlessly, leave it untouched.
    return name
