from __future__ import annotations


from conftest import make_git_repo

from worca_bench.harvest import (
    DEFAULT_EXCLUDES,
    Telemetry,
    diff_line_count,
    extract_diff,
    parse_telemetry,
    touches_paths,
)


def test_extract_diff_captures_source_change(tmp_path):
    repo = tmp_path / "r"
    base = make_git_repo(repo, {"src/main.py": "x = 1\n"})
    (repo / "src" / "main.py").write_text("x = 2\n", encoding="utf-8")
    diff = extract_diff(repo, base)
    assert "src/main.py" in diff
    assert "x = 2" in diff


def test_extract_diff_excludes_worca_scaffolding(tmp_path):
    repo = tmp_path / "r"
    base = make_git_repo(repo, {"src/main.py": "x = 1\n"})
    # simulate worca writing scaffolding + a plan file
    (repo / ".claude").mkdir()
    (repo / ".claude" / "settings.json").write_text("{}", encoding="utf-8")
    (repo / ".worca").mkdir()
    (repo / ".worca" / "x").write_text("junk", encoding="utf-8")
    (repo / "MASTER_PLAN.md").write_text("# plan", encoding="utf-8")
    (repo / "src" / "main.py").write_text("x = 2\n", encoding="utf-8")
    diff = extract_diff(repo, base)
    assert "src/main.py" in diff
    for ex in DEFAULT_EXCLUDES:
        assert ex not in diff


def test_extract_diff_includes_untracked_new_file(tmp_path):
    repo = tmp_path / "r"
    base = make_git_repo(repo, {"README.md": "hi\n"})
    (repo / "NEW.py").write_text("print('new')\n", encoding="utf-8")
    diff = extract_diff(repo, base)
    assert "NEW.py" in diff


def test_extra_excludes_drops_gold_tests(tmp_path):
    repo = tmp_path / "r"
    base = make_git_repo(repo, {"lib.py": "def f(): pass\n"})
    (repo / "lib.py").write_text("def f(): return 1\n", encoding="utf-8")
    (repo / "tests").mkdir()
    (repo / "tests" / "test_lib.py").write_text("def test_f(): assert f()\n", encoding="utf-8")
    diff = extract_diff(repo, base, extra_excludes=("tests",))
    assert "lib.py" in diff
    assert "test_lib.py" not in diff


def test_diff_line_count_ignores_headers():
    diff = (
        "diff --git a/x b/x\n"
        "--- a/x\n+++ b/x\n"
        "@@ -1 +1 @@\n-old\n+new\n+another\n"
    )
    assert diff_line_count(diff) == 3  # -old, +new, +another


def test_touches_paths_detects_gold_test_edit():
    diff = "diff --git a/tests/test_lib.py b/tests/test_lib.py\n+evil\n"
    assert touches_paths(diff, ("tests/test_lib.py",)) == ["tests/test_lib.py"]
    assert touches_paths(diff, ("src/other.py",)) == []


def test_parse_telemetry_from_status():
    status = {
        "pipeline_status": "completed",
        "loop_counters": {"implement_test": 2},
        "token_usage": {
            "input_tokens": 100, "output_tokens": 50, "total_cost_usd": 0.01,
            "by_stage": {"plan": {}}, "by_model": {"opus": {}},
        },
        "stages": {
            "plan": {"iterations": [
                {"cost_usd": 0.004, "duration_ms": 500, "duration_api_ms": 400,
                 "outcome": "success", "api_retries": 1},
            ]},
            "review": {"iterations": [
                {"cost_usd": 0.006, "duration_ms": 700, "duration_api_ms": 600,
                 "outcome": "approve"},
            ]},
        },
    }
    t = parse_telemetry(status)
    assert isinstance(t, Telemetry)
    assert t.pipeline_status == "completed"
    assert t.cost_usd == 0.01            # top-level wins when present
    assert t.tokens["total"] == 150
    assert t.wall_time_s == 1.2          # (500+700)/1000
    assert t.api_time_s == 1.0
    assert t.loop_counters == {"implement_test": 2}
    assert t.stage_outcomes == {"plan": "success", "review": "approve"}
    assert t.api_retries == 1


def test_parse_telemetry_falls_back_to_stage_cost_sum():
    status = {
        "pipeline_status": "completed",
        "token_usage": {"input_tokens": 0, "output_tokens": 0},
        "stages": {
            "plan": {"iterations": [{"cost_usd": 0.5}]},
            "pr": {"iterations": [{"cost_usd": 0.25}]},
        },
    }
    t = parse_telemetry(status)
    assert t.cost_usd == 0.75
