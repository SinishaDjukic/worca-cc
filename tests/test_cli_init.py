"""Tests for worca init (src/worca/cli/init.py)."""

import json
import pytest
from unittest.mock import patch

from worca.cli.init import (
    _cleanup_legacy_files,
    _deep_merge,
    _deep_merge_overwrite,
    _copy_worca_source,
    _ensure_gitignore,
    _get_worca_source,
    _migrate_settings_paths,
    _migrate_agent_overrides,
    read_version,
    run_init,
)


# ---------------------------------------------------------------------------
# Deep merge
# ---------------------------------------------------------------------------

class TestDeepMerge:
    def test_adds_missing_keys(self):
        base = {"a": 1}
        overlay = {"b": 2}
        assert _deep_merge(base, overlay) == {"a": 1, "b": 2}

    def test_preserves_existing_keys(self):
        base = {"a": 1, "b": 2}
        overlay = {"a": 99, "c": 3}
        result = _deep_merge(base, overlay)
        assert result["a"] == 1  # preserved
        assert result["c"] == 3  # added

    def test_recursive_merge(self):
        base = {"worca": {"stages": {"plan": True}}}
        overlay = {"worca": {"stages": {"test": True}, "new_key": "val"}}
        result = _deep_merge(base, overlay)
        assert result["worca"]["stages"]["plan"] is True
        assert result["worca"]["stages"]["test"] is True
        assert result["worca"]["new_key"] == "val"


class TestDeepMergeOverwrite:
    def test_overwrites_existing(self):
        base = {"a": 1}
        overlay = {"a": 99}
        assert _deep_merge_overwrite(base, overlay) == {"a": 99}


# ---------------------------------------------------------------------------
# Copy source
# ---------------------------------------------------------------------------

class TestCopyWorcaSource:
    def test_copies_files_excluding_cli(self, tmp_path):
        src = tmp_path / "source"
        src.mkdir()
        (src / "__init__.py").write_text('__version__ = "0.5.0"')
        (src / "orchestrator").mkdir()
        (src / "orchestrator" / "runner.py").write_text("# runner")
        (src / "cli").mkdir()
        (src / "cli" / "main.py").write_text("# cli")
        (src / "__pycache__").mkdir()
        (src / "__pycache__" / "mod.pyc").write_text("")

        target = tmp_path / "target"
        _copy_worca_source(src, target)

        assert (target / "__init__.py").exists()
        assert (target / "orchestrator" / "runner.py").exists()
        assert not (target / "cli").exists()
        assert not (target / "__pycache__").exists()

    def test_overwrites_existing_target(self, tmp_path):
        src = tmp_path / "source"
        src.mkdir()
        (src / "__init__.py").write_text('__version__ = "0.6.0"')

        target = tmp_path / "target"
        target.mkdir()
        (target / "old_file.py").write_text("old")

        _copy_worca_source(src, target)

        assert (target / "__init__.py").exists()
        assert not (target / "old_file.py").exists()


# ---------------------------------------------------------------------------
# Gitignore
# ---------------------------------------------------------------------------

class TestEnsureGitignore:
    def test_adds_missing_entries(self, tmp_path):
        gitignore = tmp_path / ".gitignore"
        gitignore.write_text("node_modules/\n")
        changes = _ensure_gitignore(tmp_path)
        content = gitignore.read_text()
        assert ".worca/" in content
        assert "logs/" in content
        assert len(changes) > 0

    def test_no_duplicates(self, tmp_path):
        gitignore = tmp_path / ".gitignore"
        gitignore.write_text(".worca/\nlogs/\n.claude/settings.local.json\n")
        changes = _ensure_gitignore(tmp_path)
        assert changes == []

    def test_creates_gitignore_if_missing(self, tmp_path):
        changes = _ensure_gitignore(tmp_path)
        assert (tmp_path / ".gitignore").exists()
        assert len(changes) > 0


# ---------------------------------------------------------------------------
# Path migrations
# ---------------------------------------------------------------------------

class TestMigrateSettingsPaths:
    def test_migrates_hook_paths(self):
        settings = {
            "hooks": {
                "PreToolUse": [{"hooks": [{"command": "python3 .claude/hooks/pre_tool_use.py"}]}]
            }
        }
        migrated, changes = _migrate_settings_paths(settings)
        raw = json.dumps(migrated)
        assert ".claude/worca/claude_hooks/pre_tool_use.py" in raw
        assert len(changes) > 0

    def test_migrates_preflight_path(self):
        settings = {
            "worca": {"stages": {"preflight": {"script": ".claude/scripts/preflight_checks.py"}}}
        }
        migrated, changes = _migrate_settings_paths(settings)
        assert migrated["worca"]["stages"]["preflight"]["script"] == (
            ".claude/worca/scripts/preflight_checks.py"
        )

    def test_migrates_agent_overrides_dir(self):
        settings = {"worca": {"agent_overrides_dir": ".claude/agents/overrides"}}
        migrated, changes = _migrate_settings_paths(settings)
        assert migrated["worca"]["agent_overrides_dir"] == ".claude/agents"

    def test_no_changes_for_already_migrated(self):
        settings = {"worca": {"agent_overrides_dir": ".claude/agents"}}
        _, changes = _migrate_settings_paths(settings)
        assert len(changes) == 0


# ---------------------------------------------------------------------------
# Agent override migration
# ---------------------------------------------------------------------------

class TestMigrateAgentOverrides:
    def test_moves_override_files(self, tmp_path):
        overrides = tmp_path / ".claude" / "agents" / "overrides"
        overrides.mkdir(parents=True)
        (overrides / "planner.md").write_text("custom planner")

        agents_dir = tmp_path / ".claude" / "agents"
        changes = _migrate_agent_overrides(tmp_path)

        assert (agents_dir / "planner.md").exists()
        assert (agents_dir / "planner.md").read_text() == "custom planner"
        assert not overrides.exists()
        assert len(changes) > 0

    def test_warns_on_conflict(self, tmp_path):
        overrides = tmp_path / ".claude" / "agents" / "overrides"
        overrides.mkdir(parents=True)
        (overrides / "planner.md").write_text("override planner")

        agents_dir = tmp_path / ".claude" / "agents"
        (agents_dir / "planner.md").write_text("existing planner")

        changes = _migrate_agent_overrides(tmp_path)
        # Should not overwrite existing
        assert (agents_dir / "planner.md").read_text() == "existing planner"
        assert any("WARNING" in c for c in changes)

    def test_no_changes_without_overrides_dir(self, tmp_path):
        changes = _migrate_agent_overrides(tmp_path)
        assert changes == []


# ---------------------------------------------------------------------------
# Version reading
# ---------------------------------------------------------------------------

class TestReadVersion:
    def test_reads_version(self, tmp_path):
        init = tmp_path / "__init__.py"
        init.write_text('__version__ = "0.5.0"\n')
        assert read_version(tmp_path) == "0.5.0"

    def test_returns_none_if_missing(self, tmp_path):
        assert read_version(tmp_path) is None


# ---------------------------------------------------------------------------
# Source resolution
# ---------------------------------------------------------------------------

class TestGetWorcaSource:
    def test_source_flag_takes_priority(self, tmp_path):
        src = tmp_path / "worca-cc" / "src" / "worca"
        src.mkdir(parents=True)
        result = _get_worca_source(str(tmp_path / "worca-cc"), tmp_path)
        assert result == src

    def test_settings_local_fallback(self, tmp_path):
        src = tmp_path / "my-worca" / "src" / "worca"
        src.mkdir(parents=True)

        claude_dir = tmp_path / ".claude"
        claude_dir.mkdir()
        (claude_dir / "settings.local.json").write_text(json.dumps({
            "worca": {"source_repo": str(tmp_path / "my-worca")}
        }))

        result = _get_worca_source(None, tmp_path)
        assert result == src

    def test_falls_back_to_installed_package(self, tmp_path):
        """When no --source and no settings.local.json, falls back to installed package."""
        result = _get_worca_source(None, tmp_path)
        # Since worca is importable in our test env, it should find it
        assert result.name == "worca"
        assert (result / "__init__.py").exists()


# ---------------------------------------------------------------------------
# Full run_init
# ---------------------------------------------------------------------------

class TestRunInit:
    def test_init_fresh_project(self, tmp_path, monkeypatch):
        """worca init on a fresh git repo scaffolds .claude/worca/."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()

        # Create a mock source
        src = tmp_path / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.5.0"')
        (src / "orchestrator").mkdir()
        (src / "orchestrator" / "runner.py").write_text("# runner")
        (src / "settings.json").write_text(json.dumps({"worca": {"stages": {}}}))
        (src / "cli").mkdir()
        (src / "cli" / "main.py").write_text("# not copied")

        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(source=str(tmp_path / "worca-src"))

        assert (tmp_path / ".claude" / "worca" / "__init__.py").exists()
        assert (tmp_path / ".claude" / "worca" / "orchestrator" / "runner.py").exists()
        assert not (tmp_path / ".claude" / "worca" / "cli").exists()
        assert (tmp_path / ".claude" / "settings.json").exists()

    def test_init_refuses_without_upgrade(self, tmp_path, monkeypatch):
        """worca init fails if .claude/worca/ exists and --upgrade not passed."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        (tmp_path / ".claude" / "worca").mkdir(parents=True)

        src = tmp_path / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.5.0"')

        with pytest.raises(SystemExit):
            run_init(source=str(tmp_path / "worca-src"))

    def test_init_upgrade_overwrites(self, tmp_path, monkeypatch):
        """worca init --upgrade overwrites .claude/worca/."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()

        target = tmp_path / ".claude" / "worca"
        target.mkdir(parents=True)
        (target / "old.py").write_text("old")

        settings = tmp_path / ".claude" / "settings.json"
        settings.write_text(json.dumps({"worca": {"stages": {}}}))

        src = tmp_path / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.6.0"')
        (src / "settings.json").write_text(json.dumps({"worca": {"stages": {}, "new_key": 1}}))

        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(upgrade=True, source=str(tmp_path / "worca-src"))

        assert not (target / "old.py").exists()
        assert (target / "__init__.py").exists()

    def test_init_not_in_git_repo(self, tmp_path, monkeypatch):
        """worca init fails outside a git repo."""
        monkeypatch.chdir(tmp_path)
        with pytest.raises(SystemExit):
            run_init()

    def test_init_check_mode(self, tmp_path, monkeypatch, capsys):
        """worca init --check shows info without making changes."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()

        src = tmp_path / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.5.0"')
        (src / "settings.json").write_text(json.dumps({"worca": {}}))

        run_init(check=True, source=str(tmp_path / "worca-src"))

        # Should not create .claude/worca/
        assert not (tmp_path / ".claude" / "worca").exists()
        captured = capsys.readouterr()
        assert "0.5.0" in captured.out


# ---------------------------------------------------------------------------
# Legacy file cleanup
# ---------------------------------------------------------------------------

class TestCleanupLegacyFiles:
    def _setup_legacy_hooks(self, tmp_path, extra_files=None):
        """Create .claude/hooks/ with all legacy hook files."""
        hooks_dir = tmp_path / ".claude" / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        for name in [
            "__init__.py", "post_tool_use.py", "pre_compact.py", "pre_tool_use.py",
            "session_end.py", "session_start.py", "stop.py",
            "subagent_start.py", "subagent_stop.py", "user_prompt_submit.py",
        ]:
            (hooks_dir / name).write_text(f"# {name}")
        for name in (extra_files or []):
            (hooks_dir / name).write_text(f"# {name}")

    def _setup_legacy_scripts(self, tmp_path, extra_files=None):
        """Create .claude/scripts/ with all legacy script files."""
        scripts_dir = tmp_path / ".claude" / "scripts"
        scripts_dir.mkdir(parents=True, exist_ok=True)
        for name in [
            "__init__.py", "preflight_checks.py", "run_batch.py", "run_learn.py",
            "run_multi.py", "run_parallel.py", "run_pipeline.py", "worca.py",
        ]:
            (scripts_dir / name).write_text(f"# {name}")
        for name in (extra_files or []):
            (scripts_dir / name).write_text(f"# {name}")

    def _setup_legacy_agents(self, tmp_path):
        """Create .claude/agents/core/ with all legacy agent files."""
        core_dir = tmp_path / ".claude" / "agents" / "core"
        core_dir.mkdir(parents=True, exist_ok=True)
        for name in [
            "coordinator.md", "guardian.md", "implementer.md", "learner.md",
            "plan_reviewer.md", "planner.md", "tester.md",
        ]:
            (core_dir / name).write_text(f"# {name}")

    def _setup_no_version(self, tmp_path):
        """Ensure .claude/worca/ exists but has no version (pre-packaging)."""
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True, exist_ok=True)

    def test_removes_legacy_hooks(self, tmp_path):
        """Legacy hook files are removed but user's custom file is kept."""
        self._setup_no_version(tmp_path)
        self._setup_legacy_hooks(tmp_path, extra_files=["my_custom.py"])

        changes = _cleanup_legacy_files(tmp_path)

        hooks_dir = tmp_path / ".claude" / "hooks"
        assert hooks_dir.is_dir()  # dir kept because my_custom.py remains
        assert (hooks_dir / "my_custom.py").exists()
        assert not (hooks_dir / "pre_tool_use.py").exists()
        assert not (hooks_dir / "__init__.py").exists()
        assert len(changes) > 0

    def test_removes_legacy_scripts(self, tmp_path):
        """Legacy script files are removed but user's custom file is kept."""
        self._setup_no_version(tmp_path)
        self._setup_legacy_scripts(tmp_path, extra_files=["my_script.py"])

        _cleanup_legacy_files(tmp_path)

        scripts_dir = tmp_path / ".claude" / "scripts"
        assert scripts_dir.is_dir()
        assert (scripts_dir / "my_script.py").exists()
        assert not (scripts_dir / "run_pipeline.py").exists()
        assert not (scripts_dir / "worca.py").exists()

    def test_removes_legacy_agents_core(self, tmp_path):
        """Legacy agent core files are removed; user override at agents/ is untouched."""
        self._setup_no_version(tmp_path)
        self._setup_legacy_agents(tmp_path)

        # User override at .claude/agents/planner.md
        agents_dir = tmp_path / ".claude" / "agents"
        (agents_dir / "planner.md").write_text("# user override")

        _cleanup_legacy_files(tmp_path)

        assert not (agents_dir / "core").exists()  # core/ dir removed
        assert (agents_dir / "planner.md").exists()  # user override untouched
        assert (agents_dir / "planner.md").read_text() == "# user override"

    def test_removes_embedded_worca_ui(self, tmp_path):
        """Entire .claude/worca-ui/ directory is removed."""
        self._setup_no_version(tmp_path)
        worca_ui = tmp_path / ".claude" / "worca-ui"
        worca_ui.mkdir(parents=True)
        (worca_ui / "index.html").write_text("<html></html>")
        (worca_ui / "app").mkdir()
        (worca_ui / "app" / "main.js").write_text("// app")

        changes = _cleanup_legacy_files(tmp_path)

        assert not worca_ui.exists()
        assert any("worca-ui" in c for c in changes)

    def test_skips_cleanup_for_packaged_install(self, tmp_path):
        """No cleanup when .claude/worca/ already has a version (packaged install)."""
        worca_dir = tmp_path / ".claude" / "worca"
        worca_dir.mkdir(parents=True)
        (worca_dir / "__init__.py").write_text('__version__ = "0.6.0rc7"')

        self._setup_legacy_hooks(tmp_path)
        self._setup_legacy_scripts(tmp_path)
        self._setup_legacy_agents(tmp_path)

        changes = _cleanup_legacy_files(tmp_path)

        assert changes == []
        # Legacy files should still be there
        assert (tmp_path / ".claude" / "hooks" / "pre_tool_use.py").exists()
        assert (tmp_path / ".claude" / "scripts" / "run_pipeline.py").exists()
        assert (tmp_path / ".claude" / "agents" / "core" / "planner.md").exists()

    def test_removes_empty_dirs(self, tmp_path):
        """Directories are removed after all legacy files are deleted (no user files)."""
        self._setup_no_version(tmp_path)
        self._setup_legacy_hooks(tmp_path)
        self._setup_legacy_scripts(tmp_path)
        self._setup_legacy_agents(tmp_path)

        changes = _cleanup_legacy_files(tmp_path)

        assert not (tmp_path / ".claude" / "hooks").exists()
        assert not (tmp_path / ".claude" / "scripts").exists()
        assert not (tmp_path / ".claude" / "agents" / "core").exists()
        assert any("empty" in c.lower() for c in changes)

    def test_removes_pycache(self, tmp_path):
        """__pycache__/ inside hooks and scripts dirs is removed."""
        self._setup_no_version(tmp_path)
        self._setup_legacy_hooks(tmp_path)
        self._setup_legacy_scripts(tmp_path)

        pycache_hooks = tmp_path / ".claude" / "hooks" / "__pycache__"
        pycache_hooks.mkdir()
        (pycache_hooks / "pre_tool_use.cpython-312.pyc").write_text("")

        pycache_scripts = tmp_path / ".claude" / "scripts" / "__pycache__"
        pycache_scripts.mkdir()
        (pycache_scripts / "run_pipeline.cpython-312.pyc").write_text("")

        changes = _cleanup_legacy_files(tmp_path)

        assert not pycache_hooks.exists()
        assert not pycache_scripts.exists()
        assert any("__pycache__" in c for c in changes)

    def test_upgrade_runs_cleanup(self, tmp_path, monkeypatch, capsys):
        """Full run_init(upgrade=True) runs legacy cleanup before source copy."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()

        # Set up pre-packaging layout (worca dir exists but no version)
        target = tmp_path / ".claude" / "worca"
        target.mkdir(parents=True)

        settings = tmp_path / ".claude" / "settings.json"
        settings.write_text(json.dumps({"worca": {"stages": {}}}))

        self._setup_legacy_hooks(tmp_path)

        src = tmp_path / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.6.0"')
        (src / "settings.json").write_text(json.dumps({"worca": {"stages": {}}}))

        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(upgrade=True, source=str(tmp_path / "worca-src"))

        captured = capsys.readouterr()
        assert "Legacy file cleanup" in captured.out
        # Legacy hooks should be gone
        assert not (tmp_path / ".claude" / "hooks").exists()

    def test_removes_domain_with_gitkeep_only(self, tmp_path):
        """.claude/agents/domain/ is removed if it only contains .gitkeep."""
        self._setup_no_version(tmp_path)
        domain_dir = tmp_path / ".claude" / "agents" / "domain"
        domain_dir.mkdir(parents=True)
        (domain_dir / ".gitkeep").write_text("")

        changes = _cleanup_legacy_files(tmp_path)

        assert not domain_dir.exists()
        assert any("domain" in c for c in changes)

    def test_keeps_domain_with_user_files(self, tmp_path):
        """.claude/agents/domain/ is kept if it has user files."""
        self._setup_no_version(tmp_path)
        domain_dir = tmp_path / ".claude" / "agents" / "domain"
        domain_dir.mkdir(parents=True)
        (domain_dir / ".gitkeep").write_text("")
        (domain_dir / "my_agent.md").write_text("# custom")

        _cleanup_legacy_files(tmp_path)

        assert domain_dir.exists()
        assert (domain_dir / "my_agent.md").exists()


# ---------------------------------------------------------------------------
# Template directory handling during init
# ---------------------------------------------------------------------------

class TestRunInitTemplates:
    def _make_src(self, base):
        """Create a minimal fake worca source with a templates/ directory."""
        src = base / "worca-src" / "src" / "worca"
        src.mkdir(parents=True)
        (src / "__init__.py").write_text('__version__ = "0.5.0"')
        (src / "settings.json").write_text(json.dumps({"worca": {}}))
        tmpl = src / "templates" / "bugfix"
        tmpl.mkdir(parents=True)
        (tmpl / "template.json").write_text(json.dumps({"id": "bugfix", "name": "Bugfix"}))
        return base / "worca-src"

    def test_init_copies_builtin_templates_to_runtime(self, tmp_path, monkeypatch):
        """worca init copies src/worca/templates/ to .claude/worca/templates/."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        src_root = self._make_src(tmp_path)
        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(source=str(src_root))
        assert (tmp_path / ".claude" / "worca" / "templates" / "bugfix" / "template.json").exists()

    def test_init_creates_project_templates_dir(self, tmp_path, monkeypatch):
        """worca init creates .claude/templates/ for project templates."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        src_root = self._make_src(tmp_path)
        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(source=str(src_root))
        assert (tmp_path / ".claude" / "templates").is_dir()

    def test_upgrade_refreshes_builtin_templates(self, tmp_path, monkeypatch):
        """worca init --upgrade refreshes built-in templates from package source."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        src_root = self._make_src(tmp_path)
        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(source=str(src_root))
        # Add a new template to source (simulating a version update)
        new_tmpl = src_root / "src" / "worca" / "templates" / "feature"
        new_tmpl.mkdir(parents=True)
        (new_tmpl / "template.json").write_text(json.dumps({"id": "feature", "name": "Feature"}))
        with patch("worca.cli.init._init_beads", return_value=False):
            with patch("worca.cli.init._upgrade_beads", return_value=False):
                run_init(upgrade=True, source=str(src_root))
        assert (tmp_path / ".claude" / "worca" / "templates" / "feature" / "template.json").exists()

    def test_upgrade_preserves_project_templates_dir(self, tmp_path, monkeypatch):
        """worca init --upgrade does not delete .claude/templates/ (project templates)."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        src_root = self._make_src(tmp_path)
        with patch("worca.cli.init._init_beads", return_value=False):
            run_init(source=str(src_root))
        # Add a project template
        proj_tmpl = tmp_path / ".claude" / "templates" / "my-proj-tmpl"
        proj_tmpl.mkdir(parents=True)
        (proj_tmpl / "template.json").write_text(json.dumps({"id": "my-proj-tmpl", "name": "Custom"}))
        with patch("worca.cli.init._init_beads", return_value=False):
            with patch("worca.cli.init._upgrade_beads", return_value=False):
                run_init(upgrade=True, source=str(src_root))
        assert (tmp_path / ".claude" / "templates" / "my-proj-tmpl").exists()
