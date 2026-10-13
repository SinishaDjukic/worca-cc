---
name: ospec-apply
description: Implement an existing OpenSpec change task by task — read its proposal, delta specs, design and tasks.md, work the unchecked tasks in order test-first, and tick each `- [ ]` to `- [x]` only when its work is done and passing. Use for "apply", "implement the change", or resuming a half-done change.
---

# Apply an OpenSpec change

1. **Pick the change**: the id the user named, or the only active folder under `openspec/changes/` (never `archive/`). If several are active and none is named, ask.
2. **Read** `proposal.md`, `design.md`, every `specs/<capability>/spec.md` delta and `tasks.md`. `openspec instructions apply --change <id>` adds the same context when the CLI is installed (optional; never install it).
3. **Work the tasks in order**, starting at the first unchecked `- [ ]`:
   - write the test the task names (or the closest one the project's test setup allows), and watch it fail;
   - implement until it passes, then run the wider suite;
   - change that line to `- [x]`. Never tick unfinished or failing work.
4. **Implement scenarios exactly.** Every `#### Scenario:` WHEN/THEN in the delta specs must hold. If one cannot, leave its task unticked and add a plain bullet under a trailing `## Implementation notes` in `tasks.md`. Do not quietly edit the delta spec.
5. Stay inside the change's scope. Report tasks ticked / total and the test command with its result.
