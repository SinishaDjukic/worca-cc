---
name: ospec-verify
description: Verify an implemented OpenSpec change before archive on three dimensions — completeness (every task really done), correctness (every delta scenario implemented and tested), coherence (design followed, no stray scope) — and report findings by severity. Use for "verify", "check the change", or before archiving.
---

# Verify an OpenSpec change

Review the **diff** (`git status`, `git diff --stat`, `git diff HEAD`, or `git diff <base>`) against the change folder `openspec/changes/<id>/`.

| Dimension | Check | Blocking when |
|---|---|---|
| Completeness | every `- [ ]` in tasks.md is `[x]`, and every `[x]` has its work in the diff | any task unticked, or ticked but not done (critical) |
| Correctness | every delta `#### Scenario:` maps to implementing code and, in a tested project, a test; REMOVED behavior is gone; the tests pass | a scenario is unimplemented or tests fail (critical); a scenario is untested or REMOVED behavior remains (major) |
| Coherence | design.md decisions are followed; deviations are recorded under `## Implementation notes`; nothing out of scope | an unrecorded design deviation (major); stray scope (minor) |

Also run `openspec validate <id> --strict` when `command -v openspec` finds the CLI (never install it). A failure is major.

Report a **scenario → evidence** table (`capability / requirement / scenario → file:line, test`), then the issues by severity (critical / major / minor / suggestion), each with its location and a concrete fix. Only critical and major issues block archive. Be honest both ways.
