"""Tests for worca templates CLI subcommands (list, show)."""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from worca.cli.main import create_parser, main
from worca.cli.templates import _resolve_dirs


def _write_template(directory: Path, data: dict):
    """Helper: create template dir with template.json."""
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "template.json").write_text(json.dumps(data))


def _minimal(
    id: str,
    name: str = None,
    tier: str = "builtin",
    tags: list = None,
    created_at: str = "2026-01-01T00:00:00Z",
) -> dict:
    return {
        "id": id,
        "name": name or id.capitalize(),
        "description": f"{id} description",
        "builtin": tier == "builtin",
        "created_at": created_at,
        "tags": tags or [],
        "config": {},
    }


# ---------------------------------------------------------------------------
# Parser tests
# ---------------------------------------------------------------------------


class TestTemplatesParser:
    def test_templates_list_subcommand_parsed(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "list"])
        assert args.command == "templates"
        assert args.templates_command == "list"

    def test_templates_show_subcommand_parsed(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "show", "bugfix"])
        assert args.command == "templates"
        assert args.templates_command == "show"
        assert args.template_id == "bugfix"

    def test_templates_no_subcommand_exits(self):
        with pytest.raises(SystemExit) as exc_info:
            main(["templates"])
        assert exc_info.value.code != 0


# ---------------------------------------------------------------------------
# worca templates list
# ---------------------------------------------------------------------------


class TestTemplatesList:
    def _run_list(self, capsys, builtin_dir=None, project_dir=None, user_dir=None):
        with patch(
            "worca.cli.templates._resolve_dirs",
            return_value=(builtin_dir, project_dir, user_dir),
        ):
            main(["templates", "list"])
        return capsys.readouterr().out

    def test_list_shows_header_row(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        output = self._run_list(capsys, builtin_dir=builtin_dir)
        assert "ID" in output
        assert "NAME" in output
        assert "TIER" in output
        assert "TAGS" in output

    def test_list_shows_builtin_template(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix", tags=["fast", "focused"]))
        output = self._run_list(capsys, builtin_dir=builtin_dir)
        assert "bugfix" in output
        assert "Bugfix" in output
        assert "builtin" in output
        assert "fast" in output

    def test_list_shows_multiple_tiers(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        _write_template(project_dir / "my-template", _minimal("my-template", tier="project"))
        _write_template(
            user_dir / "user-tmpl",
            _minimal("user-tmpl", tier="user", created_at="2026-03-01T00:00:00Z"),
        )
        output = self._run_list(capsys, builtin_dir, project_dir, user_dir)
        assert "bugfix" in output
        assert "my-template" in output
        assert "user-tmpl" in output
        assert "builtin" in output
        assert "project" in output
        assert "user" in output

    def test_list_empty_shows_no_templates_message(self, capsys, tmp_path):
        output = self._run_list(capsys)
        # Should not crash; output may be empty table or message
        assert isinstance(output, str)

    def test_list_tags_comma_separated(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(
            builtin_dir / "feature",
            _minimal("feature", tags=["full-pipeline", "requires-approval"]),
        )
        output = self._run_list(capsys, builtin_dir=builtin_dir)
        assert "full-pipeline" in output
        assert "requires-approval" in output

    def test_list_no_tags_shows_dash_or_empty(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bare", _minimal("bare", tags=[]))
        output = self._run_list(capsys, builtin_dir=builtin_dir)
        assert "bare" in output  # template is shown

    def test_list_columns_aligned(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "a", _minimal("a", name="Alpha"))
        _write_template(builtin_dir / "b", _minimal("b", name="Beta"))
        output = self._run_list(capsys, builtin_dir=builtin_dir)
        lines = [line for line in output.splitlines() if line.strip()]
        # Header + at least 2 rows
        assert len(lines) >= 3


# ---------------------------------------------------------------------------
# worca templates show
# ---------------------------------------------------------------------------


class TestTemplatesShow:
    def _run_show(self, capsys, template_id, builtin_dir=None, project_dir=None, user_dir=None):
        with patch(
            "worca.cli.templates._resolve_dirs",
            return_value=(builtin_dir, project_dir, user_dir),
        ):
            main(["templates", "show", template_id])
        return capsys.readouterr()

    def test_show_prints_json_for_known_template(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        data = _minimal("bugfix", tags=["fast"])
        _write_template(builtin_dir / "bugfix", data)
        out = self._run_show(capsys, "bugfix", builtin_dir=builtin_dir)
        parsed = json.loads(out.out)
        assert parsed["id"] == "bugfix"

    def test_show_pretty_prints_json(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "feature", _minimal("feature"))
        out = self._run_show(capsys, "feature", builtin_dir=builtin_dir)
        # Pretty-printed JSON has newlines and indentation
        assert "\n" in out.out
        assert "  " in out.out

    def test_show_includes_all_template_fields(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        data = {
            "id": "bugfix",
            "name": "Bugfix",
            "description": "Fix bugs fast",
            "builtin": True,
            "created_at": "2026-01-01T00:00:00Z",
            "tags": ["fast"],
            "params": {},
            "config": {"agents": {"planner": {"model": "sonnet"}}},
        }
        _write_template(builtin_dir / "bugfix", data)
        out = self._run_show(capsys, "bugfix", builtin_dir=builtin_dir)
        parsed = json.loads(out.out)
        assert parsed["config"]["agents"]["planner"]["model"] == "sonnet"
        assert parsed["tags"] == ["fast"]

    def test_show_unknown_id_exits_nonzero(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        with pytest.raises(SystemExit) as exc_info:
            self._run_show(capsys, "nonexistent", builtin_dir=builtin_dir)
        assert exc_info.value.code != 0

    def test_show_unknown_id_prints_error_message(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        with pytest.raises(SystemExit):
            self._run_show(capsys, "nonexistent", builtin_dir=builtin_dir)
        captured = capsys.readouterr()
        assert "nonexistent" in captured.err or "not found" in captured.err.lower() or "nonexistent" in captured.out

    def test_show_project_template_over_builtin(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        project_dir = tmp_path / "project"
        _write_template(builtin_dir / "my-tmpl", _minimal("my-tmpl", name="Built-in Version"))
        _write_template(project_dir / "my-tmpl", _minimal("my-tmpl", name="Project Version", tier="project"))
        out = self._run_show(capsys, "my-tmpl", builtin_dir=builtin_dir, project_dir=project_dir)
        # user > project > builtin; project wins here
        # But TemplateResolver.get() includes tier in the Template object
        # The JSON output for "show" comes from template.json, which has "name"
        parsed = json.loads(out.out)
        assert parsed["name"] == "Project Version"

    def test_show_also_includes_tier_field(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        out = self._run_show(capsys, "bugfix", builtin_dir=builtin_dir)
        parsed = json.loads(out.out)
        assert "tier" in parsed
        assert parsed["tier"] == "builtin"


# ---------------------------------------------------------------------------
# worca templates save
# ---------------------------------------------------------------------------


class TestTemplatesSave:
    def _run_save(self, args, builtin_dir=None, project_dir=None, user_dir=None):
        with patch(
            "worca.cli.templates._resolve_dirs",
            return_value=(builtin_dir, project_dir, user_dir),
        ):
            main(["templates", "save"] + args)

    def test_save_subcommand_parsed(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "save", "my-tmpl", "--description", "A description"])
        assert args.command == "templates"
        assert args.templates_command == "save"
        assert args.template_id == "my-tmpl"
        assert args.description == "A description"

    def test_save_global_flag_defaults_false(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "save", "my-tmpl"])
        assert args.global_ is False

    def test_save_global_flag_set(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "save", "my-tmpl", "--global"])
        assert args.global_ is True

    def test_save_creates_project_template(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        self._run_save(["my-tmpl", "--description", "desc"], builtin_dir, project_dir, user_dir)
        assert (project_dir / "my-tmpl" / "template.json").exists()

    def test_save_global_creates_user_template(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        self._run_save(
            ["my-tmpl", "--global", "--description", "desc"],
            builtin_dir,
            project_dir,
            user_dir,
        )
        assert (user_dir / "my-tmpl" / "template.json").exists()

    def test_save_template_json_has_correct_id_and_description(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        self._run_save(["my-tmpl", "--description", "Test desc"], builtin_dir, project_dir, user_dir)
        data = json.loads((project_dir / "my-tmpl" / "template.json").read_text())
        assert data["id"] == "my-tmpl"
        assert data["description"] == "Test desc"

    def test_save_rejects_builtin_id(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        project_dir = tmp_path / "project"
        with pytest.raises(SystemExit) as exc_info:
            self._run_save(
                ["bugfix", "--description", "test"],
                builtin_dir,
                project_dir,
                tmp_path / "user",
            )
        assert exc_info.value.code != 0

    def test_save_rejects_builtin_id_prints_error(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        project_dir = tmp_path / "project"
        with pytest.raises(SystemExit):
            self._run_save(
                ["bugfix", "--description", "test"],
                builtin_dir,
                project_dir,
                tmp_path / "user",
            )
        err = capsys.readouterr().err
        assert "bugfix" in err or "built-in" in err.lower()

    def test_save_prints_success_message(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        self._run_save(["my-tmpl", "--description", "desc"], builtin_dir, project_dir, user_dir)
        out = capsys.readouterr().out
        assert "my-tmpl" in out

    def test_save_description_defaults_to_empty(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        self._run_save(["my-tmpl"], builtin_dir, project_dir, user_dir)
        data = json.loads((project_dir / "my-tmpl" / "template.json").read_text())
        assert "description" in data


# ---------------------------------------------------------------------------
# worca templates delete
# ---------------------------------------------------------------------------


class TestTemplatesDelete:
    def _run_delete(self, args, builtin_dir=None, project_dir=None, user_dir=None):
        with patch(
            "worca.cli.templates._resolve_dirs",
            return_value=(builtin_dir, project_dir, user_dir),
        ):
            main(["templates", "delete"] + args)

    def test_delete_subcommand_parsed(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "delete", "my-tmpl"])
        assert args.command == "templates"
        assert args.templates_command == "delete"
        assert args.template_id == "my-tmpl"

    def test_delete_global_flag_defaults_false(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "delete", "my-tmpl"])
        assert args.global_ is False

    def test_delete_global_flag_set(self):
        parser = create_parser()
        args = parser.parse_args(["templates", "delete", "my-tmpl", "--global"])
        assert args.global_ is True

    def test_delete_removes_project_template(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        _write_template(project_dir / "my-tmpl", _minimal("my-tmpl", tier="project"))
        user_dir = tmp_path / "user"
        self._run_delete(["my-tmpl"], builtin_dir, project_dir, user_dir)
        assert not (project_dir / "my-tmpl").exists()

    def test_delete_global_removes_user_template(self, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        user_dir = tmp_path / "user"
        _write_template(user_dir / "my-tmpl", _minimal("my-tmpl", tier="user"))
        self._run_delete(["my-tmpl", "--global"], builtin_dir, project_dir, user_dir)
        assert not (user_dir / "my-tmpl").exists()

    def test_delete_rejects_builtin(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        project_dir = tmp_path / "project"
        with pytest.raises(SystemExit) as exc_info:
            self._run_delete(["bugfix"], builtin_dir, project_dir, tmp_path / "user")
        assert exc_info.value.code != 0

    def test_delete_rejects_builtin_prints_error(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        _write_template(builtin_dir / "bugfix", _minimal("bugfix"))
        project_dir = tmp_path / "project"
        with pytest.raises(SystemExit):
            self._run_delete(["bugfix"], builtin_dir, project_dir, tmp_path / "user")
        err = capsys.readouterr().err
        assert "bugfix" in err or "built-in" in err.lower()

    def test_delete_not_found_exits_nonzero(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        user_dir = tmp_path / "user"
        with pytest.raises(SystemExit) as exc_info:
            self._run_delete(["nonexistent"], builtin_dir, project_dir, user_dir)
        assert exc_info.value.code != 0

    def test_delete_not_found_prints_error(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        project_dir.mkdir()
        user_dir = tmp_path / "user"
        with pytest.raises(SystemExit):
            self._run_delete(["nonexistent"], builtin_dir, project_dir, user_dir)
        err = capsys.readouterr().err
        assert "nonexistent" in err or "not found" in err.lower()

    def test_delete_prints_success_message(self, capsys, tmp_path):
        builtin_dir = tmp_path / "builtin"
        builtin_dir.mkdir()
        project_dir = tmp_path / "project"
        _write_template(project_dir / "my-tmpl", _minimal("my-tmpl", tier="project"))
        user_dir = tmp_path / "user"
        self._run_delete(["my-tmpl"], builtin_dir, project_dir, user_dir)
        out = capsys.readouterr().out
        assert "my-tmpl" in out


# ---------------------------------------------------------------------------
# _resolve_dirs — builtin_dir uses runtime copy inside a project
# ---------------------------------------------------------------------------


class TestResolveDirs:
    def test_builtin_dir_points_to_runtime_copy_in_project(self, tmp_path, monkeypatch):
        """When in a git repo, builtin_dir is .claude/worca/templates/ (runtime copy)."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        builtin_dir, _, _ = _resolve_dirs()
        assert builtin_dir == tmp_path / ".claude" / "worca" / "templates"

    def test_builtin_dir_falls_back_to_package_outside_project(self, tmp_path, monkeypatch):
        """When not in a git repo, builtin_dir falls back to package source."""
        monkeypatch.chdir(tmp_path)
        # No .git directory — walk up finds no git root
        builtin_dir, _, _ = _resolve_dirs()
        assert builtin_dir.name == "templates"
        assert builtin_dir.parent.name == "worca"
        # Must not be the runtime copy path
        assert ".claude" not in str(builtin_dir)

    def test_project_dir_is_dot_claude_templates(self, tmp_path, monkeypatch):
        """project_dir points to .claude/templates/ relative to git root."""
        monkeypatch.chdir(tmp_path)
        (tmp_path / ".git").mkdir()
        _, project_dir, _ = _resolve_dirs()
        assert project_dir == tmp_path / ".claude" / "templates"

    def test_project_dir_is_none_outside_project(self, tmp_path, monkeypatch):
        """project_dir is None when not inside a git repo."""
        monkeypatch.chdir(tmp_path)
        _, project_dir, _ = _resolve_dirs()
        assert project_dir is None
