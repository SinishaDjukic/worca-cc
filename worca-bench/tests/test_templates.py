from __future__ import annotations

import json
from pathlib import Path

import pytest

from worca_bench.templates import (
    TemplateRefError,
    parse_ref,
    resolve_for_launch,
)


def test_parse_ref_forms():
    assert parse_ref("builtin:feature") == ("builtin", "feature")
    assert parse_ref("project:tuned") == ("project", "tuned")
    assert parse_ref("feature") == (None, "feature")


def test_parse_ref_unknown_tier():
    with pytest.raises(TemplateRefError):
        parse_ref("weird:x")


def test_builtin_and_bare_passthrough(tmp_path: Path):
    assert resolve_for_launch("builtin:feature", tree=tmp_path, templates={}) == "feature"
    assert resolve_for_launch("feature", tree=tmp_path, templates={}) == "feature"
    # no project template seeded for builtin
    assert not (tmp_path / ".claude" / "templates").exists()


def test_project_template_is_seeded(tmp_path: Path):
    defn = {"id": "tuned", "name": "Tuned", "config": {"agents": {"implementer": {"model": "opus"}}}}
    bare = resolve_for_launch("project:tuned", tree=tmp_path, templates={"tuned": defn})
    assert bare == "tuned"
    seeded = tmp_path / ".claude" / "templates" / "tuned" / "template.json"
    assert seeded.exists()
    data = json.loads(seeded.read_text())
    assert data["id"] == "tuned"
    assert data["config"]["agents"]["implementer"]["model"] == "opus"


def test_user_template_seeded_to_isolated_dir(tmp_path: Path):
    user_dir = tmp_path / "user_templates"
    bare = resolve_for_launch(
        "user:foo", tree=tmp_path, templates={"foo": {"config": {}}},
        user_templates_dir=user_dir,
    )
    assert bare == "foo"
    assert (user_dir / "foo" / "template.json").exists()


def test_missing_definition_raises(tmp_path: Path):
    with pytest.raises(TemplateRefError):
        resolve_for_launch("project:absent", tree=tmp_path, templates={})
