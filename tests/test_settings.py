# Settings loader tests
"""Tests for the shared settings loader (deep_merge + load_settings)."""

import json
import os
import sys


# Add the .claude directory to sys.path so we can import worca modules
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '.claude'))
from worca.utils.settings import deep_merge, load_settings


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
    """Tests for the worca.parallel settings section."""

    PARALLEL_DEFAULTS = {
        "max_concurrent_pipelines": 3,
        "default_base_branch": "main",
        "cleanup_policy": "on-success",
        "worktree_base_dir": ".worktrees",
    }

    def _base_with_parallel(self, parallel_overrides=None):
        """Return a minimal settings dict containing the parallel section."""
        parallel = dict(self.PARALLEL_DEFAULTS)
        if parallel_overrides:
            parallel.update(parallel_overrides)
        return {"worca": {"parallel": parallel}}

    def test_parallel_defaults_present(self, tmp_path):
        """Base settings contain all parallel keys with correct defaults."""
        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(self._base_with_parallel()))

        result = load_settings(str(settings_file))
        p = result["worca"]["parallel"]

        assert p["max_concurrent_pipelines"] == 3
        assert p["default_base_branch"] == "main"
        assert p["cleanup_policy"] == "on-success"
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
        # other parallel keys preserved from base
        assert p["default_base_branch"] == "main"
        assert p["cleanup_policy"] == "on-success"
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
                "parallel": dict(self.PARALLEL_DEFAULTS),
                "budget": {"warning_pct": 80, "max_cost_usd": None},
                "events": {"enabled": True},
            }
        }
        local = {
            "worca": {"parallel": {"max_concurrent_pipelines": 10}}
        }

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(json.dumps(base))
        local_file = tmp_path / "settings.local.json"
        local_file.write_text(json.dumps(local))

        result = load_settings(str(settings_file))
        assert result["worca"]["parallel"]["max_concurrent_pipelines"] == 10
        # siblings untouched
        assert result["worca"]["budget"]["warning_pct"] == 80
        assert result["worca"]["events"]["enabled"] is True

    def test_real_settings_has_parallel_section(self):
        """The actual .claude/settings.json contains the parallel section."""
        settings_path = os.path.join(
            os.path.dirname(__file__), '..', '.claude', 'settings.json'
        )
        result = load_settings(settings_path)
        assert "parallel" in result.get("worca", {}), \
            "worca.parallel section missing from .claude/settings.json"
        p = result["worca"]["parallel"]
        assert p["max_concurrent_pipelines"] == 3
        assert p["default_base_branch"] == "main"
        assert p["cleanup_policy"] == "on-success"
        assert p["worktree_base_dir"] == ".worktrees"
