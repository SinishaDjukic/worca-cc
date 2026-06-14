# Plan Template

Guideline for writing `docs/plans/W-NNN-*.md` files. Synthesized from W-030 through W-039.

**Picking the `W-NNN` number:** this is *not* the GitHub issue number. Scan existing `docs/plans/W-*.md` files and use the next integer after the largest existing one (e.g. if `W-039` exists, the next plan is `W-040`). Zero-pad to three digits.

## Universal Section Order

1. **Title + metadata** — Status, Priority, Area, Date, Depends on
2. **Problem** — concrete gap, cite `file:line`, user-facing impact (50–150 words)
3. **Proposal** — solution summary (30–100 words)
4. **Design** — numbered subsections, bulk of the doc
5. **Implementation Plan** — phases/steps with file lists
6. **Considerations** — trade-offs, breaking changes, governance, migration
7. **Test Plan** — tiered (unit/integration/e2e), tests-to-update + new tests
8. **Files to Create/Modify** — structured table
9. **Out of Scope** — explicit boundaries

## Recurring Conventions

- **Cite code locations** — every constraint/design point gets `path/file.py:LN`.
- **Before/after code blocks** — show current code, then the replacement.
- **Obstacle catalog** (W-030 style) — enumerate blockers with severity + resolution for architectural plans.
- **Decision tables** — compare alternatives across dimensions (see W-036 harness viability).
- **JSON schemas inline** — include required fields and enums for any new structured output.
- **ASCII diagrams** — for multi-component flows (see W-032, W-036).
- **Migration paths** — old→new config keys spelled out (see W-031, W-038).
- **Breaking changes section** — explicit, with mitigation per item (see W-038).
- **Out of Scope section** — state what is NOT being done.

## Design Subsection Pattern

Each numbered subsection follows: *Current state* (`file:line`) → *Obstacle/gap* → *Resolution* (code snippet).

## Depth Norms

- **Small refactor** (W-034, W-039): ~400–600 lines, 2–3 design sections.
- **Mid feature** (W-031, W-035, W-038): ~600–1000 lines, 4–7 sections.
- **Large architectural** (W-030, W-032, W-036, W-037): 1500–3500 lines, obstacle catalog required.

## Template Skeleton

```markdown
# W-NNN: <Title>

**Status:** Draft | In Progress | Complete
**Priority:** P0 | P1 | P2 | P3 | P4
**Area:** cc | ui
**Date:** YYYY-MM-DD
**Depends on:** <plan IDs or "None">

## Problem
<Concrete gap with `file:line` references and user-facing impact.>

## Proposal
<High-level solution summary.>

## Design

### 1. <Component / Layer A>
- **Current state:** `path/file.py:LN` — <what exists today>
- **Obstacle:** <specific blocker>
- **Resolution:** <approach>

```python
# before / after code snippet
```

### 2. Data Model / Schema
<JSON schema blocks with required fields, enums, edge cases.>

### 3. <Integration Points>
<Where changes touch other systems.>

## Implementation Plan

### Phase 1: <Description>
**Files:** `path/to/file.py`, `path/to/file.js`
**Tasks:**
1. <Concrete action with file:line>
2. <Next action>

### Files Changed Summary

| File | Change |
|------|--------|
| `src/worca/foo.py` | Add class X, update function Y |

## Considerations
- Edge cases, tradeoffs, known unknowns
- Governance/permission implications
- **Breaking changes:** <list each with mitigation>
- **Migration:** <old→new config keys, if any>

## Test Plan

### Unit Tests
| Layer | Test | Validates |
|-------|------|-----------|
| Python | `test_x_does_y` | Behavior Z |

### Integration / E2E Tests
<Scenario descriptions with expected outcomes.>

### Existing Tests to Update
<Which tests break and how to fix them.>

## Files to Create/Modify
<Full structured table of every file touched.>

## Out of Scope
<Explicit boundaries — what is NOT being done.>
```

## When Each Pattern Fits

- **Architectural/infra** → obstacle catalog (W-030).
- **Config/settings** → lead with current `settings.json`, include migration (W-031, W-038).
- **UI features** → separate client/server/UI design sections (W-032, W-039).
- **Multi-stage pipelines** → Phases in Implementation Plan, not just file lists. Phase boundaries must be **capability boundaries, not layer boundaries** — a phase titled "Service Layer" causes downstream agents to decompose by layer instead of by feature. Write phases as vertical slices: "Phase 1: Add task priority (models + service + CLI)".
- **Harness/tool swaps** → comparison tables (W-036).

## Hard Rules

- Never skip `file:line` references in the Problem section.
- Always state done-criteria (which tests must pass).
- Always document schema changes, even enum additions.
- Always call out breaking changes + migration explicitly.
