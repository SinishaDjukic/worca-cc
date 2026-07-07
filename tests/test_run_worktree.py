"""Tests for worca.scripts.run_worktree."""
import os
import subprocess
from unittest.mock import patch


from worca.orchestrator.work_request import WorkRequest


def _wr(title="Add auth", source_type="prompt"):
    return WorkRequest(source_type=source_type, title=title)


class TestCreateParser:
    def test_prompt_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "Add auth"])
        assert args.prompt == "Add auth"
        assert args.source is None

    def test_source_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--source", "gh:issue:42"])
        assert args.source == "gh:issue:42"
        assert args.prompt is None

    def test_branch_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--branch", "feature/auth"])
        assert args.branch == "feature/auth"

    def test_fleet_id_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--fleet-id", "fleet-123"])
        assert args.fleet_id == "fleet-123"

    def test_guide_flag_single(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--guide", "docs/spec.md"])
        assert args.guide == ["docs/spec.md"]

    def test_guide_flag_multiple(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--guide", "a.md", "--guide", "b.md"])
        assert args.guide == ["a.md", "b.md"]

    def test_guide_absent_by_default(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x"])
        assert args.guide is None

    def test_skip_preflight_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--skip-preflight"])
        assert args.skip_preflight is True

    def test_msize_mloops_flags(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--msize", "3", "--mloops", "2"])
        assert args.msize == 3
        assert args.mloops == 2

    def test_template_and_param_flags(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--template", "bugfix", "--param", "k=v"])
        assert args.template == "bugfix"
        assert args.param == ["k=v"]

    def test_plan_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--prompt", "x", "--plan", "docs/plans/W-048.md"])
        assert args.plan == "docs/plans/W-048.md"

    def test_spec_flag(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--spec", "docs/spec.md"])
        assert args.spec == "docs/spec.md"

    def test_spec_with_prompt(self):
        from worca.scripts.run_worktree import create_parser
        args = create_parser().parse_args(["--spec", "docs/spec.md", "--prompt", "focus on auth"])
        assert args.spec == "docs/spec.md"
        assert args.prompt == "focus on auth"

    def test_requires_at_least_one_input(self):
        from worca.scripts.run_worktree import main
        assert main(["--plan", "p.md"]) == 2

    def test_spec_file_not_found(self):
        from worca.scripts.run_worktree import main
        assert main(["--spec", "/nonexistent/spec.md"]) == 2

    def test_plan_file_not_found(self):
        from worca.scripts.run_worktree import main
        assert main(["--plan", "/nonexistent/plan.md", "--prompt", "x"]) == 2


class TestBuildPipelineCmd:
    """Direct tests for _build_pipeline_cmd — pure-function, no Popen mock."""

    def _parse(self, argv):
        from worca.scripts.run_worktree import create_parser
        return create_parser().parse_args(argv)

    def test_minimal_prompt_shape(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "Add auth"]))
        assert cmd[1].endswith("run_pipeline.py")
        assert "--worktree" in cmd
        assert "--prompt" in cmd and "Add auth" in cmd

    def test_source_replaces_prompt(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--source", "gh:issue:42"]))
        assert "--source" in cmd and "gh:issue:42" in cmd
        assert "--prompt" not in cmd

    def test_msize_mloops_only_when_non_default(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x"]))
        assert "--msize" not in cmd and "--mloops" not in cmd
        cmd2 = _build_pipeline_cmd(
            self._parse(["--prompt", "x", "--msize", "3", "--mloops", "2"])
        )
        assert ["--msize", "3"] == cmd2[cmd2.index("--msize"):cmd2.index("--msize") + 2]
        assert ["--mloops", "2"] == cmd2[cmd2.index("--mloops"):cmd2.index("--mloops") + 2]

    def test_passes_registry_base_to_run_pipeline(self):
        """run_worktree must pass --registry-base so run_pipeline updates the
        parent project's pipelines.d/ instead of the worktree's empty one."""
        import os
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x"]))
        idx = cmd.index("--registry-base")
        assert cmd[idx + 1] == os.path.abspath(".worca")
        assert os.path.isabs(cmd[idx + 1])

    def test_passes_run_id_to_run_pipeline(self):
        """When run_worktree assigns a run_id, it must forward it as --run-id
        so the runner's status.json key matches the registry entry."""
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(
            self._parse(["--prompt", "x"]),
            run_id="20260501-000000-000-abcd",
        )
        idx = cmd.index("--run-id")
        assert cmd[idx + 1] == "20260501-000000-000-abcd"

    def test_omits_run_id_when_unset(self):
        """Legacy callers may omit run_id; --run-id is then absent so the
        runner falls back to generating one."""
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x"]))
        assert "--run-id" not in cmd

    def test_spec_forwarded(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--spec", "docs/spec.md"]))
        assert "--spec" in cmd and "docs/spec.md" in cmd
        assert "--source" not in cmd
        assert "--prompt" not in cmd

    def test_spec_with_prompt_forwards_both(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--spec", "docs/spec.md", "--prompt", "focus"]))
        assert "--spec" in cmd and "docs/spec.md" in cmd
        assert "--prompt" in cmd and "focus" in cmd

    def test_spec_with_plan_forwards_both(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--spec", "docs/spec.md", "--plan", "p.md"]))
        assert "--spec" in cmd and "docs/spec.md" in cmd
        assert "--plan" in cmd and "p.md" in cmd

    def test_spec_and_source_rejected(self):
        from worca.scripts.run_worktree import main
        assert main(["--spec", "docs/spec.md", "--source", "gh:issue:42"]) == 2


class TestHelpers:
    def test_generate_run_id_format(self):
        from worca.scripts.run_worktree import _generate_run_id
        rid = _generate_run_id()
        parts = rid.split("-")
        assert len(parts) == 4
        assert len(parts[0]) == 8   # YYYYMMDD
        assert len(parts[1]) == 6   # HHMMSS
        assert len(parts[2]) == 3   # mmm
        assert len(parts[3]) == 8   # xxxxxxxx hex (4-byte random suffix)

    def test_generate_run_id_unique(self):
        from worca.scripts.run_worktree import _generate_run_id
        ids = {_generate_run_id() for _ in range(10)}
        assert len(ids) == 10

    def test_slugify_basic(self):
        from worca.scripts.run_worktree import _slugify
        assert _slugify("Add auth") == "add-auth"

    def test_slugify_special_chars(self):
        from worca.scripts.run_worktree import _slugify
        assert _slugify("Add auth & search!") == "add-auth-search"

    def test_slugify_truncates(self):
        from worca.scripts.run_worktree import _slugify
        long_title = "a" * 50
        assert len(_slugify(long_title)) <= 30


# ---------------------------------------------------------------------------
# Shared mock setup for main() integration tests
# ---------------------------------------------------------------------------

_WORKTREE_PATH = "/tmp/wt/pipeline-abc"
_RUN_ID = "20260426-120000-000-abcd"


def _patches(worktree_path=_WORKTREE_PATH):
    """Return a list of active patch context managers for main() calls.

    Indices 8 and 9 stub the base-branch helpers so existing tests stay
    deterministic without exercising real git: branch_exists defaults to
    True and detect_default_branch defaults to "main", which preserves the
    legacy "main" fallback expected by callers that don't configure
    default_base_branch in settings.
    """
    return [
        patch("worca.scripts.run_worktree._generate_run_id", return_value=_RUN_ID),
        patch("worca.scripts.run_worktree.normalize"),
        patch("worca.scripts.run_worktree.create_pipeline_worktree", return_value=worktree_path),
        patch("worca.scripts.run_worktree.init_worktree_beads", return_value=True),
        patch("worca.scripts.run_worktree.register_pipeline"),
        patch("worca.utils.runtime.os.path.isdir", return_value=True),
        patch("worca.scripts.run_worktree.subprocess.Popen"),
        patch("worca.scripts.run_worktree.copy_claude_config"),
        patch("worca.scripts.run_worktree.branch_exists", return_value=True),
        patch("worca.scripts.run_worktree.detect_default_branch", return_value="main"),
        # plist[10]: stub the post-spawn liveness check so unit tests don't
        # spin the real 3 s wait loop. The crash-detection behaviour itself
        # is covered directly in TestAwaitPipelineStartup.
        patch(
            "worca.scripts.run_worktree._await_pipeline_startup",
            return_value=True,
        ),
    ]


class TestCreatesWorktree:
    def test_creates_worktree(self):
        from worca.scripts.run_worktree import main
        from unittest.mock import patch as _patch
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             _patch("worca.scripts.run_worktree.load_settings",
                    return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "main", ".worktrees"
        )

    def test_creates_worktree_with_base_branch(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--branch", "feature/auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "feature/auth", ".worktrees"
        )

    def test_passes_configured_worktree_base_dir(self, tmp_path):
        """When worca.parallel.worktree_base_dir is set, run_worktree forwards
        the value to create_pipeline_worktree instead of hardcoding .worktrees."""
        import json
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        settings_file = tmp_path / "settings.json"
        settings_file.write_text(
            json.dumps({"worca": {"parallel": {"worktree_base_dir": "~/wt-foo"}}})
        )
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             _patch("worca.scripts.run_worktree.load_settings",
                    return_value={"worca": {"parallel": {"worktree_base_dir": "~/wt-foo"}}}):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--settings", str(settings_file)])
        assert rc == 0
        mock_create.assert_called_once_with(_RUN_ID, "add-auth", "main", "~/wt-foo")

    def test_returns_error_when_worktree_creation_fails(self, capsys):
        from worca.scripts.run_worktree import main
        plist = _patches(worktree_path="")
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 1
        mock_reg.assert_not_called()
        mock_popen.assert_not_called()


class TestRegistersInPipelinesD:
    def test_registers_in_pipelines_d(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_reg.assert_called_once()
        kwargs = mock_reg.call_args[1]
        assert kwargs["run_id"] == _RUN_ID
        assert kwargs["worktree_path"] == _WORKTREE_PATH
        assert kwargs["title"] == "Add auth"
        assert kwargs["pid"] == os.getpid()


class TestFleetIdPassthrough:
    def test_fleet_id_passthrough(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--fleet-id", "fleet-xyz"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["fleet_id"] == "fleet-xyz"

    def test_fleet_id_none_when_absent(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["fleet_id"] is None

    def test_group_type_fleet_when_fleet_id_set(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--fleet-id", "fleet-xyz"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["group_type"] == "fleet"

    def test_group_type_none_when_fleet_id_absent(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs.get("group_type") is None


class TestTargetBranchPassthrough:
    def test_target_branch_passthrough(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--branch", "feature/auth"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["target_branch"] == "feature/auth"

    def test_target_branch_none_when_absent(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["target_branch"] is None


class TestGuidePassthrough:
    def test_guide_passthrough(self, tmp_path):
        from worca.scripts.run_worktree import main
        guide = str(tmp_path / "spec.md")
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--guide", guide])
        assert rc == 0
        cmd = mock_popen.call_args[0][0]
        assert "--guide" in cmd
        idx = cmd.index("--guide")
        assert cmd[idx + 1] == os.path.abspath(guide)

    def test_multiple_guides_all_passed(self, tmp_path):
        from worca.scripts.run_worktree import main
        g1 = str(tmp_path / "spec1.md")
        g2 = str(tmp_path / "spec2.md")
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--guide", g1, "--guide", g2])
        assert rc == 0
        cmd = mock_popen.call_args[0][0]
        assert cmd.count("--guide") == 2


class TestSpawnsDetached:
    def test_spawns_detached(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_popen.assert_called_once()
        kwargs = mock_popen.call_args[1]
        assert kwargs.get("start_new_session") is True
        assert kwargs.get("stdin") == subprocess.DEVNULL
        # stdout is the spawn.log file handle (captures startup crashes
        # that DEVNULL used to swallow); stderr is folded into stdout.
        assert kwargs.get("stdout") is not None
        assert kwargs.get("stdout") != subprocess.DEVNULL
        assert getattr(kwargs.get("stdout"), "name", "").endswith("spawn.log")
        assert kwargs.get("stderr") == subprocess.STDOUT

    def test_spawned_in_worktree_cwd(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        kwargs = mock_popen.call_args[1]
        assert kwargs.get("cwd") == _WORKTREE_PATH

    def test_command_includes_worktree_flag(self):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        cmd = mock_popen.call_args[0][0]
        assert "--worktree" in cmd

    def test_prints_run_id_and_path(self, capsys):
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        out = capsys.readouterr().out
        assert _RUN_ID in out
        assert _WORKTREE_PATH in out


class TestNoPromptNoSource:
    def test_no_prompt_no_source_exits_2(self, capsys):
        from worca.scripts.run_worktree import main
        rc = main([])
        assert rc == 2
        assert capsys.readouterr().err != ""


class TestCopyClaudeConfig:
    """_copy_claude_config: project's .claude/ → worktree, no-clobber."""

    def test_copies_settings_and_subdirs(self, tmp_path):
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"
        dst = tmp_path / "worktree" / ".claude"
        (src / "agents").mkdir(parents=True)
        (src / "hooks").mkdir()
        (src / "settings.json").write_text('{"a": 1}')
        (src / "agents" / "planner.md").write_text("plan")
        (src / "hooks" / "pre.py").write_text("h")

        copy_claude_config(str(src), str(dst))

        assert (dst / "settings.json").read_text() == '{"a": 1}'
        assert (dst / "agents" / "planner.md").read_text() == "plan"
        assert (dst / "hooks" / "pre.py").read_text() == "h"

    def test_skips_settings_local_json(self, tmp_path):
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"
        dst = tmp_path / "worktree" / ".claude"
        src.mkdir(parents=True)
        (src / "settings.json").write_text("{}")
        (src / "settings.local.json").write_text('{"machine": "local"}')

        copy_claude_config(str(src), str(dst))

        assert (dst / "settings.json").exists()
        assert not (dst / "settings.local.json").exists()

    def test_no_clobber_preserves_tracked_files(self, tmp_path):
        """When git already populated the worktree (committed .claude/),
        the copy must not overwrite those files."""
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"
        dst = tmp_path / "worktree" / ".claude"
        src.mkdir(parents=True)
        dst.mkdir(parents=True)
        # File git already placed in the worktree (older committed version)
        (dst / "settings.json").write_text('{"version": "tracked"}')
        # Project's untracked-on-master version (newer)
        (src / "settings.json").write_text('{"version": "uncommitted"}')

        copy_claude_config(str(src), str(dst))

        # Tracked file wins
        assert (dst / "settings.json").read_text() == '{"version": "tracked"}'

    def test_no_clobber_within_subdirs(self, tmp_path):
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"
        dst = tmp_path / "worktree" / ".claude"
        (src / "agents").mkdir(parents=True)
        (dst / "agents").mkdir(parents=True)
        (dst / "agents" / "planner.md").write_text("tracked")
        (src / "agents" / "planner.md").write_text("uncommitted")
        (src / "agents" / "tester.md").write_text("new")

        copy_claude_config(str(src), str(dst))

        assert (dst / "agents" / "planner.md").read_text() == "tracked"
        # Files only in src still get copied through
        assert (dst / "agents" / "tester.md").read_text() == "new"

    def test_no_op_when_src_missing(self, tmp_path):
        """If the project has no .claude/ at all (edge case), don't crash."""
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"  # never created
        dst = tmp_path / "worktree" / ".claude"

        copy_claude_config(str(src), str(dst))  # must not raise
        assert not dst.exists()

    def test_includes_worca_runtime(self, tmp_path):
        """worca/ subdir must come along — that's the whole runtime."""
        from worca.utils.runtime import copy_claude_config

        src = tmp_path / "project" / ".claude"
        dst = tmp_path / "worktree" / ".claude"
        (src / "worca" / "scripts").mkdir(parents=True)
        (src / "worca" / "scripts" / "run_pipeline.py").write_text("py")

        copy_claude_config(str(src), str(dst))

        assert (dst / "worca" / "scripts" / "run_pipeline.py").read_text() == "py"


class TestDefaultBaseBranch:
    """--branch omitted uses default_base_branch from settings; --branch provided ignores it."""

    def test_branch_omitted_uses_config_default_base_branch(self, tmp_path):
        """When --branch is not provided, run_worktree reads
        worca.parallel.default_base_branch from settings (fallback 'main')."""
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        plist = _patches()
        settings = {"worca": {"parallel": {"default_base_branch": "develop"}}}
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             _patch("worca.scripts.run_worktree.load_settings", return_value=settings):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "develop", ".worktrees"
        )

    def test_branch_omitted_falls_back_to_main(self, tmp_path):
        """When --branch not provided and no default_base_branch in settings,
        falls back to 'main'."""
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        plist = _patches()
        settings = {"worca": {"parallel": {}}}
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             _patch("worca.scripts.run_worktree.load_settings", return_value=settings):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "main", ".worktrees"
        )

    def test_branch_provided_ignores_config(self, tmp_path):
        """When --branch is explicitly provided, default_base_branch is ignored."""
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        plist = _patches()
        settings = {"worca": {"parallel": {"default_base_branch": "develop"}}}
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             _patch("worca.scripts.run_worktree.load_settings", return_value=settings):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth", "--branch", "feature/auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "feature/auth", ".worktrees"
        )

    def test_configured_branch_missing_falls_back_to_detect(self, tmp_path, capsys):
        """When default_base_branch is set but the ref does not exist in this
        repo, run_worktree must fall back to detect_default_branch instead of
        passing the missing branch to git (which would fail with exit 1).
        Emits a warning to stderr so the misconfiguration is visible.
        """
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        plist = _patches()
        # Settings say "main" but this repo uses "master". branch_exists
        # returns False for "main" (the configured value); detect returns
        # "master" as the actual repo default.
        settings = {"worca": {"parallel": {"default_base_branch": "main"}}}
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[10], \
             _patch("worca.scripts.run_worktree.branch_exists", return_value=False), \
             _patch("worca.scripts.run_worktree.detect_default_branch", return_value="master"), \
             _patch("worca.scripts.run_worktree.load_settings", return_value=settings):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "master", ".worktrees"
        )
        captured = capsys.readouterr()
        # Warning names the misconfigured value so the user can fix settings.
        assert "main" in captured.err
        assert "auto-detect" in captured.err.lower()

    def test_no_config_uses_detect(self, tmp_path):
        """When neither --branch nor default_base_branch is set, fall through
        directly to detect_default_branch."""
        from unittest.mock import patch as _patch
        from worca.scripts.run_worktree import main

        plist = _patches()
        settings = {"worca": {"parallel": {}}}
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[10], \
             _patch("worca.scripts.run_worktree.branch_exists", return_value=False), \
             _patch("worca.scripts.run_worktree.detect_default_branch", return_value="master"), \
             _patch("worca.scripts.run_worktree.load_settings", return_value=settings):
            mock_norm.return_value = _wr("Add auth")
            rc = main(["--prompt", "Add auth"])
        assert rc == 0
        mock_create.assert_called_once_with(
            _RUN_ID, "add-auth", "master", ".worktrees"
        )

    def test_resolve_base_branch_unit_priority(self):
        """Direct unit test of the resolver: explicit --branch wins over
        configured value, configured-and-existing wins over detection."""
        from worca.scripts.run_worktree import _resolve_base_branch
        from unittest.mock import patch as _patch

        class _Args:
            def __init__(self, branch=None):
                self.branch = branch

        # 1. Explicit --branch wins
        with _patch("worca.scripts.run_worktree.branch_exists") as be, \
             _patch("worca.scripts.run_worktree.detect_default_branch") as det:
            assert _resolve_base_branch(_Args(branch="feature"), {}) == "feature"
            be.assert_not_called()
            det.assert_not_called()

        # 2. Configured + exists → configured
        settings = {"worca": {"parallel": {"default_base_branch": "develop"}}}
        with _patch("worca.scripts.run_worktree.branch_exists", return_value=True), \
             _patch("worca.scripts.run_worktree.detect_default_branch") as det:
            assert _resolve_base_branch(_Args(), settings) == "develop"
            det.assert_not_called()

        # 3. Configured + missing → detect
        with _patch("worca.scripts.run_worktree.branch_exists", return_value=False), \
             _patch("worca.scripts.run_worktree.detect_default_branch", return_value="master"):
            assert _resolve_base_branch(_Args(), settings) == "master"

        # 4. No configured → detect
        with _patch("worca.scripts.run_worktree.branch_exists") as be, \
             _patch("worca.scripts.run_worktree.detect_default_branch", return_value="master"):
            assert _resolve_base_branch(_Args(), {"worca": {"parallel": {}}}) == "master"
            be.assert_not_called()


class TestMissingWorcaRuntime:
    def test_fails_fast_when_runtime_missing(self, capsys):
        import pytest
        from worca.scripts.run_worktree import main
        plist = _patches()
        # Override isdir to return False — simulates missing .claude/worca/.
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4] as mock_reg, \
             patch("worca.utils.runtime.os.path.isdir", return_value=False), \
             plist[6] as mock_popen, plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _wr("Add auth")
            with pytest.raises(SystemExit) as exc_info:
                main(["--prompt", "Add auth"])
        assert exc_info.value.code == 1
        err = capsys.readouterr().err
        assert "worca runtime not found" in err
        # Validation must run before any side effects.
        mock_create.assert_not_called()
        mock_reg.assert_not_called()
        mock_popen.assert_not_called()


# ---------------------------------------------------------------------------
# _await_pipeline_startup — post-spawn crash detection
# ---------------------------------------------------------------------------


class _FakeProc:
    """Minimal subprocess.Popen stand-in: poll() returns a fixed value."""

    def __init__(self, poll_value):
        self._poll_value = poll_value

    def poll(self):
        return self._poll_value


class TestAwaitPipelineStartup:
    """Direct coverage for the liveness check — the main() tests stub it."""

    def test_status_json_present_returns_true(self, tmp_path):
        from worca.scripts.run_worktree import _await_pipeline_startup

        status_json = tmp_path / "status.json"
        status_json.write_text("{}")
        # proc reports "exited" — but status.json exists, so it started fine.
        assert _await_pipeline_startup(_FakeProc(2), "r1", str(status_json)) is True

    def test_proc_exited_before_status_json_returns_false(self, tmp_path):
        from worca.scripts.run_worktree import _await_pipeline_startup

        status_json = tmp_path / "nope" / "status.json"  # never created
        # proc exited (rc=2) and no status.json → startup crash.
        assert _await_pipeline_startup(_FakeProc(2), "r1", str(status_json)) is False

    def test_proc_alive_after_window_returns_true(self, tmp_path, monkeypatch):
        from worca.scripts import run_worktree

        status_json = tmp_path / "nope" / "status.json"  # never created
        # Collapse the wait window so the test is instant; proc still alive
        # (poll → None) after it → slow-but-alive start, treated as healthy.
        monkeypatch.setattr(run_worktree, "_STARTUP_WAIT_SECONDS", 0.0)
        assert (
            run_worktree._await_pipeline_startup(
                _FakeProc(None), "r1", str(status_json)
            )
            is True
        )

    def test_spawn_log_tail_reads_last_lines(self, tmp_path):
        from worca.scripts.run_worktree import _spawn_log_tail

        log = tmp_path / "spawn.log"
        log.write_text("\n".join(f"line {i}" for i in range(50)))
        tail = _spawn_log_tail(str(log), max_lines=5)
        assert tail.splitlines() == [f"line {i}" for i in range(45, 50)]

    def test_spawn_log_tail_missing_file_returns_empty(self, tmp_path):
        from worca.scripts.run_worktree import _spawn_log_tail

        assert _spawn_log_tail(str(tmp_path / "missing.log")) == ""


# ---------------------------------------------------------------------------
# W-067: github_pr source — branch flag rejection and target_branch derivation
# ---------------------------------------------------------------------------

def _pr_wr(
    title="Fix auth bug",
    pr_number=42,
    pr_head_branch="worca/fix-auth-abc",
    pr_base_branch="main",
    pr_is_cross_repo=False,
):
    return WorkRequest(
        source_type="github_pr",
        title=title,
        pr_number=pr_number,
        pr_head_branch=pr_head_branch,
        pr_base_branch=pr_base_branch,
        pr_is_cross_repo=pr_is_cross_repo,
    )


class TestGithubPrSource:
    """W-067: worktree behaviour for source_type==github_pr."""

    def test_worktree_pr_source_rejects_branch_flag(self, capsys):
        """--branch must be rejected when source is a github PR."""
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10]:
            mock_norm.return_value = _pr_wr()
            rc = main(["--source", "gh:pr:42", "--branch", "feature/other"])
        assert rc == 2
        captured = capsys.readouterr()
        assert "branch" in captured.err.lower() or "branch" in captured.out.lower()

    def test_worktree_pr_target_branch_from_base(self):
        """target_branch in registry must come from pr_base_branch, not --branch."""
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             patch("worca.scripts.run_worktree.find_worktree_for_branch", return_value=""), \
             patch("worca.scripts.run_worktree.checkout_pr_worktree", return_value=_WORKTREE_PATH), \
             patch("worca.scripts.run_worktree.load_settings",
                   return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _pr_wr(pr_base_branch="develop")
            rc = main(["--source", "gh:pr:42"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["target_branch"] == "develop"
        # create_pipeline_worktree must NOT be called; checkout_pr_worktree handles it
        mock_create.assert_not_called()

    def test_worktree_pr_uses_checkout_pr_worktree(self):
        """For github_pr source, checkout_pr_worktree is called (not create_pipeline_worktree)."""
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4], plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             patch("worca.scripts.run_worktree.find_worktree_for_branch", return_value=""), \
             patch("worca.scripts.run_worktree.checkout_pr_worktree", return_value=_WORKTREE_PATH) as mock_checkout, \
             patch("worca.scripts.run_worktree.load_settings",
                   return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _pr_wr(pr_number=42, pr_is_cross_repo=False)
            rc = main(["--source", "gh:pr:42"])
        assert rc == 0
        mock_checkout.assert_called_once()
        mock_create.assert_not_called()

    def test_worktree_pr_head_branch_preserved_in_registry(self):
        """The worktree branch stored in the registry is the PR head branch (L2)."""
        from worca.scripts.run_worktree import main
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             patch("worca.scripts.run_worktree.find_worktree_for_branch", return_value=""), \
             patch("worca.scripts.run_worktree.checkout_pr_worktree", return_value=_WORKTREE_PATH), \
             patch("worca.scripts.run_worktree.load_settings",
                   return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _pr_wr(pr_head_branch="feature/my-fix")
            rc = main(["--source", "gh:pr:42"])
        assert rc == 0
        kwargs = mock_reg.call_args[1]
        assert kwargs["branch"] == "feature/my-fix"

    def test_worktree_pr_reuses_existing_worktree(self):
        """When the PR head branch is already checked out (the run that opened
        the PR), reuse that worktree instead of calling checkout_pr_worktree."""
        from worca.scripts.run_worktree import main
        existing = "/tmp/wt/pipeline-original"
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2] as mock_create, \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             patch("worca.scripts.run_worktree.find_worktree_for_branch", return_value=existing), \
             patch("worca.scripts.run_worktree._worktree_pipeline_is_live", return_value=False), \
             patch("worca.scripts.run_worktree.checkout_pr_worktree") as mock_checkout, \
             patch("worca.scripts.run_worktree.load_settings",
                   return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _pr_wr(pr_head_branch="worca/fix-auth-abc")
            rc = main(["--source", "gh:pr:42"])
        assert rc == 0
        # Reused — neither worktree-creation path is invoked
        mock_checkout.assert_not_called()
        mock_create.assert_not_called()
        kwargs = mock_reg.call_args[1]
        assert kwargs["worktree_path"] == existing
        assert kwargs["branch"] == "worca/fix-auth-abc"

    def test_worktree_pr_refuses_reuse_when_pipeline_live(self):
        """If a pipeline is still live in the existing worktree, refuse with a
        clear error rather than corrupting the running run."""
        from worca.scripts.run_worktree import main
        existing = "/tmp/wt/pipeline-original"
        plist = _patches()
        with plist[0], plist[1] as mock_norm, plist[2], \
             plist[3], plist[4] as mock_reg, plist[5], plist[6], plist[7], plist[8], plist[9], plist[10], \
             patch("worca.scripts.run_worktree.find_worktree_for_branch", return_value=existing), \
             patch("worca.scripts.run_worktree._worktree_pipeline_is_live", return_value=True), \
             patch("worca.scripts.run_worktree.checkout_pr_worktree") as mock_checkout, \
             patch("worca.scripts.run_worktree.load_settings",
                   return_value={"worca": {"parallel": {}}}):
            mock_norm.return_value = _pr_wr(pr_head_branch="worca/fix-auth-abc")
            rc = main(["--source", "gh:pr:42"])
        assert rc == 1
        mock_checkout.assert_not_called()
        mock_reg.assert_not_called()


# ---------------------------------------------------------------------------
# W-069: --max-beads passthrough
# ---------------------------------------------------------------------------


class TestMaxBeadsPassthrough:
    """--max-beads is accepted by create_parser and forwarded by _build_pipeline_cmd."""

    def _parse(self, argv):
        from worca.scripts.run_worktree import create_parser
        return create_parser().parse_args(argv)

    def test_max_beads_flag_default_none(self):
        args = self._parse(["--prompt", "x"])
        assert args.max_beads is None

    def test_max_beads_flag_parsed(self):
        args = self._parse(["--prompt", "x", "--max-beads", "5"])
        assert args.max_beads == 5

    def test_max_beads_zero_accepted(self):
        args = self._parse(["--prompt", "x", "--max-beads", "0"])
        assert args.max_beads == 0

    def test_build_pipeline_cmd_includes_max_beads_when_set(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x", "--max-beads", "3"]))
        idx = cmd.index("--max-beads")
        assert cmd[idx + 1] == "3"

    def test_build_pipeline_cmd_omits_max_beads_when_none(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x"]))
        assert "--max-beads" not in cmd

    def test_build_pipeline_cmd_includes_max_beads_zero(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x", "--max-beads", "0"]))
        idx = cmd.index("--max-beads")
        assert cmd[idx + 1] == "0"


# ---------------------------------------------------------------------------
# Phase 5: --claude-md-mode passthrough
# ---------------------------------------------------------------------------


class TestClaudeMdModeWorktree:
    """--claude-md-mode is accepted by create_parser and forwarded by _build_pipeline_cmd."""

    def _parse(self, argv):
        from worca.scripts.run_worktree import create_parser
        return create_parser().parse_args(argv)

    def test_claude_md_mode_default_none(self):
        args = self._parse(["--prompt", "x"])
        assert args.claude_md_mode is None

    def test_claude_md_mode_parsed(self):
        args = self._parse(["--prompt", "x", "--claude-md-mode", "project"])
        assert args.claude_md_mode == "project"

    def test_build_pipeline_cmd_includes_claude_md_mode_when_set(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x", "--claude-md-mode", "project+local"]))
        idx = cmd.index("--claude-md-mode")
        assert cmd[idx + 1] == "project+local"

    def test_build_pipeline_cmd_omits_claude_md_mode_when_none(self):
        from worca.scripts.run_worktree import _build_pipeline_cmd
        cmd = _build_pipeline_cmd(self._parse(["--prompt", "x"]))
        assert "--claude-md-mode" not in cmd
