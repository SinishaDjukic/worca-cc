"""Tests for the plan_reviewer.md agent file (.claude/agents/core/plan_reviewer.md)."""
import os

import pytest

AGENT_PATH = os.path.join(
    os.path.dirname(__file__), os.pardir,
    ".claude", "agents", "core", "plan_reviewer.md",
)


def _extract_section(content, heading):
    """Extract text between ## heading and the next ## heading."""
    lines = content.split("\n")
    in_section = False
    section_lines = []
    for line in lines:
        if line.strip().startswith(f"## {heading}"):
            in_section = True
            continue
        if in_section and line.strip().startswith("## "):
            break
        if in_section:
            section_lines.append(line)
    return "\n".join(section_lines)


class TestAgentFileExists:
    def test_agent_file_exists(self):
        assert os.path.isfile(AGENT_PATH), f"Agent file not found at {AGENT_PATH}"

    def test_agent_file_not_empty(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        assert len(content.strip()) > 0


class TestAgentStructure:
    @pytest.fixture
    def content(self):
        with open(AGENT_PATH) as f:
            return f.read()

    def test_has_role_heading(self, content):
        assert "## Role" in content

    def test_has_process_heading(self, content):
        assert "## Process" in content

    def test_has_rules_heading(self, content):
        assert "## Rules" in content

    def test_has_output_heading(self, content):
        assert "## Output" in content

    def test_title_is_plan_reviewer_agent(self, content):
        assert content.startswith("# Plan Reviewer Agent")


class TestAgentRole:
    @pytest.fixture
    def content(self):
        with open(AGENT_PATH) as f:
            return f.read()

    def test_role_mentions_review(self, content):
        role_section = _extract_section(content, "Role")
        assert "review" in role_section.lower()

    def test_role_mentions_read_only(self, content):
        role_section = _extract_section(content, "Role")
        assert "read-only" in role_section.lower() or "read only" in role_section.lower()

    def test_role_mentions_plan(self, content):
        role_section = _extract_section(content, "Role")
        assert "plan" in role_section.lower()


class TestAgentProcessCoversAllCategories:
    """The design requires checking all 7 issue categories."""

    @pytest.fixture
    def process(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        return _extract_section(content, "Process")

    def test_checks_completeness(self, process):
        assert "completeness" in process.lower() or "complete" in process.lower()

    def test_checks_feasibility(self, process):
        assert "feasib" in process.lower()

    def test_checks_test_strategy(self, process):
        assert "test" in process.lower()

    def test_checks_architecture(self, process):
        assert "architect" in process.lower()

    def test_checks_decomposition(self, process):
        assert "decompos" in process.lower() or "task" in process.lower()

    def test_checks_risk(self, process):
        assert "risk" in process.lower()

    def test_checks_api_assumptions(self, process):
        assert "api" in process.lower() or "library" in process.lower()


class TestAgentMcpTools:
    """Agent must use MCP tools for external validation."""

    @pytest.fixture
    def content(self):
        with open(AGENT_PATH) as f:
            return f.read()

    def test_mentions_context7(self, content):
        assert "context7" in content.lower()

    def test_mentions_websearch(self, content):
        assert "websearch" in content.lower() or "web search" in content.lower()

    def test_mentions_webfetch(self, content):
        assert "webfetch" in content.lower() or "web fetch" in content.lower()

    def test_mentions_mcp_turn_budget(self, content):
        assert "10" in content

    def test_mentions_graceful_degradation(self, content):
        process = _extract_section(content, "Process")
        assert (
            "unavailable" in process.lower()
            or "fail" in process.lower()
            or "skip" in process.lower()
            or "degrad" in process.lower()
        )


class TestAgentRules:
    """Agent must be strictly read-only with no side effects."""

    @pytest.fixture
    def rules(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        return _extract_section(content, "Rules")

    def test_no_file_modifications(self, rules):
        assert "modify" in rules.lower() or "write" in rules.lower() or "edit" in rules.lower()

    def test_no_test_execution(self, rules):
        assert "test" in rules.lower()

    def test_no_skill_invocation(self, rules):
        assert "skill" in rules.lower()

    def test_no_subagent_dispatch(self, rules):
        assert "subagent" in rules.lower() or "sub-agent" in rules.lower() or "dispatch" in rules.lower()

    def test_mentions_plan_review_schema(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        assert "plan_review.json" in content

    def test_must_read_claude_md(self, rules):
        assert "claude.md" in rules.lower() or "CLAUDE.md" in rules

    def test_read_only_stated_in_rules(self, rules):
        assert "read-only" in rules.lower() or "read only" in rules.lower() or "not modify" in rules.lower()
