---
description: "Launch a worca autonomous pipeline run from natural language. Use this skill whenever the user wants to run worca, start a pipeline, launch autonomous development, implement something with worca, or says anything like 'run worca', 'start pipeline', 'build this with worca', 'launch a run', 'worca run', 'implement this'. Also trigger when the user provides a plan and wants worca to implement it, says 'implement this plan', 'run this plan with worca', or hands off a prepared plan (file or in-context). Also trigger when the user provides a GitHub issue/PR reference or a spec file and wants worca to work on it. Supports guided interview mode (bare invocation), plan handoff (plan file or in-context plan), and direct CLI passthrough (inline flags)."
---

# Run a worca pipeline

You are launching a worca autonomous pipeline run. worca plans, coordinates, implements, tests, reviews, and creates a PR — all autonomously.

## Three invocation modes

### 1. Inline mode

The user passed CLI flags directly (e.g. `/worca-cc:run --prompt "Add auth" --worktree`). Parse the flags and go straight to the Launch step. Pass all recognized flags through to `worca run`.

### 2. Plan handoff mode

The user has a prepared plan — either a file path or plan content in the conversation context — and wants worca to implement it. Detect this when:
- The user mentions "plan" and a file path (e.g. "implement this plan at docs/plans/W-078-foo.md")
- The user says "implement this plan" and plan content is visible in the conversation
- The user provides a plan and says to use a specific template or branch

**If the plan is a file path:** use `--plan PATH` directly.

**If the plan is in the conversation context (no file):** save it to a temporary file first:
```bash
cat > /tmp/worca-plan-$(date +%s).md << 'PLAN_EOF'
<plan content from context>
PLAN_EOF
```
Then use `--plan /tmp/worca-plan-<timestamp>.md`.

The `--plan` flag bypasses the Planner stage — worca goes straight to coordinating and implementing.

After identifying the plan, ask only what's still missing:
- Spec file — if the user mentions a "spec" or specification file, pass it as `--spec PATH`. Do NOT ask proactively — only if the user mentions one. **Even when `--plan` is also present, pass `--spec` as-is — do NOT silently convert to `--guide`.** worca handles spec+plan coexistence internally.
- Guide files — only if the user explicitly says "guide" or "reference guide". Pass as `--guide PATH` (repeatable). Guides carry highest authority (guide > plan > spec). When the user says "spec", always use `--spec`, never `--guide`. When ambiguous (e.g. "attach this doc"), ask: "Should this be a spec (--spec, feeds into planning) or a guide (--guide, highest authority reference)?"
- Template (if not specified) — suggest one or let the user name it
- Branch (if not specified) — default current
- Worktree vs in-place (if not specified) — default worktree

Skip the full interview — the user already did the thinking.

### 3. Interview mode

Bare `/worca-cc:run` with no flags or just a natural-language description. Walk through the interview below.

## Interview flow

Work through these steps. Skip any step where the answer is already obvious from context.

### Step 1: What to build

Ask the user what they want to build. Their answer becomes the `--prompt`.

If their answer looks like a GitHub reference (e.g. "issue 42", "#15", "PR 7"), treat it as a `--source` instead:
- "issue 42" or "#42" → `--source gh:issue:42`
- "PR 7" → `--source gh:pr:7`

If their answer looks like a file path ending in `.md`, ask whether it's a spec (`--spec`) or a plan (`--plan`). A plan bypasses the Planner stage; a spec feeds into it.

### Step 2: Base branch

Ask which branch to base the work on. Default is the current branch:

```bash
git branch --show-current
```

### Step 3: Template selection

The user may name a template directly (e.g. "use minor feature template", "quick-fix", "feature-minor-opus"). If so, resolve it to the template ID.

Common template name mappings:
- "minor feature" / "feature minor" → `feature-minor`
- "quick fix" → `quick-fix`
- "bugfix" / "bug fix" → `bugfix`
- "feature" / "full feature" → `feature`
- "refactor" → `refactor`
- "investigation" / "investigate" → `investigate`
- "test only" / "add tests" → `test-only`

If the user didn't name one, run the template adviser:

```bash
worca templates advise --prompt "<the user's prompt>" --json 2>/dev/null
```

Show the recommendation and let the user accept or pick a different one. If advise fails, skip — the project default will be used.

To list available templates:

```bash
worca templates list
```

### Step 4: Worktree mode

Default is worktree (safer, parallel-safe). Ask: "Run in a worktree? (default: yes)". If the user says no, omit `--worktree`.

The user might also say "current branch" or "in-place" — that means no worktree.

### Step 5: Spec and guide files (optional)

**Spec (`--spec`):** If the user mentions a spec or specification file, pass it as `--spec PATH`. This feeds into the Planner as structured input alongside the prompt.

**Guide (`--guide`):** Only when the user explicitly says "guide" or "reference guide". Guides carry highest authority (guide > plan > spec) and are used as normative references throughout the pipeline. This flag is repeatable.

**Rule:** "spec" → `--spec`. "guide" → `--guide`. When the user provides a file without naming it either way, ask: "Is this a spec (feeds into planning) or a guide (highest-authority reference)?" Don't conflate the two.

**CRITICAL — do NOT silently convert `--spec` to `--guide`.** When the user says "spec", always pass `--spec`, even when `--plan` is also present. `--spec` and `--plan` can coexist — worca handles the semantics internally. Do not reason that "spec feeds planner, plan bypasses planner, therefore spec is useless" and upgrade to `--guide`. That changes the authority level and pipeline behavior. If you genuinely believe the user might want `--guide` instead, **ask** — never convert silently.

## Launch

Build the `worca run` command from collected inputs:

```bash
worca run \
  --prompt "..." \        # or --source REF or --spec PATH or --plan PATH
  --worktree \            # unless user opted out
  --branch BRANCH \       # if worktree and non-default branch
  --template ID \         # if selected
  --guide PATH            # if provided, repeatable
```

Run it with `nohup` so it detaches and the user gets control back:

```bash
nohup worca run [flags] > /dev/null 2>&1 &
```

After launching, immediately check the status to get the run ID:

```bash
worca status 2>/dev/null || worca multi-status 2>/dev/null
```

Report to the user:
- The exact command that was run
- The run ID (if available)
- How to check status: "Use `/worca-cc:status` to check progress"

Then stop. Do not poll or tail — return control to the user.

## Full flag reference

These flags are all supported by `worca run`. When the user provides them inline, pass them through exactly:

| Flag | Description |
|------|-------------|
| `--prompt TEXT` | Inline work request |
| `--source REF` | External source (`gh:issue:42`, `gh:pr:15`, `bd:bd-abc`) |
| `--spec PATH` | Specification file path |
| `--plan PATH` | Plan file (bypasses Planner stage) |
| `--template ID` | Pipeline template to apply |
| `--param KEY=VALUE` | Template parameter override (repeatable) |
| `--worktree` | Run in isolated git worktree |
| `--branch BRANCH` | Worktree base branch |
| `--guide PATH` | Reference guide for planning (repeatable) |
| `--resume` | Resume from last checkpoint |
| `--max-beads N` | Cap Coordinator bead decomposition |
| `--msize N` | Turn multiplier (1-10) |
| `--mloops N` | Loop multiplier (1-10) |
| `--claude-md-mode MODE` | CLAUDE.md loading: `all`, `project`, `project+local`, `none` |

## Important notes

- Always verify `worca` is on PATH before running. If not found, tell the user to install it (`pip install worca-cc`).
- The `--worktree` flag creates an isolated git worktree — safe for parallel runs and won't disturb the user's working tree.
- `--plan` bypasses the Planner stage entirely — use it when the plan is already refined and ready. `--spec` feeds into the Planner as input.
- `--guide` attaches a reference document that takes highest authority in the pipeline (guide > plan > description).
- When using `--source gh:issue:N`, worca auto-detects plan files linked in the issue body.
- Template IDs are case-sensitive. Run `worca templates list` to see exact IDs if unsure.
