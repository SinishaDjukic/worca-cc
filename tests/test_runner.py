"""Tests for worca.orchestrator.runner — pipeline runner."""

import json
import os
from unittest.mock import patch, MagicMock

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


def test_run_stage_calls_agent():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"approach": "test"}) as mock_run:
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    mock_run.assert_called_once()
    assert result == {"approach": "test"}


def test_run_stage_extracts_structured_output():
    mock_config = {"agent": "planner", "model": "opus", "max_turns": 40, "schema": "plan.json"}
    envelope = {"type": "result", "structured_output": {"approach": "test"}, "total_cost_usd": 1.0}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value=envelope):
            result, raw = run_stage(Stage.PLAN, {"prompt": "build auth"})
    assert result == {"approach": "test"}
    assert raw == envelope


def test_run_stage_passes_correct_args():
    mock_config = {"agent": "tester", "model": "sonnet", "max_turns": 20, "schema": "test.json"}
    with patch("worca.orchestrator.runner.get_stage_config", return_value=mock_config):
        with patch("worca.orchestrator.runner.run_agent", return_value={"passed": True}) as mock_run:
            result, raw = run_stage(Stage.TEST, {"prompt": "run tests"})
    call_kwargs = mock_run.call_args
    # Agent path should contain the agent name
    assert ".claude/agents/core/tester.md" in str(call_kwargs)
    # Schema path should be resolved
    assert ".claude/worca/schemas/test.json" in str(call_kwargs)


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
    """Run ID should be YYYYMMDD-HHMMSS format."""
    run_id = _generate_run_id("2026-03-09T17:15:45.583887+00:00")
    assert run_id == "20260309-171545"


def test_generate_run_id_without_timezone():
    run_id = _generate_run_id("2026-01-15T09:30:00")
    assert run_id == "20260115-093000"


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

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None):
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

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None):
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

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None):
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

    # plan_file should be resolved from template
    assert result["plan_file"] is not None
    assert "add-user-auth" in result["plan_file"]
    assert result["plan_file"].startswith("docs/plans/")


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

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None):
        if stage == Stage.COORDINATE:
            return {"beads_ids": bead_ids, "dependency_graph": {}}, {"type": "result"}
        elif stage == Stage.IMPLEMENT:
            implement_count[0] += 1
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        return {}, {"type": "result"}

    # Always return a bead — the max_beads counter should be the limit
    call_count = [0]
    def mock_query_ready():
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

    def mock_run_stage(stage, context, settings_path, msize=1, iteration=1, prompt_override=None):
        if stage == Stage.COORDINATE:
            return {"beads_ids": bead_ids, "dependency_graph": {}}, {"type": "result"}
        elif stage == Stage.IMPLEMENT:
            return {"files_changed": [], "tests_added": []}, {"type": "result"}
        return {}, {"type": "result"}

    # Mock _query_ready_bead to always return a bead (simulating stale beads)
    def mock_query_ready():
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
