# W-005: Agent Memory & Context Sharing


**Goal:** Give every pipeline stage a durable, human-readable view of accumulated decisions, rationale, failures, and artifacts from all prior stages. Each agent reads a shared context file at startup and appends its own summary on completion. Loop-backs (test failure → implement retry, review changes → implement retry) automatically inject the failure context so the retrying agent understands exactly what went wrong and why.

**Architecture:** A new `ContextManager` class owns one Markdown file per run at `.worca/runs/{run_id}/context.md`. The `runner.py` creates the file at run start, passes a `ContextManager` instance through the pipeline loop, calls `append_stage_entry()` after each stage completes, and injects `build_prompt_section()` into every `PromptBuilder` stage method. The context file is plain Markdown so humans can read it in any editor and agents can read it as part of their tool calls. `runner.py` also adds the context file path into the template variables rendered into agent `.md` files, so agent system prompts can reference it directly.

**Tech Stack:** Python stdlib only (no new dependencies). Markdown for the context file format. Touches `runner.py`, `prompt_builder.py`, and all five agent `.md` files.

**Depends on:** Nothing. This is a standalone enhancement to the existing pipeline.

---

## 1. Scope and Boundaries

### In scope

- `ContextManager` class in `.claude/worca/orchestrator/context_manager.py`
- Context file format: `.worca/runs/{run_id}/context.md` (one file per run)
- Runner creates the file on fresh start, rehydrates it on resume
- Each pipeline stage appends a structured entry on completion
- Loop-back stages (implement retry on test failure, implement retry on review changes) inject the failure/feedback entry into the prompt
- `PromptBuilder` gains a `set_context_file()` method and injects a `## Shared Context` section into every stage prompt
- All five agent `.md` templates gain a `{context_file}` placeholder and a read instruction
- Size limit: context file capped at 16,000 characters; older entries are summarized and compacted when the cap is reached
- `_render_agent_templates` passes `context_file` as a template variable alongside the existing `plan_file`, `run_id`, `branch`, `title`
- Unit tests for `ContextManager`: create, append, inject, compact

### Out of scope

- Cross-run memory (context does not persist between runs)
- Vector embedding or semantic search of past decisions
- UI display of the context file (worca-ui reads status.json only)
- Sharing context between parallel implementers (W-002 is a separate feature)
- Modifying the JSON output schemas (`plan.json`, `implement.json`, etc.)

---

## 2. Context File Format

The context file is a Markdown document with a fixed header and one fenced section per stage completion. This makes it readable by humans and straightforwardly parseable by agents as plain text.

### 2.1 File location

```
.worca/runs/{run_id}/context.md
```

The file is created when `run_pipeline()` sets up the run directory. On resume, the existing file is left intact — `ContextManager` opens it in append mode.

### 2.2 Document structure

```markdown
# Worca Run Context

**Run ID:** 20260310-143022
**Work Request:** Add user authentication
**Branch:** worca/add-user-authentication-4Xp
**Started:** 2026-03-10T14:30:22Z

---

## Stage: plan | 2026-03-10T14:31:05Z | iter 1

**Approach:** Implement JWT-based auth with a /api/auth/login endpoint.
Use the existing Express middleware pattern. No external auth library.

**Key Decisions:**
- Chose JWT over sessions: stateless, fits current API pattern
- Token expiry: 24h access, 7d refresh stored in HttpOnly cookie
- Files to touch: server/auth.js (new), server/app.js (register route)

**Tasks Outline:**
- Create server/auth.js with login, logout, refresh handlers
- Add auth middleware to protected routes in server/app.js
- Add tests: auth.test.js (unit), integration/auth.spec.js

**Artifacts:** docs/plans/20260310-143022-add-user-authentication.md

---

## Stage: coordinate | 2026-03-10T14:33:12Z | iter 1

**Beads Created:** [bd-001, bd-002, bd-003]
**Dependency Graph:** bd-001 → bd-002 → bd-003

---

## Stage: implement | 2026-03-10T14:45:33Z | iter 1 | trigger: initial

**Files Changed:** server/auth.js, server/app.js, tests/auth.test.js
**Tests Added:** tests/auth.test.js (12 tests)
**Bead Completed:** bd-001 (Create auth module)

---

## Stage: test | 2026-03-10T14:47:02Z | iter 1 | outcome: FAILED

**Result:** FAILED
**Failures:**
- tests/auth.test.js > token refresh > should return 401 on expired token
  Error: jwt.verify is not a function — imported from wrong path
- tests/auth.test.js > login > should hash password before compare
  Error: bcrypt.compare called with undefined salt

---

## Stage: implement | 2026-03-10T14:52:18Z | iter 2 | trigger: test_failure

**Fixes Applied:**
- Corrected jwt import path in server/auth.js (line 3)
- Fixed bcrypt.compare call: now passes hash from DB lookup
**Files Changed:** server/auth.js
**Tests Added:** (none)

---

## Stage: test | 2026-03-10T14:53:44Z | iter 2 | outcome: PASSED

**Result:** PASSED
**Coverage:** 87%
**Proof Artifacts:** .worca/runs/20260310-143022/logs/test/iter-2.log

---
```

### 2.3 Section schema

Each section has a required header line followed by freeform Markdown. The `ContextManager` writes structured content for known fields and ignores unknown ones when reading.

Header format: `## Stage: {stage_name} | {iso_timestamp} | iter {n} [| trigger: {trigger}] [| outcome: {outcome}]`

All fields after the stage name are optional. The `|`-separated format is chosen because it is scannable by a regex without a full Markdown parser.

### 2.4 Size limit and compaction

The context file must not grow so large that injecting it into a prompt consumes a prohibitive fraction of the model's context window. The limit is **16,000 characters** (approximately 4,000 tokens at average English density). This is enforced by `ContextManager.append_stage_entry()` after each write.

When the file would exceed the limit, `ContextManager._compact()` is called:

1. Parse all sections from the file.
2. Keep the file header (run metadata) verbatim.
3. Keep the last **two** sections verbatim (most recent context is highest priority).
4. Replace all earlier sections with a single `## Compacted History` block that lists only the stage name, timestamp, outcome, and one-line summary per section.
5. Rewrite the file.

The compacted format:

```markdown
## Compacted History (earlier stages summarized)

- plan | 2026-03-10T14:31:05Z | outcome: approved | Approach: JWT auth, server/auth.js new
- coordinate | 2026-03-10T14:33:12Z | outcome: success | 3 beads created
- implement | 2026-03-10T14:45:33Z | iter 1 | outcome: success | 3 files changed
- test | 2026-03-10T14:47:02Z | iter 1 | outcome: FAILED | 2 failures in auth.test.js
```

---

## 3. ContextManager Class

### 3.1 Module location

`.claude/worca/orchestrator/context_manager.py`

### 3.2 Public API

```python
class ContextManager:
    MAX_CHARS = 16_000

    def __init__(self, context_path: str):
        """
        Args:
            context_path: Absolute or relative path to the context.md file.
                          File need not exist yet; create() initialises it.
        """

    def create(self, run_id: str, title: str, branch: str, started_at: str) -> None:
        """Write the file header. Overwrites any existing file.
        Called once at the start of a fresh run."""

    def append_stage_entry(self, stage: str, iteration: int, trigger: str,
                           outcome: str, body: str) -> None:
        """Append a new stage section to the context file.
        Calls _compact() if file size would exceed MAX_CHARS after append."""

    def read_full(self) -> str:
        """Return the full content of the context file, or '' if it does not exist."""

    def build_prompt_section(self, max_chars: int = 4_000) -> str:
        """Return a Markdown section suitable for injection into an agent prompt.
        Truncates to max_chars from the end (most recent content preserved)
        with a leading note if truncated."""

    def _compact(self) -> None:
        """Internal: rewrite file keeping header + last 2 sections verbatim,
        summarising all earlier sections into a Compacted History block."""

    def _parse_sections(self, content: str) -> list[dict]:
        """Internal: parse content into a list of section dicts.
        Each dict: {'header': str, 'body': str, 'stage': str, 'outcome': str}."""
```

### 3.3 Entry body helpers

`runner.py` builds the `body` string for each stage using these conventions. `ContextManager` itself does not know about stage semantics — it accepts any Markdown string.

| Stage | Key body content |
|-------|-----------------|
| plan | Approach, Key Decisions, Tasks Outline, Artifacts (plan file path) |
| coordinate | Beads Created (IDs), Dependency Graph summary |
| implement | Files Changed, Tests Added, Bead Completed, Fixes Applied (if retry) |
| test | Result (PASSED/FAILED), Failures list (name + error), Coverage %, Proof Artifacts |
| review | Outcome, Issues list (file:line severity description) |
| pr | PR URL, Title |

---

## 4. Integration with runner.py

### 4.1 Initialization at run start

After the run directory is created and `status["run_id"]` is set, create the context file:

```python
from worca.orchestrator.context_manager import ContextManager

context_file = os.path.join(run_dir, "context.md")
ctx = ContextManager(context_file)
ctx.create(
    run_id=status["run_id"],
    title=work_request.title,
    branch=branch_name,
    started_at=status["started_at"],
)
```

On resume, skip `ctx.create()` — `ContextManager` will append to the existing file.

```python
if resume_stage:
    ctx = ContextManager(context_file)  # no create() call
else:
    ctx = ContextManager(context_file)
    ctx.create(...)
```

### 4.2 Template variable injection

Pass `context_file` (the relative path as seen from the project root) to `_render_agent_templates`:

```python
_render_agent_templates(run_dir, {
    "plan_file": status["plan_file"],
    "run_id": status.get("run_id", ""),
    "branch": branch_name,
    "title": work_request.title,
    "context_file": os.path.relpath(context_file),   # new
})
```

### 4.3 PromptBuilder wiring

After creating `prompt_builder`, call:

```python
prompt_builder.set_context_manager(ctx)
```

This lets `PromptBuilder` inject the current context snapshot into every stage prompt automatically, without `runner.py` needing to thread it manually into each `update_context()` call.

### 4.4 Per-stage context appends

After each stage completes and before advancing `stage_idx`, call `ctx.append_stage_entry()` with the structured body. This must happen **after** `complete_iteration()` and `save_status()` so the context reflects confirmed completion.

**After PLAN completes:**

```python
plan_body_parts = []
approach = result.get("approach", "")
if approach:
    plan_body_parts.append(f"**Approach:** {approach}")
tasks = result.get("tasks_outline", [])
if tasks:
    plan_body_parts.append("**Tasks Outline:**")
    for t in tasks:
        plan_body_parts.append(f"- {t.get('title','')}: {t.get('description','')}")
plan_body_parts.append(f"**Artifacts:** {status['plan_file']}")
ctx.append_stage_entry(
    stage="plan", iteration=iter_num, trigger=trigger,
    outcome="approved" if approved else "rejected",
    body="\n".join(plan_body_parts),
)
```

**After COORDINATE completes:**

```python
beads = result.get("beads_ids", [])
dep_graph = result.get("dependency_graph", {})
coord_body = f"**Beads Created:** {beads}\n**Dependency Graph:** {dep_graph}"
ctx.append_stage_entry(
    stage="coordinate", iteration=iter_num, trigger=trigger,
    outcome="success", body=coord_body,
)
```

**After IMPLEMENT completes:**

```python
files = result.get("files_changed", [])
tests = result.get("tests_added", [])
bead_id = prompt_builder.get_context("assigned_bead_id", "")
impl_parts = [
    f"**Files Changed:** {', '.join(files) if files else 'none'}",
    f"**Tests Added:** {', '.join(tests) if tests else 'none'}",
]
if bead_id:
    impl_parts.append(f"**Bead Completed:** {bead_id}")
if trigger == "test_failure":
    failures = prompt_builder.get_context("test_failures", [])
    if failures:
        impl_parts.append("**Fixes Applied (for test failures):**")
        for f in failures:
            impl_parts.append(f"- {f.get('test_name','?')}: {f.get('error','?')}")
elif trigger == "review_changes":
    issues = prompt_builder.get_context("review_issues", [])
    if issues:
        impl_parts.append("**Fixes Applied (for review feedback):**")
        for i in issues:
            impl_parts.append(f"- [{i.get('severity','?')}] {i.get('file','?')}:{i.get('line','?')} {i.get('description','')}")
ctx.append_stage_entry(
    stage="implement", iteration=iter_num, trigger=trigger,
    outcome="success", body="\n".join(impl_parts),
)
```

**After TEST completes:**

```python
passed = result.get("passed", False)
test_parts = [f"**Result:** {'PASSED' if passed else 'FAILED'}"]
if not passed:
    test_parts.append("**Failures:**")
    for f in result.get("failures", []):
        test_parts.append(f"- {f.get('test_name','?')}\n  Error: {f.get('error','?')}")
cov = result.get("coverage_pct")
if cov is not None:
    test_parts.append(f"**Coverage:** {cov}%")
artifacts = result.get("proof_artifacts", [])
if artifacts:
    test_parts.append(f"**Proof Artifacts:** {', '.join(artifacts)}")
ctx.append_stage_entry(
    stage="test", iteration=iter_num, trigger=trigger,
    outcome="PASSED" if passed else "FAILED",
    body="\n".join(test_parts),
)
```

**After REVIEW completes:**

```python
review_parts = [f"**Outcome:** {outcome}"]
issues = result.get("issues", [])
if issues:
    review_parts.append("**Issues:**")
    for i in issues:
        review_parts.append(f"- [{i.get('severity','?')}] {i.get('file','?')}:{i.get('line','?')} — {i.get('description','')}")
ctx.append_stage_entry(
    stage="review", iteration=iter_num, trigger=trigger,
    outcome=outcome, body="\n".join(review_parts),
)
```

**After PR completes:**

```python
pr_parts = []
pr_url = result.get("pr_url", "")
if pr_url:
    pr_parts.append(f"**PR URL:** {pr_url}")
ctx.append_stage_entry(
    stage="pr", iteration=iter_num, trigger=trigger,
    outcome="success", body="\n".join(pr_parts),
)
```

### 4.5 Loop-back context (the critical path)

The existing `runner.py` already calls `prompt_builder.update_context("test_failures", ...)` before looping back to IMPLEMENT. With W-005, the `test` section has already been appended to `context.md` by the time the implement retry runs. The `PromptBuilder._build_implement()` will inject the full `## Shared Context` section (which includes the test failure section verbatim) in addition to the existing failure list it already formats from `_context["test_failures"]`.

This means the retrying implementer receives:
1. The structured failure list (from `PromptBuilder`'s existing iteration logic) — fast to scan.
2. The full context file section for the failed test stage — includes proof artifact paths and the full error message as the tester recorded it.

No changes to the loop-back trigger logic in `runner.py` are required beyond adding the `ctx.append_stage_entry()` calls.

---

## 5. PromptBuilder Changes

### 5.1 New method: `set_context_manager()`

```python
def set_context_manager(self, ctx) -> None:
    """Attach a ContextManager. When set, build() injects context into prompts."""
    self._ctx = ctx
```

Add `self._ctx = None` to `__init__`.

### 5.2 New method: `_context_section()`

```python
def _context_section(self) -> str:
    """Return a ## Shared Run Context section for injection into prompts.
    Returns '' if no ContextManager is attached or context file is empty."""
    if not self._ctx:
        return ""
    snippet = self._ctx.build_prompt_section(max_chars=4_000)
    if not snippet:
        return ""
    return f"## Shared Run Context\n\n{snippet}"
```

### 5.3 Injection into each stage builder

Each `_build_{stage}()` method appends `self._context_section()` to its `parts` list before joining. The section is always appended last so the work-request and structured data appear first (agents read top-to-bottom).

Example diff for `_build_plan`:

```python
def _build_plan(self, iteration: int) -> str:
    parts = [
        "Create a detailed implementation plan ...",
        ...
        self._work_request_section(),
    ]
    if self._claude_md_content:
        parts.append(f"## Project Context (from CLAUDE.md)\n\n{self._claude_md_content}")
    context_section = self._context_section()   # new
    if context_section:                          # new
        parts.append(context_section)            # new
    return "\n\n".join(parts)
```

Apply the same three-line addition to `_build_coordinate`, `_build_implement`, `_build_test`, `_build_review`, and `_build_pr`.

For `_build_plan` specifically, the context file will be empty on the first run (it was just created). On a `restart_planning` loop, the context file will contain all prior stage entries — this is intentional and valuable: the planner can see what the guardian objected to.

---

## 6. Agent Prompt Template Changes

All five agent `.md` files in `.claude/agents/core/` receive two additions:

1. A `{context_file}` placeholder reference so the rendered template path is accurate.
2. A read instruction in the Process section.

### 6.1 planner.md

Add to the **Context** section:

```markdown
The shared run context file is at `{context_file}`. Read it before starting — it contains prior stage decisions and rationale if this is a restart.
```

Add as step 2a in **Process** (after "Read and understand the work request"):

```
2a. Read `{context_file}` if it exists — check for prior planning attempts or guardian feedback.
```

### 6.2 coordinator.md

Add to the **Context** section:

```markdown
The shared run context file is at `{context_file}`. It contains the planner's approach and key decisions. Read it before decomposing.
```

Add as step 1a in **Process** (after "Read `{plan_file}`"):

```
1a. Read `{context_file}` — confirms the approach and any architectural constraints the planner recorded.
```

### 6.3 implementer.md

Add to the **Context** section:

```markdown
The shared run context file is at `{context_file}`. On retry iterations, it contains test failure details and review feedback from prior stages.
```

Add as step 3a in **Process** (after "Read the task description"):

```
3a. Read `{context_file}` — if this is a retry, failures and review issues are recorded there. Use them to guide your fix.
```

### 6.4 tester.md

Add to the **Context** section:

```markdown
The shared run context file is at `{context_file}`. It records what the implementer changed. Read it to understand which files and tests to focus on.
```

Add as step 1a in **Process** (after discovering the test command):

```
1a. Read `{context_file}` — note the files changed by the implementer and any prior test failure patterns.
```

### 6.5 guardian.md

Add to the **Context** section:

```markdown
The shared run context file is at `{context_file}`. It contains the full pipeline history: plan decisions, implementation details, and test results.
```

Add as step 1a in **Process** (before verifying proof status):

```
1a. Read `{context_file}` — review the full pipeline history before forming a judgment.
```

---

## 7. Implementation Tasks

Tasks are ordered so that each step is independently testable and no task depends on a later one.

---

### Task 1: Create `context_manager.py`

**File:**
- Create: `.claude/worca/orchestrator/context_manager.py`

Implement the `ContextManager` class with the full public API described in Section 3.

**Implementation details:**

`create(run_id, title, branch, started_at)`:
- Build the header block as shown in Section 2.2.
- Write the file with `open(self._path, 'w')`.

`append_stage_entry(stage, iteration, trigger, outcome, body)`:
- Build the `## Stage: ...` header line.
- Append `\n\n{header}\n\n{body}\n\n---\n` to the file using `open(self._path, 'a')`.
- After appending, check `os.path.getsize(self._path)`. If it exceeds `MAX_CHARS`, call `_compact()`.

`read_full()`:
- `open(self._path)` and return content. Return `''` if `FileNotFoundError`.

`build_prompt_section(max_chars=4_000)`:
- Call `read_full()`.
- If content is empty, return `''`.
- If `len(content) <= max_chars`, return content.
- Otherwise, return the last `max_chars` characters prefixed with:
  `"[Context truncated — showing most recent {max_chars} characters]\n\n"`.

`_compact()`:
- Read the full file.
- Call `_parse_sections(content)` to get a list of section dicts.
- If fewer than 4 sections (header + compacted-history + 2 verbatim), skip compaction — not worth it.
- Build compacted history lines from all sections except the last two.
- Reconstruct the file: header block + compacted history section + last two sections verbatim.
- Write the result back with `open(self._path, 'w')`.

`_parse_sections(content)`:
- Split on `\n---\n`.
- The first chunk is the file header (no `## Stage:` prefix).
- For subsequent chunks, match the `## Stage: {stage} | {ts} | iter {n}` pattern.
- Return a list of dicts: `[{'raw': str, 'stage': str, 'timestamp': str, 'outcome': str}]`.
- Chunks that don't match the stage pattern are treated as the header.

---

### Task 2: Add unit tests for `ContextManager`

**File:**
- Create: `tests/test_context_manager.py`

**Test cases:**

`test_create_writes_header`: Call `create()`, read the file, assert header contains run_id, title, branch.

`test_append_stage_entry_adds_section`: Call `create()`, then `append_stage_entry()`. Read the file. Assert section header is present with correct stage, iteration, outcome.

`test_append_multiple_entries_ordered`: Append plan, coordinate, implement entries. Assert they appear in order in the file.

`test_build_prompt_section_under_limit`: Create a context file under `max_chars`. Assert `build_prompt_section()` returns the full content.

`test_build_prompt_section_truncates`: Create a context file over `max_chars`. Assert `build_prompt_section(max_chars=100)` returns only the last 100 chars plus the truncation prefix.

`test_compact_triggered_on_overflow`: Set `MAX_CHARS` to 500 in the test. Append enough entries to exceed it. Assert the file is smaller than `MAX_CHARS` after the next `append_stage_entry()` call. Assert the `## Compacted History` block is present. Assert the last two sections are verbatim.

`test_compact_preserves_last_two_sections`: After compaction, parse the file. Assert the last two stage headers match the last two entries appended.

`test_read_full_nonexistent_returns_empty`: Call `read_full()` on a non-existent path. Assert returns `''`.

`test_create_overwrites_existing`: Write a file, call `create()` again with a different run_id. Assert the old content is gone.

`test_parse_sections_handles_no_sections`: Call `_parse_sections()` with only the header block. Assert returns empty list (or list with just the header).

All tests use `tmp_path` from pytest fixtures. No mocking needed — `ContextManager` only touches the filesystem.

---

### Task 3: Update `PromptBuilder` to inject context

**File:**
- Modify: `.claude/worca/orchestrator/prompt_builder.py`

**Changes:**

1. Add `self._ctx = None` in `__init__`.

2. Add `set_context_manager(self, ctx) -> None` method (sets `self._ctx`).

3. Add `_context_section(self) -> str` method (calls `self._ctx.build_prompt_section(max_chars=4_000)` if `self._ctx` is set, wraps in `## Shared Run Context` header, returns `''` if empty).

4. In each of the six `_build_{stage}()` methods, append `self._context_section()` to `parts` before the final `return "\n\n".join(parts)`. Use `if context_section: parts.append(context_section)` pattern to avoid empty sections.

---

### Task 4: Add unit tests for `PromptBuilder` context injection

**File:**
- Modify: `tests/test_prompt_builder.py` (extend existing test file)

**Test cases:**

`test_build_plan_without_context_manager`: Existing tests should still pass unchanged — verify `set_context_manager` was not called, `build()` returns no `## Shared Run Context` section.

`test_build_plan_with_empty_context`: Attach a `ContextManager` pointing to a nonexistent file. Assert the built prompt has no `## Shared Run Context` section.

`test_build_plan_with_context`: Create a temp context file with one stage entry. Attach a `ContextManager`. Call `build("plan", 0)`. Assert the prompt contains `## Shared Run Context` and the stage entry text.

`test_build_implement_with_context`: Same but for the implement stage.

`test_build_test_with_context`: Same but for the test stage.

`test_context_section_truncates_large_context`: Create a context file with 10,000 characters. Attach `ContextManager`. Call `build("implement", 0)`. Assert the `## Shared Run Context` section is present but truncated.

---

### Task 5: Wire `ContextManager` into `runner.py`

**File:**
- Modify: `.claude/worca/orchestrator/runner.py`

**Changes — import:**

```python
from worca.orchestrator.context_manager import ContextManager
```

**Changes — initialization block (after run directory creation, before the main loop):**

```python
context_file = os.path.join(run_dir, "context.md")
ctx = ContextManager(context_file)
if not resume_stage:
    ctx.create(
        run_id=status["run_id"],
        title=work_request.title,
        branch=branch_name,
        started_at=status["started_at"],
    )
# else: resume — context.md already exists, ContextManager will append
```

**Changes — template variables:**

Add `"context_file": os.path.relpath(context_file)` to the `_render_agent_templates` call dict.

**Changes — PromptBuilder wiring:**

After constructing `prompt_builder`, add:

```python
prompt_builder.set_context_manager(ctx)
```

**Changes — per-stage append calls:**

After each stage's `save_status()` call and before `stage_idx += 1`, add the corresponding `ctx.append_stage_entry()` call using the body-building pattern described in Section 4.4.

This must be placed **after** `complete_iteration()` / `update_stage()` / `save_status()` to ensure the status file is consistent before the context is updated.

For loop-back stages (where `continue` is called instead of `stage_idx += 1`), the `ctx.append_stage_entry()` call must be placed **before** the `continue` statement, since the `stage_idx += 1` at the bottom of the loop is never reached.

**Example placement for TEST failure path:**

```python
# Thread test failures ...
ctx.append_stage_entry(          # new: append before continue
    stage="test", iteration=iter_num, trigger=trigger,
    outcome="FAILED", body="\n".join(test_parts),
)
_next_trigger[Stage.IMPLEMENT.value] = "test_failure"
stage_idx = stage_order.index(Stage.IMPLEMENT)
continue
```

---

### Task 6: Update agent `.md` templates

**Files:**
- Modify: `.claude/agents/core/planner.md`
- Modify: `.claude/agents/core/coordinator.md`
- Modify: `.claude/agents/core/implementer.md`
- Modify: `.claude/agents/core/tester.md`
- Modify: `.claude/agents/core/guardian.md`

Apply the additions described in Section 6 to each file. The placeholder `{context_file}` will be replaced at runtime by `_render_agent_templates()` before the agent is invoked.

**Exact addition to each file's Context section** (adapt wording per agent as shown in Section 6):

```markdown
The shared run context file is at `{context_file}`. [Agent-specific description of what it contains and when to read it.]
```

**Exact addition to each file's Process section** (insert at the appropriate step):

```
{N}. Read `{context_file}` — [agent-specific guidance on what to look for].
```

Keep the process step ordering logical. For the planner, reading context comes before exploring the codebase. For the implementer, it comes after claiming the bead but before writing code. For the tester and guardian, it is the first step.

---

### Task 7: Integration test — full pipeline with context file

**File:**
- Create: `tests/test_runner_context.py`

This test runs a trimmed mock pipeline through `run_pipeline()` with all agents mocked to return minimal valid structured outputs. It verifies:

1. The context file is created at the expected path.
2. After the PLAN stage, the context file contains a `## Stage: plan` section.
3. After the COORDINATE stage, the context file contains a `## Stage: coordinate` section.
4. After a simulated TEST failure and IMPLEMENT retry, the context file contains two `## Stage: implement` entries and two `## Stage: test` entries in order.
5. The rendered prompt for the implement retry (iteration > 0) contains `## Shared Run Context`.
6. On resume (`resume=True`), the context file is not overwritten — new entries are appended to the existing content.

**Setup approach:**

- Use `unittest.mock.patch` to mock `run_agent` in `runner.py` so no actual Claude CLI calls are made.
- Return minimal valid structured outputs for each stage: `{"approved": True, "approach": "test approach", "tasks_outline": []}` for plan, etc.
- Simulate test failure on first TEST call by returning `{"passed": False, "failures": [{"test_name": "t1", "error": "oops"}]}`, then pass on second.
- Use `tmp_path` (pytest) for all file system paths.

---

## 8. File Summary

### New files

| File | Purpose |
|------|---------|
| `.claude/worca/orchestrator/context_manager.py` | `ContextManager` class: create, append, compact, inject |
| `tests/test_context_manager.py` | Unit tests for `ContextManager` |
| `tests/test_runner_context.py` | Integration test: full pipeline with context file verification |

### Modified files

| File | Changes |
|------|---------|
| `.claude/worca/orchestrator/prompt_builder.py` | Add `set_context_manager()`, `_context_section()`, inject context in all 6 `_build_*` methods |
| `.claude/worca/orchestrator/runner.py` | Import `ContextManager`, create/resume context file, pass to `PromptBuilder`, append entries after each stage, add `context_file` to template vars |
| `.claude/agents/core/planner.md` | Add `{context_file}` reference and read instruction |
| `.claude/agents/core/coordinator.md` | Add `{context_file}` reference and read instruction |
| `.claude/agents/core/implementer.md` | Add `{context_file}` reference and read instruction |
| `.claude/agents/core/tester.md` | Add `{context_file}` reference and read instruction |
| `.claude/agents/core/guardian.md` | Add `{context_file}` reference and read instruction |
| `tests/test_prompt_builder.py` | Add context injection tests |

---

## 9. Rollout Order

Tasks should be implemented in this order. Each task is independently testable before proceeding.

1. **Task 1** (`context_manager.py`) — core class, no dependencies
2. **Task 2** (unit tests for `ContextManager`) — validates Task 1 before any runner changes
3. **Task 3** (`PromptBuilder` changes) — depends on Task 1 (imports `ContextManager` indirectly via duck-typing)
4. **Task 4** (unit tests for `PromptBuilder`) — validates Task 3
5. **Task 5** (`runner.py` wiring) — depends on Tasks 1 and 3
6. **Task 6** (agent `.md` templates) — independent, can run in parallel with Tasks 3-5
7. **Task 7** (integration test) — depends on Tasks 1, 3, 5; run last to confirm everything works together

---

## 10. Acceptance Criteria

- [ ] A file `.worca/runs/{run_id}/context.md` is created for every fresh pipeline run.
- [ ] The context file contains one `## Stage: {name}` section per completed stage, in chronological order.
- [ ] The implement retry prompt (iteration > 0, trigger `test_failure`) contains a `## Shared Run Context` section that includes the failed test section from the previous test stage.
- [ ] The implement retry prompt (iteration > 0, trigger `review_changes`) contains a `## Shared Run Context` section that includes the review issues recorded by the guardian.
- [ ] On pipeline resume, the context file is not overwritten; new entries are appended.
- [ ] When the context file exceeds 16,000 characters, it is automatically compacted: the last two sections remain verbatim and earlier sections appear in the `## Compacted History` summary block.
- [ ] `build_prompt_section(max_chars=4_000)` never returns more than 4,000 characters.
- [ ] All five agent `.md` templates reference `{context_file}` and include a read instruction in their Process section.
- [ ] The rendered agent templates in `.worca/runs/{run_id}/agents/` contain the actual file path (no unresolved `{context_file}` placeholder).
- [ ] All unit tests in `tests/test_context_manager.py` pass (`pytest tests/test_context_manager.py -v`).
- [ ] All new tests in `tests/test_prompt_builder.py` pass without breaking existing tests.
- [ ] The integration test in `tests/test_runner_context.py` passes end-to-end including the loop-back scenario.
- [ ] No new Python package dependencies are introduced.
- [ ] The existing `tests/` suite continues to pass with no regressions (`pytest tests/ -v`).
