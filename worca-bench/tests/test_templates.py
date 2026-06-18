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


def test_user_template_passthrough_when_present_on_host(tmp_path: Path):
    # A `user:` ref with no profile.templates definition resolves seamlessly against
    # an existing host template — worca's own project>user>builtin resolution finds it.
    # worca-bench must NOT require an embedded copy, and must NOT overwrite the host one.
    user_dir = tmp_path / "user_templates"
    host = user_dir / "foo" / "template.json"
    host.parent.mkdir(parents=True)
    host.write_text(json.dumps({"id": "foo", "name": "Host Foo", "config": {"x": 1}}))

    bare = resolve_for_launch(
        "user:foo", tree=tmp_path, templates={}, user_templates_dir=user_dir
    )
    assert bare == "foo"
    # untouched — no copy / overwrite from the (empty) profile templates
    data = json.loads(host.read_text())
    assert data["name"] == "Host Foo"
    assert data["config"] == {"x": 1}


def test_project_template_passthrough_when_present_in_tree(tmp_path: Path):
    # Same seamless fallback for the project tier: an on-disk template in the work
    # tree is used as-is when the profile carries no definition.
    existing = tmp_path / ".claude" / "templates" / "tuned" / "template.json"
    existing.parent.mkdir(parents=True)
    existing.write_text(json.dumps({"id": "tuned", "config": {"agents": {}}}))

    bare = resolve_for_launch("project:tuned", tree=tmp_path, templates={})
    assert bare == "tuned"
    assert json.loads(existing.read_text())["id"] == "tuned"  # untouched


def test_explicit_definition_overrides_on_disk_template(tmp_path: Path):
    # When a profile DOES carry a definition, it materializes (overrides) the host copy
    # — preserving the self-contained / CI path for isolated hosts.
    user_dir = tmp_path / "user_templates"
    host = user_dir / "foo" / "template.json"
    host.parent.mkdir(parents=True)
    host.write_text(json.dumps({"id": "foo", "name": "Stale Host", "config": {}}))

    bare = resolve_for_launch(
        "user:foo", tree=tmp_path,
        templates={"foo": {"name": "Profile Foo", "config": {"y": 2}}},
        user_templates_dir=user_dir,
    )
    assert bare == "foo"
    data = json.loads(host.read_text())
    assert data["name"] == "Profile Foo"
    assert data["config"] == {"y": 2}


def test_missing_definition_and_no_on_disk_raises(tmp_path: Path):
    # Neither an embedded definition nor an existing on-disk template -> hard error.
    with pytest.raises(TemplateRefError):
        resolve_for_launch("project:absent", tree=tmp_path, templates={})
