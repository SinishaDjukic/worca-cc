# Settings loader tests
"""Tests for the shared settings loader (deep_merge + load_settings)."""

import json
import os

import pytest

from worca.utils.settings import deep_merge, load_settings, normalize_model_entry


# ---------------------------------------------------------------------------
# TestDeepMerge
# ---------------------------------------------------------------------------


class TestDeepMerge:
    def test_empty_override(self):
        base = {"a": 1, "b": {"c": 2}}
        result = deep_merge(base, {})
        assert result == {"a": 1, "b": {"c": 2}}

    def test_empty_base(self):
        override = {"x": 10}
        result = deep_merge({}, override)
        assert result == {"x": 10}

    def test_both_empty(self):
        assert deep_merge({}, {}) == {}

    def test_scalar_override(self):
        base = {"a": 1, "b": 2}
        override = {"b": 99}
        result = deep_merge(base, override)
        assert result == {"a": 1, "b": 99}

    def test_nested_merge(self):
        base = {"worca": {"agents": {"planner": "opus"}, "loops": {"a": 1}}}
        override = {"worca": {"agents": {"implementer": "sonnet"}}}
        result = deep_merge(base, override)
        assert result == {
            "worca": {
                "agents": {"planner": "opus", "implementer": "sonnet"},
                "loops": {"a": 1},
            }
        }

    def test_list_replacement(self):
        """Lists in override replace base lists entirely (no concatenation)."""
        base = {"tags": [1, 2, 3], "nested": {"items": ["a"]}}
        override = {"tags": [99], "nested": {"items": ["x", "y"]}}
        result = deep_merge(base, override)
        assert result["tags"] == [99]
        assert result["nested"]["items"] == ["x", "y"]

    def test_no_mutate(self):
        """Neither base nor override should be mutated."""
        base = {"a": {"b": 1}}
        override = {"a": {"c": 2}}
        base_copy = json.loads(json.dumps(base))
        override_copy = json.loads(json.dumps(override))

        deep_merge(base, override)

        assert base == base_copy
        assert override == override_copy

    def test_new_key_in_override(self):
        base = {"a": 1}
        override = {"b": 2}
        assert deep_merge(base, override) == {"a": 1, "b": 2}

    def test_override_dict_with_scalar(self):
        """A scalar in override replaces a dict in base."""
        base = {"a": {"nested": True}}
        override = {"a": "replaced"}
        assert deep_merge(base, override) == {"a": "replaced"}

    def test_override_scalar_with_dict(self):
        """A dict in override replaces a scalar in base."""
        base = {"a": "string"}
        override = {"a": {"nested": True}}
        assert deep_merge(base, override) == {"a": {"nested": True}}

    def test_deeply_nested(self):
        base = {"l1": {"l2": {"l3": {"l4": "base"}}}}
        override = {"l1": {"l2": {"l3": {"l4": "override", "new": True}}}}
        result = deep_merge(base, override)
        assert result == {"l1": {"l2": {"l3": {"l4": "override", "new": True}}}}

    def test_null_override(self):
        """None values in override should replace base values."""
        base = {"a": 1, "b": 2}
        override = {"a": None}
        assert deep_merge(base, override) == {"a": None, "b": 2}


# ---------------------------------------------------------------------------
# TestLoadSettings
# ---------------------------------------------------------------------------


class TestLoadSettings:
    def test_missing_base_file(self):
        """Missing base file returns empty dict."""
        result = load_settings("/nonexistent/path/settings.json")
        assert result == {}

    def test_base_only(self, tmp_path):
        """No .local.json returns base as-is."""
        base = {"worca": {"agents": {"planner": "opus"}}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))

        result = load_settings(str(settings_file))
        assert result == base

    def test_merge(self, tmp_path):
        """Both files exist: returns deep-merged result."""
        base = {"worca": {"agents": {"planner": "opus"}, "loops": {"a": 5}}}
        local = {"worca": {"agents": {"planner": "sonnet"}}}

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result == {
            "worca": {
                "agents": {"planner": "sonnet"},
                "loops": {"a": 5},
            }
        }

    def test_invalid_local_json(self, tmp_path, capsys):
        """Invalid .local.json logs warning and returns base."""
        base = {"key": "value"}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text("{bad json!!!")

        result = load_settings(str(settings_file))
        assert result == base
        captured = capsys.readouterr()
        assert "invalid JSON" in captured.err

    def test_invalid_base_json(self, tmp_path):
        """Invalid base JSON returns empty dict."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text("{not json}")

        result = load_settings(str(settings_file))
        assert result == {}

    def test_partial_override(self, tmp_path):
        """.local.json overrides only some keys; rest come from base."""
        base = {
            "hooks": {"a": 1},
            "worca": {
                "stages": {"plan": {"enabled": True}},
                "webhooks": [],
            },
        }
        local = {
            "worca": {
                "webhooks": [{"url": "http://localhost:3400"}],
            }
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        # hooks untouched
        assert result["hooks"] == {"a": 1}
        # stages untouched
        assert result["worca"]["stages"] == {"plan": {"enabled": True}}
        # webhooks overridden
        assert result["worca"]["webhooks"] == [{"url": "http://localhost:3400"}]

    def test_empty_local_file(self, tmp_path):
        """Empty .local.json ({}) returns base unchanged."""
        base = {"worca": {"a": 1}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text("{}")

        result = load_settings(str(settings_file))
        assert result == base

    def test_local_path_derivation(self, tmp_path):
        """Verify that .local.json path is correctly derived from base path."""
        base = {"a": 1}
        local = {"b": 2}

        # Use a non-standard filename
        settings_file = tmp_path / "config.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "config.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result == {"a": 1, "b": 2}

    def test_real_world_webhook_override(self, tmp_path):
        """Simulate the main use case: base has empty webhooks, local adds localhost."""
        base = {
            "worca": {
                "events": {"enabled": True},
                "webhooks": [],
                "budget": {"warning_pct": 80},
            }
        }
        local = {
            "worca": {
                "webhooks": [
                    {
                        "url": "http://localhost:3400/api/webhooks/inbox",
                        "secret": "",
                        "events": [],
                        "timeout_ms": 10000,
                        "max_retries": 3,
                        "rate_limit_ms": 1000,
                        "control": False,
                    }
                ]
            }
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert len(result["worca"]["webhooks"]) == 1
        assert result["worca"]["webhooks"][0]["url"] == "http://localhost:3400/api/webhooks/inbox"
        # events and budget from base preserved
        assert result["worca"]["events"]["enabled"] is True
        assert result["worca"]["budget"]["warning_pct"] == 80


# ---------------------------------------------------------------------------
# TestParallelSettings
# ---------------------------------------------------------------------------


class TestParallelSettings:
    """Tests for the worca.parallel settings section.

    Post-W-049, max_concurrent_pipelines and cleanup_policy are global-only
    keys (live in ~/.worca/settings.json). The project template only contains
    project-scoped keys: default_base_branch and worktree_base_dir.
    """

    PROJECT_PARALLEL_DEFAULTS = {
        "default_base_branch": "main",
        "worktree_base_dir": ".worktrees",
    }

    ALL_PARALLEL_DEFAULTS = {
        "max_concurrent_pipelines": 10,
        "default_base_branch": "main",
        "cleanup_policy": "never",
        "worktree_base_dir": ".worktrees",
    }

    def _base_with_parallel(self, parallel_overrides=None):
        """Return a minimal settings dict containing the parallel section."""
        parallel = dict(self.ALL_PARALLEL_DEFAULTS)
        if parallel_overrides:
            parallel.update(parallel_overrides)
        return {"worca": {"parallel": parallel}}

    def test_parallel_defaults_present(self, tmp_path):
        """Base settings contain all parallel keys with correct defaults."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))

        result = load_settings(str(settings_file))
        p = result["worca"]["parallel"]

        assert p["max_concurrent_pipelines"] == 10
        assert p["default_base_branch"] == "main"
        assert p["cleanup_policy"] == "never"
        assert p["worktree_base_dir"] == ".worktrees"

    def test_local_override_max_concurrent(self, tmp_path):
        """Local override can change max_concurrent_pipelines."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"parallel": {"max_concurrent_pipelines": 5}}
        }))

        result = load_settings(str(settings_file))
        p = result["worca"]["parallel"]

        assert p["max_concurrent_pipelines"] == 5
        assert p["default_base_branch"] == "main"
        assert p["cleanup_policy"] == "never"
        assert p["worktree_base_dir"] == ".worktrees"

    def test_local_override_cleanup_policy(self, tmp_path):
        """Local override can change cleanup_policy."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"parallel": {"cleanup_policy": "always"}}
        }))

        result = load_settings(str(settings_file))
        assert result["worca"]["parallel"]["cleanup_policy"] == "always"

    def test_local_override_worktree_base_dir(self, tmp_path):
        """Local override can change worktree_base_dir."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"parallel": {"worktree_base_dir": "/tmp/my-worktrees"}}
        }))

        result = load_settings(str(settings_file))
        assert result["worca"]["parallel"]["worktree_base_dir"] == "/tmp/my-worktrees"

    def test_local_override_default_base_branch(self, tmp_path):
        """Local override can change default_base_branch."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"parallel": {"default_base_branch": "develop"}}
        }))

        result = load_settings(str(settings_file))
        assert result["worca"]["parallel"]["default_base_branch"] == "develop"

    def test_parallel_merge_preserves_siblings(self, tmp_path):
        """Overriding parallel keys does not affect sibling worca sections."""
        base = {
            "worca": {
                "parallel": dict(self.ALL_PARALLEL_DEFAULTS),
                "budget": {"warning_pct": 80, "max_cost_usd": None},
                "events": {"enabled": True},
            }
        }
        local = {
            "worca": {"parallel": {"max_concurrent_pipelines": 20}}
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result["worca"]["parallel"]["max_concurrent_pipelines"] == 20
        assert result["worca"]["budget"]["warning_pct"] == 80
        assert result["worca"]["events"]["enabled"] is True

    def test_real_settings_has_parallel_section(self):
        """The src/worca/settings.json contains the project-scoped parallel keys."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "parallel" in result.get("worca", {}), \
            "worca.parallel section missing from src/worca/settings.json"
        p = result["worca"]["parallel"]
        assert p["default_base_branch"] == "main"
        assert p["worktree_base_dir"] == ".worktrees"
        assert "max_concurrent_pipelines" not in p, \
            "global-only key max_concurrent_pipelines should not be in project template"
        assert "cleanup_policy" not in p, \
            "global-only key cleanup_policy should not be in project template"


# ---------------------------------------------------------------------------
# TestWorkspaceSettings
# ---------------------------------------------------------------------------


class TestWorkspaceSettings:
    """Tests for the worca.workspace settings section (W-047 §8 / Phase 1)."""

    WORKSPACE_DEFAULTS = {
        "init_timeout_seconds": 60,
        "max_parallel": 5,
        "context_cap_bytes": 8192,
        "failure_threshold": 0.30,
    }

    def test_real_settings_has_workspace_section(self):
        """The src/worca/settings.json contains the workspace section."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "workspace" in result.get("worca", {}), \
            "worca.workspace section missing from src/worca/settings.json"

    def test_workspace_defaults_values(self):
        """Workspace defaults have the expected keys and values."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        ws = result["worca"]["workspace"]

        assert ws["init_timeout_seconds"] == 60
        assert ws["max_parallel"] == 5
        assert ws["context_cap_bytes"] == 8192
        assert ws["failure_threshold"] == 0.30

    def test_workspace_defaults_match_code_constants(self):
        """Settings defaults match the hardcoded constants in workspace code."""
        from worca.workspace.init import _DEFAULT_TIMEOUT
        from worca.workspace.dag_executor import CONTEXT_CAP_BYTES

        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        ws = result["worca"]["workspace"]

        assert ws["init_timeout_seconds"] == _DEFAULT_TIMEOUT
        assert ws["context_cap_bytes"] == CONTEXT_CAP_BYTES

    def test_local_override_init_timeout(self, tmp_path):
        """Local override can change init_timeout_seconds."""
        base = {"worca": {"workspace": dict(self.WORKSPACE_DEFAULTS)}}
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"workspace": {"init_timeout_seconds": 120}}
        }))

        result = load_settings(str(settings_file))
        ws = result["worca"]["workspace"]

        assert ws["init_timeout_seconds"] == 120
        assert ws["max_parallel"] == 5
        assert ws["context_cap_bytes"] == 8192
        assert ws["failure_threshold"] == 0.30

    def test_workspace_merge_preserves_siblings(self, tmp_path):
        """Overriding workspace keys does not affect sibling worca sections."""
        base = {
            "worca": {
                "workspace": dict(self.WORKSPACE_DEFAULTS),
                "fleet": {"max_parallel": 5, "failure_threshold": 0.30},
            }
        }
        local = {
            "worca": {"workspace": {"max_parallel": 3}}
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result["worca"]["workspace"]["max_parallel"] == 3
        assert result["worca"]["fleet"]["max_parallel"] == 5
        assert result["worca"]["fleet"]["failure_threshold"] == 0.30


# ---------------------------------------------------------------------------
# TestEffortSettings (W-052 Phase 1)
# ---------------------------------------------------------------------------


class TestEffortSettings:
    """Tests for the worca.effort settings block and per-agent effort defaults."""

    def test_real_settings_has_effort_section(self):
        """src/worca/settings.json contains the worca.effort block."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "effort" in result.get("worca", {}), \
            "worca.effort section missing from src/worca/settings.json"

    def test_effort_auto_mode_default(self):
        """Default auto_mode is 'adaptive'."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["effort"]["auto_mode"] == "adaptive"

    def test_effort_auto_cap_default(self):
        """Default auto_cap is 'xhigh'."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["effort"]["auto_cap"] == "xhigh"

    def test_effort_block_has_exactly_two_keys(self):
        """The effort block contains only auto_mode and auto_cap."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert set(result["worca"]["effort"].keys()) == {"auto_mode", "auto_cap"}

    def test_planner_effort_xhigh(self):
        """Planner has effort 'xhigh' (heavy reasoning)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["agents"]["planner"]["effort"] == "xhigh"

    def test_coordinator_effort_high(self):
        """Coordinator has effort 'high' (complexity classification is judgment)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["agents"]["coordinator"]["effort"] == "high"

    def test_guardian_effort_high(self):
        """Guardian has effort 'high' (high vigilance)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["agents"]["guardian"]["effort"] == "high"

    def test_implementer_effort_unset(self):
        """Implementer has no effort field (adaptive path drives base)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "effort" not in result["worca"]["agents"]["implementer"]

    def test_tester_effort_unset(self):
        """Tester has no effort field (model default)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "effort" not in result["worca"]["agents"]["tester"]

    def test_reviewer_effort_high(self):
        """Reviewer has effort 'high' (loop-controlling judgment gate)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["agents"]["reviewer"]["effort"] == "high"

    def test_plan_reviewer_effort_high(self):
        """Plan reviewer has effort 'high' (judgment gate, only active when enabled)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert result["worca"]["agents"]["plan_reviewer"]["effort"] == "high"

    def test_learner_effort_unset(self):
        """Learner has no effort field (low stakes, disabled by default)."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', 'src', 'worca', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "effort" not in result["worca"]["agents"]["learner"]

    def test_local_override_auto_mode(self, tmp_path):
        """Local override can change auto_mode."""
        base = {
            "worca": {
                "effort": {"auto_mode": "adaptive", "auto_cap": "xhigh"}
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"effort": {"auto_mode": "disabled"}}
        }))

        result = load_settings(str(settings_file))
        assert result["worca"]["effort"]["auto_mode"] == "disabled"
        assert result["worca"]["effort"]["auto_cap"] == "xhigh"

    def test_local_override_agent_effort(self, tmp_path):
        """Local override can add effort to an agent that lacks it."""
        base = {
            "worca": {
                "agents": {
                    "implementer": {"model": "sonnet", "max_turns": 300}
                }
            }
        }
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps({
            "worca": {"agents": {"implementer": {"effort": "high"}}}
        }))

        result = load_settings(str(settings_file))
        impl = result["worca"]["agents"]["implementer"]
        assert impl["effort"] == "high"
        assert impl["model"] == "sonnet"
        assert impl["max_turns"] == 300

    def test_effort_merge_preserves_siblings(self, tmp_path):
        """Overriding effort keys does not affect sibling worca sections."""
        base = {
            "worca": {
                "effort": {"auto_mode": "adaptive", "auto_cap": "xhigh"},
                "fleet": {"max_parallel": 5, "failure_threshold": 0.30},
            }
        }
        local = {
            "worca": {"effort": {"auto_cap": "high"}}
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result["worca"]["effort"]["auto_cap"] == "high"
        assert result["worca"]["effort"]["auto_mode"] == "adaptive"
        assert result["worca"]["fleet"]["max_parallel"] == 5


class TestLoadSettingsReadsWorcaConfigPath:
    """test_load_settings_reads_worca_config_path: WORCA_CONFIG_PATH env var respected."""

    def test_worca_config_path_merged_as_base(self, tmp_path, monkeypatch):
        """When WORCA_CONFIG_PATH is set, its content is the base layer for worca.*."""
        from worca.utils.settings import load_settings

        worca_config = tmp_path / "config.json"
        worca_config.write_text(json.dumps({"worca": {"stages": {"plan": {"enabled": False}}}}))

        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {"agents": {"planner": {"model": "sonnet"}}}}))

        monkeypatch.setenv("WORCA_CONFIG_PATH", str(worca_config))

        result = load_settings(str(project_settings))
        assert result["worca"]["stages"]["plan"]["enabled"] is False
        assert result["worca"]["agents"]["planner"]["model"] == "sonnet"

    def test_worca_config_path_overridden_by_project_settings(self, tmp_path, monkeypatch):
        """Project settings worca.* values override WORCA_CONFIG_PATH values."""
        from worca.utils.settings import load_settings

        worca_config = tmp_path / "config.json"
        worca_config.write_text(json.dumps({"worca": {"loops": {"implement_test": 3}}}))

        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 7}}}))

        monkeypatch.setenv("WORCA_CONFIG_PATH", str(worca_config))

        result = load_settings(str(project_settings))
        assert result["worca"]["loops"]["implement_test"] == 7

    def test_no_worca_config_path_unchanged(self, tmp_path, monkeypatch):
        """Without WORCA_CONFIG_PATH, load_settings behaves as before."""
        from worca.utils.settings import load_settings

        monkeypatch.delenv("WORCA_CONFIG_PATH", raising=False)
        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))

        result = load_settings(str(project_settings))
        assert result["worca"]["loops"]["implement_test"] == 5

    def test_missing_worca_config_file_tolerated(self, tmp_path, monkeypatch):
        """If WORCA_CONFIG_PATH points to a non-existent file, load_settings falls back gracefully."""
        from worca.utils.settings import load_settings

        monkeypatch.setenv("WORCA_CONFIG_PATH", str(tmp_path / "nonexistent.json"))
        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))

        result = load_settings(str(project_settings))
        assert result["worca"]["loops"]["implement_test"] == 5


class TestNormalizeModelEntryColonRejection:
    """Colon-in-alias guard on normalize_model_entry."""

    def test_rejects_colon_in_alias(self):
        with pytest.raises(ValueError, match="colon"):
            normalize_model_entry("claude-opus-4-7", alias="user:opus")

    def test_rejects_colon_dict_form(self):
        with pytest.raises(ValueError, match="colon"):
            normalize_model_entry({"id": "claude-opus-4-7"}, alias="project:x")

    def test_valid_alias_no_colon_passes(self):
        result = normalize_model_entry("claude-opus-4-7", alias="my-model")
        assert result["id"] == "claude-opus-4-7"

    def test_no_alias_arg_unchanged(self):
        result = normalize_model_entry("claude-sonnet-4-6")
        assert result == {"id": "claude-sonnet-4-6", "env": {}}

