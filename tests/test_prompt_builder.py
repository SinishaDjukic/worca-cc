"""Tests for worca.orchestrator.prompt_builder — stage-specific prompt generation."""


from worca.orchestrator.prompt_builder import PromptBuilder


def test_build_unknown_stage_returns_work_request():
    pb = PromptBuilder("Add auth", "Implement user authentication")
    prompt = pb.build("unknown_stage")
    assert "Add auth" in prompt
    assert "Implement user authentication" in prompt


def test_build_plan_includes_work_request():
    pb = PromptBuilder("Add auth", "Implement user authentication")
    prompt = pb.build("plan")
    assert "Add auth" in prompt
    assert "Implement user authentication" in prompt


def test_build_plan_includes_claude_md_instruction():
    pb = PromptBuilder("Add auth", "Implement user authentication")
    prompt = pb.build("plan")
    assert "CLAUDE.md" in prompt
    assert "MASTER_PLAN.md" in prompt


def test_build_plan_includes_claude_md_content(tmp_path):
    claude_md = tmp_path / "CLAUDE.md"
    claude_md.write_text("# My Project\n\nUses Python + pytest")
    pb = PromptBuilder("Add auth", "Desc", claude_md_path=str(claude_md))
    prompt = pb.build("plan")
    assert "My Project" in prompt
    assert "Uses Python + pytest" in prompt
    assert "Project Context" in prompt


def test_build_plan_no_claude_md(tmp_path):
    pb = PromptBuilder("Add auth", "Desc", claude_md_path=str(tmp_path / "nonexistent.md"))
    prompt = pb.build("plan")
    assert "Project Context" not in prompt
    assert "Add auth" in prompt


def test_build_coordinate_includes_work_request():
    pb = PromptBuilder("Add auth", "Implement user authentication")
    prompt = pb.build("coordinate")
    assert "Add auth" in prompt
    assert "bd create" in prompt
    assert "Do NOT implement" in prompt


def test_build_coordinate_includes_plan_context():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("plan_approach", "Use JWT tokens with refresh flow")
    pb.update_context("plan_tasks_outline", [
        {"title": "Create auth middleware", "description": "JWT validation middleware"},
        {"title": "Add login endpoint", "description": "POST /api/login"},
    ])
    prompt = pb.build("coordinate")
    assert "Approved Plan" in prompt
    assert "JWT tokens" in prompt
    assert "Create auth middleware" in prompt
    assert "Add login endpoint" in prompt


def test_build_coordinate_without_plan_context():
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("coordinate")
    assert "Approved Plan" not in prompt


def test_build_implement_with_assigned_bead():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc123")
    pb.update_context("assigned_bead_title", "Create auth middleware")
    pb.update_context("assigned_bead_description", "JWT validation middleware")
    prompt = pb.build("implement")
    assert "bd-abc123" in prompt
    assert "Create auth middleware" in prompt
    assert "JWT validation middleware" in prompt
    assert "bd ready" not in prompt


def test_build_implement_without_assigned_bead():
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("implement")
    assert "bd ready" in prompt


def test_build_implement_with_test_failures():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc123")
    pb.update_context("test_failures", [
        {"test_name": "test_login_valid", "error": "AssertionError: 401 != 200"},
        {"test_name": "test_token_refresh", "error": "KeyError: 'refresh_token'"},
    ])
    prompt = pb.build("implement", iteration=1)
    assert "PRIORITY: Fix Test Failures" in prompt
    assert "Failures to Fix" in prompt
    assert "test_login_valid" in prompt
    assert "401 != 200" in prompt
    assert "test_token_refresh" in prompt
    assert "Reference: Task & Plan (already implemented)" in prompt


def test_build_implement_with_review_issues():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc123")
    pb.update_context("review_issues", [
        {"file": "auth.py", "line": 42, "severity": "critical", "description": "SQL injection"},
    ])
    prompt = pb.build("implement", iteration=2)
    assert "PRIORITY: Fix Review Issues" in prompt
    assert "Issues to Fix" in prompt
    assert "auth.py:42" in prompt
    assert "SQL injection" in prompt
    assert "[critical]" in prompt
    assert "Reference: Task & Plan (already implemented)" in prompt


def test_build_implement_no_loop_context_at_iteration_0():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("test_failures", [{"test_name": "t", "error": "e"}])
    prompt = pb.build("implement", iteration=0)
    assert "PRIORITY" not in prompt


def test_build_implement_cleared_context_not_shown():
    """When test_failures is set to None (cleared), it should not appear."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc123")
    pb.update_context("test_failures", None)
    pb.update_context("review_issues", [
        {"file": "x.py", "line": 1, "severity": "minor", "description": "style"},
    ])
    prompt = pb.build("implement", iteration=1)
    assert "Fix Test Failures" not in prompt
    assert "Fix Review Issues" in prompt


def test_build_implement_retry_shows_history():
    """Review history from multiple attempts is shown in retry prompt."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc123")
    pb.update_context("review_history", [
        {"attempt": 1, "issues": [{"file": "a.py", "line": 10, "severity": "major", "description": "bug1"}]},
        {"attempt": 2, "issues": [{"file": "a.py", "line": 10, "severity": "major", "description": "bug1 still"}]},
    ])
    pb.update_context("review_issues", [
        {"file": "a.py", "line": 10, "severity": "major", "description": "bug1 still"},
    ])
    prompt = pb.build("implement", iteration=2)
    assert "Previous Attempts (all failed to resolve)" in prompt
    assert "Attempt 1" in prompt
    assert "PRIORITY: Fix Review Issues (attempt 2)" in prompt


def test_build_implement_retry_verification_instruction():
    """Retry prompt includes verification instruction."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("review_issues", [
        {"file": "a.py", "line": 1, "severity": "critical", "description": "x"},
    ])
    prompt = pb.build("implement", iteration=1)
    assert "read back the changed lines" in prompt


def test_build_test_includes_implementation_summary():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("files_changed", ["auth.py", "middleware.py"])
    pb.update_context("tests_added", ["test_auth.py"])
    prompt = pb.build("test")
    assert "Implementation Summary" in prompt
    assert "auth.py" in prompt
    assert "middleware.py" in prompt
    assert "test_auth.py" in prompt


def test_build_test_without_implementation_summary():
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("test")
    assert "Implementation Summary" not in prompt
    assert "Do NOT modify source code" in prompt


def test_build_review_includes_test_results():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("test_passed", True)
    pb.update_context("test_coverage", 87.5)
    pb.update_context("proof_artifacts", [".worca/test-output.txt"])
    pb.update_context("files_changed", ["auth.py"])
    prompt = pb.build("review")
    assert "PASSED" in prompt
    assert "87.5%" in prompt
    assert "test-output.txt" in prompt
    assert "Files Changed" in prompt
    assert "auth.py" in prompt


def test_build_review_without_test_results():
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("review")
    assert "Test Results" not in prompt


def test_build_pr_includes_approach():
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("plan_approach", "JWT with refresh tokens")
    prompt = pb.build("pr")
    assert "JWT with refresh tokens" in prompt
    assert "pull request" in prompt.lower()


def test_build_pr_without_approach():
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("pr")
    assert "Approach" not in prompt


def test_update_and_get_context():
    pb = PromptBuilder("title", "desc")
    pb.update_context("key1", "value1")
    assert pb.get_context("key1") == "value1"
    assert pb.get_context("missing") is None
    assert pb.get_context("missing", "default") == "default"


def test_description_defaults_to_title():
    pb = PromptBuilder("Add auth")
    prompt = pb.build("plan")
    # Description should fall back to title
    assert "Add auth" in prompt


# --- Fix 1: per-bead prompt iteration counter ---

def test_implement_iteration_0_produces_initial_prompt():
    """build("implement", 0) should produce the initial prompt."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("assigned_bead_id", "bd-abc")
    pb.update_context("assigned_bead_title", "Task 1")
    prompt = pb.build("implement", iteration=0)
    assert prompt.startswith("Implement the code")
    assert "PRIORITY" not in prompt


def test_implement_iteration_1_with_review_issues_produces_retry():
    """build("implement", 1) with review_issues should produce a retry prompt."""
    pb = PromptBuilder("Add auth", "Desc")
    pb.update_context("review_issues", [
        {"file": "x.py", "line": 1, "severity": "major", "description": "bug"},
    ])
    prompt = pb.build("implement", iteration=1)
    assert prompt.startswith("## PRIORITY")


def test_implement_iteration_0_after_context_clear_produces_initial():
    """After clearing feedback context, build("implement", 0) should produce
    the initial prompt again — not a broken retry prompt."""
    pb = PromptBuilder("Add auth", "Desc")
    # Simulate a retry cycle
    pb.update_context("review_issues", [
        {"file": "x.py", "line": 1, "severity": "major", "description": "bug"},
    ])
    prompt_retry = pb.build("implement", iteration=1)
    assert "PRIORITY" in prompt_retry

    # Simulate next_bead transition: clear feedback, reset iteration
    pb.update_context("review_issues", None)
    pb.update_context("review_history", None)
    pb.update_context("test_failures", None)
    pb.update_context("test_failure_history", None)
    prompt_fresh = pb.build("implement", iteration=0)
    assert prompt_fresh.startswith("Implement the code")
    assert "PRIORITY" not in prompt_fresh
    assert "Verification" not in prompt_fresh.split("\n")[0]


# --- Fix 2: reviewer knows implementer capabilities ---

def test_review_prompt_contains_implementer_capabilities():
    """Review prompt should tell the reviewer that the implementer cannot commit."""
    pb = PromptBuilder("Add auth", "Desc")
    prompt = pb.build("review")
    assert "CANNOT make git commits" in prompt
    assert "Do NOT flag uncommitted files" in prompt
