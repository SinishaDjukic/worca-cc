"""Tests for load_settings_with_global_fallback."""

import json

from worca.utils.settings import load_settings_with_global_fallback


class TestLoadSettingsWithGlobalFallback:
    """Deep-merges ~/.worca/settings.json under project blob, project wins."""

    def test_merge_project_wins(self, tmp_path):
        """Project values override global values on overlap."""
        global_file = tmp_path / "global" / "settings.json"
        global_file.parent.mkdir()
        global_file.write_text(json.dumps({
            "worca": {
                "circuit_breaker": {"classifier_model": "sonnet"},
                "parallel": {"cleanup_policy": "always"},
            }
        }))

        project_file = tmp_path / "project" / "settings.json"
        project_file.parent.mkdir()
        project_file.write_text(json.dumps({
            "worca": {
                "circuit_breaker": {"max_consecutive_failures": 5},
            }
        }))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        assert result["worca"]["circuit_breaker"]["max_consecutive_failures"] == 5
        assert result["worca"]["circuit_breaker"]["classifier_model"] == "sonnet"
        assert result["worca"]["parallel"]["cleanup_policy"] == "always"

    def test_missing_global_file(self, tmp_path):
        """Missing global file returns project settings unchanged."""
        project_file = tmp_path / "settings.json"
        project_file.write_text(json.dumps({
            "worca": {"stages": {"plan": {"enabled": True}}}
        }))

        result = load_settings_with_global_fallback(
            str(project_file),
            global_path=str(tmp_path / "nonexistent" / "settings.json"),
        )

        assert result["worca"] == {"stages": {"plan": {"enabled": True}}}

    def test_malformed_global_json(self, tmp_path, capsys):
        """Malformed global JSON logs a warning and returns project settings."""
        global_file = tmp_path / "global_settings.json"
        global_file.write_text("{bad json!!!")

        project_file = tmp_path / "settings.json"
        project_file.write_text(json.dumps({"worca": {"key": "val"}}))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        assert result["worca"] == {"key": "val"}
        captured = capsys.readouterr()
        assert "invalid JSON" in captured.err

    def test_both_missing(self, tmp_path):
        """Both files missing returns empty dict."""
        result = load_settings_with_global_fallback(
            str(tmp_path / "no_project.json"),
            global_path=str(tmp_path / "no_global.json"),
        )
        assert result.get("worca") is None

    def test_global_only_no_project(self, tmp_path):
        """Only global file exists — its values appear in result."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"parallel": {"max_concurrent_pipelines": 7}}
        }))

        result = load_settings_with_global_fallback(
            str(tmp_path / "missing_project.json"),
            global_path=str(global_file),
        )

        assert result["worca"] == {"parallel": {"max_concurrent_pipelines": 7}}

    def test_deep_nested_merge(self, tmp_path):
        """Deep merge works across multiple nesting levels."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {
                "parallel": {"cleanup_policy": "always", "max_concurrent_pipelines": 5},
                "ui": {"worktree_disk_warning_bytes": 1000000},
            }
        }))

        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({
            "worca": {
                "parallel": {"default_base_branch": "develop"},
                "stages": {"plan": {"enabled": True}},
            }
        }))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        assert result["worca"]["parallel"]["cleanup_policy"] == "always"
        assert result["worca"]["parallel"]["max_concurrent_pipelines"] == 5
        assert result["worca"]["parallel"]["default_base_branch"] == "develop"
        assert result["worca"]["ui"]["worktree_disk_warning_bytes"] == 1000000
        assert result["worca"]["stages"]["plan"]["enabled"] is True

    def test_tier_views_populated(self, tmp_path):
        """_worca_tier_views stash has user, project, and builtin tiers."""
        from worca.utils.settings import _DEFAULT_MODEL_MAP
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"fast": "claude-user-fast"}}
        }))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({
            "worca": {"models": {"fast": "claude-project-fast"}}
        }))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        views = result["_worca_tier_views"]
        assert views["user"] == {"fast": "claude-user-fast"}
        assert views["project"] == {"fast": "claude-project-fast"}
        assert "opus" in views["builtin"]
        assert views["builtin"]["opus"] == _DEFAULT_MODEL_MAP["opus"]

    def test_tier_views_builtin_always_present(self, tmp_path):
        """builtin tier is always populated even when no models config exists."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({"worca": {}}))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({"worca": {}}))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        views = result["_worca_tier_views"]
        assert views["builtin"] != {}
        assert "sonnet" in views["builtin"]

    def test_tier_views_stash_regression_dropped(self, tmp_path):
        """Pre-existing _worca_tier_views in input is dropped and rebuilt."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "_worca_tier_views": {"user": {"stale": "old"}, "project": {}, "builtin": {}},
            "worca": {"models": {"mymodel": "fresh-id"}}
        }))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({"worca": {}}))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        # Rebuilt stash — should reflect fresh global models, not the stale stash
        views = result["_worca_tier_views"]
        assert views["user"] == {"mymodel": "fresh-id"}

    def test_tier_views_worktree_case(self, tmp_path):
        """Worktree-local project settings + separate user-global resolves correctly."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"fast": "claude-user-fast", "slow": "claude-user-slow"}}
        }))
        project_file = tmp_path / "worktree" / "settings.json"
        project_file.parent.mkdir()
        project_file.write_text(json.dumps({
            "worca": {"models": {"fast": "claude-worktree-fast"}}
        }))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        views = result["_worca_tier_views"]
        assert views["user"]["fast"] == "claude-user-fast"
        assert views["user"]["slow"] == "claude-user-slow"
        assert views["project"]["fast"] == "claude-worktree-fast"
        assert "fast" not in views["project"] or views["project"]["fast"] == "claude-worktree-fast"

    def test_user_local_env_merges_into_merged_config(self, tmp_path):
        """User-global settings.local.json env deep-merges into the merged config.

        Regression for the user-tier parity bug: the global tier was read with a
        raw json.load that skipped ~/.worca/settings.local.json, so model env
        blocks (alt-endpoint secrets) written there by `templates import
        --scope user` were silently dropped.
        """
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"id": "opus"}}}
        }))
        # Sibling .local carries the env block (secrets), id stays in base.
        global_local = tmp_path / "global.local.json"
        global_local.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"env": {"ANTHROPIC_BASE_URL": "https://alt.example"}}}}
        }))

        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({"worca": {}}))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        merged = result["worca"]["models"]["glm-ds"]
        assert merged["id"] == "opus"
        assert merged["env"]["ANTHROPIC_BASE_URL"] == "https://alt.example"

    def test_user_local_env_in_tier_view_stash(self, tmp_path):
        """The `user` tier-view stash includes env merged from the .local sibling."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"id": "opus"}}}
        }))
        global_local = tmp_path / "global.local.json"
        global_local.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"env": {"ANTHROPIC_AUTH_TOKEN": "tok"}}}}
        }))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({"worca": {}}))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        user_view = result["_worca_tier_views"]["user"]["glm-ds"]
        assert user_view["id"] == "opus"
        assert user_view["env"]["ANTHROPIC_AUTH_TOKEN"] == "tok"

    def test_user_tier_pinned_ref_resolves_local_env(self, tmp_path):
        """resolve_tier_pinned('user:alias') returns env from the .local sibling.

        End-to-end: this is what makes a user-tier template pinned to
        `user:glm-ds` actually route through the alt endpoint.
        """
        from worca.utils.settings import resolve_tier_pinned

        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"id": "opus"}}}
        }))
        global_local = tmp_path / "global.local.json"
        global_local.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"env": {"ANTHROPIC_BASE_URL": "https://alt.example"}}}}
        }))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({"worca": {}}))

        settings = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        model_id, env, err = resolve_tier_pinned("user:glm-ds", settings)
        assert err is None
        assert model_id == "opus"
        assert env == {"ANTHROPIC_BASE_URL": "https://alt.example"}

    def test_project_tier_still_shadows_user_with_local_env(self, tmp_path):
        """Atomic cross-tier replace still holds: a project-tier entry shadows the
        user entry wholesale even when the user entry now carries .local env."""
        global_file = tmp_path / "global.json"
        global_file.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"id": "opus"}}}
        }))
        global_local = tmp_path / "global.local.json"
        global_local.write_text(json.dumps({
            "worca": {"models": {"glm-ds": {"env": {"ANTHROPIC_BASE_URL": "https://user.example"}}}}
        }))
        project_file = tmp_path / "project.json"
        project_file.write_text(json.dumps({
            "worca": {"models": {"glm-ds": "sonnet"}}
        }))

        result = load_settings_with_global_fallback(
            str(project_file), global_path=str(global_file)
        )

        # Project tier wins wholesale — no leakage of the user-tier env.
        assert result["worca"]["models"]["glm-ds"] == "sonnet"
        # But the user tier-view still carries its own merged entry intact.
        user_view = result["_worca_tier_views"]["user"]["glm-ds"]
        assert user_view["env"]["ANTHROPIC_BASE_URL"] == "https://user.example"

    def test_default_global_path(self, tmp_path, monkeypatch):
        """Without explicit global_path, uses $WORCA_HOME/settings.json."""
        fake_home = tmp_path / "home"
        fake_home.mkdir()
        worca_dir = fake_home / ".worca"
        worca_dir.mkdir()
        global_file = worca_dir / "settings.json"
        global_file.write_text(json.dumps({
            "worca": {"circuit_breaker": {"classifier_model": "opus"}}
        }))

        monkeypatch.setenv("WORCA_HOME", str(worca_dir))

        project_file = tmp_path / "settings.json"
        project_file.write_text(json.dumps({
            "worca": {"circuit_breaker": {"max_consecutive_failures": 2}}
        }))

        result = load_settings_with_global_fallback(str(project_file))

        assert result["worca"]["circuit_breaker"]["classifier_model"] == "opus"
        assert result["worca"]["circuit_breaker"]["max_consecutive_failures"] == 2
