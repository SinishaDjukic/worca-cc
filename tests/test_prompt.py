"""Tests for prompt.py - Milestone approval gates for UserPromptSubmit."""
import json
from worca.hooks.prompt import check_milestone


# --- Plan approval gate ---

class TestPlanApproval:
    def test_injects_prompt_when_plan_stage_not_approved(self):
        status = {
            "stage": "plan",
            "milestones": {"plan_approved": None},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert "MILESTONE GATE" in message
        assert "plan" in message.lower()

    def test_no_gate_when_plan_approved(self):
        status = {
            "stage": "plan",
            "milestones": {"plan_approved": True},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert message == ""

    def test_plan_gate_mentions_master_plan(self):
        status = {
            "stage": "plan",
            "milestones": {"plan_approved": None},
        }
        code, message = check_milestone(status)
        assert "MASTER_PLAN" in message


# --- PR approval gate ---

class TestPrApproval:
    def test_injects_prompt_when_review_stage_not_approved(self):
        status = {
            "stage": "review",
            "milestones": {"pr_approved": None},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert "MILESTONE GATE" in message
        assert "pr" in message.lower() or "PR" in message

    def test_no_gate_when_pr_approved(self):
        status = {
            "stage": "review",
            "milestones": {"pr_approved": True},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert message == ""

    def test_pr_gate_mentions_review(self):
        status = {
            "stage": "review",
            "milestones": {"pr_approved": None},
        }
        code, message = check_milestone(status)
        assert "review" in message.lower() or "Review" in message


# --- No gate active ---

class TestNoGate:
    def test_no_gate_when_status_is_none(self):
        code, message = check_milestone(None)
        assert code == 0
        assert message == ""

    def test_no_gate_when_stage_is_implement(self):
        status = {
            "stage": "implement",
            "milestones": {},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert message == ""

    def test_no_gate_when_stage_is_empty(self):
        status = {
            "stage": "",
            "milestones": {},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert message == ""

    def test_no_gate_when_milestones_missing(self):
        status = {"stage": "plan"}
        code, message = check_milestone(status)
        # plan_approved key doesn't exist => .get returns None => gate triggers
        assert code == 0
        assert "MILESTONE GATE" in message

    def test_no_gate_when_stage_is_test(self):
        status = {
            "stage": "test",
            "milestones": {},
        }
        code, message = check_milestone(status)
        assert code == 0
        assert message == ""


# --- Main function integration with status file ---

class TestMainStatusFile:
    def test_reads_from_status_file(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)  # isolate from real .worca/active_run
        status_file = tmp_path / "status.json"
        status_file.write_text(json.dumps({
            "stage": "plan",
            "milestones": {"plan_approved": None},
        }))
        monkeypatch.setenv("WORCA_STATUS_FILE", str(status_file))

        from worca.hooks.prompt import load_status
        status = load_status()
        assert status is not None
        assert status["stage"] == "plan"

    def test_returns_none_when_file_missing(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)  # isolate from real .worca/active_run
        monkeypatch.setenv("WORCA_STATUS_FILE", str(tmp_path / "nonexistent.json"))

        from worca.hooks.prompt import load_status
        status = load_status()
        assert status is None

    def test_returns_none_when_no_env_and_no_default(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("WORCA_STATUS_FILE", raising=False)

        from worca.hooks.prompt import load_status
        status = load_status()
        assert status is None
