"""Stage-specific prompt builder for the worca pipeline.

Constructs per-stage user prompts that include the work request plus
accumulated inter-stage context (plan output, bead IDs, test results, etc.).
"""
import json
import os
import tempfile
from pathlib import Path

from worca.orchestrator.context_keys import alias_for, flat_for
from worca.orchestrator.overlay import _dig

_MAX_CONTEXT_BYTES = 100_000  # 100KB cap for prompt_context.json
_DESIGN_NOTES_CAP = 2000

# prompt_context.json format version (W-072 §2). Version 2 adds the nested
# "stages" namespace (stages.<stage>.<output>). Version-1 files carry flat
# keys only and have no marker — they load unchanged; namespaced reads of
# their data resolve through the alias table (context_keys.CONTEXT_ALIASES).
PROMPT_CONTEXT_SCHEMA_VERSION = 2


def _render_notes(notes: list[dict], cap: int) -> str:
    """Render design notes as an attributed bullet list, drop-oldest to fit cap."""
    if not notes or cap <= 0:
        return ""
    lines = [f"- [{n['bead_id']}] {n['note']}" for n in notes]
    result = "\n".join(lines)
    while len(result) > cap and lines:
        lines.pop(0)
        result = "\n".join(lines)
    return result


class PromptBuilder:
    """Builds contextual prompts for each pipeline stage.

    Accumulates inter-stage outputs and renders stage-appropriate prompts.
    Acts as a context assembler: build_context() returns a dict used by
    resolve_agent() in the pipeline loop to substitute placeholders in agent
    .md templates.
    """

    _MAX_STATUS_JSON_LEN = 50_000  # truncate serialised status beyond this

    def __init__(self, work_request_title: str, work_request_description: str = "",
                 context_path: str = None,
                 master_plan_path: str = "MASTER_PLAN.md",
                 resolver=None, core_dir: str = None,
                 template_agents_dir: str = None, run_dir: str = None,
                 work_request_guide_content: str = ""):
        self._title = work_request_title
        self._description = work_request_description or work_request_title
        self._guide_content = work_request_guide_content
        self._graphify_available = False
        self._crg_available = False
        self._context: dict = {}
        self._context_path = context_path
        self._master_plan_path = master_plan_path
        self._resolver = resolver
        self._core_dir = core_dir
        self._template_agents_dir = template_agents_dir
        self._run_dir = run_dir

    def set_graphify_available(self, available: bool) -> None:
        """Flag whether a queryable code knowledge graph is available this run.

        Set True after PREFLIGHT resolves a ready snapshot, and again on resume
        when the PREFLIGHT handler is skipped. Agents query the graph on demand
        via the ``GRAPHIFY_OUT`` env var the runner injects — no report content
        is carried in the prompt; this only toggles the per-run availability
        note exposed as ``has_graphify``.
        """
        self._graphify_available = bool(available)

    def set_crg_available(self, available: bool) -> None:
        """Flag whether a CRG MCP code graph is available this run.

        Set True after PREFLIGHT seeds the run-scoped CRG database, and again
        on resume. Agents receive MCP tools via ``--mcp-config``; this only
        toggles the ``has_code_review_graph`` availability note in block.md.
        """
        self._crg_available = bool(available)

    def update_context(self, key: str, value) -> None:
        """Store inter-stage output for use in downstream prompts.

        Dual-write (W-072 §4): a flat key with a namespaced alias also
        writes its ``stages.<stage>.<output>`` form, so templates referencing
        either form stay consistent during the migration window.
        """
        self._context[key] = value
        namespaced = alias_for(key)
        if namespaced is not None:
            self._set_namespaced(namespaced, value)

    def publish_output(self, stage: str, name: str, value) -> None:
        """Publish a stage output under the namespaced contract (W-072 §1).

        Writes ``stages.<stage>.<name>``; when the output has a legacy flat
        alias, dual-writes the flat key too (kept through the deprecation
        window for third-party overlays referencing flat keys).
        """
        namespaced = f"stages.{stage}.{name}"
        self._set_namespaced(namespaced, value)
        flat = flat_for(namespaced)
        if flat is not None:
            self._context[flat] = value

    def _set_namespaced(self, namespaced: str, value) -> None:
        """Set a dotted key as a nested dict path inside self._context."""
        parts = namespaced.split(".")
        cur = self._context
        for part in parts[:-1]:
            nxt = cur.get(part)
            if not isinstance(nxt, dict):
                nxt = {}
                cur[part] = nxt
            cur = nxt
        cur[parts[-1]] = value

    def get_context(self, key: str, default=None):
        """Retrieve stored inter-stage context.

        Supports dotted namespaced keys and falls through the flat<->
        namespaced alias table on a miss (W-072 §4).
        """
        return _dig(self._context, key, default)

    def pop_context(self, key: str):
        """Remove and return a context key value. Returns None if key not present.

        Pops both the flat key and its namespaced alias (when one exists) so
        a dual-written value doesn't survive in the other form.
        """
        value = self._context.pop(key, None)
        namespaced = alias_for(key) if "." not in key else key
        if namespaced is not None and "." in namespaced:
            popped = self._pop_namespaced(namespaced)
            if value is None:
                value = popped
            flat = flat_for(namespaced)
            if flat is not None and flat != key:
                self._context.pop(flat, None)
        return value

    def _pop_namespaced(self, namespaced: str):
        """Remove a dotted key from the nested dict path. Returns the value."""
        parts = namespaced.split(".")
        cur = self._context
        for part in parts[:-1]:
            cur = cur.get(part)
            if not isinstance(cur, dict):
                return None
        return cur.pop(parts[-1], None)

    def _read_master_plan(self) -> str:
        """Read plan content from disk. Checks MASTER_PLAN.md first, then falls
        back to the ``plan_file_path`` context key (set when a pre-made plan is
        provided via CLI and MASTER_PLAN.md is not created).
        Returns empty string if neither is found."""
        for path in (self._master_plan_path, self._context.get("plan_file"), self._context.get("plan_file_path")):
            if not path:
                continue
            try:
                if os.path.exists(path):
                    with open(path, encoding="utf-8") as f:
                        content = f.read().strip()
                    if content:
                        return content
            except OSError:
                pass
        return ""

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
        context_copy["schema_version"] = PROMPT_CONTEXT_SCHEMA_VERSION
        serialized = json.dumps(context_copy, indent=2, default=str)
        if len(serialized.encode()) > _MAX_CONTEXT_BYTES:
            # Drop oldest-inserted keys first; the schema_version marker is
            # never droppable (a v2 file must stay detectable as v2).
            keys = [k for k in context_copy if k != "schema_version"]
            while keys and len(serialized.encode()) > _MAX_CONTEXT_BYTES:
                del context_copy[keys.pop(0)]
                serialized = json.dumps(context_copy, indent=2, default=str)

        fd, tmp_path = tempfile.mkstemp(dir=p.parent, prefix=".tmp_", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(serialized)
                f.write("\n")
            os.replace(tmp_path, path)
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

        Handles both file format versions (W-072 §2): version 2 carries a
        "schema_version" marker and a nested "stages" namespace; version 1
        (no marker) carries flat keys only — it loads unchanged, and
        namespaced reads of its data resolve through the alias table.

        Raises:
            ValueError: If the file exists but is not valid JSON. A corrupt
                context file must fail the resume loudly — silently continuing
                with missing inter-stage context produces wrong agent prompts
                downstream (e.g. an implementer retry without test_failures).
        """
        path = context_path or self._context_path
        if not path:
            return
        if not os.path.exists(path):
            return
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            raise ValueError(
                f"prompt_context file {path} is corrupt (invalid JSON): {e}. "
                "Refusing to resume with partial inter-stage context — "
                "fix or delete the file and resume again."
            ) from e
        data.pop("schema_version", None)
        self._context.update(data)

    def build_context(self, stage: str, iteration: int = 0) -> dict:
        """Assemble the context dict for block/placeholder resolution.

        Returns a dict containing all inter-stage context values plus
        computed values for the given stage and iteration. This dict is
        used by resolve_agent() to substitute {{placeholder}} tokens and
        resolve {{block:name}} references in agent .md templates.

        Args:
            stage: Pipeline stage name.
            iteration: Loop iteration number (0 = first run, >0 = retry).

        Returns:
            Context dict with all keys needed for block/placeholder resolution.
        """
        ctx = dict(self._context)
        ctx["work_request"] = self._work_request_section()
        ctx["assigned_task"] = self._assigned_task_body()
        ctx["guide_content"] = self._guide_content
        ctx["has_guide"] = bool(self._guide_content)
        ctx["has_graphify"] = self._graphify_available
        ctx["has_code_review_graph"] = self._crg_available

        all_notes = ctx.get("all_design_notes") or []
        assigned = ctx.get("assigned_bead_id") or ""
        sibling_notes = [n for n in all_notes if n.get("bead_id") != assigned]
        rendered = _render_notes(sibling_notes, _DESIGN_NOTES_CAP)
        ctx["accumulated_design_notes"] = rendered
        ctx["has_design_notes"] = bool(rendered)

        self._apply_stage_context(stage, iteration, ctx)
        return ctx

    def _apply_stage_context(self, stage: str, iteration: int, ctx: dict) -> None:
        """Populate stage-specific context keys in-place.

        Handles mode routing (e.g. plan_revision_mode, is_retry) and
        pre-formats complex data structures into Markdown strings before
        storing them as context values for placeholder substitution.

        Args:
            stage: Pipeline stage name.
            iteration: Loop iteration number.
            ctx: Context dict to mutate in place.
        """
        if stage == "plan":
            ctx["has_review_comments"] = bool(ctx.get("review_comments"))
            if ctx.get("plan_revision_mode"):
                # Prefer the plan content threaded by the runner at the revise
                # loopback (the current plan being revised). Under W-061's
                # append-only scheme plan_file already points at the *next*
                # (not-yet-written) numbered file, so reading it from disk would
                # be empty — the threaded content is the authoritative source.
                ctx["plan_content"] = ctx.get("plan_file_content") or self._read_master_plan()
                ctx["plan_review_issues_formatted"] = self._format_plan_review_issues(
                    ctx.get("plan_review_issues") or []
                )
                ctx["plan_review_history_formatted"] = self._format_plan_review_history(
                    ctx.get("plan_review_history") or []
                )

        elif stage == "plan_review":
            # Prefer plan content already in context (set by runner after PLAN stage)
            # to avoid race condition where the file isn't flushed yet
            ctx["plan_content"] = ctx.get("plan_file_content") or self._read_master_plan()
            if iteration > 0:
                ctx["plan_review_history_formatted"] = self._format_plan_review_history(
                    ctx.get("plan_review_history") or []
                )
            else:
                ctx["plan_review_history_formatted"] = ""

        elif stage == "coordinate":
            # W-061: the coordinator decomposes the FULL current plan file, not a
            # derived summary. After a plan_review revision the Planner's
            # structured tasks_outline is delta-scoped (only what changed), so
            # summarizing it would hand the coordinator just the revision
            # changelog. Prefer the plan content threaded from the last PLAN
            # completion; otherwise read the current (latest) plan file.
            ctx["current_plan"] = ctx.get("plan_file_content") or self._read_master_plan()
            has_review_comments = bool(ctx.get("review_comments"))
            ctx["has_review_comments"] = has_review_comments

            # W-069: resolve effective bead cap; PR-revision runs suppress the cap
            # so comment-to-bead decomposition is unconstrained.
            if has_review_comments:
                effective_cap = 0
            else:
                override = ctx.get("max_beads_override")
                config_cap = ctx.get("max_beads_config", 0) or 0
                effective_cap = override if override is not None else config_cap
            ctx["max_beads"] = effective_cap
            ctx["bead_cap_single"] = effective_cap == 1
            ctx["bead_cap_multi"] = effective_cap > 1

            unresolved = ctx.get("unresolved_plan_issues")
            if unresolved:
                ctx["unresolved_plan_issues_formatted"] = self._format_plan_review_issues(unresolved)
            else:
                ctx["unresolved_plan_issues_formatted"] = ""

        elif stage == "implement":
            ctx["is_retry"] = iteration > 0
            if iteration > 0:
                test_failures = ctx.get("test_failures")
                review_issues = ctx.get("review_issues")
                review_history = ctx.get("review_history") or []
                test_failure_history = ctx.get("test_failure_history") or []
                attempt_count = len(review_history) or len(test_failure_history) or iteration

                if test_failures:
                    ctx["issue_type"] = "Test Failures"
                elif review_issues:
                    ctx["issue_type"] = "Review Issues"
                else:
                    ctx["issue_type"] = "Issues"

                ctx["attempt_count"] = attempt_count
                ctx["test_failures_formatted"] = self._format_test_failures(test_failures or [])
                ctx["review_issues_formatted"] = self._format_review_issues(review_issues or [])

                if len(review_history) > 1:
                    ctx["previous_attempts"] = self._format_review_history(review_history[:-1])
                elif len(test_failure_history) > 1:
                    ctx["previous_attempts"] = self._format_test_failure_history(
                        test_failure_history[:-1]
                    )
                else:
                    ctx["previous_attempts"] = ""
            else:
                ctx["issue_type"] = ""
                ctx["attempt_count"] = 0
                ctx["test_failures_formatted"] = ""
                ctx["review_issues_formatted"] = ""
                ctx["previous_attempts"] = ""

        elif stage == "test":
            files_changed = ctx.get("files_changed")
            tests_added = ctx.get("tests_added")
            ctx["implementation_summary"] = self._format_implementation_summary(
                files_changed or [], tests_added or []
            )

        elif stage == "review":
            test_passed = ctx.get("test_passed")
            if test_passed is not None:
                ctx["test_results"] = self._format_test_results(
                    test_passed,
                    ctx.get("test_coverage"),
                    ctx.get("proof_artifacts"),
                )
            else:
                ctx["test_results"] = ""
            files_changed = ctx.get("files_changed")
            if files_changed:
                ctx["files_changed_formatted"] = "\n".join(f"- {f}" for f in files_changed)
            else:
                ctx["files_changed_formatted"] = ""
            # Inject review_base for proper diff scoping (pre-inherited code exclusion)
            ctx["review_base"] = self._context.get("review_base", "")

        elif stage == "learn":
            full_status = ctx.get("full_status") or {}
            ctx["termination_type"] = ctx.get("termination_type") or "unknown"
            ctx["plan_content"] = ctx.get("plan_file_content") or ""
            run_id = full_status.get("run_id", "unknown")
            ctx["run_id"] = run_id
            status_json = json.dumps(full_status, indent=2, default=str)
            if len(status_json) > self._MAX_STATUS_JSON_LEN:
                status_json = status_json[:self._MAX_STATUS_JSON_LEN] + "\n... (truncated)"
            ctx["run_data"] = status_json
            # Ground-truth diff since the run started. Learner must use this,
            # not iteration prose, to decide what the pipeline produced.
            ctx["files_changed_since_git_head"] = self._diff_since_git_head(
                full_status.get("git_head"),
            )

    @staticmethod
    def _diff_since_git_head(git_head: str | None) -> str:
        """Return `git diff --stat` from git_head to the current tree.

        Used by the learn stage to give the learner ground truth about what
        the pipeline produced — prevents it from confusing "already complete
        within a prior iteration" with "pre-existing before the session."

        Returns the empty string if git_head is missing, the git call fails,
        or the diff is empty (no changes). Safe on non-git projects.
        """
        if not git_head:
            return ""
        try:
            import subprocess
            # --stat gives a compact summary; --name-status is an alternative
            # if the diffstat would be too long. 200KB cap prevents pathological
            # cases from exploding the prompt.
            result = subprocess.run(
                ["git", "diff", "--stat", f"{git_head}..HEAD"],
                capture_output=True, text=True, timeout=10,
            )
            if result.returncode != 0:
                return ""
            out = (result.stdout or "").strip()
            # Also include uncommitted working-tree changes against HEAD — the
            # guardian's commit may not have run, but the work still happened.
            result_wt = subprocess.run(
                ["git", "diff", "--stat", "HEAD"],
                capture_output=True, text=True, timeout=10,
            )
            if result_wt.returncode == 0:
                wt_out = (result_wt.stdout or "").strip()
                if wt_out:
                    if out:
                        out = out + "\n\n# Uncommitted working-tree changes\n" + wt_out
                    else:
                        out = "# Uncommitted working-tree changes\n" + wt_out
            if len(out) > 200_000:
                out = out[:200_000] + "\n... (truncated)"
            return out
        except (OSError, subprocess.SubprocessError):
            return ""

    def _load_agent_template(self, stage: str) -> str:
        """Read the overlay-merged agent .md template for the given stage.

        Reads from {run_dir}/agents/{agent_name}.md — the template file that
        contains unresolved {{block:name}} and {{placeholder}} tokens. Returns
        empty string if run_dir is not configured or the file doesn't exist.

        Args:
            stage: Pipeline stage name.

        Returns:
            Template content string, or empty string if unavailable.
        """
        if self._run_dir is None:
            return ""
        from worca.orchestrator.stages import Stage, STAGE_AGENT_MAP
        try:
            stage_enum = Stage(stage)
        except ValueError:
            return ""
        agent_name = STAGE_AGENT_MAP.get(stage_enum)
        if not agent_name:
            return ""
        template_path = os.path.join(self._run_dir, "agents", f"{agent_name}.md")
        try:
            with open(template_path, encoding="utf-8") as f:
                return f.read()
        except OSError:
            return ""

    def _work_request_section(self) -> str:
        """Common work request content for {{work_request}} placeholder.

        Returns title + description only — no heading. Block files provide
        the ## Work Request heading so template authors control structure.
        """
        return f"**{self._title}**\n\n{self._description}"

    # -- Pre-formatting helpers ------------------------------------------------

    @staticmethod
    def _format_test_failures(failures: list) -> str:
        """Format a list of test failure dicts into a numbered Markdown string."""
        if not failures:
            return ""
        lines = []
        for i, f in enumerate(failures, 1):
            name = f.get("test_name", "unknown")
            error = f.get("error", "no details")
            lines.append(f"{i}. **{name}**\n   {error}")
        return "\n".join(lines)

    @staticmethod
    def _format_review_issues(issues: list) -> str:
        """Format a list of review issue dicts into a numbered Markdown string."""
        if not issues:
            return ""
        lines = []
        for i, issue in enumerate(issues, 1):
            file = issue.get("file", "?")
            line = issue.get("line", "?")
            sev = issue.get("severity", "?")
            desc = issue.get("description", "")
            lines.append(f"{i}. [{sev}] `{file}:{line}`\n   {desc}")
        return "\n".join(lines)

    @staticmethod
    def _format_review_history(history: list) -> str:
        """Format a list of review history entries into Markdown bullet lines."""
        if not history:
            return ""
        lines = []
        for entry in history:
            attempt = entry.get("attempt", "?")
            issues = entry.get("issues", [])
            issue_summary = "; ".join(
                f"[{iss.get('severity','?')}] {iss.get('file','?')}:{iss.get('line','?')}"
                for iss in issues
            )
            lines.append(f"- Attempt {attempt}: {issue_summary}")
        return "\n".join(lines)

    @staticmethod
    def _format_test_failure_history(history: list) -> str:
        """Format a list of test failure history entries into Markdown bullet lines."""
        if not history:
            return ""
        lines = []
        for entry in history:
            attempt = entry.get("attempt", "?")
            failures = entry.get("failures", [])
            fail_summary = "; ".join(f.get("test_name", "unknown") for f in failures)
            lines.append(f"- Attempt {attempt}: {fail_summary}")
        return "\n".join(lines)

    @staticmethod
    def _format_plan_review_issues(issues: list) -> str:
        """Format a list of plan review issue dicts into a numbered Markdown string."""
        if not issues:
            return ""
        lines = []
        for i, issue in enumerate(issues, 1):
            category = issue.get("category", "?")
            severity = issue.get("severity", "?")
            description = issue.get("description", "")
            suggestion = issue.get("suggestion", "")
            evidence = issue.get("evidence", "")
            line = f"{i}. [{severity}] ({category}) {description}"
            if suggestion:
                line += f"\n   Suggestion: {suggestion}"
            if evidence:
                line += f"\n   Evidence: {evidence}"
            lines.append(line)
        return "\n".join(lines)

    @staticmethod
    def _format_plan_review_history(history: list) -> str:
        """Format a list of plan review history entries into Markdown bullet lines."""
        if not history:
            return ""
        lines = []
        for entry in history:
            attempt = entry.get("attempt", "?")
            attempt_issues = entry.get("issues", [])
            summary = "; ".join(
                f"[{iss.get('severity','?')}] {iss.get('category','?')}: {iss.get('description','')}"
                for iss in attempt_issues
            )
            lines.append(f"- Attempt {attempt}: {summary}")
        return "\n".join(lines)

    @staticmethod
    def _format_implementation_summary(files_changed: list, tests_added: list) -> str:
        """Format files_changed and tests_added lists into a Markdown implementation summary."""
        parts = []
        if files_changed:
            parts.append("**Files changed:**\n" + "\n".join(f"- {f}" for f in files_changed))
        if tests_added:
            parts.append("**Tests added:**\n" + "\n".join(f"- {t}" for t in tests_added))
        return "\n\n".join(parts)

    @staticmethod
    def _format_test_results(test_passed: bool, coverage, proof_artifacts: list) -> str:
        """Format test result data into a Markdown block."""
        lines = [f"**Status:** {'PASSED' if test_passed else 'FAILED'}"]
        if coverage is not None:
            lines.append(f"**Coverage:** {coverage}%")
        if proof_artifacts:
            lines.append("**Proof artifacts:**\n" + "\n".join(f"- {a}" for a in proof_artifacts))
        return "\n".join(lines)

    def _assigned_task_body(self) -> str:
        """Return assigned task body content for context assembly.

        Omits the ## Assigned Task header (provided by the implement.block.md
        template). Returns empty string when no bead is assigned.
        """
        bead_id = self._context.get("assigned_bead_id")
        if not bead_id:
            return ""
        bead_title = self._context.get("assigned_bead_title")
        bead_description = self._context.get("assigned_bead_description")
        lines = [f"**Bead ID:** {bead_id}"]
        if bead_title:
            lines.append(f"**Title:** {bead_title}")
        if bead_description:
            lines.append(f"**Description:** {bead_description}")
        return "\n\n".join(lines)
