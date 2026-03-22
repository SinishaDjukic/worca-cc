"""Stage-specific prompt builder for the worca pipeline.

Constructs per-stage user prompts that include the work request plus
accumulated inter-stage context (plan output, bead IDs, test results, etc.).
"""
import json
import os
import tempfile
from pathlib import Path

_MAX_CONTEXT_BYTES = 100_000  # 100KB cap for prompt_context.json


class PromptBuilder:
    """Builds contextual prompts for each pipeline stage.

    Accumulates inter-stage outputs and renders stage-appropriate prompts.
    """

    def __init__(self, work_request_title: str, work_request_description: str = "",
                 claude_md_path: str = "CLAUDE.md", context_path: str = None):
        self._title = work_request_title
        self._description = work_request_description or work_request_title
        self._context: dict = {}
        self._context_path = context_path
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

    def save_context(self, context_path: str = None) -> None:
        """Persist current context to prompt_context.json using atomic write.

        Caps output at 100KB by dropping the oldest-inserted keys first.
        No-op if no path is configured.
        """
        path = context_path or self._context_path
        if not path:
            return

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)

        # Build a copy of the context and truncate if over the size cap
        context_copy = dict(self._context)
        serialized = json.dumps(context_copy, indent=2, default=str)
        if len(serialized.encode()) > _MAX_CONTEXT_BYTES:
            keys = list(context_copy.keys())
            while keys and len(serialized.encode()) > _MAX_CONTEXT_BYTES:
                del context_copy[keys.pop(0)]
                serialized = json.dumps(context_copy, indent=2, default=str)

        fd, tmp_path = tempfile.mkstemp(dir=p.parent, prefix=".tmp_", suffix=".json")
        try:
            with os.fdopen(fd, "w") as f:
                f.write(serialized)
                f.write("\n")
            os.rename(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def load_context(self, context_path: str = None) -> None:
        """Load context from prompt_context.json and merge into current context.

        Merges loaded keys into self._context (loaded values override existing).
        No-op if the file doesn't exist or no path is configured.
        """
        path = context_path or self._context_path
        if not path:
            return
        if not os.path.exists(path):
            return
        try:
            with open(path) as f:
                data = json.load(f)
            self._context.update(data)
        except (OSError, json.JSONDecodeError):
            pass

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
        if iteration > 0:
            return self._build_implement_retry(iteration)
        return self._build_implement_initial()

    def _build_implement_initial(self) -> str:
        """Build prompt for the first implementation attempt."""
        parts = [
            "Implement the code changes for the assigned task. Follow TDD: write a failing test first, then implement.",
        ]
        parts.append(self._assigned_task_section())
        parts.append("")
        parts.append(self._work_request_section())
        return "\n\n".join(parts)

    def _build_implement_retry(self, iteration: int) -> str:
        """Build prompt for retry iterations — feedback first, plan as reference."""
        parts = []
        test_failures = self._context.get("test_failures")
        review_issues = self._context.get("review_issues")
        test_failure_history = self._context.get("test_failure_history") or []
        review_history = self._context.get("review_history") or []
        attempt_count = len(review_history) or len(test_failure_history) or iteration
        assigned = self._context.get("assigned_bead_id")

        # -- Priority header --
        if assigned:
            # Per-bead retry (legacy path, kept for compatibility)
            if test_failures:
                parts.append(
                    f"## PRIORITY: Fix Test Failures (attempt {attempt_count})\n\n"
                    "The implementation is already in place. Your ONLY task is to fix the "
                    "failing tests listed below. Do NOT re-implement the plan from scratch. "
                    "Do NOT just rebuild and exit."
                )
            elif review_issues:
                parts.append(
                    f"## PRIORITY: Fix Review Issues (attempt {attempt_count})\n\n"
                    "The implementation is already in place. Your ONLY task is to fix the "
                    "specific issues listed below. Do NOT re-implement the plan from scratch. "
                    "Do NOT just rebuild and exit."
                )
        else:
            # Fix mode: no specific bead, fix all issues across the project
            if test_failures:
                parts.append(
                    f"## PRIORITY: Fix All Issues — Test Failures (attempt {attempt_count})\n\n"
                    "All tasks have been implemented. Your ONLY task is to fix the "
                    "failing tests listed below. You have full access to the codebase — "
                    "fix whatever is broken. Do NOT re-implement the plan from scratch. "
                    "Do NOT use `bd ready` or `bd close`."
                )
            elif review_issues:
                parts.append(
                    f"## PRIORITY: Fix All Issues — Review Issues (attempt {attempt_count})\n\n"
                    "All tasks have been implemented. Your ONLY task is to fix the "
                    "specific issues listed below. You have full access to the codebase — "
                    "fix whatever is broken. Do NOT re-implement the plan from scratch. "
                    "Do NOT use `bd ready` or `bd close`."
                )

        # -- Current issues to fix --
        if test_failures:
            parts.append("### Failures to Fix")
            for i, f in enumerate(test_failures, 1):
                name = f.get("test_name", "unknown")
                error = f.get("error", "no details")
                parts.append(f"{i}. **{name}**\n   {error}")

        if review_issues:
            parts.append("### Issues to Fix")
            for i, issue in enumerate(review_issues, 1):
                file = issue.get("file", "?")
                line = issue.get("line", "?")
                sev = issue.get("severity", "?")
                desc = issue.get("description", "")
                parts.append(f"{i}. [{sev}] `{file}:{line}`\n   {desc}")

        # -- Previous failed attempts (if any) --
        if len(review_history) > 1:
            parts.append("### Previous Attempts (all failed to resolve)")
            for entry in review_history[:-1]:
                attempt = entry.get("attempt", "?")
                issues = entry.get("issues", [])
                issue_summary = "; ".join(
                    f"[{i.get('severity','?')}] {i.get('file','?')}:{i.get('line','?')}"
                    for i in issues
                )
                parts.append(f"- Attempt {attempt}: {issue_summary}")

        if len(test_failure_history) > 1:
            parts.append("### Previous Attempts (all failed to resolve)")
            for entry in test_failure_history[:-1]:
                attempt = entry.get("attempt", "?")
                failures = entry.get("failures", [])
                fail_summary = "; ".join(f.get("test_name", "unknown") for f in failures)
                parts.append(f"- Attempt {attempt}: {fail_summary}")

        # -- Verification instruction --
        parts.append(
            "### Verification\n\n"
            "After making each fix, read back the changed lines to confirm the fix is correct. "
            "Do not assume the fix landed — verify it."
        )

        # -- Reference section: task + plan (demoted) --
        parts.append("---")
        parts.append("## Reference: Task & Plan (already implemented)")
        parts.append(self._assigned_task_section())
        parts.append("")
        parts.append(self._work_request_section())

        return "\n\n".join(parts)

    def _assigned_task_section(self) -> str:
        """Render the assigned bead task section."""
        bead_id = self._context.get("assigned_bead_id")
        bead_title = self._context.get("assigned_bead_title")
        bead_description = self._context.get("assigned_bead_description")
        if bead_id:
            lines = [f"## Assigned Task\n\n**Bead ID:** {bead_id}"]
            if bead_title:
                lines.append(f"**Title:** {bead_title}")
            if bead_description:
                lines.append(f"**Description:** {bead_description}")
            return "\n\n".join(lines)
        return "Run `bd ready` to find available work, then claim and implement a task."

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
        parts.append(
            "## Implementer Capabilities\n\n"
            "The implementer agent can edit files and run tests but CANNOT make git commits "
            "(commits are handled by the guardian stage). Do NOT flag uncommitted files as issues "
            "requiring changes — focus only on code correctness, style, and adherence to the plan."
        )
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

    # -- Learn stage -------------------------------------------------------

    _MAX_STATUS_JSON_LEN = 50_000  # truncate serialised status beyond this

    def _build_learn(self, iteration: int) -> str:
        """Build the retrospective analysis prompt for the LEARN stage."""
        full_status = self._context.get("full_status") or {}
        termination_type = self._context.get("termination_type", "unknown")
        termination_reason = self._context.get("termination_reason", "")
        plan_content = self._context.get("plan_file_content")

        parts = [
            "Analyze the completed pipeline run and produce a structured retrospective.",
            "You are a read-only analyst. Do NOT modify files or run tests.",
        ]

        # Work request context
        parts.append(self._work_request_section())

        # Termination info
        term_section = f"## Termination\n\n**Type:** {termination_type}"
        if termination_reason:
            term_section += f"\n**Reason:** {termination_reason}"
        parts.append(term_section)

        # Plan content (if available)
        if plan_content:
            parts.append(f"## Plan File\n\n{plan_content}")

        # Run reference — surface run_id and paths for traceability
        run_id = full_status.get("run_id", "unknown")
        run_dir = f".worca/runs/{run_id}/"
        logs_dir = f".worca/runs/{run_id}/logs/"
        parts.append(
            f"## Run Reference\n\n"
            f"**Run ID:** `{run_id}`\n"
            f"**Run directory:** `{run_dir}`\n"
            f"**Logs directory:** `{logs_dir}`"
        )

        # Full run data as JSON (truncated if too large)
        status_json = json.dumps(full_status, indent=2, default=str)
        if len(status_json) > self._MAX_STATUS_JSON_LEN:
            status_json = status_json[:self._MAX_STATUS_JSON_LEN] + "\n... (truncated)"
        parts.append(f"## Run Data\n\n```json\n{status_json}\n```")

        # Analysis instructions per category
        parts.append(
            "## Analysis Instructions\n\n"
            "Analyze the run data above across these categories:\n\n"
            "1. **Test loops** — What triggered each test failure? Did fixes address "
            "root causes or just symptoms? Did the same failure types recur?\n"
            "2. **Review loops** — What severity/category of issues were raised? "
            "Were they systemic or isolated?\n"
            "3. **Implementation** — Were there recurring issues across beads "
            "(same error types, missing patterns, same test categories failing)?\n"
            "4. **Planning** — Did the plan anticipate actual challenges? "
            "Were task decompositions appropriate?\n"
            "5. **Coordination** — Were dependencies correct? Did the bead ordering "
            "cause unnecessary rework?\n"
            "6. **Configuration** — Were loop limits hit? Were turn limits adequate? "
            "Was cost disproportionate to outcome?\n\n"
            "For each observation, rate importance as critical/high/medium/low "
            "based on impact and recurrence. In each observation's `evidence` field, "
            f"reference the run ID (`{run_id}`) and relevant log file paths "
            f"(e.g., `{logs_dir}<stage>/iter-N.log`) so that follow-up investigation "
            "can locate the source data.\n\n"
            "Formulate targeted suggestions linking to specific artifacts "
            "(prompts, config, plan templates). In each suggestion's `description`, "
            f"include the run ID (`{run_id}`) and the specific log paths that "
            "contain the evidence, so follow-up agents can reproduce and verify."
        )

        return "\n\n".join(parts)
