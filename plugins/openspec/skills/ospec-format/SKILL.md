---
name: ospec-format
description: OpenSpec authoring rules — the exact format of main specs, delta specs (ADDED/MODIFIED/REMOVED/RENAMED), proposal.md, design.md and tasks.md, change-id naming, and the validation checklist `openspec validate --strict` enforces. Use when writing, reviewing or validating anything under openspec/.
---

# OpenSpec format cheat-sheet

Encodes OpenSpec's default `spec-driven` schema (OPSX). When `openspec/config.yaml` names another `schema`, prefer `openspec instructions <artifact> --change <id>` output when the CLI is installed.

## Main spec: `openspec/specs/<capability>/spec.md`

```markdown
# <Capability> Specification

## Purpose
<1-2 sentences: what this capability is for.>

## Requirements

### Requirement: <Name>
The system SHALL <behavior>.

#### Scenario: <Name>
- **WHEN** <condition>
- **THEN** <outcome>
```

A capability path may be nested (`identity/user-auth`). Each segment is kebab-case.

## Delta spec: `openspec/changes/<id>/specs/<capability>/spec.md`

```markdown
## Purpose
<NEW capabilities only: 1-2 sentences, at least 50 characters.>

## ADDED Requirements

### Requirement: Session timeout
The system SHALL expire an idle session after 30 minutes.

#### Scenario: Idle session expires
- **WHEN** a session has been idle for 30 minutes
- **THEN** the next request is rejected with 401

## MODIFIED Requirements

### Requirement: <exact existing header>
<the WHOLE existing requirement block, every scenario included, then edited>

## REMOVED Requirements

### Requirement: Legacy token login
**Reason**: Replaced by session login.
**Migration**: Clients switch to POST /session.

## RENAMED Requirements
- FROM: `### Requirement: Old Name`
- TO: `### Requirement: New Name`
```

Rules:
- Section headers are exactly `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, `## RENAMED Requirements`. Omit an empty section.
- Each requirement is `### Requirement: <name>`, uses SHALL or MUST, and has a description of at most about 500 characters.
- Every requirement (except REMOVED ones) has at least one `#### Scenario:`. That is **four** `#`; a `###` scenario or a bullet scenario is silently dropped. Scenarios use `- **WHEN**` / `- **THEN**` bullets (`- **GIVEN**`, `- **AND**` are allowed).
- MODIFIED copies the entire existing block. A partial copy loses detail at archive. If you are only adding behavior, use ADDED.
- REMOVED needs `**Reason**:` and `**Migration**:`. A name may not be both RENAMED and REMOVED. Every FROM has a TO.

## `proposal.md`

```markdown
# Proposal: <change-id>

## Why
<1-2 sentences: the problem or opportunity.>

## What Changes
- <bullet per change; mark breaking ones **BREAKING**>

## Capabilities

### New Capabilities
- `<capability>`: <one line>

### Modified Capabilities
- `<existing capability path>`: <what changes>

## Impact
<affected code, APIs, dependencies, systems>
```

## `design.md` (only when warranted)

`# Design`, then `## Context`, `## Goals / Non-Goals` (with **Goals:** and **Non-Goals:**), `## Decisions` (each with rationale and alternatives), `## Risks / Trade-offs` (`[Risk] → Mitigation`), and optionally `## Migration Plan` and `## Open Questions`. Write it for a cross-cutting change, a new dependency or data model, security, performance or migration risk, or real ambiguity. Skip it otherwise.

## `tasks.md`

```markdown
# Tasks

## 1. Session expiry
- [ ] 1.1 Add `SESSION_IDLE_MS` config with a unit test for the default
- [ ] 1.2 Reject idle sessions in the auth middleware (test: idle session → 401)

## 2. Docs
- [ ] 2.1 Document the timeout in docs/auth.md
```

Only `- [x]` counts as done (`[~]`, `[-]`, `[]` are unfinished). Each task says how it is verified, and each group lands its own tests. Plain bullets under a trailing `## Implementation notes` or `## Workflow follow-up` are not tracked.

## Change id

Lowercase kebab-case: letters, digits and single hyphens, with no leading or trailing hyphen. Start with a verb (`add-dark-mode`, `fix-login-timeout`, `refactor-auth-module`). Avoid `update`, `changes` and `wip`. It must be unique among active and archived changes.

## Validation checklist

Run `openspec validate <id> --strict` when `command -v openspec` finds the CLI (never install it). Check these either way:

1. `openspec/changes/<id>/` exists with `proposal.md` and `tasks.md`. The id follows the rule above.
2. `proposal.md` has Why, What Changes, Capabilities and Impact.
3. Every capability in the proposal has a delta spec, and every delta spec is listed in the proposal.
4. The change has at least one delta, unless `.openspec.yaml` sets `skip_specs: true`.
5. Delta sections use only the four headers above. Every requirement has SHALL/MUST and at least one `#### Scenario:` with WHEN and THEN.
6. Every MODIFIED, REMOVED and RENAMED-FROM header matches an existing requirement in `openspec/specs/<capability>/spec.md`, ignoring whitespace.
7. REMOVED requirements have Reason and Migration. RENAMED pairs are complete.
8. A new capability's delta has a `## Purpose` of at least 50 characters.
9. `tasks.md` uses `## N. Group` and `- [ ] N.M task` lines, and every delta requirement is covered by a task.
