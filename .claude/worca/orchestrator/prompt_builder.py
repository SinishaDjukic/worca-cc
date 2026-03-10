"""Stage-specific prompt builder for the worca pipeline.

Constructs per-stage user prompts that include the work request plus
accumulated inter-stage context (plan output, bead IDs, test results, etc.).
"""
import os


class PromptBuilder:
    """Builds contextual prompts for each pipeline stage.

    Accumulates inter-stage outputs and renders stage-appropriate prompts.
    """

    def __init__(self, work_request_title: str, work_request_description: str = "",
                 claude_md_path: str = "CLAUDE.md"):
        self._title = work_request_title
        self._description = work_request_description or work_request_title
        self._context: dict = {}
        self._claude_md_content = self._read_claude_md(claude_md_path)

    @staticmethod
    def _read_claude_md(path: str) -> str:
        """Read CLAUDE.md content if it exists, return empty string otherwise."""
        try:
            if os.path.exists(path):
                with open(path) as f:
                    return f.read().strip()
        except OSError:
            pass
        return ""

    def update_context(self, key: str, value) -> None:
        """Store inter-stage output for use in downstream prompts."""
        self._context[key] = value

    def get_context(self, key: str, default=None):
        """Retrieve stored inter-stage context."""
        return self._context.get(key, default)

    def build(self, stage: str, iteration: int = 0) -> str:
        """Render the user prompt for the given stage.

        Args:
            stage: Pipeline stage name (plan, coordinate, implement, test, review, pr).
            iteration: Loop iteration number (0 = first run, >0 = retry).

        Returns:
            Fully rendered prompt string.
        """
        builder = getattr(self, f"_build_{stage}", None)
        if builder is None:
            return self._work_request_section()
        return builder(iteration)

    def _work_request_section(self) -> str:
        """Common work request section included in all prompts."""
        return f"## Work Request\n\n**{self._title}**\n\n{self._description}"

    def _build_plan(self, iteration: int) -> str:
        parts = [
            "Create a detailed implementation plan for the following work request.",
            "Start by reading CLAUDE.md for project context (tech stack, build/test commands, conventions).",
            "Then explore the codebase to understand existing architecture.",
            "Write the plan to MASTER_PLAN.md.",
            "",
            self._work_request_section(),
        ]
        if self._claude_md_content:
            parts.append(f"## Project Context (from CLAUDE.md)\n\n{self._claude_md_content}")
        return "\n\n".join(parts)

    def _build_coordinate(self, iteration: int) -> str:
        parts = [
            "Decompose the approved plan into fine-grained Beads tasks with dependencies.",
            "Do NOT implement anything — only create tasks using `bd create` and set dependencies with `bd dep add`.",
            "",
            self._work_request_section(),
        ]
        approach = self._context.get("plan_approach")
        tasks_outline = self._context.get("plan_tasks_outline")
        if approach or tasks_outline:
            parts.append("## Approved Plan")
            if approach:
                parts.append(f"**Approach:** {approach}")
            if tasks_outline:
                outline_text = "\n".join(
                    f"- {t.get('title', 'Untitled')}: {t.get('description', '')}"
                    for t in tasks_outline
                )
                parts.append(f"**Task Outline:**\n{outline_text}")
        return "\n\n".join(parts)

    def _build_implement(self, iteration: int) -> str:
        parts = [
            "Implement the code changes for the assigned task. Follow TDD: write a failing test first, then implement.",
        ]
        bead_id = self._context.get("assigned_bead_id")
        bead_title = self._context.get("assigned_bead_title")
        bead_description = self._context.get("assigned_bead_description")
        if bead_id:
            parts.append(f"## Assigned Task\n\n**Bead ID:** {bead_id}")
            if bead_title:
                parts.append(f"**Title:** {bead_title}")
            if bead_description:
                parts.append(f"**Description:** {bead_description}")
        else:
            parts.append("Run `bd ready` to find available work, then claim and implement a task.")

        parts.append("")
        parts.append(self._work_request_section())

        if iteration > 0:
            test_failures = self._context.get("test_failures")
            review_issues = self._context.get("review_issues")
            if test_failures:
                parts.append(f"## Iteration {iteration}: Fix Test Failures")
                for f in test_failures:
                    name = f.get("test_name", "unknown")
                    error = f.get("error", "no details")
                    parts.append(f"- **{name}**: {error}")
            if review_issues:
                parts.append(f"## Iteration {iteration}: Address Review Feedback")
                for issue in review_issues:
                    file = issue.get("file", "?")
                    line = issue.get("line", "?")
                    sev = issue.get("severity", "?")
                    desc = issue.get("description", "")
                    parts.append(f"- [{sev}] {file}:{line} — {desc}")

        return "\n\n".join(parts)

    def _build_test(self, iteration: int) -> str:
        parts = [
            "Run the full test suite and verify the implementation. Do NOT modify source code.",
            "",
            self._work_request_section(),
        ]
        files_changed = self._context.get("files_changed")
        tests_added = self._context.get("tests_added")
        if files_changed or tests_added:
            parts.append("## Implementation Summary")
            if files_changed:
                parts.append("**Files changed:**\n" + "\n".join(f"- {f}" for f in files_changed))
            if tests_added:
                parts.append("**Tests added:**\n" + "\n".join(f"- {t}" for t in tests_added))
        return "\n\n".join(parts)

    def _build_review(self, iteration: int) -> str:
        parts = [
            "Review the code changes for correctness, style, and adherence to the plan. Do NOT modify code.",
            "",
            self._work_request_section(),
        ]
        test_passed = self._context.get("test_passed")
        coverage = self._context.get("test_coverage")
        proof_artifacts = self._context.get("proof_artifacts")
        if test_passed is not None:
            parts.append("## Test Results")
            parts.append(f"**Status:** {'PASSED' if test_passed else 'FAILED'}")
            if coverage is not None:
                parts.append(f"**Coverage:** {coverage}%")
            if proof_artifacts:
                parts.append("**Proof artifacts:**\n" + "\n".join(f"- {a}" for a in proof_artifacts))
        files_changed = self._context.get("files_changed")
        if files_changed:
            parts.append("## Files Changed\n" + "\n".join(f"- {f}" for f in files_changed))
        return "\n\n".join(parts)

    def _build_pr(self, iteration: int) -> str:
        parts = [
            "Create a pull request summarizing all changes. Ensure the commit history is clean.",
            "",
            self._work_request_section(),
        ]
        approach = self._context.get("plan_approach")
        if approach:
            parts.append(f"## Approach\n\n{approach}")
        return "\n\n".join(parts)
