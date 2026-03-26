"""Tests for PromptBuilder._build_learn — learn stage prompt generation."""


from worca.orchestrator.prompt_builder import PromptBuilder


def _make_status(iterations=2, test_fix_loops=1, review_fix_loops=0):
    """Build a minimal full_status dict for learn prompt tests."""
    return {
        "stages": {
            "plan": {"status": "completed"},
            "coordinate": {"status": "completed"},
            "implement": {
                "status": "completed",
                "iterations": [
                    {"agent": "implementer", "trigger": "initial", "status": "completed",
                     "output": {"files_changed": ["auth.py"]}},
                    {"agent": "implementer", "trigger": "test_fix", "status": "completed",
                     "output": {"files_changed": ["auth.py"]}},
                ],
            },
            "test": {
                "status": "completed",
                "iterations": [
                    {"agent": "tester", "status": "completed",
                     "output": {"passed": False, "failures": [{"test_name": "test_login"}]}},
                    {"agent": "tester", "status": "completed",
                     "output": {"passed": True}},
                ],
            },
            "review": {"status": "completed", "iterations": []},
        },
        "plan_file": "MASTER_PLAN.md",
    }


def test_build_learn_includes_work_request():
    pb = PromptBuilder("Add auth", "Implement user authentication")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    assert "Add auth" in prompt
    assert "Implement user authentication" in prompt


def test_build_learn_includes_termination_info():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "failure")
    pb.update_context("termination_reason", "Max iterations exceeded")
    prompt = pb.build("learn")
    assert "failure" in prompt
    assert "Max iterations exceeded" in prompt


def test_build_learn_includes_plan_content():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "success")
    pb.update_context("plan_file_content", "# Plan\n\n## Step 1\nDo the thing")
    prompt = pb.build("learn")
    assert "# Plan" in prompt
    assert "Step 1" in prompt


def test_build_learn_includes_status_as_json():
    status = _make_status()
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", status)
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    # The prompt should contain the status data serialized as JSON
    assert '"stages"' in prompt
    assert '"implement"' in prompt


def test_build_learn_includes_analysis_categories():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    # Should mention all analysis categories from the plan
    assert "test" in prompt.lower() and "loop" in prompt.lower()
    assert "review" in prompt.lower()
    assert "implementation" in prompt.lower()
    assert "planning" in prompt.lower() or "plan" in prompt.lower()
    assert "configuration" in prompt.lower()


def test_build_learn_without_plan_content():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "success")
    # No plan_file_content set
    prompt = pb.build("learn")
    assert "Plan File" not in prompt or "not available" in prompt.lower() or "no plan" in prompt.lower()


def test_build_learn_without_termination_reason():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", _make_status())
    pb.update_context("termination_type", "success")
    pb.update_context("termination_reason", "")
    prompt = pb.build("learn")
    # Should still render without error
    assert "success" in prompt


def test_build_learn_truncates_large_status():
    """If full_status JSON is very large, the prompt should truncate it."""
    status = _make_status()
    # Add a large output to blow up the JSON size
    large_output = "x" * 100_000
    status["stages"]["implement"]["iterations"][0]["output"]["large"] = large_output
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", status)
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    # Prompt should be truncated to a reasonable size (less than original)
    assert len(prompt) < len(large_output)


def test_build_learn_empty_status():
    """Handle minimal/empty status gracefully."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", {"stages": {}})
    pb.update_context("termination_type", "failure")
    pb.update_context("termination_reason", "Unknown error")
    prompt = pb.build("learn")
    assert "failure" in prompt
    assert "Unknown error" in prompt


def test_build_learn_includes_run_reference():
    """The learn prompt should surface run_id and log paths for traceability."""
    status = _make_status()
    status["run_id"] = "20260318-222430"
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", status)
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    assert "20260318-222430" in prompt
    assert ".worca/runs/20260318-222430/" in prompt
    assert ".worca/runs/20260318-222430/logs/" in prompt
    # Instructions should tell agent to reference run_id in observations and suggestions
    assert "observation" in prompt.lower() or "evidence" in prompt.lower()
    assert "suggestion" in prompt.lower()


def test_build_learn_run_reference_fallback_when_no_run_id():
    """When run_id is missing from status, should show 'unknown' gracefully."""
    status = _make_status()
    # No run_id key
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("full_status", status)
    pb.update_context("termination_type", "success")
    prompt = pb.build("learn")
    assert "unknown" in prompt
    assert ".worca/runs/unknown/" in prompt
