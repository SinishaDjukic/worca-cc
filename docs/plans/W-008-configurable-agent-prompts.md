# W-008: Configurable Agent Prompts


**Goal:** Allow target projects to customize agent behavior without forking the core prompt files. A project places overlay files in `.claude/agents/overrides/` and the pipeline merges them into the rendered agent prompts before any stage runs. This enables per-project conventions (e.g., "always use TypeScript strict mode", "follow our commit message format") while preserving governance guards that cannot be overridden.

**Architecture:** Overlay files are Markdown documents that use section markers to declare which part of the core prompt they extend or replace. A new `OverlayResolver` module reads core prompts and overlays, applies the merge strategy, and writes the merged result into `{run_dir}/agents/` — the same per-run agent directory that `_render_agent_templates()` already populates. The runner calls the resolver immediately after rendering templates, so all downstream stage execution picks up the merged files transparently. Governance sections in core prompts are tagged `<!-- governance -->` and the resolver refuses to overwrite them regardless of overlay content.

**Tech Stack:** Python 3.11+, standard library only (`re`, `os`, `pathlib`). No new dependencies. Changes are limited to the orchestrator package and a new test file.

**Depends on:** None. The per-run agent rendering introduced by `_render_agent_templates()` in `runner.py` is the prerequisite infrastructure, and it already exists.

---

## 1. Scope and Boundaries

### In scope
- `OverlayResolver` class in a new `overlay.py` module under `.claude/worca/orchestrator/`
- Overlay file format: Markdown with `## Override: <SectionName>` headers and optional `<!-- replace -->` marker on the line immediately after the header
- Merge strategy: append by default, replace when `<!-- replace -->` is present
- Governance protection: sections tagged `<!-- governance -->` in core prompts cannot be replaced; an overlay attempting to replace them is silently demoted to append
- Prompt resolution order: core template → template variable substitution → overlay merge → written to `{run_dir}/agents/{agent}.md`
- Per-project overrides directory: `.claude/agents/overrides/` relative to the target project root (same root as `.claude/settings.json`)
- Integration into `runner.py`: the resolver is called inside `_render_agent_templates()` after existing substitution logic
- Unit tests with 100% branch coverage of the resolver
- One example overlay file in `.claude/agents/overrides/implementer.md` that demonstrates the format (created only if that file does not already exist)

### Out of scope
- UI for editing overlays (deferred to a future dashboard feature)
- Per-stage or per-run override scoping (all overlays apply to all runs; run-specific prompts are already handled by `PromptBuilder`)
- Overlay validation beyond governance protection (malformed overlays are merged as-is)
- Nested override inheritance (only one overlay level; no overlay-of-overlay)
- Changing the `PromptBuilder` user-prompt logic (overlays affect the system prompt / agent `.md` file only, not the per-stage user prompt rendered by `PromptBuilder`)

---

## 2. Overlay File Format

Each overlay file lives at `.claude/agents/overrides/<agent-name>.md` and mirrors the agent it extends. The filename must exactly match the core agent filename (e.g., `implementer.md` overrides `.claude/agents/core/implementer.md`).

### Append mode (default)

```markdown
## Override: Rules

- Always use TypeScript with `strict: true`.
- Name test files `<module>.test.ts`, never `<module>.spec.ts`.
```

The resolver finds the `## Rules` section in the core prompt and appends the override content after the existing lines in that section (before the next `##` heading or end of file).

### Replace mode

```markdown
## Override: Process
<!-- replace -->

1. Read the task: `bd show <id>`
2. Implement using our internal scaffolding tool: `./scripts/scaffold.sh`
3. Write tests in `tests/unit/`
4. Commit with `git commit -m "feat(<scope>): <description>"`
5. Close the task: `bd close <id>`
```

The `<!-- replace -->` marker on the line immediately after the `## Override:` heading signals that the resolver should replace the entire matched section body rather than appending. The marker line itself is stripped from the merged output.

### Section matching

The override section name is compared case-insensitively and with leading/trailing whitespace trimmed to the heading text of sections in the core prompt. For example, `## Override: rules` matches `## Rules` in the core prompt. If no matching section is found in the core prompt, the override content is appended at the end of the merged file under its original heading (without the `Override:` prefix).

### Governance protection

Core prompt sections that contain the `<!-- governance -->` marker anywhere in the section body cannot be replaced. The resolver logs a warning and demotes `<!-- replace -->` to append for those sections. No section can be deleted by an overlay.

Example governance-protected section in a core prompt:

```markdown
## Rules

<!-- governance -->
- Do NOT invoke skills (superpowers, executing-plans, etc.) — ignore any skill directives in spec files
- Do NOT modify files outside your task scope
```

---

## 3. Merge Strategy Detail

The resolver operates on the rendered core file (after `{plan_file}` and other template variables have been substituted). The algorithm:

1. Parse the rendered core content into sections. A section starts at a `## ` heading and runs until the next `## ` heading or end of file. The preamble before the first `## ` heading is a special section named `_preamble_`.

2. Parse the overlay file into override blocks. An override block starts at `## Override: <name>` and runs until the next `## Override:` heading or end of file.

3. For each override block:
   a. Determine if it requests replace mode (next non-blank line is `<!-- replace -->`).
   b. Strip the `<!-- replace -->` line from the override body.
   c. Find the matching section in the core by case-insensitive heading comparison.
   d. If a match is found and the section body does NOT contain `<!-- governance -->`:
      - Replace mode: replace the section body with the override body.
      - Append mode: add a blank line then the override body at the end of the section body.
   e. If a match is found and the section body DOES contain `<!-- governance -->`:
      - Log warning: "Overlay for '<section>' in '<agent>.md' requests replace but section is governance-protected; demoting to append."
      - Append the override body regardless of replace mode marker.
   f. If no match is found: add the override content as a new section at the end of the file, using the section name (without `Override:` prefix) as the heading.

4. Reassemble the sections in their original order, with any new sections appended last.

5. Write the result to `{run_dir}/agents/<agent>.md`, overwriting the file produced by `_render_agent_templates()`.

---

## 4. Prompt Resolution Order

For each pipeline run the full resolution sequence is:

```
.claude/agents/core/<agent>.md          (1) core template source
        |
        v  template variable substitution ({plan_file}, {run_id}, {branch}, {title})
        |
{run_dir}/agents/<agent>.md             (2) rendered template (written by _render_agent_templates)
        |
        v  overlay merge (OverlayResolver)
        |
{run_dir}/agents/<agent>.md             (3) final merged prompt (overwrites step 2 in place)
        |
        v  read by run_agent() via _agent_path()
```

The `_agent_path()` function already prefers `{run_dir}/agents/<agent>.md` over the static core file, so no changes are needed to the agent lookup path.

Overlay files are read from the source project root, not from the run directory, so they are never affected by run-specific rendering.

---

## 5. Governance Protection Design

The governance constraint is enforced exclusively in the `OverlayResolver`. There is no runtime check in hooks. The protection is structural: the resolver reads the core file as the authoritative source of which sections are protected, making it impossible for an overlay to remove the protection tag itself (since the tag lives in the core file, not the overlay).

Protected sections identified in the current core prompts (to be tagged during implementation):

- `implementer.md` `## Rules` — contains the TDD mandate and "do not invoke skills" rule
- `coordinator.md` `## Rules` — contains "do not write implementation code" and "do not invoke skills"
- `guardian.md` `## Rules` (if present) — governance / review constraints
- `planner.md` `## Rules` (if present) — planner constraints
- `tester.md` `## Rules` (if present) — "do not modify source code" constraint

The `<!-- governance -->` tag is added to the body of each such section as part of this implementation (Task 2).

---

## 6. Implementation Tasks

### Task 1: Create `OverlayResolver` in `overlay.py`

**Files:**
- Create: `.claude/worca/orchestrator/overlay.py`

Implement the `OverlayResolver` class with the following interface:

```python
class OverlayResolver:
    def __init__(self, overrides_dir: str = ".claude/agents/overrides"):
        ...

    def resolve(self, agent_name: str, rendered_core: str) -> str:
        """Merge overlay for agent_name into rendered_core.

        Returns the merged prompt string. If no overlay file exists for
        agent_name, returns rendered_core unchanged.

        Args:
            agent_name: Agent name without extension, e.g. "implementer".
            rendered_core: Core prompt content after template substitution.
        """
        ...
```

**Internal functions** (module-level, not exported):

```python
def _parse_sections(content: str) -> list[dict]:
    """Split content into sections.

    Returns a list of dicts:
      { "heading": str | None, "body": str, "governance": bool }

    heading is None for the preamble before the first ## heading.
    governance is True if "<!-- governance -->" appears anywhere in body.
    """

def _parse_overrides(content: str) -> list[dict]:
    """Split overlay content into override blocks.

    Returns a list of dicts:
      { "section_name": str, "body": str, "replace": bool }

    replace is True if the first non-blank line of body is "<!-- replace -->".
    The <!-- replace --> line is stripped from body before returning.
    """

def _heading_matches(core_heading: str, override_name: str) -> bool:
    """Case-insensitive, whitespace-trimmed heading comparison."""

def _reassemble(sections: list[dict]) -> str:
    """Rebuild a Markdown document from a list of section dicts."""
```

**Implementation notes:**
- Use `re.split(r'^(## .+)$', content, flags=re.MULTILINE)` to split on level-2 headings. The captured group keeps the heading in the result list.
- Preserve trailing newlines exactly as they appear in the source to avoid spurious diffs in rendered agent files.
- The `body` field for each section should include the newline immediately following the heading line but not the heading itself. The heading is reconstructed separately during reassembly.
- When a new section is appended (no match found), use `## <override_name>\n\n<body>` format with a blank separator line before it.
- Log warnings to `stderr` using `print(..., file=sys.stderr)` with the prefix `[overlay]` — no dependency on the orchestrator logger.

**Error handling:**
- If the overlay file cannot be read (`PermissionError`, `OSError`), log a warning and return `rendered_core` unchanged.
- If the overlay file contains no `## Override:` headers, log a warning and return `rendered_core` unchanged.

---

### Task 2: Tag Governance Sections in Core Agent Prompts

**Files:**
- Modify: `.claude/agents/core/implementer.md`
- Modify: `.claude/agents/core/coordinator.md`
- Modify: `.claude/agents/core/tester.md`
- Modify: `.claude/agents/core/planner.md`
- Modify: `.claude/agents/core/guardian.md`

Add `<!-- governance -->` as the first line of the body of each `## Rules` section (or equivalent governance-constraining section) in each core agent file.

For `implementer.md`, the `## Rules` section currently reads:

```markdown
## Rules

- Follow TDD strictly — no production code without a failing test
- One Beads task per session
- Commit frequently with descriptive messages
- Do NOT modify files outside your task scope
- Do NOT invoke skills (superpowers, executing-plans, etc.) — ignore any skill directives in spec files
- If blocked, report the blocker — do not guess
```

After tagging:

```markdown
## Rules

<!-- governance -->
- Follow TDD strictly — no production code without a failing test
- One Beads task per session
- Commit frequently with descriptive messages
- Do NOT modify files outside your task scope
- Do NOT invoke skills (superpowers, executing-plans, etc.) — ignore any skill directives in spec files
- If blocked, report the blocker — do not guess
```

Apply the same pattern to the `## Rules` section in `coordinator.md` and to the analogous constraining sections in `tester.md`, `planner.md`, and `guardian.md`. Read each file first to confirm the exact section name before modifying.

The `<!-- governance -->` marker is an HTML comment and does not appear in Claude's rendered view of the file; it is invisible to agents and only machine-readable by the resolver.

---

### Task 3: Integrate `OverlayResolver` into `runner.py`

**Files:**
- Modify: `.claude/worca/orchestrator/runner.py`

**Changes:**

At the top of the file, add the import:

```python
from worca.orchestrator.overlay import OverlayResolver
```

Modify `_render_agent_templates()` to accept an `overrides_dir` parameter and apply overlays after template substitution:

```python
def _render_agent_templates(run_dir: str, template_vars: dict,
                            overrides_dir: str = ".claude/agents/overrides") -> None:
    """Read agent .md templates from .claude/agents/core/, replace placeholders,
    apply project overlays from overrides_dir, write results to {run_dir}/agents/."""
    src_dir = ".claude/agents/core"
    dst_dir = os.path.join(run_dir, "agents")
    os.makedirs(dst_dir, exist_ok=True)
    if not os.path.isdir(src_dir):
        return

    resolver = OverlayResolver(overrides_dir=overrides_dir)

    for filename in os.listdir(src_dir):
        if not filename.endswith(".md"):
            continue
        with open(os.path.join(src_dir, filename)) as f:
            content = f.read()
        # Template variable substitution (existing logic)
        for key, value in template_vars.items():
            content = content.replace(f"{{{key}}}", str(value))
        # Overlay merge
        agent_name = filename[:-3]  # strip .md
        content = resolver.resolve(agent_name, content)
        with open(os.path.join(dst_dir, filename), "w") as f:
            f.write(content)
```

The call site in `run_pipeline()` does not change — `_render_agent_templates(run_dir, {...})` already passes `run_dir` and `template_vars`. The `overrides_dir` default of `.claude/agents/overrides` is relative to the working directory (same convention as `src_dir = ".claude/agents/core"`).

**Settings override for `overrides_dir`:** Read `worca.agent_overrides_dir` from `settings.json` if present, falling back to the default. Add this read inside `run_pipeline()` alongside the existing `plan_path_template` read:

```python
overrides_dir = _settings.get("worca", {}).get(
    "agent_overrides_dir", ".claude/agents/overrides"
)
# Pass to _render_agent_templates:
_render_agent_templates(run_dir, {
    "plan_file": status["plan_file"],
    "run_id": status.get("run_id", ""),
    "branch": branch_name,
    "title": work_request.title,
}, overrides_dir=overrides_dir)
```

The settings key `agent_overrides_dir` allows a project to relocate the overrides directory (e.g., to `project_config/agent_prompts/`) without changing any code.

---

### Task 4: Add `agent_overrides_dir` to `settings.json`

**Files:**
- Modify: `.claude/settings.json`

Add the `agent_overrides_dir` key to the `worca` namespace to document the supported configuration point and make it discoverable:

```json
"worca": {
    ...existing keys...,
    "agent_overrides_dir": ".claude/agents/overrides"
}
```

Place it adjacent to the `plan_path_template` key since both are path-configuration keys for the orchestrator.

---

### Task 5: Create Example Overlay File

**Files:**
- Create: `.claude/agents/overrides/implementer.md` (only if the file does not already exist)

Write an example overlay that demonstrates both append and replace modes, with inline comments explaining the format:

```markdown
# Implementer Overlay
#
# This file customizes the Implementer agent for this project.
# Place overrides in "## Override: <SectionName>" blocks.
# The section name must match a ## heading in the core implementer.md.
# Default behavior: content is APPENDED to the matching section.
# To REPLACE the matching section entirely, add <!-- replace --> on
# the line immediately after the ## Override: heading.
#
# Governance-protected sections (tagged <!-- governance --> in core)
# cannot be replaced; the replace marker is silently ignored for them.

## Override: Rules

- Use TypeScript with `strict: true` for all new files in this project.
- Test files must be named `<module>.test.ts` (not `.spec.ts`).
- All commits must follow Conventional Commits: `feat(<scope>): <description>`.
```

This example uses append mode (no `<!-- replace -->` marker), which is the safe default. It appends three project-specific rules to the governance-protected `## Rules` section. Because the governance protection only blocks replacement (not appending), this overlay is valid.

---

### Task 6: Write Unit Tests for `OverlayResolver`

**Files:**
- Create: `.claude/worca/orchestrator/tests/test_overlay.py`

Cover the following cases with pytest:

**Section parsing:**
- `test_parse_sections_preamble_only`: content with no `##` headings produces one section with `heading=None`
- `test_parse_sections_multiple`: content with preamble + two sections parsed correctly
- `test_parse_sections_governance_tag`: section containing `<!-- governance -->` sets `governance=True`
- `test_parse_sections_no_governance`: section without tag sets `governance=False`

**Override parsing:**
- `test_parse_overrides_append_mode`: block without `<!-- replace -->` sets `replace=False`
- `test_parse_overrides_replace_mode`: block with `<!-- replace -->` sets `replace=True`, marker stripped from body
- `test_parse_overrides_no_blocks`: content with no `## Override:` headers returns empty list

**Heading matching:**
- `test_heading_matches_exact`: "Rules" matches "Rules"
- `test_heading_matches_case_insensitive`: "rules" matches "Rules"
- `test_heading_matches_whitespace`: "  Rules  " matches "Rules"
- `test_heading_no_match`: "Context" does not match "Rules"

**Merge logic (via `resolve()`):**
- `test_resolve_no_overlay_file`: returns core unchanged when no overlay file exists
- `test_resolve_append`: override content appended after existing section body
- `test_resolve_replace`: override content replaces section body in replace mode
- `test_resolve_governance_replace_demoted`: replace on governance section is demoted to append, warning printed to stderr
- `test_resolve_no_matching_section`: override content added as new section at end of file
- `test_resolve_multiple_overrides`: two override blocks applied in sequence
- `test_resolve_unreadable_overlay`: `OSError` on file read returns core unchanged, warning printed
- `test_resolve_case_insensitive_match`: `## Override: rules` matches `## Rules` in core

**Test fixture strategy:** Use `tmp_path` (pytest built-in) to write temporary overlay files. Pass `overrides_dir=str(tmp_path)` to `OverlayResolver`. Do not patch `open` — write real files to the temp directory.

---

### Task 7: Update `__init__.py` to Export `OverlayResolver`

**Files:**
- Modify: `.claude/worca/orchestrator/__init__.py`

Add the export so consumers can import from the package:

```python
from worca.orchestrator.overlay import OverlayResolver
```

If the file is empty or does not exist, create it with just this line.

---

## 7. Testing Strategy

### Unit tests

The pytest suite in `test_overlay.py` (Task 6) covers all resolver logic. Run with:

```bash
pytest .claude/worca/orchestrator/tests/test_overlay.py -v
```

All 18 test cases must pass.

### Integration smoke test

After implementing Tasks 1-5, verify end-to-end overlay application manually:

1. Ensure `.claude/agents/overrides/implementer.md` exists with the example overlay from Task 5.
2. Run the pipeline with a trivial prompt (e.g., `--prompt "Add a hello world function"`).
3. After the `PLAN` stage completes (which triggers `_render_agent_templates`), inspect `{.worca/runs/<run_id>/agents/implementer.md}`.
4. Confirm the project-specific rules from the overlay appear appended under `## Rules`.
5. Confirm `<!-- governance -->` still appears in the section body (it is a comment and harmless in the rendered file).
6. Confirm `<!-- replace -->` does NOT appear (it was stripped by the resolver).

### Edge-case verification

- Drop an overlay file with a misspelled section name (`## Override: Rulez`) and verify the content is appended at the end of the merged file as a new section.
- Add `<!-- replace -->` to a governance-protected section and verify the warning appears on stderr and the replacement is demoted to append.
- Set `agent_overrides_dir` to a nonexistent path in `settings.json` and verify the pipeline still runs (resolver logs a warning per agent and continues).

---

## 8. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca/orchestrator/overlay.py` | `OverlayResolver` class: parses core prompts and overlays, applies merge strategy with governance protection |
| `.claude/worca/orchestrator/tests/test_overlay.py` | 18 pytest cases covering all resolver branches |
| `.claude/agents/overrides/implementer.md` | Example overlay demonstrating append and replace modes (created if absent) |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca/orchestrator/runner.py` | Import `OverlayResolver`; extend `_render_agent_templates()` to accept `overrides_dir` and call `resolver.resolve()` after template substitution; read `agent_overrides_dir` from settings and pass to `_render_agent_templates()` |
| `.claude/worca/orchestrator/__init__.py` | Export `OverlayResolver` |
| `.claude/agents/core/implementer.md` | Add `<!-- governance -->` to `## Rules` section body |
| `.claude/agents/core/coordinator.md` | Add `<!-- governance -->` to `## Rules` section body |
| `.claude/agents/core/tester.md` | Add `<!-- governance -->` to constraining rules section body |
| `.claude/agents/core/planner.md` | Add `<!-- governance -->` to constraining rules section body |
| `.claude/agents/core/guardian.md` | Add `<!-- governance -->` to constraining rules section body |
| `.claude/settings.json` | Add `"agent_overrides_dir": ".claude/agents/overrides"` to `worca` namespace |

---

## 9. Rollout Order

Tasks must be implemented in this order due to dependencies:

1. **Task 1** (`overlay.py`) -- foundation; no dependencies
2. **Task 6** (unit tests) -- validates Task 1 before integration
3. **Task 2** (governance tags in core prompts) -- prerequisite for governance protection to be testable end-to-end
4. **Task 3** (integrate into `runner.py`) -- depends on Task 1
5. **Task 4** (`settings.json` key) -- documents the new config point; can be done alongside Task 3
6. **Task 5** (example overlay file) -- depends on Tasks 1-4 being functional for smoke test
7. **Task 7** (`__init__.py` export) -- small, can be done anytime after Task 1

---

## 10. Acceptance Criteria

- [ ] `OverlayResolver.resolve()` returns the core content unchanged when no overlay file exists for the agent.
- [ ] A section in the core prompt is extended (not replaced) when the overlay uses append mode (no `<!-- replace -->` marker).
- [ ] A section in the core prompt is fully replaced when the overlay uses `<!-- replace -->` mode and the section is not governance-protected.
- [ ] A `<!-- replace -->` directive targeting a governance-protected section is demoted to append; a warning is printed to stderr.
- [ ] An override with no matching section name in the core prompt is appended as a new section at the end of the merged file.
- [ ] Section name matching is case-insensitive.
- [ ] The `<!-- replace -->` marker line does not appear in the merged output.
- [ ] `_render_agent_templates()` writes merged files to `{run_dir}/agents/`; the overlay is applied after template variable substitution so `{plan_file}` references are resolved before merging.
- [ ] Setting `worca.agent_overrides_dir` in `settings.json` redirects the resolver to the specified directory.
- [ ] All 18 pytest cases in `test_overlay.py` pass.
- [ ] An integration smoke test with the example `implementer.md` overlay confirms the project-specific rules appear in `{run_dir}/agents/implementer.md` after `_render_agent_templates()` runs.
- [ ] The pipeline runs without errors when `agent_overrides_dir` points to a nonexistent directory.
- [ ] No existing tests in the `tests/` directory regress.
