"""Tests for worca CLI entry point (src/worca/cli/main.py)."""

import pytest

from worca.cli.main import create_parser, main


class TestCliParser:
    def test_parser_no_args_exits(self):
        """No command prints help and exits."""
        with pytest.raises(SystemExit) as exc_info:
            main([])
        assert exc_info.value.code == 1

    def test_parser_version_flag(self, capsys):
        """--version prints version and exits cleanly."""
        main(["--version"])
        captured = capsys.readouterr()
        assert "worca-cc" in captured.out

    def test_parser_init_subcommand(self):
        parser = create_parser()
        args = parser.parse_args(["init"])
        assert args.command == "init"
        assert args.upgrade is False
        assert args.force is False
        assert args.check is False
        assert args.source is None

    def test_parser_init_with_flags(self):
        parser = create_parser()
        args = parser.parse_args(["init", "--upgrade", "--source", "/tmp/worca"])
        assert args.upgrade is True
        assert args.source == "/tmp/worca"

    def test_parser_run_subcommand(self):
        parser = create_parser()
        args = parser.parse_args(["run", "--prompt", "hello world"])
        assert args.command == "run"
        assert args.prompt == "hello world"

    def test_parser_run_with_all_flags(self):
        parser = create_parser()
        args = parser.parse_args([
            "run", "--prompt", "test", "--plan", "plan.md",
            "--msize", "3", "--mloops", "2", "--resume",
        ])
        assert args.prompt == "test"
        assert args.plan == "plan.md"
        assert args.msize == 3
        assert args.mloops == 2
        assert args.resume is True

    def test_parser_pause_subcommand(self):
        parser = create_parser()
        args = parser.parse_args(["pause", "run-123"])
        assert args.command == "pause"
        assert args.run_id == "run-123"

    def test_parser_stop_subcommand(self):
        parser = create_parser()
        args = parser.parse_args(["stop"])
        assert args.command == "stop"
        assert args.run_id is None

    def test_parser_status_with_base(self):
        parser = create_parser()
        args = parser.parse_args(["status", "run-1", "--base", "/tmp/.worca"])
        assert args.command == "status"
        assert args.run_id == "run-1"
        assert args.base == "/tmp/.worca"

    def test_parser_multi_status(self):
        parser = create_parser()
        args = parser.parse_args(["multi-status"])
        assert args.command == "multi-status"
