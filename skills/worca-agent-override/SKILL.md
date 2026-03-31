---
name: worca-agent-override
description: Create or update agent prompt overrides for worca pipeline agents. Use when the user wants to customize agent behavior per-project, add project-specific rules, replace agent sections, or modify how planner/coordinator/implementer/tester/guardian agents work. Triggers on "override agent", "customize agent", "agent override", "change implementer rules", etc.
---

# Agent Override Manager

Create or update per-project agent prompt overlays in `.claude/agents/overrides/`. These overlay files customize the core agent prompts without modifying the originals.

**Usage:** `/worca-agent-override [agent-name] [instruction]`

Examples:
- `/worca-agent-override` — interactive mode, asks what to change
- `/worca-agent-override implementer Use Java + Maven instead of Python` — direct
- `/worca-agent-override guardian Add a lint check before committing`

## Background

Core agent prompts live in `.claude/agents/core/<agent>.md` with `## Section` headings.
Override files in `.claude/agents/overrides/<agent>.md` use `## Override: <Section>` headings.

Two modes per section:
- **Append** (default): override body is added after the existing section content
- **Replace**: adding `<!-- replace -->` as the first line swaps the section body entirely

Sections marked `<!-- governance -->` in core prompts **cannot be replaced** — replace is automatically demoted to append. This protects safety rules.

## Procedure

### Step 1: Determine the target agent

Available agents (from `.claude/agents/core/`):

| Agent         | Role |
|---------------|------|
| planner       | Creates implementation plans |
| coordinator   | Breaks plan into tasks, dispatches implementers |
| implementer   | Writes code following TDD |
| tester        | Runs full test suite |
| guardian      | Reviews code, creates commits and PRs |
| learner       | Extracts learnings from completed runs |

If the user didn't specify an agent, ask which one. If the intent is clear from context (e.g. "change testing approach"), infer the agent.

### Step 2: Show current sections

Read the core agent prompt from `.claude/agents/core/<agent>.md` and list its `## Section` headings. Show them to the user so they know what can be targeted. Also note which sections have `<!-- governance -->` (these cannot be replaced, only appended to).

If an override file already exists at `.claude/agents/overrides/<agent>.md`, read it and show the existing overrides too.

### Step 3: Determine what the user wants

From the user's prompt, determine:
1. **Which section(s)** to target — match against the headings shown in Step 2
2. **Mode** — append (default) or replace
3. **Content** — what to add or replace with

If the user's request maps to a new section that doesn't exist in core, that's fine — it will be appended as a new section at the end of the prompt.

If the request targets a governance-protected section with replace, warn the user that it will be demoted to append at runtime. Suggest append instead.

### Step 4: Create or update the override file

Ensure the overrides directory exists:

```bash
mkdir -p .claude/agents/overrides
```

The override file is `.claude/agents/overrides/<agent>.md`.

**Format for each override block:**

```markdown
## Override: <Section Name>

<content to append>
```

Or with replace:

```markdown
## Override: <Section Name>
<!-- replace -->

<content that replaces the section body>
```

**Rules for writing the file:**
- If the file doesn't exist, create it with the new override block(s)
- If the file exists and already has a `## Override: <Section>` for the same section, update that block's content
- If the file exists but doesn't have the target section, append the new override block
- Preserve any existing override blocks for other sections
- Keep a blank line between override blocks

### Step 5: Verify and report

After writing, show the user:

1. The full contents of the override file
2. A preview of what the merged result will look like for the affected section(s). Do this by reading the core prompt section and manually applying the override logic:
   - **Append**: show `[original section content] + [override content]`
   - **Replace**: show `[override content only]`
3. Remind the user that overrides take effect on the next pipeline run — no rebuild needed

```
Agent override saved!

  File:    .claude/agents/overrides/<agent>.md
  Agent:   <agent>
  Section: <section> (append|replace)

  Preview of merged "<section>":
  ────────────────────────────────
  <merged content>
  ────────────────────────────────

  This takes effect on the next pipeline run.
```

## Edge Cases

- **User wants to remove an override**: Delete the `## Override: <Section>` block from the file. If no blocks remain, delete the file.
- **User wants to see all overrides**: List all files in `.claude/agents/overrides/` and show their contents.
- **User wants to reset an agent**: Delete `.claude/agents/overrides/<agent>.md`.
- **Multiple sections in one request**: Create multiple `## Override:` blocks in the same file.
