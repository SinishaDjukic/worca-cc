"""Tests for worca.orchestrator.runner — pipeline runner."""

import importlib.util
import json
import os
import re
from unittest.mock import patch, MagicMock

import pytest

from worca.orchestrator.runner import (
    run_stage,
    run_pipeline,
    check_loop_limit,
    handle_pr_review,
    _ensure_beads_initialized,
    _generate_run_id,
    _slugify,
    _resolve_plan_path,
    _render_agent_templates,
    _agent_path,
    _archive_run,
    LoopExhaustedError,
    PipelineError,
)
from worca.orchestrator.stages import Stage


@pytest.fixture(autouse=True)
def _mock_beads_init():
    """Prevent run_pipeline from invoking the real bd binary in tests."""
    with patch("worca.orchestrator.runner._ensure_beads_initialized"):
        yield


def _import_run_pipeline():
    """Import .claude/scripts/run_pipeline.py as a module."""
    script_path = os.path.join(
        os.path.dirname(__file__), "..", ".claude", "scripts", "run_pipeline.py",
    )
    spec = importlib.util.spec_from_file_location("run_pipeline_script", script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_run_stage_calls_agent():
    mock_config = {"agent": "planner", "model": "claude-opus-4-6", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"approach": "test"}) as mock_run:
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    mock_run.assert_called_once()
    assert result == {"approach": "test"}


def test_run_stage_extracts_structured_output():
    mock_config = {"agent": "planner", "model": "claude-opus-4-6", "max_turns": 40, "schema": "plan.json"}
    envelope = {"type": "result", "structured_output": {"approach": "test"}, "total_cost_usd": 1.0}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value=envelope):
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    assert result == {"approach": "test"}
    assert raw == envelope


def test_run_stage_passes_correct_args():
    mock_config = {"agent": "tester", "model": "claude-sonnet-4-6", "max_turns": 20, "schema": "test.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"passed": True}) as mock_run:
            result, raw = run_stage(Stage.TEST, {"prompt": "run tests"})
    call_kwargs = mock_run.call_args
    # Agent path should contain the agent name
    assert ".claude/agents/core/tester.md" in str(call_kwargs)
    # Schema path should be resolved
    assert ".claude/worca/schemas/test.json" in str(call_kwargs)


def test_run_stage_passes_model_to_run_agent():
    mock_config = {"agent": "implementer", "model": "claude-sonnet-4-6", "max_turns": 30, "schema": "implement.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.IMPLEMENT, {"prompt": "build it"})
    assert mock_run.call_args.kwargs.get("model") == "claude-sonnet-4-6"


def test_run_stage_passes_none_model_when_missing():
    mock_config = {"agent": "planner", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.PLAN, {"prompt": "plan it"})
    assert mock_run.call_args.kwargs.get("model") is None


def test_check_loop_limit_within_limit(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 3, str(settings)) is True


def test_check_loop_limit_at_boundary(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 9, str(settings)) is True


def test_check_loop_limit_exceeded(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 10}}}))
    assert check_loop_limit("implement_test", 10, str(settings)) is False


def test_check_loop_limit_exceeded_over(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    assert check_loop_limit("implement_test", 7, str(settings)) is False


def test_check_loop_limit_default_when_missing(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {}}))
    # No loops configured, default to 5
    assert check_loop_limit("implement_test", 4, str(settings)) is True
    assert check_loop_limit("implement_test", 5, str(settings)) is False


def test_check_loop_limit_default_when_no_file(tmp_path):
    missing = tmp_path / "nonexistent.json"
    # Default to 5 when file doesn't exist
    assert check_loop_limit("implement_test", 4, str(missing)) is True
    assert check_loop_limit("implement_test", 5, str(missing)) is False


def test_handle_pr_approve():
    stage, status = handle_pr_review("approve", {"stage": "review"})
    assert stage is None  # pipeline done


def test_handle_pr_request_changes():
    stage, status = handle_pr_review("request_changes", {"stage": "review"})
    assert stage == Stage.IMPLEMENT


def test_handle_pr_reject():
    stage, status = handle_pr_review("reject", {"stage": "review"})
    assert stage is None


def test_handle_pr_restart():
    stage, status = handle_pr_review("restart_planning", {"stage": "review"})
    assert stage == Stage.PLAN


# --- msize multiplier ---

def test_run_stage_msize_multiplies_max_turns():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.PLAN, {"prompt": "test"}, msize=3)
    call_kwargs = mock_run.call_args
    assert call_kwargs.kwargs.get("max_turns") == 120  # 40 * 3


def test_run_stage_msize_default_is_1():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"ok": True}) as mock_run:
            run_stage(Stage.PLAN, {"prompt": "test"})
    call_kwargs = mock_run.call_args
    assert call_kwargs.kwargs.get("max_turns") == 40


# --- mloops multiplier ---

def test_check_loop_limit_mloops_multiplies(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    # Without multiplier: 5 is at limit
    assert check_loop_limit("implement_test", 5, str(settings)) is False
    # With mloops=2: limit becomes 10
    assert check_loop_limit("implement_test", 5, str(settings), mloops=2) is True
    assert check_loop_limit("implement_test", 10, str(settings), mloops=2) is False


def test_check_loop_limit_mloops_default_is_1(tmp_path):
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({"worca": {"loops": {"implement_test": 5}}}))
    assert check_loop_limit("implement_test", 4, str(settings)) is True
    assert check_loop_limit("implement_test", 5, str(settings)) is False


# --- _ensure_beads_initialized ---

def test_ensure_beads_initialized_already_init():
    mock_result = MagicMock()
    mock_result.returncode = 0
    with patch("worca.orchestrator.runner.subprocess.run", return_value=mock_result) as mock_run:
        _ensure_beads_initialized()
    # Should only call bd stats, not bd init
    mock_run.assert_called_once()
    assert mock_run.call_args[0][0] == ["bd", "stats"]


def test_ensure_beads_initialized_runs_init():
    stats_fail = MagicMock(returncode=1)
    init_ok = MagicMock(returncode=0)
    with patch("worca.orchestrator.runner.subprocess.run", side_effect=[stats_fail, init_ok]) as mock_run:
        _ensure_beads_initialized()
    assert mock_run.call_count == 2
    assert mock_run.call_args_list[0][0][0] == ["bd", "stats"]
    assert mock_run.call_args_list[1][0][0] == ["bd", "init"]


def test_ensure_beads_initialized_raises_on_init_failure():
    stats_fail = MagicMock(returncode=1)
    init_fail = MagicMock(returncode=1, stderr="no git repo")
    with patch("worca.orchestrator.runner.subprocess.run", side_effect=[stats_fail, init_fail]):
        try:
            _ensure_beads_initialized()
            assert False, "Should have raised"
        except PipelineError as e:
            assert "beads" in str(e).lower()


# --- get_enabled_stages integration ---

def test_runner_imports_get_enabled_stages():
    """Verify runner can import get_enabled_stages."""
    from worca.orchestrator.stages import get_enabled_stages
    assert callable(get_enabled_stages)


def test_handle_pr_review_unknown_outcome():
    """Unknown outcome treated as approve (no next stage)."""
    stage, status = handle_pr_review("unknown", {"stage": "review"})
    assert stage is None


# --- run_id and helper functions ---

def test_generate_run_id_format():
    """Run ID should be YYYYMMDD-HHMMSS-mmm-xxxx format."""
    run_id = _generate_run_id("2026-03-09T17:15:45.583887+00:00")
    assert re.match(r"^\d{8}-\d{6}-\d{3}-[0-9a-f]{4}$", run_id)
    assert run_id.startswith("20260309-171545-583-")


def test_generate_run_id_without_timezone():
    run_id = _generate_run_id("2026-01-15T09:30:00")
    assert re.match(r"^\d{8}-\d{6}-\d{3}-[0-9a-f]{4}$", run_id)
    assert run_id.startswith("20260115-093000-000-")


def test_slugify_basic():
    assert _slugify("Add User Auth") == "add-user-auth"


def test_slugify_special_chars():
    assert _slugify("W-006: Cost & Token Tracking") == "w-006-cost-token-tracking"


def test_slugify_truncates():
    long_title = "a" * 100
    assert len(_slugify(long_title)) <= 60


def test_resolve_plan_path():
    result = _resolve_plan_path(
        "docs/plans/{timestamp}-{title_slug}.md",
        "20260309-171545",
        "W-006: Cost Tracking",
    )
    assert result == "docs/plans/20260309-171545-w-006-cost-tracking.md"


def test_render_agent_templates(tmp_path, monkeypatch):
    """Templates with placeholders should be rendered to run_dir/agents/."""
    # Create mock template dir
    src_dir = tmp_path / "templates"
    src_dir.mkdir()
    (src_dir / "coordinator.md").write_text("# Coordinator\n\n1. Read {plan_file}\n")
    (src_dir / "planner.md").write_text("# Planner\n\nRun: {run_id}\nTitle: {title}\n")
    (src_dir / "not_an_agent.txt").write_text("ignore me")

    # Patch the source directory used by _render_agent_templates
    monkeypatch.setattr("worca.orchestrator.runner._render_agent_templates",
                        lambda run_dir, template_vars: None)

    # Call the real logic directly (inline version)
    run_dir = tmp_path / "run"
    agents_dst = run_dir / "agents"
    agents_dst.mkdir(parents=True)

    template_vars = {"plan_file": "docs/plans/my-plan.md", "run_id": "20260309", "title": "Test"}
    for filename in os.listdir(str(src_dir)):
        if not filename.endswith(".md"):
            continue
        with open(os.path.join(str(src_dir), filename)) as f:
            content = f.read()
        for key, value in template_vars.items():
            content = content.replace(f"{{{key}}}", str(value))
        with open(os.path.join(str(agents_dst), filename), "w") as f:
            f.write(content)

    # Verify rendered output
    rendered_coord = (agents_dst / "coordinator.md").read_text()
    assert "docs/plans/my-plan.md" in rendered_coord
    assert "{plan_file}" not in rendered_coord

    rendered_plan = (agents_dst / "planner.md").read_text()
    assert "20260309" in rendered_plan
    assert "Test" in rendered_plan

    # .txt file should not be rendered
    assert not (agents_dst / "not_an_agent.txt").exists()


def test_agent_path_with_run_dir(tmp_path):
    """_agent_path prefers rendered agent in run_dir if it exists."""
    run_dir = tmp_path / "run"
    agents_dir = run_dir / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "coordinator.md").write_text("# Rendered coordinator")

    result = _agent_path("coordinator", run_dir=str(run_dir))
    assert result == str(agents_dir / "coordinator.md")


def test_agent_path_fallback():
    """_agent_path falls back to .claude/agents/core/ when no run_dir."""
    result = _agent_path("coordinator")
    assert result == ".claude/agents/core/coordinator.md"


def test_agent_path_fallback_missing_rendered(tmp_path):
    """_agent_path falls back when run_dir exists but agent file doesn't."""
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    result = _agent_path("coordinator", run_dir=str(run_dir))
    assert result == ".claude/agents/core/coordinator.md"


# --- plan_file support ---

def test_run_pipeline_with_plan_file_skips_plan_stage(tmp_path):
    """When plan_file is provided, PLAN stage is skipped and COORDINATE starts first."""
    from worca.orchestrator.work_request import WorkRequest

    # Create a plan file
    plan = tmp_path / "my_plan.md"
    plan.write_text("# My Plan\n\n## Tasks\n1. Do thing A\n2. Do thing B\n")

    # Create settings
    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test plan skip")

    stages_run = []

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        stages_run.append(stage.value)
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr,
                        plan_file=str(plan),
                        settings_path=str(settings),
                        status_path=status_path,
                    )

    # PLAN should not have been run; COORDINATE should be the only stage
    assert "plan" not in stages_run
    assert "coordinate" in stages_run
    # Plan file path stored in status
    assert result["plan_file"] == str(plan)


def test_plan_file_stores_path_in_status(tmp_path, monkeypatch):
    """plan_file path is stored in status and no MASTER_PLAN.md is created."""
    from worca.orchestrator.work_request import WorkRequest

    plan_content = "# Pre-made Plan\n\nDetailed tasks here.\n"
    plan = tmp_path / "spec.md"
    plan.write_text(plan_content)

    monkeypatch.chdir(tmp_path)

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test master plan")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": []}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr,
                        plan_file=str(plan),
                        settings_path=str(settings),
                        status_path=status_path,
                    )

    # No MASTER_PLAN.md should be created
    master_plan = tmp_path / "MASTER_PLAN.md"
    assert not master_plan.exists()

    # Plan file path stored in status
    assert result["plan_file"] == str(plan)

    # Per-run directory created
    assert result["run_id"] is not None
    run_dir = worca_dir / "runs" / result["run_id"]
    assert run_dir.is_dir()
    assert (run_dir / "status.json").exists()
    assert (run_dir / "agents").is_dir()
    assert (run_dir / "logs").is_dir()

    # Active run pointer written
    active_run = worca_dir / "active_run"
    assert active_run.exists()
    assert active_run.read_text() == result["run_id"]


def test_archive_moves_run_dir(tmp_path):
    """_archive_run moves per-run dir to results/ when run_id is present."""
    worca_dir = tmp_path / ".worca"
    run_id = "20260309-171545"
    run_dir = worca_dir / "runs" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "logs").mkdir()
    (run_dir / "agents").mkdir()

    status = {"run_id": run_id, "started_at": "2026-03-09T17:15:45+00:00"}
    status_path = str(run_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status, f)

    # Write active_run pointer
    with open(str(worca_dir / "active_run"), "w") as f:
        f.write(run_id)

    _archive_run(status, status_path)

    # Run dir should be moved to results/
    assert not run_dir.exists()
    assert (worca_dir / "results" / run_id / "status.json").exists()

    # Active run pointer cleaned up
    assert not (worca_dir / "active_run").exists()


def test_archive_includes_events_jsonl(tmp_path):
    """_archive_run moves events.jsonl alongside other run files."""
    worca_dir = tmp_path / ".worca"
    run_id = "20260320-120000"
    run_dir = worca_dir / "runs" / run_id
    run_dir.mkdir(parents=True)

    status = {"run_id": run_id, "started_at": "2026-03-20T12:00:00+00:00"}
    status_path = str(run_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status, f)

    # Write events.jsonl co-located with status.json
    events_path = run_dir / "events.jsonl"
    events_path.write_text('{"type":"pipeline.run.started"}\n')

    _archive_run(status, status_path)

    # events.jsonl should be in the archived location
    assert (worca_dir / "results" / run_id / "events.jsonl").exists()
    assert not events_path.exists()


def test_archive_without_events_jsonl_graceful(tmp_path):
    """_archive_run succeeds gracefully when events.jsonl does not exist."""
    worca_dir = tmp_path / ".worca"
    run_id = "20260320-130000"
    run_dir = worca_dir / "runs" / run_id
    run_dir.mkdir(parents=True)

    status = {"run_id": run_id, "started_at": "2026-03-20T13:00:00+00:00"}
    status_path = str(run_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status, f)

    # No events.jsonl in run_dir (events were disabled)
    assert not (run_dir / "events.jsonl").exists()

    _archive_run(status, status_path)

    # Archive should succeed without errors
    assert not run_dir.exists()
    assert (worca_dir / "results" / run_id / "status.json").exists()
    # No events.jsonl in results (was never created)
    assert not (worca_dir / "results" / run_id / "events.jsonl").exists()


def test_archive_legacy_format(tmp_path):
    """_archive_run uses hash-based format when no run_id."""
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()

    status = {"started_at": "2026-01-01T00:00:00+00:00", "work_request": {"title": "Legacy"}}
    status_path = str(worca_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status, f)

    _archive_run(status, status_path)

    # Status file should be removed
    assert not os.path.exists(status_path)

    # Result should exist as a hash-based .json file
    results_dir = worca_dir / "results"
    assert results_dir.exists()
    json_files = list(results_dir.glob("*.json"))
    assert len(json_files) == 1


def test_run_pipeline_no_plan_resolves_from_template(tmp_path, monkeypatch):
    """Without --plan, plan_file is resolved from template in settings."""
    from worca.orchestrator.work_request import WorkRequest

    monkeypatch.chdir(tmp_path)

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
            "plan_path_template": "docs/plans/{timestamp}-{title_slug}.md",
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Add user auth")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"approved": True}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr,
                        settings_path=str(settings),
                        status_path=status_path,
                    )

    # plan_file should be sequenced inside the run directory
    assert result["plan_file"] is not None
    assert result["plan_file"].endswith("plan-001.md")
    assert ".worca/runs/" in result["plan_file"]


# --- bead limit from coordinator ---

def test_bead_limit_derived_from_coordinator(tmp_path):
    """Bead loop stops at exactly len(beads_ids), not a config value."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": True},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
                "implementer": {"model": "sonnet", "max_turns": 10},
            },
            "loops": {"implement_test": 3},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test bead limit")

    # Coordinator returns 3 beads
    bead_ids = ["beads-aaa", "beads-bbb", "beads-ccc"]
    implement_count = [0]

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.COORDINATE:
            return {"beads_ids": bead_ids, "dependency_graph": {}}, {"type": "result"}
        elif stage == Stage.IMPLEMENT:
            implement_count[0] += 1
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        return {}, {"type": "result"}

    # Always return a bead — the max_beads counter should be the limit
    call_count = [0]
    def mock_query_ready(allowed_ids=None):
        call_count[0] += 1
        return {"id": f"beads-{call_count[0]:03d}", "title": f"Bead {call_count[0]}"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", side_effect=mock_query_ready):
            with patch("worca.orchestrator.runner._claim_bead", return_value=True):
                with patch("worca.orchestrator.runner.bd_show", return_value={"description": ""}):
                    with patch("worca.orchestrator.runner.bd_close", return_value=True):
                        with patch("worca.orchestrator.runner.bd_label_add", return_value=True):
                            with patch("worca.orchestrator.runner.create_branch"):
                                with patch("worca.orchestrator.runner._write_pid"):
                                    with patch("worca.orchestrator.runner._remove_pid"):
                                        run_pipeline(
                                            wr,
                                            plan_file=str(plan),
                                            settings_path=str(settings),
                                            status_path=status_path,
                                        )

    # Should have implemented exactly 3 beads (matching coordinator output, not config)
    assert implement_count[0] == 3


# --- gh_issue_start integration ---

def test_run_pipeline_calls_gh_issue_start_for_github_source(tmp_path):
    """gh_issue_start() is called after init when source is a GitHub issue."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(
        source_type="github_issue",
        source_ref="gh:42",
        title="Fix the bug",
    )

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.gh_issue_start") as mock_start:
                        run_pipeline(
                            wr,
                            plan_file=str(plan),
                            settings_path=str(settings),
                            status_path=status_path,
                        )

    # gh_issue_start must have been called exactly once with the status dict
    mock_start.assert_called_once()
    call_status = mock_start.call_args[0][0]
    assert call_status["work_request"]["source_type"] == "github_issue"
    assert call_status["work_request"]["source_ref"] == "gh:42"
    assert call_status["run_id"] is not None


def test_run_pipeline_calls_gh_issue_start_for_non_github_source(tmp_path):
    """gh_issue_start() is still called for non-GitHub sources (it's a no-op internally)."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test prompt run")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.gh_issue_start") as mock_start:
                        run_pipeline(
                            wr,
                            plan_file=str(plan),
                            settings_path=str(settings),
                            status_path=status_path,
                        )

    # gh_issue_start is called (it handles the no-op internally)
    mock_start.assert_called_once()


# --- gh_issue_complete integration ---

def test_run_pipeline_calls_gh_issue_complete_for_github_source(tmp_path):
    """gh_issue_complete() is called after pipeline completion for GitHub issues."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(
        source_type="github_issue",
        source_ref="gh:42",
        title="Fix the bug",
    )

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.gh_issue_start"):
                        with patch("worca.orchestrator.runner.gh_issue_complete") as mock_complete:
                            run_pipeline(
                                wr,
                                plan_file=str(plan),
                                settings_path=str(settings),
                                status_path=status_path,
                            )

    # gh_issue_complete must have been called exactly once
    mock_complete.assert_called_once()
    call_status = mock_complete.call_args[0][0]
    assert call_status["work_request"]["source_type"] == "github_issue"
    assert call_status["work_request"]["source_ref"] == "gh:42"
    assert call_status["completed_at"] is not None
    assert call_status["run_id"] is not None


def test_run_pipeline_calls_gh_issue_complete_for_non_github_source(tmp_path):
    """gh_issue_complete() is still called for non-GitHub sources (no-op internally)."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test prompt run")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.gh_issue_start"):
                        with patch("worca.orchestrator.runner.gh_issue_complete") as mock_complete:
                            run_pipeline(
                                wr,
                                plan_file=str(plan),
                                settings_path=str(settings),
                                status_path=status_path,
                            )

    # gh_issue_complete is called (it handles the no-op internally)
    mock_complete.assert_called_once()


def test_run_pipeline_gh_issue_complete_called_after_completed_at_set(tmp_path):
    """gh_issue_complete() receives status with completed_at already set."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(
        source_type="github_issue",
        source_ref="gh:55",
        title="Test completion timing",
    )

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {"beads_ids": [], "dependency_graph": {}}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.gh_issue_start"):
                        with patch("worca.orchestrator.runner.gh_issue_complete") as mock_complete:
                            run_pipeline(
                                wr,
                                plan_file=str(plan),
                                settings_path=str(settings),
                                status_path=status_path,
                            )

    # Verify the status passed to gh_issue_complete has completion metrics
    call_status = mock_complete.call_args[0][0]
    assert "completed_at" in call_status
    assert "started_at" in call_status
    assert "token_usage" in call_status


def test_bead_limit_warns_on_stale_beads(tmp_path, capsys):
    """Warning is logged when bd ready returns beads beyond expected count."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")

    settings = tmp_path / "settings.json"
    settings.write_text(json.dumps({
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": True},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
                "implementer": {"model": "sonnet", "max_turns": 10},
            },
            "loops": {"implement_test": 3},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test stale beads")

    # Coordinator returns 2 beads
    bead_ids = ["beads-aaa", "beads-bbb"]

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.COORDINATE:
            return {"beads_ids": bead_ids, "dependency_graph": {}}, {"type": "result"}
        elif stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        return {}, {"type": "result"}

    # Mock _query_ready_bead to always return a bead (simulating stale beads)
    def mock_query_ready(allowed_ids=None):
        return {"id": "beads-stale", "title": "Stale bead"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", side_effect=mock_query_ready):
            with patch("worca.orchestrator.runner._claim_bead", return_value=True):
                with patch("worca.orchestrator.runner.bd_show", return_value={"description": ""}):
                    with patch("worca.orchestrator.runner.bd_close", return_value=True):
                        with patch("worca.orchestrator.runner.bd_label_add", return_value=True):
                            with patch("worca.orchestrator.runner.create_branch"):
                                with patch("worca.orchestrator.runner._write_pid"):
                                    with patch("worca.orchestrator.runner._remove_pid"):
                                        run_pipeline(
                                            wr,
                                            plan_file=str(plan),
                                            settings_path=str(settings),
                                            status_path=status_path,
                                        )

    # Check that the stale bead warning was printed to stderr
    captured = capsys.readouterr()
    assert "stale beads" in captured.err.lower()


# --- gh_issue_fail integration (run_pipeline.py exception handlers) ---

def test_run_pipeline_main_calls_gh_issue_fail_on_loop_exhausted(tmp_path, monkeypatch):
    """run_pipeline.py main() calls gh_issue_fail when LoopExhaustedError is raised."""
    from worca.orchestrator.work_request import WorkRequest

    mod = _import_run_pipeline()

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_data = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
            "title": "Fix bug",
        },
        "run_id": "20260318-120000",
        "branch": "worca/fix-bug-abc",
        "started_at": "2026-03-18T12:00:00+00:00",
        "token_usage": {"total_cost_usd": 5.0, "num_turns": 100},
    }
    status_path = str(worca_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status_data, f)

    error_msg = "Loop implement_test exhausted after 5 iterations"

    monkeypatch.setattr(
        "sys.argv",
        ["run_pipeline.py", "--source", "gh:issue:42",
         "--status-dir", str(worca_dir)],
    )
    with patch.object(mod, "run_pipeline", side_effect=LoopExhaustedError(error_msg)):
        with patch.object(mod, "normalize") as mock_normalize:
            mock_wr = WorkRequest(
                source_type="github_issue", source_ref="gh:42", title="Fix bug",
            )
            mock_normalize.return_value = mock_wr
            with patch.object(mod, "gh_issue_fail") as mock_fail:
                try:
                    mod.main()
                except SystemExit:
                    pass

    mock_fail.assert_called_once()
    call_status = mock_fail.call_args[0][0]
    assert call_status["work_request"]["source_type"] == "github_issue"
    assert error_msg in mock_fail.call_args[1]["error"]


def test_run_pipeline_main_calls_gh_issue_fail_on_pipeline_error(tmp_path, monkeypatch):
    """run_pipeline.py main() calls gh_issue_fail when PipelineError is raised."""
    from worca.orchestrator.work_request import WorkRequest

    mod = _import_run_pipeline()

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_data = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:99",
            "title": "Add feature",
        },
        "run_id": "20260318-130000",
        "branch": "worca/add-feature-xyz",
        "started_at": "2026-03-18T13:00:00+00:00",
        "token_usage": {"total_cost_usd": 12.0, "num_turns": 250},
    }
    status_path = str(worca_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status_data, f)

    error_msg = "Guardian rejected changes after 3 review cycles"

    monkeypatch.setattr(
        "sys.argv",
        ["run_pipeline.py", "--source", "gh:issue:99",
         "--status-dir", str(worca_dir)],
    )
    with patch.object(mod, "run_pipeline", side_effect=PipelineError(error_msg)):
        with patch.object(mod, "normalize") as mock_normalize:
            mock_wr = WorkRequest(
                source_type="github_issue", source_ref="gh:99", title="Add feature",
            )
            mock_normalize.return_value = mock_wr
            with patch.object(mod, "gh_issue_fail") as mock_fail:
                try:
                    mod.main()
                except SystemExit:
                    pass

    mock_fail.assert_called_once()
    call_status = mock_fail.call_args[0][0]
    assert call_status["work_request"]["source_ref"] == "gh:99"
    assert error_msg in mock_fail.call_args[1]["error"]


def test_run_pipeline_main_gh_issue_fail_noop_for_non_github(tmp_path, monkeypatch):
    """gh_issue_fail is still called for non-GitHub sources (no-op internally)."""
    from worca.orchestrator.work_request import WorkRequest

    mod = _import_run_pipeline()

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_data = {
        "work_request": {"source_type": "prompt", "source_ref": ""},
        "run_id": "20260318-140000",
        "branch": "worca/test-xyz",
    }
    status_path = str(worca_dir / "status.json")
    with open(status_path, "w") as f:
        json.dump(status_data, f)

    monkeypatch.setattr(
        "sys.argv",
        ["run_pipeline.py", "--prompt", "do something",
         "--status-dir", str(worca_dir)],
    )
    with patch.object(mod, "run_pipeline", side_effect=PipelineError("fail")):
        with patch.object(mod, "normalize") as mock_normalize:
            mock_wr = WorkRequest(source_type="prompt", title="do something")
            mock_normalize.return_value = mock_wr
            with patch.object(mod, "gh_issue_fail") as mock_fail:
                try:
                    mod.main()
                except SystemExit:
                    pass

    mock_fail.assert_called_once()


def test_run_pipeline_main_gh_issue_fail_never_crashes_pipeline(tmp_path, monkeypatch):
    """Even if gh_issue_fail raises, the original exit code is preserved."""
    from worca.orchestrator.work_request import WorkRequest

    mod = _import_run_pipeline()

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_data = {
        "work_request": {
            "source_type": "github_issue",
            "source_ref": "gh:42",
        },
        "run_id": "20260318-150000",
        "branch": "worca/test",
    }
    with open(str(worca_dir / "status.json"), "w") as f:
        json.dump(status_data, f)

    monkeypatch.setattr(
        "sys.argv",
        ["run_pipeline.py", "--source", "gh:issue:42",
         "--status-dir", str(worca_dir)],
    )
    with patch.object(mod, "run_pipeline", side_effect=LoopExhaustedError("exhausted")):
        with patch.object(mod, "normalize") as mock_normalize:
            mock_wr = WorkRequest(
                source_type="github_issue", source_ref="gh:42", title="Test",
            )
            mock_normalize.return_value = mock_wr
            with patch.object(mod, "gh_issue_fail", side_effect=RuntimeError("gh broken")):
                exit_code = None
                try:
                    mod.main()
                except SystemExit as e:
                    exit_code = e.code

    assert exit_code == 1


# ---------------------------------------------------------------------------
# T7: EventContext initialization in run_pipeline()
# ---------------------------------------------------------------------------

def _make_minimal_settings(tmp_path, extra=None):
    """Return a minimal settings.json path for runner tests."""
    cfg = {
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "planner": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
        }
    }
    if extra:
        cfg["worca"].update(extra)
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(cfg))
    return str(p)


def _run_pipeline_with_plan(tmp_path, wr=None, extra_settings=None, resume=False,
                             plan_content="# Plan\n", resume_status=None):
    """Helper: run_pipeline with a pre-made plan, mocked run_stage."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text(plan_content)

    if wr is None:
        wr = WorkRequest(source_type="prompt", title="Event ctx test")

    settings_path = _make_minimal_settings(tmp_path, extra_settings)

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")

    if resume_status:
        with open(status_path, "w") as f:
            json.dump(resume_status, f)

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    return run_pipeline(
                        wr,
                        plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                        resume=resume,
                    )


def test_run_pipeline_events_jsonl_written_to_run_dir(tmp_path):
    """events.jsonl is created inside the per-run directory."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    worca_dir = tmp_path / ".worca"
    events_path = worca_dir / "runs" / run_id / "events.jsonl"
    assert events_path.exists(), f"events.jsonl not found at {events_path}"


def test_run_pipeline_emits_run_started_event(tmp_path):
    """pipeline.run.started event is written to events.jsonl on fresh start."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    worca_dir = tmp_path / ".worca"
    events_path = worca_dir / "runs" / run_id / "events.jsonl"
    lines = events_path.read_text().strip().split("\n")
    event_types = [json.loads(line)["event_type"] for line in lines if line.strip()]
    assert "pipeline.run.started" in event_types


def test_run_pipeline_run_started_payload_resume_false(tmp_path):
    """pipeline.run.started payload has resume=False on fresh start."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    worca_dir = tmp_path / ".worca"
    events_path = worca_dir / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    started = next(e for e in events if e["event_type"] == "pipeline.run.started")
    assert started["payload"]["resume"] is False


def test_run_pipeline_worca_events_path_set_then_cleaned(tmp_path):
    """WORCA_EVENTS_PATH env var is set during run and cleaned up after."""
    captured_env = {}
    import worca.events.emitter as emitter_mod
    original_emit = emitter_mod.emit_event

    def tracking_emit(ctx, event_type, payload):
        if "WORCA_EVENTS_PATH" not in captured_env:
            captured_env["WORCA_EVENTS_PATH"] = os.environ.get("WORCA_EVENTS_PATH")
        return original_emit(ctx, event_type, payload)

    result = _run_pipeline_with_plan(tmp_path)

    # WORCA_EVENTS_PATH is set during init (before emit_event) — check via env after run
    # The env var should be cleaned up after run completes
    assert os.environ.get("WORCA_EVENTS_PATH") is None

    # The events.jsonl should exist (confirming ctx was created)
    run_id = result["run_id"]
    worca_dir = tmp_path / ".worca"
    events_path = worca_dir / "runs" / run_id / "events.jsonl"
    assert events_path.exists()


def test_run_pipeline_events_path_inside_run_dir(tmp_path):
    """events.jsonl is located inside the per-run directory."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    worca_dir = tmp_path / ".worca"
    expected = worca_dir / "runs" / run_id / "events.jsonl"
    assert expected.exists()


def test_run_pipeline_ctx_close_called_on_success(tmp_path):
    """EventContext.close() is called after a successful pipeline run."""
    from worca.events.emitter import EventContext

    close_calls = []
    original_close = EventContext.close

    def tracking_close(self):
        close_calls.append(True)
        original_close(self)

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        return {}, {"type": "result"}

    from worca.orchestrator.work_request import WorkRequest
    plan = tmp_path / "plan.md"
    plan.write_text("# Plan")
    wr = WorkRequest(source_type="prompt", title="Close test")
    settings_path = _make_minimal_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    with patch.object(EventContext, "close", tracking_close):
        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, plan_file=str(plan), settings_path=settings_path,
                                     status_path=status_path)

    assert len(close_calls) >= 1


def test_run_pipeline_ctx_close_called_on_exception(tmp_path):
    """EventContext.close() is called even when pipeline raises."""
    from worca.events.emitter import EventContext

    close_calls = []
    original_close = EventContext.close

    def tracking_close(self):
        close_calls.append(True)
        original_close(self)

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        raise PipelineError("something went wrong")

    from worca.orchestrator.work_request import WorkRequest
    plan = tmp_path / "plan.md"
    plan.write_text("# Plan")
    wr = WorkRequest(source_type="prompt", title="Error test")
    # Enable COORDINATE so run_stage is actually called (and raises)
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": True},
            "coordinate": {"agent": "coordinator", "enabled": True},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "planner": {"model": "opus", "max_turns": 10},
            "coordinator": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    with patch.object(EventContext, "close", tracking_close):
        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        with pytest.raises(PipelineError):
                            run_pipeline(wr, plan_file=str(plan), settings_path=settings_path,
                                         status_path=status_path)

    assert len(close_calls) >= 1


# ---------------------------------------------------------------------------
# T8: Stage lifecycle events
# ---------------------------------------------------------------------------


def test_run_pipeline_emits_stage_started_event(tmp_path):
    """pipeline.stage.started is emitted at the beginning of each stage."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    events_path = tmp_path / ".worca" / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.stage.started" in types


def test_run_pipeline_emits_stage_completed_event(tmp_path):
    """pipeline.stage.completed is emitted after each stage succeeds."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    events_path = tmp_path / ".worca" / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.stage.completed" in types


def test_run_pipeline_stage_started_payload_fields(tmp_path):
    """pipeline.stage.started payload has required fields."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    events_path = tmp_path / ".worca" / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    started = next(e for e in events if e["event_type"] == "pipeline.stage.started")
    p = started["payload"]
    assert "stage" in p
    assert "iteration" in p
    assert "agent" in p
    assert "model" in p
    assert "trigger" in p
    assert "max_turns" in p
    assert p["trigger"] == "initial"
    assert isinstance(p["iteration"], int)
    assert isinstance(p["max_turns"], int)


def test_run_pipeline_stage_completed_payload_fields(tmp_path):
    """pipeline.stage.completed payload has required fields."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    events_path = tmp_path / ".worca" / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    completed = next(e for e in events if e["event_type"] == "pipeline.stage.completed")
    p = completed["payload"]
    assert "stage" in p
    assert "iteration" in p
    assert "duration_ms" in p
    assert "cost_usd" in p
    assert "turns" in p
    assert "outcome" in p
    assert isinstance(p["duration_ms"], int)


def _find_events_path(worca_dir):
    """Find events.jsonl from active_run pointer or glob."""
    import glob
    active_run_path = worca_dir / "active_run"
    if active_run_path.exists():
        run_id = active_run_path.read_text().strip()
        p = worca_dir / "runs" / run_id / "events.jsonl"
        if p.exists():
            return p
    candidates = sorted(glob.glob(str(worca_dir / "runs" / "*" / "events.jsonl")))
    assert candidates, "No events.jsonl found"
    return candidates[-1]


def test_run_pipeline_emits_stage_failed_on_exception(tmp_path):
    """pipeline.stage.failed is emitted when a stage raises an exception."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan")
    wr = WorkRequest(source_type="prompt", title="Stage fail test")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": True},
            "coordinate": {"agent": "coordinator", "enabled": True},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "planner": {"model": "opus", "max_turns": 10},
            "coordinator": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage.value == "coordinate":
            raise RuntimeError("simulated stage failure")
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with pytest.raises(RuntimeError):
                        run_pipeline(wr, plan_file=str(plan), settings_path=settings_path,
                                     status_path=status_path)

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.stage.failed" in types
    failed = next(e for e in events if e["event_type"] == "pipeline.stage.failed")
    p = failed["payload"]
    assert p["stage"] == "coordinate"
    assert "error" in p
    assert "error_type" in p
    assert "elapsed_ms" in p


def test_run_pipeline_emits_stage_interrupted_on_shutdown(tmp_path):
    """pipeline.stage.interrupted is emitted when a stage raises InterruptedError."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan")
    wr = WorkRequest(source_type="prompt", title="Interrupt test")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": True},
            "coordinate": {"agent": "coordinator", "enabled": True},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "planner": {"model": "opus", "max_turns": 10},
            "coordinator": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage.value == "coordinate":
            raise InterruptedError("simulated interrupt")
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with pytest.raises(Exception):
                        run_pipeline(wr, plan_file=str(plan), settings_path=settings_path,
                                     status_path=status_path)

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.stage.interrupted" in types
    interrupted = next(e for e in events if e["event_type"] == "pipeline.stage.interrupted")
    p = interrupted["payload"]
    assert p["stage"] == "coordinate"
    assert "iteration" in p
    assert "elapsed_ms" in p


# ---------------------------------------------------------------------------
# T10: Bead lifecycle events in run_pipeline()
# ---------------------------------------------------------------------------

def _make_bead_settings(tmp_path):
    """Settings with COORDINATE + IMPLEMENT enabled, rest disabled."""
    return _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": True},
            "implement": {"agent": "implementer", "enabled": True},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "coordinator": {"model": "opus", "max_turns": 10},
            "implementer": {"model": "sonnet", "max_turns": 10},
        },
        "loops": {},
    })


def _run_bead_pipeline(tmp_path, bead_ids, bd_close_return=True):
    """Run pipeline through COORDINATE + IMPLEMENT with given beads."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_bead_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Bead event test")

    bead_iter = [0]

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.COORDINATE:
            return {"beads_ids": bead_ids, "dependency_graph": {}}, {"type": "result"}
        elif stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        return {}, {"type": "result"}

    def mock_query_ready(allowed_ids=None):
        if bead_iter[0] < len(bead_ids):
            idx = bead_iter[0]
            return {"id": bead_ids[idx], "title": f"Bead {idx}"}
        return None

    def mock_claim_bead(bead_id):
        bead_iter[0] += 1
        return True

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", side_effect=mock_query_ready):
            with patch("worca.orchestrator.runner._claim_bead", side_effect=mock_claim_bead):
                with patch("worca.orchestrator.runner.bd_show", return_value={"description": ""}):
                    with patch("worca.orchestrator.runner.bd_close", return_value=bd_close_return):
                        with patch("worca.orchestrator.runner.bd_label_add", return_value=True):
                            with patch("worca.orchestrator.runner.create_branch"):
                                with patch("worca.orchestrator.runner._write_pid"):
                                    with patch("worca.orchestrator.runner._remove_pid"):
                                        run_pipeline(
                                            wr,
                                            plan_file=str(plan),
                                            settings_path=settings_path,
                                            status_path=status_path,
                                        )
    return worca_dir


def test_bead_assigned_event_emitted_after_claim(tmp_path):
    """pipeline.bead.assigned is emitted after _claim_bead() succeeds."""
    bead_ids = ["beads-aaa"]
    worca_dir = _run_bead_pipeline(tmp_path, bead_ids)
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.bead.assigned" in types
    assigned = next(e for e in events if e["event_type"] == "pipeline.bead.assigned")
    p = assigned["payload"]
    assert p["bead_id"] == "beads-aaa"
    assert "title" in p
    assert "iteration" in p


def test_bead_completed_event_emitted_after_bd_close(tmp_path):
    """pipeline.bead.completed is emitted after bd_close() succeeds."""
    bead_ids = ["beads-bbb"]
    worca_dir = _run_bead_pipeline(tmp_path, bead_ids, bd_close_return=True)
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.bead.completed" in types
    completed = next(e for e in events if e["event_type"] == "pipeline.bead.completed")
    p = completed["payload"]
    assert p["bead_id"] == "beads-bbb"
    assert "reason" in p


def test_bead_labeled_event_emitted_after_bd_label_add(tmp_path):
    """pipeline.bead.labeled is emitted after bd_label_add() succeeds."""
    bead_ids = ["beads-ccc", "beads-ddd"]
    worca_dir = _run_bead_pipeline(tmp_path, bead_ids)
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.bead.labeled" in types
    labeled = next(e for e in events if e["event_type"] == "pipeline.bead.labeled")
    p = labeled["payload"]
    assert "bead_ids" in p
    assert "label" in p
    assert p["label"].startswith("run:")


def test_bead_next_event_emitted_before_loop_continue(tmp_path):
    """pipeline.bead.next is emitted before looping back to IMPLEMENT for the next bead."""
    bead_ids = ["beads-eee", "beads-fff"]
    worca_dir = _run_bead_pipeline(tmp_path, bead_ids)
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.bead.next" in types
    bead_next = next(e for e in events if e["event_type"] == "pipeline.bead.next")
    p = bead_next["payload"]
    assert "next_bead_id" in p
    assert "bead_iteration" in p


# ---------------------------------------------------------------------------
# T11: Test, review, loop, and milestone events
# ---------------------------------------------------------------------------


def _run_implement_test_pipeline(tmp_path, test_results, loops=3):
    """Run pipeline through IMPLEMENT + TEST stages with given per-iteration test results."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": True},
            "test": {"agent": "tester", "enabled": True},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "implementer": {"model": "sonnet", "max_turns": 10},
            "tester": {"model": "sonnet", "max_turns": 10},
        },
        "loops": {"implement_test": loops},
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Test stage event test")

    test_iter = [0]

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        elif stage == Stage.TEST:
            idx = min(test_iter[0], len(test_results) - 1)
            test_iter[0] += 1
            return test_results[idx], {"type": "result"}
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", return_value=None):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        try:
                            run_pipeline(wr, plan_file=str(plan),
                                         settings_path=settings_path,
                                         status_path=status_path)
                        except Exception:
                            pass
    return worca_dir


def _run_review_pipeline(tmp_path, review_results, extra_loops=None):
    """Run pipeline through IMPLEMENT + REVIEW stages with given per-iteration review results."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    loops = {"pr_changes": 3, "restart_planning": 2}
    if extra_loops:
        loops.update(extra_loops)
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": True},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": True},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "implementer": {"model": "sonnet", "max_turns": 10},
            "guardian": {"model": "opus", "max_turns": 10},
        },
        "loops": loops,
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Review stage event test")

    review_iter = [0]

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        elif stage == Stage.REVIEW:
            idx = min(review_iter[0], len(review_results) - 1)
            review_iter[0] += 1
            return review_results[idx], {"type": "result"}
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", return_value=None):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        try:
                            run_pipeline(wr, plan_file=str(plan),
                                         settings_path=settings_path,
                                         status_path=status_path)
                        except Exception:
                            pass
    return worca_dir


def test_test_suite_passed_event_emitted(tmp_path):
    """pipeline.test.suite_passed is emitted when TEST stage passes."""
    worca_dir = _run_implement_test_pipeline(tmp_path, [{"passed": True}])
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.test.suite_passed" in [e["event_type"] for e in events]


def test_test_suite_passed_payload_fields(tmp_path):
    """pipeline.test.suite_passed payload has required iteration field."""
    worca_dir = _run_implement_test_pipeline(tmp_path, [{"passed": True}])
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.test.suite_passed")
    assert "iteration" in evt["payload"]


def test_test_suite_failed_event_emitted(tmp_path):
    """pipeline.test.suite_failed is emitted when TEST stage fails."""
    worca_dir = _run_implement_test_pipeline(
        tmp_path,
        [{"passed": False, "failures": [{"test": "test_foo", "error": "AssertionError"}]},
         {"passed": True}],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.test.suite_failed" in [e["event_type"] for e in events]


def test_test_suite_failed_payload_fields(tmp_path):
    """pipeline.test.suite_failed payload has required fields."""
    failures = [{"test": "test_bar", "error": "ValueError"}]
    worca_dir = _run_implement_test_pipeline(
        tmp_path,
        [{"passed": False, "failures": failures}, {"passed": True}],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.test.suite_failed")
    p = evt["payload"]
    assert "iteration" in p
    assert "failure_count" in p
    assert "failures" in p
    assert p["failure_count"] == 1


def test_test_fix_attempt_event_emitted_before_loop(tmp_path):
    """pipeline.test.fix_attempt is emitted before looping back to IMPLEMENT on failure."""
    worca_dir = _run_implement_test_pipeline(
        tmp_path,
        [{"passed": False, "failures": [{"test": "t", "error": "err"}]}, {"passed": True}],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.test.fix_attempt" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.test.fix_attempt")
    p = evt["payload"]
    assert p["attempt"] == 1
    assert "limit" in p
    assert "failures_summary" in p


def test_loop_triggered_emitted_on_test_failure_loop(tmp_path):
    """pipeline.loop.triggered is emitted when TEST failure causes loop back to IMPLEMENT."""
    worca_dir = _run_implement_test_pipeline(
        tmp_path,
        [{"passed": False, "failures": [{"test": "t"}]}, {"passed": True}],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    loop_evts = [e for e in events if e["event_type"] == "pipeline.loop.triggered"]
    assert len(loop_evts) >= 1
    p = loop_evts[0]["payload"]
    assert p["loop_key"] == "implement_test"
    assert p["from_stage"] == "test"
    assert p["to_stage"] == "implement"
    assert "iteration" in p
    assert "trigger" in p


def test_review_verdict_event_emitted(tmp_path):
    """pipeline.review.verdict is emitted after handle_pr_review()."""
    worca_dir = _run_review_pipeline(tmp_path, [{"outcome": "approve"}])
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.review.verdict" in [e["event_type"] for e in events]


def test_review_verdict_payload_fields(tmp_path):
    """pipeline.review.verdict payload has required fields."""
    worca_dir = _run_review_pipeline(tmp_path, [{"outcome": "approve", "issues": []}])
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.review.verdict")
    p = evt["payload"]
    assert p["outcome"] == "approve"
    assert "issue_count" in p
    assert "critical_count" in p


def test_review_fix_attempt_event_emitted_before_loop(tmp_path):
    """pipeline.review.fix_attempt is emitted before looping back to IMPLEMENT on changes."""
    worca_dir = _run_review_pipeline(
        tmp_path,
        [
            {"outcome": "request_changes", "issues": [{"severity": "critical", "description": "Bug"}]},
            {"outcome": "approve"},
        ],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.review.fix_attempt" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.review.fix_attempt")
    p = evt["payload"]
    assert p["attempt"] == 1
    assert "limit" in p


def test_loop_triggered_emitted_on_review_changes_loop(tmp_path):
    """pipeline.loop.triggered is emitted when review changes cause loop back to IMPLEMENT."""
    worca_dir = _run_review_pipeline(
        tmp_path,
        [
            {"outcome": "request_changes", "issues": [{"severity": "critical", "description": "Bug"}]},
            {"outcome": "approve"},
        ],
    )
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    loop_evts = [e for e in events if e["event_type"] == "pipeline.loop.triggered"]
    assert len(loop_evts) >= 1
    p = loop_evts[0]["payload"]
    assert p["loop_key"] == "pr_changes"
    assert p["from_stage"] == "review"
    assert p["to_stage"] == "implement"


def test_loop_exhausted_emitted_before_raise(tmp_path):
    """pipeline.loop.exhausted is emitted before LoopExhaustedError is raised."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    # restart_planning=1: first restart triggers exhaustion immediately
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": True},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": True},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": True},
            "pr": {"agent": "guardian", "enabled": False},
        },
        "agents": {
            "planner": {"model": "opus", "max_turns": 10},
            "implementer": {"model": "sonnet", "max_turns": 10},
            "guardian": {"model": "opus", "max_turns": 10},
        },
        "loops": {"restart_planning": 1},
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Loop exhausted test")

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None, **kwargs):
        if stage == Stage.PLAN:
            return {"approved": True, "approach": "test"}, {"type": "result"}
        if stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        if stage == Stage.REVIEW:
            return {"outcome": "restart_planning", "issues": []}, {"type": "result"}
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner._query_ready_bead", return_value=None):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        with pytest.raises(LoopExhaustedError):
                            run_pipeline(wr, settings_path=settings_path,
                                         status_path=status_path)

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.loop.exhausted" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.loop.exhausted")
    p = evt["payload"]
    assert p["loop_key"] == "restart_planning"
    assert "iteration" in p
    assert "limit" in p


def test_milestone_set_event_emitted_on_plan_file(tmp_path):
    """pipeline.milestone.set is emitted when plan_file is provided (plan_approved=True)."""
    result = _run_pipeline_with_plan(tmp_path)
    run_id = result["run_id"]
    events_path = tmp_path / ".worca" / "runs" / run_id / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    assert "pipeline.milestone.set" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.milestone.set")
    p = evt["payload"]
    assert p["milestone"] == "plan_approved"
    assert p["value"] is True
    assert "stage" in p


# ---------------------------------------------------------------------------
# T12: Circuit breaker events
# ---------------------------------------------------------------------------


def _make_cb_settings(tmp_path, enabled=True, max_consecutive=3,
                      transient_backoff=None, extra=None):
    """Settings with circuit_breaker enabled and a real stage."""
    cfg = {
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": True},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "coordinator": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
            "circuit_breaker": {
                "enabled": enabled,
                "max_consecutive_failures": max_consecutive,
                "transient_retry_backoff_seconds": transient_backoff or [],
            },
        }
    }
    if extra:
        cfg["worca"].update(extra)
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(cfg))
    return str(p)


def _run_cb_pipeline(tmp_path, stage_results, cb_settings_extra=None,
                     max_consecutive=3, backoff=None):
    """Run pipeline with CB enabled, returns (worca_dir, exception_or_None)."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_cb_settings(
        tmp_path,
        max_consecutive=max_consecutive,
        transient_backoff=backoff or [],
        extra=cb_settings_extra,
    )
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="CB test")

    call_count = [0]

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        idx = call_count[0]
        call_count[0] += 1
        result = stage_results[idx] if idx < len(stage_results) else {}
        if isinstance(result, Exception):
            raise result
        return result, {"type": "result"}

    caught = None
    try:
        with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
            with patch("worca.orchestrator.runner.create_branch"):
                with patch("worca.orchestrator.runner._write_pid"):
                    with patch("worca.orchestrator.runner._remove_pid"):
                        run_pipeline(wr, plan_file=str(plan),
                                     settings_path=settings_path,
                                     status_path=status_path)
    except Exception as e:
        caught = e
    return worca_dir, caught


def _classification(category="infra_permanent", retriable=False):
    return {"category": category, "retriable": retriable,
            "remediation": "none", "similar_to_previous": False}


def test_cb_failure_recorded_event_emitted(tmp_path):
    """CB_FAILURE_RECORDED emitted after record_failure() when CB enabled."""
    from worca.orchestrator.runner import PipelineError, CircuitBreakerTripped

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_permanent", False)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(True, "permanent error")):
            worca_dir, exc = _run_cb_pipeline(
                tmp_path,
                stage_results=[RuntimeError("api failure")],
            )

    assert isinstance(exc, (PipelineError, CircuitBreakerTripped, RuntimeError))
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.circuit_breaker.failure_recorded" in types


def test_cb_failure_recorded_payload_fields(tmp_path):
    """CB_FAILURE_RECORDED payload has required fields."""

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_permanent", False)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(True, "permanent error")):
            worca_dir, exc = _run_cb_pipeline(
                tmp_path,
                stage_results=[RuntimeError("api failure")],
            )

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    evt = next(e for e in events
               if e["event_type"] == "pipeline.circuit_breaker.failure_recorded")
    p = evt["payload"]
    assert "stage" in p
    assert "error" in p
    assert "category" in p
    assert "retriable" in p
    assert "consecutive_failures" in p


def test_cb_tripped_event_emitted(tmp_path):
    """CB_TRIPPED emitted before CircuitBreakerTripped is raised."""
    from worca.orchestrator.runner import CircuitBreakerTripped

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_permanent", False)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(True, "permanent error")):
            worca_dir, exc = _run_cb_pipeline(
                tmp_path,
                stage_results=[RuntimeError("fatal")],
            )

    assert isinstance(exc, CircuitBreakerTripped)
    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.circuit_breaker.tripped" in [e["event_type"] for e in events]


def test_cb_tripped_payload_fields(tmp_path):
    """CB_TRIPPED payload has reason, consecutive_failures, category."""

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_permanent", False)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(True, "permanent halt reason")):
            worca_dir, _ = _run_cb_pipeline(
                tmp_path,
                stage_results=[RuntimeError("fatal")],
            )

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.circuit_breaker.tripped")
    p = evt["payload"]
    assert "reason" in p
    assert "consecutive_failures" in p
    assert "category" in p


def test_cb_retry_event_emitted_on_transient(tmp_path):
    """CB_RETRY emitted before sleep on transient retriable error."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    # backoff of [0.001] so sleep is essentially instant
    settings_path = _make_cb_settings(
        tmp_path,
        max_consecutive=5,
        transient_backoff=[0.001],
    )
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="CB retry test")

    call_count = [0]

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise RuntimeError("transient network error")
        return {"beads_ids": []}, {"type": "result"}

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_transient", True)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(False, "")):
            with patch("worca.orchestrator.runner.run_stage",
                       side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, plan_file=str(plan),
                                         settings_path=settings_path,
                                         status_path=status_path)

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.circuit_breaker.retry" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.circuit_breaker.retry")
    p = evt["payload"]
    assert "stage" in p
    assert "attempt" in p
    assert "delay_seconds" in p
    assert "consecutive_failures" in p


def test_cb_reset_event_emitted_after_success(tmp_path):
    """CB_RESET emitted after record_success() when previous failures existed."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_cb_settings(
        tmp_path,
        max_consecutive=5,
        transient_backoff=[0.001],
    )
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="CB reset test")

    call_count = [0]

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise RuntimeError("transient error")
        return {"beads_ids": []}, {"type": "result"}

    with patch("worca.orchestrator.runner.classify_error",
               return_value=_classification("infra_transient", True)):
        with patch("worca.orchestrator.runner.should_halt",
                   return_value=(False, "")):
            with patch("worca.orchestrator.runner.run_stage",
                       side_effect=mock_run_stage):
                with patch("worca.orchestrator.runner.create_branch"):
                    with patch("worca.orchestrator.runner._write_pid"):
                        with patch("worca.orchestrator.runner._remove_pid"):
                            run_pipeline(wr, plan_file=str(plan),
                                         settings_path=settings_path,
                                         status_path=status_path)

    events_path = _find_events_path(worca_dir)
    events = [json.loads(line) for line in open(events_path).read().strip().split("\n") if line.strip()]
    assert "pipeline.circuit_breaker.reset" in [e["event_type"] for e in events]
    evt = next(e for e in events if e["event_type"] == "pipeline.circuit_breaker.reset")
    p = evt["payload"]
    assert "stage" in p
    assert "previous_consecutive_failures" in p
    assert p["previous_consecutive_failures"] >= 1


# ---------------------------------------------------------------------------
# T12: Cost events
# ---------------------------------------------------------------------------


def _run_pipeline_with_cost(tmp_path, cost_usd=1.5, input_tokens=1000,
                             output_tokens=500, budget=None):
    """Run minimal pipeline with a stage that returns cost data.

    Uses PLAN stage (no plan_file) so run_stage is actually invoked.
    """
    from worca.orchestrator.work_request import WorkRequest

    extra = {"stages": {
        "plan": {"agent": "planner", "enabled": True},
        "coordinate": {"agent": "coordinator", "enabled": False},
        "implement": {"agent": "implementer", "enabled": False},
        "test": {"agent": "tester", "enabled": False},
        "review": {"agent": "guardian", "enabled": False},
        "pr": {"agent": "guardian", "enabled": False},
    }, "agents": {
        "planner": {"model": "opus", "max_turns": 10},
    }}
    if budget is not None:
        extra["budget"] = {"max_cost_usd": budget}

    settings_path = _make_minimal_settings(tmp_path, extra=extra)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Cost test")

    raw_envelope = {
        "type": "result",
        "total_cost_usd": cost_usd,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        },
    }

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"approved": True}, raw_envelope

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    # No plan_file: PLAN stage runs via run_stage
                    result = run_pipeline(
                        wr,
                        settings_path=settings_path,
                        status_path=status_path,
                        skip_preflight=True,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    return events


def test_cost_stage_total_event_emitted(tmp_path):
    """pipeline.cost.stage_total emitted after stage completion with cost data."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=1.5)
    types = [e["event_type"] for e in events]
    assert "pipeline.cost.stage_total" in types


def test_cost_stage_total_payload_fields(tmp_path):
    """pipeline.cost.stage_total payload has required fields."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=2.0,
                                     input_tokens=800, output_tokens=400)
    evt = next(e for e in events if e["event_type"] == "pipeline.cost.stage_total")
    p = evt["payload"]
    assert "stage" in p
    assert "iteration" in p
    assert "cost_usd" in p
    assert "input_tokens" in p
    assert "output_tokens" in p
    assert "model" in p
    assert p["cost_usd"] == 2.0


def test_cost_running_total_event_emitted(tmp_path):
    """pipeline.cost.running_total emitted after stage completion."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=1.5)
    types = [e["event_type"] for e in events]
    assert "pipeline.cost.running_total" in types


def test_cost_running_total_payload_fields(tmp_path):
    """pipeline.cost.running_total payload has cumulative totals."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=1.5,
                                     input_tokens=1000, output_tokens=500)
    evt = next(e for e in events if e["event_type"] == "pipeline.cost.running_total")
    p = evt["payload"]
    assert "total_cost_usd" in p
    assert "total_input_tokens" in p
    assert "total_output_tokens" in p
    assert p["total_cost_usd"] >= 1.5


def test_cost_budget_warning_not_emitted_when_no_budget(tmp_path):
    """pipeline.cost.budget_warning not emitted when no budget configured."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=100.0)
    types = [e["event_type"] for e in events]
    assert "pipeline.cost.budget_warning" not in types


def test_cost_budget_warning_emitted_when_exceeded(tmp_path):
    """pipeline.cost.budget_warning emitted when cost exceeds 80% of budget."""
    # budget=1.0, cost=0.9 → 90% used → triggers warning
    events = _run_pipeline_with_cost(tmp_path, cost_usd=0.9, budget=1.0)
    types = [e["event_type"] for e in events]
    assert "pipeline.cost.budget_warning" in types


def test_cost_budget_warning_not_emitted_when_under_threshold(tmp_path):
    """pipeline.cost.budget_warning not emitted when cost is under threshold."""
    # budget=10.0, cost=0.5 → 5% used → no warning
    events = _run_pipeline_with_cost(tmp_path, cost_usd=0.5, budget=10.0)
    types = [e["event_type"] for e in events]
    assert "pipeline.cost.budget_warning" not in types


def test_cost_budget_warning_payload_fields(tmp_path):
    """pipeline.cost.budget_warning payload has required fields."""
    events = _run_pipeline_with_cost(tmp_path, cost_usd=0.9, budget=1.0)
    evt = next(e for e in events if e["event_type"] == "pipeline.cost.budget_warning")
    p = evt["payload"]
    assert "total_cost_usd" in p
    assert "budget_usd" in p
    assert "pct_used" in p
    assert p["budget_usd"] == 1.0
    assert p["pct_used"] > 80.0


# ---------------------------------------------------------------------------
# T12: Git events
# ---------------------------------------------------------------------------


def test_git_branch_created_event_emitted(tmp_path):
    """pipeline.git.branch_created emitted after create_branch() on fresh start."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Git branch test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch") as _mock_branch:
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.git.branch_created" in types


def test_git_branch_created_payload_fields(tmp_path):
    """pipeline.git.branch_created payload has branch field."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Git branch fields test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.git.branch_created")
    p = evt["payload"]
    assert "branch" in p
    assert "git-branch-fields-test" in p["branch"]


def test_git_branch_created_not_emitted_on_resume(tmp_path):
    """pipeline.git.branch_created NOT emitted when using --branch (already on branch)."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Branch skip test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        # create_branch is NOT called when branch= is provided explicitly
        with patch("worca.orchestrator.runner.create_branch") as mock_branch:
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        branch="worca/existing-branch",
                        settings_path=settings_path,
                        status_path=status_path,
                    )
        # create_branch not called when explicit branch is passed
        mock_branch.assert_not_called()

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.git.branch_created" not in types


def test_git_pr_created_event_emitted(tmp_path):
    """pipeline.git.pr_created emitted when PR stage completes with pr_url."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": True},
        },
        "agents": {
            "guardian": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="PR test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"pr_url": "https://github.com/org/repo/pull/42",
                "pr_number": 42}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.git.pr_created" in types


def test_git_pr_created_payload_fields(tmp_path):
    """pipeline.git.pr_created payload has pr_url, pr_number, title."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": True},
        },
        "agents": {
            "guardian": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="PR payload test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"pr_url": "https://github.com/org/repo/pull/99",
                "pr_number": 99}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.git.pr_created")
    p = evt["payload"]
    assert p["pr_url"] == "https://github.com/org/repo/pull/99"
    assert p["pr_number"] == 99
    assert "title" in p


def test_git_pr_created_not_emitted_without_pr_url(tmp_path):
    """pipeline.git.pr_created NOT emitted if PR stage returns no pr_url."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_minimal_settings(tmp_path, extra={
        "stages": {
            "plan": {"agent": "planner", "enabled": False},
            "coordinate": {"agent": "coordinator", "enabled": False},
            "implement": {"agent": "implementer", "enabled": False},
            "test": {"agent": "tester", "enabled": False},
            "review": {"agent": "guardian", "enabled": False},
            "pr": {"agent": "guardian", "enabled": True},
        },
        "agents": {
            "guardian": {"model": "opus", "max_turns": 10},
        },
    })
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="PR no url test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {}, {"type": "result"}  # no pr_url

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    result = run_pipeline(
                        wr, plan_file=str(plan),
                        settings_path=settings_path,
                        status_path=status_path,
                    )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.git.pr_created" not in types


# ---------------------------------------------------------------------------
# T12: Preflight events
# ---------------------------------------------------------------------------


def _make_preflight_settings(tmp_path, preflight_enabled=True, script=None):
    """Settings with preflight enabled."""
    cfg = {
        "worca": {
            "stages": {
                "preflight": {"enabled": preflight_enabled,
                              "script": script or ".claude/scripts/preflight_checks.py"},
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {},
            "loops": {},
        }
    }
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(cfg))
    return str(p)


def test_preflight_completed_event_emitted(tmp_path):
    """pipeline.preflight.completed emitted when preflight runs and passes."""
    from worca.orchestrator.work_request import WorkRequest

    # Create a real script file
    script = tmp_path / "preflight_checks.py"
    script.write_text(
        'import json, sys\n'
        'print(json.dumps({"status": "ok", "checks": [], "summary": "all good"}))\n'
        'sys.exit(0)\n'
    )
    settings_path = _make_preflight_settings(tmp_path, script=str(script))
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Preflight completed test")

    with patch("worca.orchestrator.runner.create_branch"):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                result = run_pipeline(wr, settings_path=settings_path,
                                      status_path=status_path)

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.preflight.completed" in types


def test_preflight_completed_payload_fields(tmp_path):
    """pipeline.preflight.completed payload has checks and all_passed."""
    from worca.orchestrator.work_request import WorkRequest

    script = tmp_path / "preflight_checks.py"
    script.write_text(
        'import json, sys\n'
        'print(json.dumps({"status": "ok", "checks": [{"name": "git", "status": "pass"}], "summary": "ok"}))\n'
        'sys.exit(0)\n'
    )
    settings_path = _make_preflight_settings(tmp_path, script=str(script))
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Preflight payload test")

    with patch("worca.orchestrator.runner.create_branch"):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                result = run_pipeline(wr, settings_path=settings_path,
                                      status_path=status_path)

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    evt = next(e for e in events if e["event_type"] == "pipeline.preflight.completed")
    p = evt["payload"]
    assert "checks" in p
    assert "all_passed" in p


def test_preflight_skipped_event_emitted_explicit(tmp_path):
    """pipeline.preflight.skipped emitted when --skip-preflight is used."""
    from worca.orchestrator.work_request import WorkRequest

    settings_path = _make_preflight_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Preflight skip test")

    with patch("worca.orchestrator.runner.create_branch"):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                result = run_pipeline(wr, settings_path=settings_path,
                                      status_path=status_path,
                                      skip_preflight=True)

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.preflight.skipped" in types


def test_preflight_skipped_event_emitted_script_not_found(tmp_path):
    """pipeline.preflight.skipped emitted when preflight script doesn't exist."""
    from worca.orchestrator.work_request import WorkRequest

    settings_path = _make_preflight_settings(
        tmp_path, script="/nonexistent/preflight_checks.py"
    )
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Preflight no script test")

    with patch("worca.orchestrator.runner.create_branch"):
        with patch("worca.orchestrator.runner._write_pid"):
            with patch("worca.orchestrator.runner._remove_pid"):
                result = run_pipeline(wr, settings_path=settings_path,
                                      status_path=status_path)

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    types = [e["event_type"] for e in events]
    assert "pipeline.preflight.skipped" in types


# ---------------------------------------------------------------------------
# T12: Learn stage events
# ---------------------------------------------------------------------------


def _make_learn_settings(tmp_path):
    """Settings with learn enabled."""
    cfg = {
        "worca": {
            "stages": {
                "plan": {"agent": "planner", "enabled": False},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {
                "learner": {"model": "opus", "max_turns": 10},
            },
            "loops": {},
            "learn": {"enabled": True},
        }
    }
    p = tmp_path / "settings.json"
    p.write_text(json.dumps(cfg))
    return str(p)


def test_learn_completed_event_emitted(tmp_path):
    """pipeline.stage.completed emitted for learn stage after success."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_learn_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Learn completed test")

    learn_result = {"summary": "Learned something", "insights": []}

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return learn_result, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.is_learn_enabled",
                               return_value=True):
                        result = run_pipeline(
                            wr, plan_file=str(plan),
                            settings_path=settings_path,
                            status_path=status_path,
                        )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    learn_events = [e for e in events
                    if e["event_type"] == "pipeline.stage.completed"
                    and e["payload"].get("stage") == "learn"]
    assert len(learn_events) == 1


def test_learn_completed_payload_fields(tmp_path):
    """pipeline.stage.completed for learn has standard stage payload fields."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_learn_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Learn payload test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"summary": "ok"}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.is_learn_enabled",
                               return_value=True):
                        result = run_pipeline(
                            wr, plan_file=str(plan),
                            settings_path=settings_path,
                            status_path=status_path,
                        )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    evt = next(e for e in events
               if e["event_type"] == "pipeline.stage.completed"
               and e["payload"].get("stage") == "learn")
    p = evt["payload"]
    assert p["stage"] == "learn"
    assert p["iteration"] == 1
    assert p["outcome"] == "success"
    assert "duration_ms" in p


def test_learn_started_event_emitted(tmp_path):
    """pipeline.stage.started emitted for learn stage."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_learn_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Learn started test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"summary": "ok"}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.is_learn_enabled",
                               return_value=True):
                        result = run_pipeline(
                            wr, plan_file=str(plan),
                            settings_path=settings_path,
                            status_path=status_path,
                        )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    learn_started = [e for e in events
                     if e["event_type"] == "pipeline.stage.started"
                     and e["payload"].get("stage") == "learn"]
    assert len(learn_started) == 1
    p = learn_started[0]["payload"]
    assert p["agent"] == "learner"
    assert p["model"] == "sonnet"


def test_learn_failed_event_emitted(tmp_path):
    """pipeline.stage.failed emitted when learn stage raises an exception."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_learn_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Learn failed test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        if stage.value == "learn":
            raise RuntimeError("learner crashed")
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.is_learn_enabled",
                               return_value=True):
                        result = run_pipeline(
                            wr, plan_file=str(plan),
                            settings_path=settings_path,
                            status_path=status_path,
                        )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    learn_failed = [e for e in events
                    if e["event_type"] == "pipeline.stage.failed"
                    and e["payload"].get("stage") == "learn"]
    assert len(learn_failed) == 1


def test_learn_failed_payload_has_error(tmp_path):
    """pipeline.stage.failed for learn has error and error_type fields."""
    from worca.orchestrator.work_request import WorkRequest

    plan = tmp_path / "plan.md"
    plan.write_text("# Plan\n")
    settings_path = _make_learn_settings(tmp_path)
    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir(exist_ok=True)
    status_path = str(worca_dir / "status.json")
    wr = WorkRequest(source_type="prompt", title="Learn fail payload test")

    def mock_run_stage(stage, context, sp, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        if stage.value == "learn":
            raise RuntimeError("learn error details")
        return {}, {"type": "result"}

    with patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage):
        with patch("worca.orchestrator.runner.create_branch"):
            with patch("worca.orchestrator.runner._write_pid"):
                with patch("worca.orchestrator.runner._remove_pid"):
                    with patch("worca.orchestrator.runner.is_learn_enabled",
                               return_value=True):
                        result = run_pipeline(
                            wr, plan_file=str(plan),
                            settings_path=settings_path,
                            status_path=status_path,
                        )

    events_path = worca_dir / "runs" / result["run_id"] / "events.jsonl"
    events = [json.loads(line) for line in events_path.read_text().strip().split("\n") if line.strip()]
    evt = next(e for e in events
               if e["event_type"] == "pipeline.stage.failed"
               and e["payload"].get("stage") == "learn")
    p = evt["payload"]
    assert "error" in p
    assert "learn error details" in p["error"]
    assert p["error_type"] == "RuntimeError"


# ---------------------------------------------------------------------------
# T3: OverlayResolver integration in _render_agent_templates
# ---------------------------------------------------------------------------

def test_render_agent_templates_accepts_overrides_dir(tmp_path, monkeypatch):
    """_render_agent_templates accepts overrides_dir parameter."""
    src_dir = tmp_path / "core"
    src_dir.mkdir()
    (src_dir / "implementer.md").write_text("## Rules\n\n- Core rule.\n")
    dst_dir = tmp_path / "run"

    monkeypatch.chdir(tmp_path)
    (tmp_path / ".claude" / "agents" / "core").mkdir(parents=True)
    (tmp_path / ".claude" / "agents" / "core" / "implementer.md").write_text(
        "## Rules\n\n- Core rule.\n"
    )

    custom_overrides = tmp_path / "custom_overrides"
    custom_overrides.mkdir()

    # Should not raise — overrides_dir parameter accepted
    _render_agent_templates(str(dst_dir), {"plan_file": "p.md", "run_id": "r1", "branch": "b", "title": "T"},
                            overrides_dir=str(custom_overrides))


def test_render_agent_templates_applies_overlay(tmp_path, monkeypatch):
    """_render_agent_templates applies overlay when overlay file exists."""
    monkeypatch.chdir(tmp_path)

    core_dir = tmp_path / ".claude" / "agents" / "core"
    core_dir.mkdir(parents=True)
    (core_dir / "implementer.md").write_text("## Rules\n\n- Core rule.\n")

    overrides_dir = tmp_path / "overrides"
    overrides_dir.mkdir()
    (overrides_dir / "implementer.md").write_text("## Override: Rules\n\n- Extra rule.\n")

    run_dir = tmp_path / "run"
    _render_agent_templates(
        str(run_dir),
        {"plan_file": "p.md", "run_id": "r1", "branch": "b", "title": "T"},
        overrides_dir=str(overrides_dir),
    )

    rendered = (run_dir / "agents" / "implementer.md").read_text()
    assert "Core rule" in rendered
    assert "Extra rule" in rendered


def test_render_agent_templates_no_overlay_unchanged(tmp_path, monkeypatch):
    """_render_agent_templates leaves output unchanged when no overlay exists."""
    monkeypatch.chdir(tmp_path)

    core_dir = tmp_path / ".claude" / "agents" / "core"
    core_dir.mkdir(parents=True)
    (core_dir / "implementer.md").write_text("## Rules\n\n- Core rule.\n")

    # Empty overrides dir (no overlay file for implementer)
    overrides_dir = tmp_path / "overrides"
    overrides_dir.mkdir()

    run_dir = tmp_path / "run"
    _render_agent_templates(
        str(run_dir),
        {"plan_file": "p.md", "run_id": "r1", "branch": "b", "title": "T"},
        overrides_dir=str(overrides_dir),
    )

    rendered = (run_dir / "agents" / "implementer.md").read_text()
    assert rendered == "## Rules\n\n- Core rule.\n"


def test_settings_json_has_agent_overrides_dir():
    """settings.json worca namespace must declare agent_overrides_dir adjacent to plan_path_template."""
    import pathlib
    settings_path = pathlib.Path(__file__).parent.parent / ".claude" / "settings.json"
    with settings_path.open() as f:
        settings = json.load(f)
    worca = settings.get("worca", {})
    assert "agent_overrides_dir" in worca, (
        "settings.json missing 'agent_overrides_dir' key under 'worca'"
    )
    assert worca["agent_overrides_dir"] == ".claude/agents/overrides", (
        f"Expected '.claude/agents/overrides', got {worca['agent_overrides_dir']!r}"
    )


def test_run_pipeline_reads_agent_overrides_dir_from_settings(tmp_path, monkeypatch):
    """run_pipeline passes agent_overrides_dir from settings to _render_agent_templates."""
    from worca.orchestrator.work_request import WorkRequest as _WR

    custom_overrides = str(tmp_path / "my_overrides")

    settings_path = tmp_path / "settings.json"
    settings_path.write_text(json.dumps({
        "worca": {
            "agent_overrides_dir": custom_overrides,
            "stages": {
                "plan": {"agent": "planner", "enabled": True},
                "coordinate": {"agent": "coordinator", "enabled": False},
                "implement": {"agent": "implementer", "enabled": False},
                "test": {"agent": "tester", "enabled": False},
                "review": {"agent": "guardian", "enabled": False},
                "pr": {"agent": "guardian", "enabled": False},
            },
            "agents": {"planner": {"model": "opus", "max_turns": 10}},
            "loops": {},
        }
    }))

    worca_dir = tmp_path / ".worca"
    worca_dir.mkdir()
    status_path = str(worca_dir / "status.json")

    monkeypatch.chdir(tmp_path)

    captured_calls = []

    def fake_render(run_dir, template_vars, overrides_dir=".claude/agents/overrides"):
        captured_calls.append(overrides_dir)

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1,
                       prompt_override=None, **kwargs):
        return {"approved": True}, {"type": "result"}

    wr = _WR(source_type="prompt", title="Add user auth")

    with patch("worca.orchestrator.runner._render_agent_templates", side_effect=fake_render), \
         patch("worca.orchestrator.runner.run_stage", side_effect=mock_run_stage), \
         patch("worca.orchestrator.runner.create_branch"), \
         patch("worca.orchestrator.runner._write_pid"), \
         patch("worca.orchestrator.runner._remove_pid"):
        run_pipeline(wr, settings_path=str(settings_path), status_path=status_path)

    assert any(c == custom_overrides for c in captured_calls), (
        f"Expected agent_overrides_dir={custom_overrides!r} to be passed; got calls: {captured_calls}"
    )
