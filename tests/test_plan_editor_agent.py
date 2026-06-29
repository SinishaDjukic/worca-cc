"""Tests for the plan_editor.md agent file (src/worca/agents/core/plan_editor.md)."""
import os

import pytest

import worca

AGENT_PATH = os.path.join(
    os.path.dirname(worca.__file__), "agents", "core", "plan_editor.md",
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

    def test_title_is_plan_editor_agent(self, content):
        assert content.startswith("# Plan Editor Agent")


class TestEditorRole:
    @pytest.fixture
    def content(self):
        with open(AGENT_PATH) as f:
            return f.read()

    def test_role_mentions_review(self, content):
        role_section = _extract_section(content, "Role")
        assert "review" in role_section.lower()

    def test_role_mentions_edit(self, content):
        role_section = _extract_section(content, "Role")
        assert "edit" in role_section.lower() or "rewrite" in role_section.lower()

    def test_role_mentions_plan(self, content):
        role_section = _extract_section(content, "Role")
        assert "plan" in role_section.lower()

    def test_role_not_read_only(self, content):
        """Editor is NOT read-only — it rewrites the plan."""
        role_section = _extract_section(content, "Role")
        assert "read-only" not in role_section.lower()


class TestEditorProcessCoversAllCategories:
    """The editor shares the same review categories as the reviewer."""

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


class TestEditorMcpTools:
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


class TestEditorBehavior:
    """Editor-specific behavior: rewrite + self-approve, guide-conflict rule."""

    @pytest.fixture
    def content(self):
        with open(AGENT_PATH) as f:
            return f.read()

    def test_mentions_rewrite(self, content):
        assert "rewrite" in content.lower()

    def test_mentions_self_approve(self, content):
        assert "self-approve" in content.lower() or "approve" in content.lower()

    def test_mentions_approve_with_edits_outcome(self, content):
        assert "approve_with_edits" in content

    def test_guide_authority(self, content):
        assert "guide" in content.lower()
        assert "guide > plan" in content.lower() or "guide wins" in content.lower()

    def test_plan_file_only_writes(self, content):
        rules = _extract_section(content, "Rules")
        assert "plan file" in rules.lower() or "plan_review.json" in rules.lower()

    def test_no_source_writes(self, content):
        rules = _extract_section(content, "Rules")
        assert "source" in rules.lower() or "src" in rules.lower()

    def test_mentions_plan_review_schema(self, content):
        assert "plan_review.json" in content


class TestEditorRules:
    @pytest.fixture
    def rules(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        return _extract_section(content, "Rules")

    def test_may_write_plan(self, rules):
        assert "write" in rules.lower() or "edit" in rules.lower() or "rewrite" in rules.lower()

    def test_no_test_execution(self, rules):
        assert "test" in rules.lower()

    def test_no_subagent_dispatch(self, rules):
        assert "subagent" in rules.lower() or "sub-agent" in rules.lower() or "dispatch" in rules.lower()

    def test_must_read_claude_md(self, rules):
        assert "claude.md" in rules.lower() or "CLAUDE.md" in rules

    def test_blocked_from_source_writes(self, rules):
        assert "source" in rules.lower()


class TestEditorDoesNotEmbedBlock:
    def test_plan_editor_does_not_embed_block(self):
        with open(AGENT_PATH) as f:
            content = f.read()
        assert "{{block:plan-edit}}" not in content
