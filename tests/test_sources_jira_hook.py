"""Tests for worca.sources.jira.hook — aggregated terminal report write-back."""
import io
import json
import os
import re
from unittest.mock import patch, MagicMock

import pytest

from worca.sources.jira import hook as jh


# --- event fixtures ---

def _envelope(event_type, payload, source_ref="jtr:BIRM-594", branch="feat/birm",
              timestamp="2026-06-15T10:00:00+00:00", run_id="r_test"):
    """Build a worca event envelope matching emitter.py's shape."""
    return {
        "schema_version": "1",
        "event_id": "evt-1",
        "event_type": event_type,
        "timestamp": timestamp,
        "run_id": run_id,
        "pipeline": {
            "branch": branch,
            "work_request": {
                "source_type": "jira",
                "source_ref": source_ref,
                "title": "Implement OAuth flow",
            },
        },
        "payload": payload,
    }


def _stdin(event):
    return io.StringIO(json.dumps(event))


def _write_events(path, events: list) -> None:
    path.write_text("\n".join(json.dumps(e) for e in events) + "\n")


def _extract_json_appendix(body: str) -> dict:
    """Pull the fenced JSON block out of a rendered comment body."""
    m = re.search(
        r"```json worca-report/v1\n(.*?)\n```",
        body,
        re.DOTALL,
    )
    assert m, f"no worca-report/v1 fence found in body:\n{body}"
    return json.loads(m.group(1))


# --- _human_duration ---

class TestHumanDuration:
    @pytest.mark.parametrize(
        "ms,expected",
        [
            (None, "?"),
            (-5, "?"),
            ("garbage", "?"),
            (5000, "5s"),
            (65000, "1m 5s"),
            (3_661_000, "1h 1m"),
        ],
    )
    def test_cases(self, ms, expected):
        assert jh._human_duration(ms) == expected


# --- aggregated report shape ---

class TestAggregateReport:
    def test_completed_aggregates_started_pr_and_warnings(self, tmp_path):
        events_path = tmp_path / "events.jsonl"
        _write_events(events_path, [
            _envelope("pipeline.run.started", {
                "resume": False,
                "started_at": "2026-06-15T09:00:00+00:00",
                "plan_file": "docs/plans/BIRM-594-x.md",
            }, timestamp="2026-06-15T09:00:00+00:00"),
            _envelope("pipeline.cost.budget_warning", {
                "total_cost_usd": 0.8, "budget_usd": 1.0, "pct_used": 80.0,
            }, timestamp="2026-06-15T09:20:00+00:00"),
            _envelope("pipeline.git.pr_created", {
                "pr_url": "https://github.com/o/r/pull/42",
                "pr_number": 42, "title": "Add OAuth",
                "commit_sha": "abc123def", "source_branch": "feat/birm",
                "target_branch": "main", "provider": "github",
            }, timestamp="2026-06-15T09:50:00+00:00"),
        ])
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 3_600_000,
            "total_cost_usd": 1.2345,
            "total_turns": 42,
            "total_tokens": 12_345,
            "stages_completed": ["plan", "implement", "test", "review", "pr"],
        }, timestamp="2026-06-15T10:00:00+00:00")

        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_EVENTS_PATH": str(events_path),
             }, clear=False):
            jh.main(stdin=_stdin(terminal))

        body = ms.run.call_args[0][0][4]
        # Human header — status glyph appears once in the title line now
        assert body.count("✅ COMPLETED") == 1
        assert "r_test" in body
        assert "1h 0m" in body
        assert "$1.2345" in body
        assert "12,345 tok" in body
        assert "plan → implement → test → review → pr" in body
        assert "https://github.com/o/r/pull/42" in body
        assert "docs/plans/BIRM-594-x.md" in body
        assert "1 during run" in body  # warnings count

        # JSON appendix
        report = _extract_json_appendix(body)
        assert report["schema"] == "worca-report/v1"
        assert report["status"] == "completed"
        assert report["source_ref"] == "jtr:BIRM-594"
        assert report["branch"] == "feat/birm"
        assert report["started_at"] == "2026-06-15T09:00:00+00:00"
        assert report["finished_at"] == "2026-06-15T10:00:00+00:00"
        assert report["duration_ms"] == 3_600_000
        assert report["cost_usd"] == 1.2345
        assert report["total_tokens"] == 12_345
        assert report["pr"]["url"] == "https://github.com/o/r/pull/42"
        assert report["pr"]["commit_sha"] == "abc123def"
        assert report["plan_file"] == "docs/plans/BIRM-594-x.md"
        assert len(report["warnings"]) == 1
        assert report["warnings"][0]["pct_used"] == 80.0
        assert report["termination"] == {}

    def test_failed_termination_block(self, tmp_path):
        terminal = _envelope("pipeline.run.failed", {
            "error": "two consecutive pytest failures",
            "failed_stage": "test",
            "error_type": "hook_block",
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        assert "❌ FAILED" in body
        assert "stage `test`" in body
        assert "two consecutive pytest failures" in body
        assert "hook_block" in body
        report = _extract_json_appendix(body)
        assert report["status"] == "failed"
        assert report["termination"] == {
            "stage": "test",
            "error_type": "hook_block",
            "error": "two consecutive pytest failures",
        }

    def test_interrupted_termination_block(self, tmp_path):
        terminal = _envelope("pipeline.run.interrupted", {
            "interrupted_stage": "implement",
            "elapsed_ms": 300_000,
            "source": "sigterm",
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        assert "⚠ INTERRUPTED" in body
        assert "stage `implement`" in body
        assert "source: sigterm" in body
        assert "5m 0s" in body
        report = _extract_json_appendix(body)
        assert report["status"] == "interrupted"
        assert report["duration_ms"] == 300_000  # elapsed_ms maps to duration_ms
        assert report["termination"] == {"stage": "implement", "source": "sigterm"}

    def test_cancelled_with_reason(self, tmp_path):
        terminal = _envelope("pipeline.run.cancelled", {
            "cancelled_stage": "plan",
            "elapsed_ms": 15_000,
            "source": "user",
            "reason": "User Ctrl-C",
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        assert "⏹ CANCELLED" in body
        assert "User Ctrl-C" in body
        report = _extract_json_appendix(body)
        assert report["status"] == "cancelled"
        assert report["termination"] == {
            "stage": "plan", "source": "user", "reason": "User Ctrl-C",
        }

    def test_cancelled_without_reason(self, tmp_path):
        terminal = _envelope("pipeline.run.cancelled", {
            "cancelled_stage": "plan",
            "elapsed_ms": 15_000,
            "source": "user",
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        # Header doesn't add a `reason:` segment when missing
        assert "reason:" not in body.split("```")[0]
        report = _extract_json_appendix(body)
        assert report["termination"]["reason"] is None

    def test_no_events_jsonl_still_produces_minimal_report(self, tmp_path):
        """If events.jsonl is missing, the terminal event alone is enough."""
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 100,
            "stages_completed": ["plan"],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            # WORCA_EVENTS_PATH deliberately not set
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        report = _extract_json_appendix(body)
        assert report["status"] == "completed"
        assert report["started_at"] is None
        assert report["plan_file"] is None
        assert report["pr"] is None
        assert report["warnings"] == []

    def test_appendix_is_valid_json(self, tmp_path):
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1,
            "stages_completed": [],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {"WORCA_PROJECT_ROOT": str(tmp_path)},
                        clear=False):
            jh.main(stdin=_stdin(terminal))
        body = ms.run.call_args[0][0][4]
        # Round-trip parse — _extract_json_appendix already does json.loads
        report = _extract_json_appendix(body)
        assert isinstance(report, dict)
        assert report["schema"] == "worca-report/v1"


# --- main() dispatch ---

class TestMain:
    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_terminal_event_posts_comment(self, mock_load, mock_subprocess):
        mock_load.return_value = {}
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": [],
        })
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0
        mock_subprocess.run.assert_called_once()
        args, kwargs = mock_subprocess.run.call_args
        argv = args[0]
        assert argv[:4] == ["jtr", "comment", "BIRM-594", "-y"]
        assert "✅ COMPLETED" in argv[4]
        assert kwargs["cwd"] == "/repo"

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_always_passes_dash_y(self, mock_load, mock_subprocess):
        """Regression guard: without -y the hook hangs on a vanished TTY."""
        mock_load.return_value = {}
        ev = _envelope("pipeline.run.failed", {
            "error": "x", "failed_stage": "y", "error_type": "z",
        })
        jh.main(stdin=_stdin(ev))
        argv = mock_subprocess.run.call_args[0][0]
        assert "-y" in argv

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/some/worca/repo"},
                clear=False)
    def test_uses_project_root_cwd(self, mock_load, mock_subprocess):
        """Regression guard for worktree mode."""
        mock_load.return_value = {}
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 100, "stages_completed": [],
        })
        jh.main(stdin=_stdin(ev))
        assert mock_subprocess.run.call_args.kwargs["cwd"] == "/some/worca/repo"

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {}, clear=True)
    def test_missing_project_root_falls_back_with_warning(
        self, mock_load, mock_subprocess, capsys
    ):
        mock_load.return_value = {}
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        })
        jh.main(stdin=_stdin(ev))
        captured = capsys.readouterr()
        assert "WORCA_PROJECT_ROOT not set" in captured.err
        # Still proceeds to post (falls back to cwd)
        mock_subprocess.run.assert_called_once()

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    def test_non_jira_source_is_noop(self, mock_load, mock_subprocess):
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        }, source_ref="gh:42")
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0
        mock_subprocess.run.assert_not_called()
        mock_load.assert_not_called()  # short-circuits before settings load

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_write_back_false_is_noop(self, mock_load, mock_subprocess):
        mock_load.return_value = {
            "worca": {"sources": {"jira": {"write_back": False}}}
        }
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        })
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0
        mock_subprocess.run.assert_not_called()

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_write_back_default_true_when_unset(self, mock_load, mock_subprocess):
        mock_load.return_value = {"worca": {}}
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        })
        jh.main(stdin=_stdin(ev))
        mock_subprocess.run.assert_called_once()

    @patch("worca.sources.jira.hook.subprocess")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_non_terminal_event_is_noop(self, mock_subprocess):
        """started/pr_created/budget_warning/stage events no longer post."""
        for et, payload in [
            ("pipeline.run.started", {"resume": False, "started_at": "..."}),
            ("pipeline.git.pr_created", {"pr_url": "u", "pr_number": 1,
                                          "title": "t"}),
            ("pipeline.cost.budget_warning", {"total_cost_usd": 1.0,
                                               "budget_usd": 2.0,
                                               "pct_used": 50.0}),
            ("pipeline.stage.started", {"stage": "plan"}),
        ]:
            mock_subprocess.run.reset_mock()
            ev = _envelope(et, payload)
            rc = jh.main(stdin=_stdin(ev))
            assert rc == 0, f"{et} should exit 0"
            assert not mock_subprocess.run.called, f"{et} should not post"

    @patch("worca.sources.jira.hook.subprocess")
    def test_malformed_json_is_noop(self, mock_subprocess, capsys):
        rc = jh.main(stdin=io.StringIO("{not json"))
        assert rc == 0
        mock_subprocess.run.assert_not_called()
        assert "malformed event JSON" in capsys.readouterr().err

    @patch("worca.sources.jira.hook.subprocess")
    def test_non_dict_event_is_noop(self, mock_subprocess):
        rc = jh.main(stdin=io.StringIO('["a", "b"]'))
        assert rc == 0
        mock_subprocess.run.assert_not_called()

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_jtr_missing_is_silent(self, mock_load, mock_subprocess, capsys):
        mock_load.return_value = {}
        mock_subprocess.run.side_effect = FileNotFoundError("jtr")
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        })
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0
        assert "not found on PATH" in capsys.readouterr().err

    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict("os.environ", {"WORCA_PROJECT_ROOT": "/repo"}, clear=False)
    def test_jtr_nonzero_exit_is_silent(self, mock_load, mock_subprocess):
        """Hook never raises even if jtr itself returns non-zero (e.g. Jira down)."""
        mock_load.return_value = {}
        mock_subprocess.run.return_value = MagicMock(
            returncode=1, stdout="", stderr="jira unreachable"
        )
        ev = _envelope("pipeline.run.failed", {
            "error": "x", "failed_stage": "y", "error_type": "z",
        })
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0  # Hook itself succeeded — jtr failure is logged-only


# --- local jira-report.md file write ---

class TestLocalReportFile:
    def test_writes_jira_report_md_to_run_dir(self, tmp_path):
        run_dir = tmp_path / "run123"
        run_dir.mkdir()
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": ["plan"],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_dir),
             }, clear=False):
            jh.main(stdin=_stdin(terminal))
        report_path = run_dir / "jira-report.md"
        assert report_path.exists()
        body = report_path.read_text()
        # File content matches what was posted to jtr
        assert body == ms.run.call_args[0][0][4]
        # Round-trip parse of the JSON appendix succeeds
        report = _extract_json_appendix(body)
        assert report["status"] == "completed"

    def test_file_written_even_when_jira_muted_via_env(self, tmp_path):
        """--no-jira (WORCA_JIRA_DISABLED=1) mutes the post but file still lands."""
        run_dir = tmp_path / "run456"
        run_dir.mkdir()
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": [],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_dir),
                 "WORCA_JIRA_DISABLED": "1",
             }, clear=False):
            jh.main(stdin=_stdin(terminal))
        assert (run_dir / "jira-report.md").exists()
        ms.run.assert_not_called()  # post is muted

    def test_file_written_even_when_jira_muted_via_settings(self, tmp_path):
        """write_back: false mutes the post but file still lands."""
        run_dir = tmp_path / "run789"
        run_dir.mkdir()
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": [],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={
                 "worca": {"sources": {"jira": {"write_back": False}}}
             }), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_dir),
             }, clear=False):
            jh.main(stdin=_stdin(terminal))
        assert (run_dir / "jira-report.md").exists()
        ms.run.assert_not_called()

    def test_no_file_for_non_jira_source(self, tmp_path):
        """Non-jtr sources short-circuit before the report is built — no file."""
        run_dir = tmp_path / "run_gh"
        run_dir.mkdir()
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": [],
        }, source_ref="gh:issue:42")
        with patch("worca.sources.jira.hook.subprocess"), \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_dir),
             }, clear=False):
            jh.main(stdin=_stdin(terminal))
        assert not (run_dir / "jira-report.md").exists()

    def test_missing_run_dir_warns_and_continues(self, tmp_path, capsys):
        """Hook outside a live pipeline run: warn, skip file, still try to post."""
        terminal = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": [],
        })
        with patch("worca.sources.jira.hook.subprocess") as ms, \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 # WORCA_RUN_DIR deliberately unset
             }, clear=False):
            os.environ.pop("WORCA_RUN_DIR", None)
            jh.main(stdin=_stdin(terminal))
        assert "WORCA_RUN_DIR not set" in capsys.readouterr().err
        ms.run.assert_called_once()  # still posts

    def test_consecutive_runs_get_separate_files(self, tmp_path):
        """Each run writes to its OWN $WORCA_RUN_DIR — no overwrite across runs."""
        run_a = tmp_path / "run_a"
        run_b = tmp_path / "run_b"
        run_a.mkdir()
        run_b.mkdir()

        ev_a = _envelope("pipeline.run.completed", {
            "duration_ms": 1000, "total_cost_usd": 0.1,
            "total_turns": 1, "total_tokens": 1, "stages_completed": ["plan"],
        }, run_id="run_a_id")
        ev_b = _envelope("pipeline.run.failed", {
            "error": "boom", "failed_stage": "test", "error_type": "x",
        }, run_id="run_b_id")

        with patch("worca.sources.jira.hook.subprocess"), \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_a),
             }, clear=False):
            jh.main(stdin=_stdin(ev_a))

        with patch("worca.sources.jira.hook.subprocess"), \
             patch("worca.sources.jira.hook.load_settings", return_value={}), \
             patch.dict("os.environ", {
                 "WORCA_PROJECT_ROOT": str(tmp_path),
                 "WORCA_RUN_DIR": str(run_b),
             }, clear=False):
            jh.main(stdin=_stdin(ev_b))

        # Both files exist, contain different runs' data, neither was clobbered
        report_a = _extract_json_appendix((run_a / "jira-report.md").read_text())
        report_b = _extract_json_appendix((run_b / "jira-report.md").read_text())
        assert report_a["run_id"] == "run_a_id"
        assert report_a["status"] == "completed"
        assert report_b["run_id"] == "run_b_id"
        assert report_b["status"] == "failed"


# --- WORCA_JIRA_DISABLED env override ---

class TestEnvDisableOverride:
    @patch("worca.sources.jira.hook.subprocess")
    @patch("worca.sources.jira.hook.load_settings")
    @patch.dict(
        "os.environ",
        {"WORCA_PROJECT_ROOT": "/repo", "WORCA_JIRA_DISABLED": "1"},
        clear=False,
    )
    def test_env_disabled_blocks_comment_even_when_settings_enable(
        self, mock_load, mock_subprocess
    ):
        """--no-jira CLI flag → env var → hard mute, overriding settings."""
        mock_load.return_value = {
            "worca": {"sources": {"jira": {"write_back": True}}}
        }
        ev = _envelope("pipeline.run.completed", {
            "duration_ms": 1, "total_cost_usd": 0.0,
            "total_turns": 0, "total_tokens": 0, "stages_completed": [],
        })
        rc = jh.main(stdin=_stdin(ev))
        assert rc == 0
        mock_subprocess.run.assert_not_called()
