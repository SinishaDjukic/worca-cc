"""Tests for WORCA_CONFIG_PATH propagation to fleet/workspace child runs (Phase 5).

Covers:
  - build_child_env (fleet) injects WORCA_CONFIG_PATH derived from child project dir
  - _build_child_env (dag_executor) injects WORCA_CONFIG_PATH derived from child project dir
  - WORCA_CONFIG_PATH is not inherited blindly from parent (re-derived per child)
  - If no config.json exists for child, WORCA_CONFIG_PATH is not injected
  - EventContext.__post_init__ reads webhook config via load_settings (which honours WORCA_CONFIG_PATH)
"""
import json
import os
from unittest.mock import patch


# ---------------------------------------------------------------------------
# Fleet: build_child_env propagates WORCA_CONFIG_PATH
# ---------------------------------------------------------------------------


class TestFleetBuildChildEnvConfigPath:
    def test_injects_worca_config_path_when_config_exists(self, tmp_path, monkeypatch):
        """build_child_env sets WORCA_CONFIG_PATH to child project's config.json."""
        from worca.scripts.run_fleet import build_child_env

        project_dir = tmp_path / "my-project"
        project_dir.mkdir()

        # Simulate config.json existing for slug "my-project"
        worca_home = tmp_path / ".worca"
        config_dir = worca_home / "projects" / "my-project"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"
        config_file.write_text('{"worca": {"webhooks": []}}')

        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin", "HOME": str(tmp_path)}
        env = build_child_env(base_env, fleet_id="f_test", project_dir=str(project_dir))

        assert "WORCA_CONFIG_PATH" in env
        assert env["WORCA_CONFIG_PATH"] == str(config_file)

    def test_does_not_inject_when_config_missing(self, tmp_path, monkeypatch):
        """build_child_env does not set WORCA_CONFIG_PATH when config.json absent."""
        from worca.scripts.run_fleet import build_child_env

        project_dir = tmp_path / "no-config-project"
        project_dir.mkdir()

        worca_home = tmp_path / ".worca"
        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin"}
        env = build_child_env(base_env, fleet_id="f_test", project_dir=str(project_dir))

        assert "WORCA_CONFIG_PATH" not in env

    def test_strips_parent_worca_config_path_and_re_derives(self, tmp_path, monkeypatch):
        """Parent WORCA_CONFIG_PATH is scrubbed; child gets its own derived path."""
        from worca.scripts.run_fleet import build_child_env

        project_dir = tmp_path / "child-proj"
        project_dir.mkdir()

        worca_home = tmp_path / ".worca"
        config_dir = worca_home / "projects" / "child-proj"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"
        config_file.write_text("{}")

        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        # Parent env has a different (stale) WORCA_CONFIG_PATH
        base_env = {
            "PATH": "/usr/bin",
            "WORCA_CONFIG_PATH": "/old/parent/config.json",
        }
        env = build_child_env(base_env, fleet_id="f_test", project_dir=str(project_dir))

        # Must be the child's own path, not the parent's stale one
        assert env["WORCA_CONFIG_PATH"] == str(config_file)

    def test_backward_compat_no_project_dir(self, tmp_path, monkeypatch):
        """build_child_env without project_dir still works (no WORCA_CONFIG_PATH)."""
        from worca.scripts.run_fleet import build_child_env

        worca_home = tmp_path / ".worca"
        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin", "WORCA_FLEET_ID": "old"}
        # project_dir=None should not crash and should not inject WORCA_CONFIG_PATH
        env = build_child_env(base_env, fleet_id="f_test", project_dir=None)

        assert "WORCA_CONFIG_PATH" not in env


# ---------------------------------------------------------------------------
# DagExecutor: _build_child_env propagates WORCA_CONFIG_PATH
# ---------------------------------------------------------------------------


class TestDagExecutorBuildChildEnvConfigPath:
    def test_injects_worca_config_path_when_config_exists(self, tmp_path, monkeypatch):
        """_build_child_env sets WORCA_CONFIG_PATH for workspace child project."""
        from worca.workspace.dag_executor import _build_child_env

        project_dir = tmp_path / "svc-alpha"
        project_dir.mkdir()

        worca_home = tmp_path / ".worca"
        config_dir = worca_home / "projects" / "svc-alpha"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"
        config_file.write_text('{"worca": {}}')

        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin"}
        env = _build_child_env(
            base_env,
            workspace_id="ws_test",
            workspace_name="my-ws",
            project_dir=str(project_dir),
        )

        assert "WORCA_CONFIG_PATH" in env
        assert env["WORCA_CONFIG_PATH"] == str(config_file)

    def test_does_not_inject_when_config_missing(self, tmp_path, monkeypatch):
        """_build_child_env does not set WORCA_CONFIG_PATH when config.json absent."""
        from worca.workspace.dag_executor import _build_child_env

        project_dir = tmp_path / "svc-beta"
        project_dir.mkdir()

        worca_home = tmp_path / ".worca"
        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin"}
        env = _build_child_env(
            base_env,
            workspace_id="ws_test",
            workspace_name="my-ws",
            project_dir=str(project_dir),
        )

        assert "WORCA_CONFIG_PATH" not in env

    def test_parent_config_path_not_inherited(self, tmp_path, monkeypatch):
        """Parent WORCA_CONFIG_PATH is scrubbed; child gets its own derived path."""
        from worca.workspace.dag_executor import _build_child_env

        project_dir = tmp_path / "svc-gamma"
        project_dir.mkdir()

        worca_home = tmp_path / ".worca"
        config_dir = worca_home / "projects" / "svc-gamma"
        config_dir.mkdir(parents=True)
        config_file = config_dir / "config.json"
        config_file.write_text("{}")

        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {
            "PATH": "/usr/bin",
            "WORCA_CONFIG_PATH": "/stale/parent/config.json",
        }
        env = _build_child_env(
            base_env,
            workspace_id="ws_test",
            workspace_name="my-ws",
            project_dir=str(project_dir),
        )

        assert env["WORCA_CONFIG_PATH"] == str(config_file)

    def test_backward_compat_no_project_dir(self, tmp_path, monkeypatch):
        """_build_child_env without project_dir still works."""
        from worca.workspace.dag_executor import _build_child_env

        worca_home = tmp_path / ".worca"
        monkeypatch.setenv("WORCA_HOME", str(worca_home))

        base_env = {"PATH": "/usr/bin"}
        env = _build_child_env(
            base_env,
            workspace_id="ws_test",
            workspace_name="my-ws",
            project_dir=None,
        )

        assert "WORCA_CONFIG_PATH" not in env
        assert env["WORCA_DEFER_PR"] == "1"
        assert env["WORCA_WORKSPACE_ID"] == "ws_test"


# ---------------------------------------------------------------------------
# Emitter: EventContext reads webhook config via WORCA_CONFIG_PATH
# ---------------------------------------------------------------------------


class TestEmitterReadsFromWorcaConfigPath:
    def test_event_context_picks_up_webhook_from_config_path(self, tmp_path, monkeypatch):
        """EventContext reads webhook from WORCA_CONFIG_PATH when set."""
        from worca.events.emitter import EventContext

        # Write worca config with a webhook in it
        worca_config = tmp_path / "config.json"
        worca_config.write_text(json.dumps({
            "worca": {
                "webhooks": [
                    {"url": "https://example.com/hook", "events": ["pipeline.*"]},
                ]
            }
        }))

        # Project settings has no webhook
        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {}}))

        monkeypatch.setenv("WORCA_CONFIG_PATH", str(worca_config))

        events_path = str(tmp_path / "events.jsonl")
        ctx = EventContext(
            run_id="r-test",
            branch="feat/test",
            work_request={},
            events_path=events_path,
            settings_path=str(project_settings),
        )

        assert len(ctx._webhooks) == 1
        assert ctx._webhooks[0]["url"] == "https://example.com/hook"

    def test_event_context_no_webhook_without_config_path(self, tmp_path, monkeypatch):
        """EventContext has no webhooks when neither settings nor config path has any."""
        from worca.events.emitter import EventContext

        project_settings = tmp_path / "settings.json"
        project_settings.write_text(json.dumps({"worca": {}}))

        monkeypatch.delenv("WORCA_CONFIG_PATH", raising=False)

        events_path = str(tmp_path / "events.jsonl")
        ctx = EventContext(
            run_id="r-test",
            branch="feat/test",
            work_request={},
            events_path=events_path,
            settings_path=str(project_settings),
        )

        assert ctx._webhooks == []
