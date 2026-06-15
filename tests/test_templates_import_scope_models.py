"""End-to-end coverage for the v2 scope-honest bundle import.

Pins the post-0.52.0 semantics:
1. Templates, model aliases, and pricing land in the SAME tier picked via
   ``--scope`` (project or user). Earlier versions hardcoded models/pricing
   to user-global regardless of ``--scope``; see MIGRATION.md.
2. Each imported model entry is stamped with ``_imported_from: <bundle-name>``
   in settings.json so the Models page can surface an attribution badge.
3. ``_derive_bundle_label`` boils the source down to a short human label
   that matches paths, gist sources, and HTTP URLs.
"""

import json
from argparse import Namespace
from pathlib import Path

import pytest

from worca.cli.templates import (
    _derive_bundle_label,
    _rewrite_template_model_refs,
    cmd_templates_import,
)


class TestDeriveBundleLabel:
    """The label shown on the imported-from badge — short, human-readable."""

    def test_local_file_basename(self):
        assert _derive_bundle_label("/tmp/feature-fast-bundle.json") == "feature-fast-bundle.json"

    def test_relative_path_basename(self):
        assert _derive_bundle_label("./bundles/quick-fix.json") == "quick-fix.json"

    def test_http_url_basename(self):
        assert _derive_bundle_label("https://example.com/path/feature.json") == "feature.json"

    def test_http_url_with_query_string(self):
        assert _derive_bundle_label("https://example.com/feature.json?v=2") == "feature.json"

    def test_http_url_with_fragment(self):
        assert _derive_bundle_label("https://example.com/feature.json#section") == "feature.json"

    def test_gist_id(self):
        # Gist source has no path slashes — full source preserved.
        assert _derive_bundle_label("gist:abcdef123456") == "gist:abcdef123456"

    def test_empty_source(self):
        assert _derive_bundle_label("") == ""

    def test_trailing_slash_stripped(self):
        assert _derive_bundle_label("https://example.com/dir/") == "dir"


def _write_bundle(path: Path, *, with_models: bool = True, with_pricing: bool = True) -> None:
    """Write a minimal v1-shape JSON bundle suitable for cmd_templates_import."""
    manifest = {
        "worca_bundle_version": 1,
        "templates": [
            {
                "id": "imported-tpl",
                "name": "Imported Template",
                "description": "from a bundle",
                "tags": [],
                "params": {},
                "config": {
                    "agents": {
                        "planner": {"model": "custom-alias"},
                    },
                },
            }
        ],
    }
    if with_models:
        manifest["models"] = {
            "custom-alias": {
                "id": "claude-opus-4-7",
                "env": {"ANTHROPIC_BASE_URL": "https://example.com/"},
            }
        }
    if with_pricing:
        manifest["pricing"] = {
            "models": {
                "custom-alias": {
                    "input_per_mtok": 1.5,
                    "output_per_mtok": 7.5,
                }
            }
        }
    path.write_text(json.dumps(manifest), encoding="utf-8")


@pytest.fixture
def project_dir(tmp_path, monkeypatch):
    """A fake project root with .git/ plus a tmp HOME so user-tier writes
    land in `tmp/.worca/` instead of the real `~/.worca/`. WORCA_HOME alone
    isn't enough — the templates resolver uses Path.home() directly, while
    settings.py honors WORCA_HOME. Patching $HOME and exporting WORCA_HOME
    to the same root keeps both paths redirected.

    On Windows, ``Path.home()`` resolves from ``USERPROFILE`` (not ``HOME``),
    so without redirecting it too the user-scope write would land in the
    runner's real profile and the strict-fs-isolation guard would fail.
    """
    project = tmp_path / "project"
    project.mkdir()
    (project / ".git").mkdir()  # _find_settings_path walks up to find this
    (project / ".claude").mkdir()
    (project / ".claude" / "templates").mkdir()

    fake_home = tmp_path / "fake-home"
    fake_home.mkdir()
    worca_home = fake_home / ".worca"
    worca_home.mkdir()
    (worca_home / "templates").mkdir()
    monkeypatch.setenv("HOME", str(fake_home))
    monkeypatch.setenv("USERPROFILE", str(fake_home))
    monkeypatch.setenv("WORCA_HOME", str(worca_home))

    # cmd_templates_import resolves project settings against cwd → .git walk.
    monkeypatch.chdir(project)
    return project, worca_home


def _make_import_args(*, source: str, scope: str = "project") -> Namespace:
    return Namespace(
        from_source=source,
        scope=scope,
        non_interactive=True,
        on_model_conflict="abort",
        on_template_conflict="abort",
        preview=False,
        resolutions=None,
        project_root=None,
        ext_preview=None,
    )


class TestImportScopeHonesty:
    """`--scope project` lands models in the project's settings.json, not user-global."""

    def test_scope_project_writes_models_to_project_settings(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "bundle.json"
        _write_bundle(bundle)

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        project_settings = project / ".claude" / "settings.json"
        assert project_settings.exists()
        data = json.loads(project_settings.read_text())
        assert "custom-alias" in data.get("worca", {}).get("models", {})

        # User-global must remain empty.
        user_settings = worca_home / "settings.json"
        if user_settings.exists():
            user = json.loads(user_settings.read_text())
            assert "custom-alias" not in user.get("worca", {}).get("models", {})

    def test_scope_user_writes_models_to_user_global(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "bundle.json"
        _write_bundle(bundle)

        cmd_templates_import(_make_import_args(source=str(bundle), scope="user"))

        user_settings = worca_home / "settings.json"
        assert user_settings.exists()
        data = json.loads(user_settings.read_text())
        assert "custom-alias" in data.get("worca", {}).get("models", {})

        # Project's own settings.json must NOT carry the alias.
        project_settings = project / ".claude" / "settings.json"
        if project_settings.exists():
            project_data = json.loads(project_settings.read_text())
            assert "custom-alias" not in project_data.get("worca", {}).get("models", {})


class TestImportProvenanceStamping:
    """Each imported model entry gets ``_imported_from: <bundle-name>``."""

    def test_imported_models_get_imported_from_field(self, project_dir, capsys):
        project, _worca_home = project_dir
        bundle = project / "shareable-bundle.json"
        _write_bundle(bundle)

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        data = json.loads((project / ".claude" / "settings.json").read_text())
        entry = data["worca"]["models"]["custom-alias"]
        # Object-form preserved; bundle metadata added alongside id.
        assert entry.get("_imported_from") == "shareable-bundle.json"
        assert entry.get("id") == "claude-opus-4-7"

    def test_string_form_alias_is_promoted_to_object_form(self, project_dir, capsys):
        """If the bundle ships an alias as a bare string, the stamp upgrades
        it to the object form `{id, _imported_from}` so the metadata survives.
        """
        project, _ = project_dir
        bundle = project / "bare.json"
        bundle.write_text(
            json.dumps(
                {
                    "worca_bundle_version": 1,
                    "templates": [
                        {
                            "id": "imported-tpl",
                            "name": "T",
                            "description": "",
                            "tags": [],
                            "params": {},
                            "config": {"agents": {"planner": {"model": "bare"}}},
                        }
                    ],
                    "models": {"bare": "claude-opus-4-7"},
                }
            ),
            encoding="utf-8",
        )

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        data = json.loads((project / ".claude" / "settings.json").read_text())
        entry = data["worca"]["models"]["bare"]
        assert isinstance(entry, dict)
        assert entry["id"] == "claude-opus-4-7"
        assert entry["_imported_from"] == "bare.json"

    def test_pricing_entries_land_in_same_tier_as_models(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "with-pricing.json"
        _write_bundle(bundle, with_pricing=True)

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        data = json.loads((project / ".claude" / "settings.json").read_text())
        pricing = data.get("worca", {}).get("pricing", {}).get("models", {})
        assert "custom-alias" in pricing
        assert pricing["custom-alias"]["input_per_mtok"] == 1.5
        assert pricing["custom-alias"]["output_per_mtok"] == 7.5


def _write_bundle_with_model_ref(
    path: Path, *, model_ref: str, alias: str = "glm-ds", model_id: str = "claude-sonnet-4-6"
) -> None:
    """Write a minimal bundle whose planner.model is the given ref string."""
    manifest = {
        "worca_bundle_version": 1,
        "templates": [
            {
                "id": "ref-tpl",
                "name": "Ref Template",
                "description": "",
                "tags": [],
                "params": {},
                "config": {"agents": {"planner": {"model": model_ref}}},
            }
        ],
        "models": {alias: {"id": model_id}},
    }
    path.write_text(json.dumps(manifest), encoding="utf-8")


class TestAutoPinModelRefs:
    """Bare model refs are auto-pinned to --scope on import (D3)."""

    def test_bare_ref_pinned_to_user_scope(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="glm-ds")

        cmd_templates_import(_make_import_args(source=str(bundle), scope="user"))

        tpl_path = worca_home / "templates" / "ref-tpl" / "template.json"
        assert tpl_path.exists()
        tpl = json.loads(tpl_path.read_text())
        assert tpl["config"]["agents"]["planner"]["model"] == "user:glm-ds"

    def test_bare_ref_pinned_to_project_scope(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="glm-ds")

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        tpl_path = project / ".claude" / "templates" / "ref-tpl" / "template.json"
        assert tpl_path.exists()
        tpl = json.loads(tpl_path.read_text())
        assert tpl["config"]["agents"]["planner"]["model"] == "project:glm-ds"

    def test_builtin_ref_preserved_unchanged(self, project_dir, capsys):
        """builtin:opus passes through without modification."""
        project, worca_home = project_dir
        bundle = project / "b.json"
        # builtin refs have no alias in the models map — write without models.
        manifest = {
            "worca_bundle_version": 1,
            "templates": [
                {
                    "id": "ref-tpl",
                    "name": "Ref Template",
                    "description": "",
                    "tags": [],
                    "params": {},
                    "config": {"agents": {"planner": {"model": "builtin:opus"}}},
                }
            ],
        }
        bundle.write_text(json.dumps(manifest), encoding="utf-8")

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        tpl_path = project / ".claude" / "templates" / "ref-tpl" / "template.json"
        tpl = json.loads(tpl_path.read_text())
        assert tpl["config"]["agents"]["planner"]["model"] == "builtin:opus"

    def test_renamed_alias_ref_pinned(self, project_dir, capsys):
        """When glm-ds collides and is renamed to glm-ds-01, the ref becomes project:glm-ds-01."""
        project, worca_home = project_dir

        # Pre-populate project settings with an existing glm-ds that differs.
        existing_settings = {
            "worca": {
                "models": {
                    "glm-ds": {"id": "claude-opus-4-7"},
                }
            }
        }
        settings_path = project / ".claude" / "settings.json"
        settings_path.write_text(json.dumps(existing_settings), encoding="utf-8")

        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="glm-ds")

        # Use resolutions to rename instead of aborting on collision.
        resolutions = {"models": {"glm-ds": {"action": "rename"}}}
        res_path = project / "res.json"
        res_path.write_text(json.dumps(resolutions), encoding="utf-8")

        args = _make_import_args(source=str(bundle), scope="project")
        args.resolutions = str(res_path)
        cmd_templates_import(args)

        tpl_path = project / ".claude" / "templates" / "ref-tpl" / "template.json"
        tpl = json.loads(tpl_path.read_text())
        assert tpl["config"]["agents"]["planner"]["model"] == "project:glm-ds-01"

    def test_wire_format_violation_warns_and_is_rewritten(self, project_dir, capsys):
        """A ref like 'project:glm-ds' in the bundle is a violation — warn, treat as bare."""
        project, worca_home = project_dir
        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="project:glm-ds")

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        captured = capsys.readouterr()
        assert "wire-format violation" in captured.err or "wire_format_violation" in captured.err

        tpl_path = project / ".claude" / "templates" / "ref-tpl" / "template.json"
        tpl = json.loads(tpl_path.read_text())
        # After stripping the violation prefix, the bare alias is pinned to --scope.
        assert tpl["config"]["agents"]["planner"]["model"] == "project:glm-ds"

    def test_info_block_emitted_for_auto_pin(self, project_dir, capsys):
        """An info block listing the rewrites is printed to stderr."""
        project, worca_home = project_dir
        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="glm-ds")

        cmd_templates_import(_make_import_args(source=str(bundle), scope="project"))

        captured = capsys.readouterr()
        assert "rewrote" in captured.err
        assert "glm-ds" in captured.err
        assert "project:glm-ds" in captured.err


class TestUserScopeImportRoundTrip:
    """`import --scope user` of an alt-endpoint alias resolves end-to-end.

    Regression for the user-tier parity bug: import writes the model `env`
    (secrets) to ~/.worca/settings.local.json and auto-pins the template ref to
    `user:<alias>`, but the resolver used to read ~/.worca/settings.json raw,
    silently dropping the env — so the pinned ref ran against the wrong endpoint.
    """

    def test_user_import_env_lands_in_local_and_resolves(self, project_dir, capsys):
        from worca.utils.settings import (
            load_settings_with_global_fallback,
            resolve_tier_pinned,
        )

        project, worca_home = project_dir
        bundle = project / "bundle.json"
        _write_bundle(bundle)  # custom-alias carries env={ANTHROPIC_BASE_URL: ...}

        cmd_templates_import(_make_import_args(source=str(bundle), scope="user"))

        # id stays in the committed user settings.json; env (secret) in .local.
        user_settings = worca_home / "settings.json"
        user_local = worca_home / "settings.local.json"
        assert user_local.exists(), "import --scope user must write env to settings.local.json"
        local_data = json.loads(user_local.read_text())
        assert (
            local_data["worca"]["models"]["custom-alias"]["env"]["ANTHROPIC_BASE_URL"]
            == "https://example.com/"
        )

        # The auto-pinned template ref is user:custom-alias.
        tpl = json.loads(
            (worca_home / "templates" / "imported-tpl" / "template.json").read_text()
        )
        assert tpl["config"]["agents"]["planner"]["model"] == "user:custom-alias"

        # End-to-end: the resolver now sees the .local env for the user tier.
        settings = load_settings_with_global_fallback(
            str(project / ".claude" / "settings.json"),
            global_path=str(user_settings),
        )
        model_id, env, err = resolve_tier_pinned("user:custom-alias", settings)
        assert err is None
        assert model_id == "claude-opus-4-7"
        assert env.get("ANTHROPIC_BASE_URL") == "https://example.com/"


class TestBuildCollisionPreviewRefRewrites:
    """_build_collision_preview surfaces ref_rewrites for the UI dialog."""

    def test_ref_rewrites_included_in_preview(self, project_dir, capsys):
        project, worca_home = project_dir
        bundle = project / "b.json"
        _write_bundle_with_model_ref(bundle, model_ref="glm-ds")

        args = _make_import_args(source=str(bundle), scope="project")
        args.preview = True
        cmd_templates_import(args)

        captured = capsys.readouterr()
        preview = json.loads(captured.out)
        assert "ref_rewrites" in preview
        rewrites = preview["ref_rewrites"]
        assert len(rewrites) == 1
        rw = rewrites[0]
        assert rw["template_id"] == "ref-tpl"
        assert rw["role"] == "planner"
        assert rw["old"] == "glm-ds"
        assert rw["new"] == "project:glm-ds"
        assert rw["reason"] == "auto_pin"


class TestRewriteTemplateModelRefsUnit:
    """Unit tests for _rewrite_template_model_refs extended behaviour."""

    def _make_templates(self, *role_model_pairs, tid="t1"):
        agents = {role: {"model": model} for role, model in role_model_pairs}
        return {tid: {"config": {"agents": agents}}}

    def test_bare_rewritten_to_landing_tier(self):
        templates = self._make_templates(("planner", "my-model"))
        rewrites = _rewrite_template_model_refs(templates, {}, landing_tier="user")
        assert templates["t1"]["config"]["agents"]["planner"]["model"] == "user:my-model"
        assert len(rewrites) == 1
        assert rewrites[0][2] == "my-model"
        assert rewrites[0][3] == "user:my-model"
        assert rewrites[0][4] == "auto_pin"

    def test_builtin_preserved(self):
        templates = self._make_templates(("planner", "builtin:opus"))
        rewrites = _rewrite_template_model_refs(templates, {}, landing_tier="project")
        assert templates["t1"]["config"]["agents"]["planner"]["model"] == "builtin:opus"
        assert rewrites == []

    def test_rename_map_applied_before_pin(self):
        templates = self._make_templates(("planner", "old-alias"))
        rewrites = _rewrite_template_model_refs(
            templates, {"old-alias": "new-alias"}, landing_tier="project"
        )
        assert templates["t1"]["config"]["agents"]["planner"]["model"] == "project:new-alias"
        assert rewrites[0][4] == "auto_pin_after_rename"

    def test_wire_format_violation_emits_warning(self, capsys):
        templates = self._make_templates(("planner", "project:some-alias"))
        rewrites = _rewrite_template_model_refs(templates, {}, landing_tier="user")
        captured = capsys.readouterr()
        assert "wire_format_violation" in captured.err or "wire-format violation" in captured.err
        # After treating as bare, it's pinned to landing_tier.
        assert templates["t1"]["config"]["agents"]["planner"]["model"] == "user:some-alias"
        assert rewrites[0][4] == "wire_format_violation"

    def test_user_tier_violation_treated_as_bare(self, capsys):
        templates = self._make_templates(("planner", "user:my-alias"))
        _rewrite_template_model_refs(templates, {}, landing_tier="project")
        captured = capsys.readouterr()
        assert "wire_format_violation" in captured.err or "wire-format violation" in captured.err
        assert templates["t1"]["config"]["agents"]["planner"]["model"] == "project:my-alias"
